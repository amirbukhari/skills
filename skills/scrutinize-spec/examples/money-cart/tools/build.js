#!/usr/bin/env node
/**
 * The gated build: scrutinize -> (gate) -> generate -> verify.
 *
 * The core inversion of spec-driven development is that you cannot compile a
 * spec that has not earned it. This pipeline refuses to run the generator
 * unless the spec folder clears two gates:
 *
 *   1. STRUCTURAL (deterministic, computed straight from spec/):
 *        - every module's spec-codegen block parses
 *        - every module has at least one executable fixture case
 *        - the dependsOn graph has no cycle
 *      These are hard preconditions; no score can buy past them.
 *
 *   2. SCRUTINY (the real scoring scripts on the committed .analysis/):
 *        - runs scripts/score.js per module and scripts/score-folder.js
 *        - refuses on any hard structural cappedBy from folder mode
 *        - refuses when the folder finalScore is below --min-score
 *
 * Only when both pass does it call generate.js then verify.js. On refusal the
 * generator never runs, so generated/ is left exactly as it was.
 *
 * Usage:  node tools/build.js [--min-score N]     (default N = 95, the one-shot bar)
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const lib = require("./lib.js");

const SCRIPTS_DIR = path.resolve(lib.EXAMPLE_ROOT, "..", "..", "scripts");
const ANALYSIS_DIR = path.join(lib.EXAMPLE_ROOT, ".analysis");
const TOOLS_DIR = __dirname;

const HARD_FOLDER_GATES = new Set([
  "orphan_code_detected",
  "contract_cycle",
  "fixtures_not_executable",
  "regeneration_contract_missing",
  "stateful_artifacts_unhandled",
  "unspecified_not_declared",
]);

function extractFence(md, tag) {
  const re = new RegExp("```" + tag + "\\n([\\s\\S]*?)\\n```");
  const m = md.match(re);
  return m ? m[1] : null;
}

function runScore(scriptName, analysisPath) {
  const out = execFileSync("node", [path.join(SCRIPTS_DIR, scriptName), analysisPath], {
    encoding: "utf8",
  });
  return JSON.parse(out);
}

/** Deterministic structural preconditions, straight from spec/. */
function structuralGate() {
  const refusals = [];
  const modules = lib.listModules();
  const edges = new Map();

  for (const name of modules) {
    const specPath = path.join(lib.MODULES_DIR, name, "spec.md");
    const raw = extractFence(fs.readFileSync(specPath, "utf8"), "spec-codegen");
    if (!raw) {
      refusals.push(`STRUCTURAL ${name}: no spec-codegen block`);
      edges.set(name, []);
      continue;
    }
    let cg;
    try {
      cg = JSON.parse(raw);
    } catch (e) {
      refusals.push(`STRUCTURAL ${name}: spec-codegen block is not valid JSON (${e.message})`);
      edges.set(name, []);
      continue;
    }
    edges.set(name, Array.isArray(cg.dependsOn) ? cg.dependsOn : []);

    const fixturesDir = path.join(lib.MODULES_DIR, name, "fixtures");
    let cases = 0;
    if (fs.existsSync(fixturesDir)) {
      for (const f of fs.readdirSync(fixturesDir)) {
        if (!f.endsWith(".json")) continue;
        try {
          cases += JSON.parse(fs.readFileSync(path.join(fixturesDir, f), "utf8")).length;
        } catch (e) {
          refusals.push(`STRUCTURAL ${name}: fixture ${f} is not valid JSON`);
        }
      }
    }
    if (cases === 0) {
      refusals.push(
        `STRUCTURAL ${name}: no executable fixtures — the build has no acceptance oracle (mirrors fixtures_not_executable)`
      );
    }
  }

  // Cycle detection over the dependsOn graph (external names ignored).
  const state = new Map();
  function walk(n, stack) {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) {
      refusals.push(`STRUCTURAL cycle: ${stack.slice(stack.indexOf(n)).concat(n).join(" -> ")}`);
      return;
    }
    state.set(n, 1);
    stack.push(n);
    for (const m of edges.get(n) || []) if (edges.has(m)) walk(m, stack);
    stack.pop();
    state.set(n, 2);
  }
  for (const n of modules) walk(n, []);

  return refusals;
}

/** Scrutiny gate via the real scoring scripts on the committed analyses. */
function scrutinyGate(minScore) {
  const refusals = [];
  const moduleScores = [];
  for (const name of lib.listModules()) {
    const analysisPath = path.join(ANALYSIS_DIR, `${name}.json`);
    if (!fs.existsSync(analysisPath)) {
      refusals.push(`SCRUTINY ${name}: no analysis at .analysis/${name}.json — spec not scrutinized`);
      continue;
    }
    const r = runScore("score.js", analysisPath);
    moduleScores.push({ name, finalScore: r.finalScore, cappedBy: r.cappedBy });
    if (r.cappedBy.length > 0) {
      refusals.push(`SCRUTINY ${name}: capped by ${r.cappedBy.join(", ")} (finalScore ${r.finalScore})`);
    }
  }

  const folderAnalysis = path.join(ANALYSIS_DIR, "folder.json");
  let folder = null;
  if (!fs.existsSync(folderAnalysis)) {
    refusals.push("SCRUTINY folder: no .analysis/folder.json");
  } else {
    folder = runScore("score-folder.js", folderAnalysis);
    for (const gate of folder.cappedBy) {
      const hard = HARD_FOLDER_GATES.has(gate.split(":")[0]) || HARD_FOLDER_GATES.has(gate);
      if (hard) {
        refusals.push(`SCRUTINY folder: hard gate ${gate} — cannot generate regardless of score`);
      }
    }
    if (folder.finalScore < minScore) {
      refusals.push(
        `SCRUTINY folder: finalScore ${folder.finalScore} is below the --min-score bar of ${minScore}` +
          (folder.cappedBy.length ? ` (cappedBy ${folder.cappedBy.join(", ")})` : "")
      );
    }
  }
  return { refusals, moduleScores, folder };
}

function main() {
  const args = process.argv.slice(2);
  const msIdx = args.indexOf("--min-score");
  const minScore = msIdx >= 0 ? Number(args[msIdx + 1]) : 95;
  if (Number.isNaN(minScore)) {
    console.error("build: --min-score needs a number");
    process.exit(2);
  }

  console.log(`build: gating spec/ (min-score ${minScore}) ...`);
  const structural = structuralGate();
  const { refusals: scrutiny, moduleScores, folder } = scrutinyGate(minScore);

  if (moduleScores.length) {
    console.log("build: module scores — " + moduleScores.map((m) => `${m.name} ${m.finalScore}`).join(", "));
  }
  if (folder) {
    console.log(`build: folder finalScore ${folder.finalScore}, isRegenerable ${folder.isRegenerable}`);
  }

  const refusals = [...structural, ...scrutiny];
  if (refusals.length > 0) {
    console.error(`build: REFUSED — spec has not earned generation (${refusals.length} reason(s)):`);
    for (const r of refusals) console.error("  " + r);
    console.error("build: generator NOT run; generated/ left untouched.");
    process.exit(1);
  }

  console.log("build: gate PASSED — generating ...");
  execFileSync("node", [path.join(TOOLS_DIR, "generate.js")], { stdio: "inherit" });
  console.log("build: verifying ...");
  execFileSync("node", [path.join(TOOLS_DIR, "verify.js")], { stdio: "inherit" });
  console.log("build: OK — spec cleared the gate, code generated and every fixture passed.");
}

main();
