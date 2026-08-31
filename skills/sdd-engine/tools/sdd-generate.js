#!/usr/bin/env node
/**
 * sdd-generate — the LLM generation path of the spec-driven-dev harness.
 *
 * Reads a module's spec (standards + contract + constants + module spec.md,
 * WITHHOLDING the fixtures), asks a generator to emit the module source, then
 * accepts the result IFF the fixtures pass. Validity is behavioural
 * (fixtures-pass), not byte-identity — a model does not emit identical bytes,
 * so this is the seam that lets an LLM stand in for the deterministic renderer.
 *
 * Backends (pluggable):
 *   default            shell out to the `claude` CLI (real generation)
 *   --stub <file>      emit the contents of <file> verbatim (zero-cost test double)
 *
 * Usage:
 *   node tools/sdd-generate.js <exampleDir> [--module m] [--lang ts]
 *        [--stub <goldenFile>] [--model <id>] [--max-retries n]
 *
 * On success it writes generated/<module>.<lang> and updates the example's
 * .sdd-provenance.json. On failure (fixtures never pass) it exits non-zero and
 * leaves any prior generated artifact untouched.
 */

const fs = require("fs");
const path = require("path");
const lib = require("./sdd-lib");

function parseArgs(argv) {
  const a = { exampleDir: null, module: null, lang: "ts", stub: null, model: null, maxRetries: 2 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--module") a.module = rest[++i];
    else if (t === "--lang") a.lang = rest[++i];
    else if (t === "--stub") a.stub = rest[++i];
    else if (t === "--model") a.model = rest[++i];
    else if (t === "--max-retries") a.maxRetries = parseInt(rest[++i], 10);
    else if (!a.exampleDir) a.exampleDir = t;
    else throw new Error(`unexpected argument: ${t}`);
  }
  if (!a.exampleDir) throw new Error("usage: sdd-generate.js <exampleDir> [options]");
  a.exampleDir = path.resolve(process.cwd(), a.exampleDir);
  if (a.stub) a.stub = path.resolve(process.cwd(), a.stub);
  return a;
}

function generateModule(cfg, moduleName) {
  const outDir = path.join(cfg.exampleDir, "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${moduleName}.${cfg.lang}`);
  const candPath = path.join(outDir, `.${moduleName}.candidate.${cfg.lang}`);

  const langName = cfg.lang === "ts" ? "TypeScript" : cfg.lang === "js" ? "JavaScript" : cfg.lang;
  const prompt = lib.assembleGeneratorPrompt(cfg.exampleDir, moduleName, langName);

  const maxAttempts = cfg.stub ? 1 : Math.max(1, cfg.maxRetries + 1);
  let feedback = null;
  let lastOut = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const backend = cfg.stub
      ? { kind: "stub", src: cfg.stub }
      : { kind: "claude", model: cfg.model, feedback };
    const { code, generatorId } = lib.runGenerator(backend, prompt);
    fs.writeFileSync(candPath, code);

    const v = lib.runVerify(cfg.exampleDir, candPath);
    lastOut = v.output;
    if (v.ok) {
      fs.renameSync(candPath, outPath);
      return {
        module: moduleName,
        path: lib.relTo(cfg.exampleDir, outPath),
        lang: cfg.lang,
        generatorId,
        attempts: attempt,
        verified: true,
        specInputs: lib.specInputsHashMap(cfg.exampleDir, moduleName),
        fixturesHash: lib.fixturesHash(cfg.exampleDir, moduleName),
      };
    }
    feedback = v.output.slice(0, 4000);
    process.stderr.write(`  attempt ${attempt}/${maxAttempts} failed fixtures for ${moduleName}\n`);
  }
  if (fs.existsSync(candPath)) fs.rmSync(candPath);
  throw new Error(`generation of ${moduleName} never passed fixtures:\n${lastOut}`);
}

function main() {
  const cfg = parseArgs(process.argv);
  const modules = cfg.module ? [cfg.module] : lib.listModules(cfg.exampleDir);
  if (!modules.length) {
    console.error(`no modules under ${cfg.exampleDir}/spec/modules`);
    process.exit(1);
  }
  const backendLabel = cfg.stub ? `stub:${path.basename(cfg.stub)}` : `claude-cli:${cfg.model || lib.DEFAULT_MODEL}`;
  console.log(`sdd-generate — example=${lib.relTo(process.cwd(), cfg.exampleDir)} backend=${backendLabel}`);

  const prior = lib.readProvenance(cfg.exampleDir);
  const byModule = new Map((prior?.artifacts || []).map((a) => [a.module, a]));
  for (const m of modules) {
    const entry = generateModule(cfg, m);
    byModule.set(m, entry);
    console.log(`  OK ${m} -> ${entry.path} (${entry.generatorId}, attempts=${entry.attempts})`);
  }
  const manifest = {
    schema: "sdd-provenance/1",
    validity: "fixtures-pass",
    generatedAt: null, // stamped by the caller/commit, not by the pipeline (kept deterministic)
    artifacts: [...byModule.values()].sort((a, b) => a.module.localeCompare(b.module)),
  };
  lib.writeProvenance(cfg.exampleDir, manifest);
  console.log(`  wrote ${lib.relTo(process.cwd(), lib.provenancePath(cfg.exampleDir))}`);
}

main();
