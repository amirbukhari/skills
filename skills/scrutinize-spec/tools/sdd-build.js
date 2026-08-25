#!/usr/bin/env node
/**
 * sdd-build — the scrutinize gate as the precondition for LLM generation.
 *
 * "You cannot compile a spec that hasn't earned it." For each requested module
 * this runs a LIVE scrutiny of the CURRENT spec (it never trusts a stale
 * committed score), gates on it, and only if the gate passes does it invoke the
 * generator. If the gate fails, nothing is generated and any prior artifact is
 * left untouched.
 *
 * Two things are pluggable and independent:
 *   - The GATE's dimension assessment (what a human/model judges the spec to be):
 *       --scrutinize-stub   read the committed .analysis/<module>.json (zero cost)
 *       default             call the `claude` CLI to assess the live spec -> JSON
 *     Either way, scoring itself is always run LIVE by scripts/score.js — the
 *     deterministic part is never stubbed, only the model's dimension judgement.
 *   - The GENERATOR backend (passed through to sdd-generate): --stub / default.
 *
 * Usage:
 *   node tools/sdd-build.js <exampleDir> [--module m] [--lang ts]
 *        [--min-score 95] [--scrutinize-stub] [--stub <golden>]
 *        [--model id] [--scrutinize-model id]
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const lib = require("./sdd-lib");

const SCORE_JS = path.join(lib.SKILL_ROOT, "scripts", "score.js");
const RUBRIC_MD = path.join(lib.SKILL_ROOT, "references", "rubric.md");

const ANALYSIS_SCHEMA_HINT = `Output ONLY a JSON object with EXACTLY these keys (no prose, no fences):
{
  "dimensionScores": { "scopeGoalClarity":0-100, "functionalCompleteness":0-100, "dataModelDefinition":0-100,
    "edgeCaseErrorHandling":0-100, "nonFunctionalRequirements":0-100, "acceptanceCriteria":0-100, "outOfScope":0-100,
    "technicalConstraints":0-100, "ambiguousLanguage":0-100, "assumptionsSection":0-100, "consistency":0-100,
    "definitionExecutability":0-100, "constantsEnumerated":0-100 },
  "flags": { "hasContradictions":bool, "dataModelRequiredButMissing":bool, "acceptanceCriteriaMissing":bool },
  "ambiguousPhraseCount":int, "unconfirmedAssumptionCount":int, "unpopulatedConstantCount":int,
  "duplicatedDefinitionCount":int, "undefinedLoadBearingTerms":[string],
  "inherits": [ { "document":string, "dimensionsSatisfied":[string] } ]
}`;

function parseArgs(argv) {
  const a = { exampleDir: null, module: null, lang: "ts", minScore: 95, scrutinizeStub: false, stub: null, model: null, scrutinizeModel: null };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--module") a.module = rest[++i];
    else if (t === "--lang") a.lang = rest[++i];
    else if (t === "--min-score") a.minScore = parseFloat(rest[++i]);
    else if (t === "--scrutinize-stub") a.scrutinizeStub = true;
    else if (t === "--stub") a.stub = path.resolve(process.cwd(), rest[++i]);
    else if (t === "--model") a.model = rest[++i];
    else if (t === "--scrutinize-model") a.scrutinizeModel = rest[++i];
    else if (!a.exampleDir) a.exampleDir = t;
    else throw new Error(`unexpected argument: ${t}`);
  }
  if (!a.exampleDir) throw new Error("usage: sdd-build.js <exampleDir> [options]");
  a.exampleDir = path.resolve(process.cwd(), a.exampleDir);
  return a;
}

/** Produce the dimension-assessment JSON for a module's live spec. */
function assessSpec(cfg, moduleName) {
  if (cfg.scrutinizeStub) {
    const committed = path.join(cfg.exampleDir, ".analysis", `${moduleName}.json`);
    if (!fs.existsSync(committed)) throw new Error(`--scrutinize-stub: no committed analysis at ${committed}`);
    return JSON.parse(fs.readFileSync(committed, "utf8"));
  }
  // Real path: ask the claude CLI to assess the live spec against the rubric.
  const specDir = path.join(cfg.exampleDir, "spec");
  const modDir = path.join(specDir, "modules", moduleName);
  const docs = [
    ...lib.listFiles(path.join(specDir, "standards"), ".md"),
    ...lib.listFiles(path.join(specDir, "contracts"), ".md"),
    path.join(modDir, "spec.md"),
    path.join(modDir, "constants.md"),
  ].filter((p) => fs.existsSync(p));
  const specText = docs.map((p) => `# ${lib.relTo(cfg.exampleDir, p)}\n\n${fs.readFileSync(p, "utf8")}`).join("\n\n---\n\n");
  const rubric = fs.existsSync(RUBRIC_MD) ? fs.readFileSync(RUBRIC_MD, "utf8") : "";
  const prompt = `Score this specification against the scrutinize-spec rubric.\n\n# RUBRIC\n\n${rubric}\n\n# SPECIFICATION (module: ${moduleName})\n\n${specText}\n\n---\n${ANALYSIS_SCHEMA_HINT}`;
  const res = spawnSync("claude", ["-p", "--model", cfg.scrutinizeModel || lib.DEFAULT_MODEL], {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 240000,
  });
  if (res.status !== 0) throw new Error(`scrutiny CLI failed (status ${res.status}): ${(res.stderr || "").slice(0, 500)}`);
  const raw = lib.stripCodeFences(res.stdout).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error(`scrutiny returned no JSON object:\n${raw.slice(0, 500)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

function scoreAnalysis(analysis) {
  const tmp = path.join(os.tmpdir(), `sdd-analysis-${process.pid}-${Math.abs(hashish(JSON.stringify(analysis)))}.json`);
  fs.writeFileSync(tmp, JSON.stringify(analysis));
  const res = spawnSync("node", [SCORE_JS, tmp], { encoding: "utf8" });
  fs.rmSync(tmp, { force: true });
  if (res.status !== 0) throw new Error(`score.js failed: ${(res.stderr || res.stdout || "").slice(0, 500)}`);
  return JSON.parse(res.stdout);
}
// tiny non-crypto hash just to name a temp file uniquely without Date/random
function hashish(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function main() {
  const cfg = parseArgs(process.argv);
  const modules = cfg.module ? [cfg.module] : lib.listModules(cfg.exampleDir);
  if (!modules.length) {
    console.error(`no modules under ${cfg.exampleDir}/spec/modules`);
    process.exit(1);
  }
  const scrutinyLabel = cfg.scrutinizeStub ? "committed-analysis (stub)" : `claude-cli:${cfg.scrutinizeModel || lib.DEFAULT_MODEL}`;
  const genLabel = cfg.stub ? `stub:${path.basename(cfg.stub)}` : `claude-cli:${cfg.model || lib.DEFAULT_MODEL}`;
  console.log(`sdd-build — ${lib.relTo(process.cwd(), cfg.exampleDir)}`);
  console.log(`  gate: scrutiny=${scrutinyLabel} min-score=${cfg.minScore}`);
  console.log(`  generator: ${genLabel}`);

  // ---- GATE (live scrutiny, per module) ----
  const gate = [];
  let blocked = false;
  for (const m of modules) {
    const analysis = assessSpec(cfg, m);
    const score = scoreAnalysis(analysis);
    const hardGate = score.cappedBy.length > 0;
    const belowBar = score.finalScore < cfg.minScore;
    const pass = !hardGate && !belowBar;
    if (!pass) blocked = true;
    gate.push({ m, score, pass, hardGate, belowBar });
    const why = hardGate ? `HARD GATE ${JSON.stringify(score.cappedBy)}` : belowBar ? `below ${cfg.minScore}` : "clear";
    console.log(`  scrutinize ${m.padEnd(16)} finalScore=${String(score.finalScore).padStart(5)}  ${pass ? "PASS" : "REFUSE"} (${why})`);
  }

  if (blocked) {
    console.log(`  => BUILD REFUSED — spec did not earn generation; generated/ untouched.`);
    process.exit(1);
  }

  // ---- GENERATE (only the gate-passing modules) ----
  console.log(`  => gate cleared; generating…`);
  const genArgs = [path.join(__dirname, "sdd-generate.js"), cfg.exampleDir, "--lang", cfg.lang];
  if (cfg.module) genArgs.push("--module", cfg.module);
  if (cfg.stub) genArgs.push("--stub", cfg.stub);
  else if (cfg.model) genArgs.push("--model", cfg.model);
  const gen = spawnSync("node", genArgs, { encoding: "utf8", stdio: "inherit" });
  process.exit(gen.status === 0 ? 0 : 1);
}

main();
