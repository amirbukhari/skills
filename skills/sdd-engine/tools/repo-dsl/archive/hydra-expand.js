#!/usr/bin/env node
"use strict";
/**
 * hydra-expand — expand (and optionally byte-verify) an authored hydra-source
 * module. This is the loop's Rebuild&verify step for whole-file-word modules:
 * it reads spec/modules/<module>/composition.calc, expands it against
 * catalog/dsl-words.json, and (with --verify) byte-compares to the target .ts.
 *
 * Deterministic, no model. Emits a `hydra-expand: <module> OK|FAIL ...` verdict
 * line and a JSON blob on --json; exit non-zero on any byte mismatch.
 *
 *   node hydra-expand.js <projectDir> <module> [--verify] [--write] [--json] [--print]
 *
 *   --verify  byte-compare the expansion to the module's target .ts (gate)
 *   --write   write the expansion to the target path (build)
 *   --json    print a machine-readable result object (to stdout, or stderr with --print)
 *   --print   emit the reconstructed COMMENT-FREE source to STDOUT (the "compiler
 *             output" pane); verdict/JSON go to stderr so stdout is clean code
 */
const fs = require("fs");
const path = require("path");
const { parseCalc } = require("./engine/hydra-dsl.js");
const { expandWord } = require("./engine/wholefile.js");

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [projectDir, moduleName] = args.filter((a) => !a.startsWith("--"));
  if (!projectDir || !moduleName) {
    console.error("usage: node hydra-expand.js <projectDir> <module> [--verify] [--write] [--json]");
    process.exit(2);
  }
  const proj = path.resolve(process.cwd(), projectDir);
  const modDir = path.join(proj, "spec", "modules", moduleName);
  const calcPath = path.join(modDir, "composition.calc");
  const wordsPath = path.join(proj, "catalog", "dsl-words.json");

  const calc = fs.readFileSync(calcPath, "utf8");
  const wordIndex = JSON.parse(fs.readFileSync(wordsPath, "utf8")).words;
  const { word, params } = parseCalc(calc);
  const def = wordIndex[word];
  if (!def) { console.error(`hydra-expand: ${moduleName} FAIL — unknown word ${word}`); process.exit(1); }
  const missing = def.params.filter((p) => !(p.name in params)).map((p) => p.name);
  if (missing.length) { console.error(`hydra-expand: ${moduleName} FAIL — missing params ${missing.join(",")}`); process.exit(1); }

  const expanded = expandWord(def, params);

  // resolve target path from spec.md / modules-index (authoritative), else derive
  let targetPath = null;
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(proj, "spec", "modules-index.json"), "utf8"));
    const row = idx.modules.find((m) => m.module === moduleName);
    if (row) targetPath = row.targetPath;
  } catch (_) {}
  if (!targetPath) targetPath = (def.memberFiles || []).find((f) => path.basename(f, ".ts") === moduleName) || null;

  const result = { module: moduleName, word, targetPath, expandedChars: expanded.length };
  // with --print, stdout must be CLEAN reconstructed code; route verdict/json to stderr.
  const emit = flags.has("--print") || flags.has("--emit");
  const say = emit ? console.error : console.log;
  const sayJson = (o) => (emit ? console.error : console.log)(JSON.stringify(o, null, 2));

  if (flags.has("--verify")) {
    if (!targetPath) { console.error(`hydra-expand: ${moduleName} FAIL — no target path`); process.exit(1); }
    const real = fs.readFileSync(path.join(proj, targetPath), "utf8");
    result.byteIdentical = expanded === real;
    result.residueChars = expanded === real ? 0 : Math.abs(expanded.length - real.length);
    if (!result.byteIdentical) {
      if (emit) process.stdout.write(expanded);
      if (flags.has("--json")) sayJson(result);
      console.error(`hydra-expand: ${moduleName} FAIL — expansion != ${targetPath} (${result.residueChars} chars)`);
      process.exit(1);
    }
  }
  if (flags.has("--write") && targetPath) fs.writeFileSync(path.join(proj, targetPath), expanded);

  if (emit) process.stdout.write(expanded);
  if (flags.has("--json")) sayJson(result);
  say(`hydra-expand: ${moduleName} OK${flags.has("--verify") ? " (byte-identical)" : ""} -> ${targetPath}`);
}

main();
