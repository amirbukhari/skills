#!/usr/bin/env node
"use strict";
/**
 * compose-expand — expand (and optionally byte-verify) ONE file's compositional
 * DSL. This is the panel's Rebuild&verify for the whole-repo file browser: it
 * reads spec/files/<rel>.calc, expands it against catalog/compose-words.json, and
 * (with --verify) byte-compares to the real .ts at <rel>.
 *
 *   node compose-expand.js <projectDir> <rel> [--verify] [--write] [--json] [--print]
 *
 *   --print  emit the reconstructed COMMENT-FREE source to STDOUT (compiler-output
 *            pane); verdict/JSON go to stderr so stdout is clean code.
 */
const fs = require("fs");
const path = require("path");
const { expandComposition } = require("./engine/compose");

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const [projectDir, rel] = args.filter((a) => !a.startsWith("--"));
  if (!projectDir || !rel) { console.error("usage: node compose-expand.js <projectDir> <rel> [--verify] [--write] [--json]"); process.exit(2); }
  const proj = path.resolve(process.cwd(), projectDir);
  const calcPath = path.join(proj, ".cache", "compose", "files", rel + ".calc"); // STEP 7: derived IR, out of spec tree
  const dict = JSON.parse(fs.readFileSync(path.join(proj, "catalog", "compose-words.json"), "utf8")).words;
  const mod = JSON.parse(fs.readFileSync(calcPath, "utf8"));

  const expanded = expandComposition(mod.items, dict);
  const result = { rel, wordCoveragePct: mod.wordCoveragePct, wordTokens: mod.wordTokens, bespokeSlots: mod.literalTokens, expandedChars: expanded.length };
  const emit = flags.has("--print") || flags.has("--emit");
  const say = emit ? console.error : console.log;
  const sayJson = (o) => (emit ? console.error : console.log)(JSON.stringify(o, null, 2));

  if (flags.has("--verify")) {
    const real = fs.readFileSync(path.join(proj, rel), "utf8");
    result.byteIdentical = expanded === real;
    result.residueChars = expanded === real ? 0 : Math.abs(expanded.length - real.length);
    if (!result.byteIdentical) {
      if (emit) process.stdout.write(expanded);
      if (flags.has("--json")) sayJson(result);
      console.error(`compose-expand: ${rel} FAIL — expansion != source (${result.residueChars} chars)`);
      process.exit(1);
    }
  }
  if (flags.has("--write")) fs.writeFileSync(path.join(proj, rel), expanded);
  if (emit) process.stdout.write(expanded);
  if (flags.has("--json")) sayJson(result);
  say(`compose-expand: ${rel} OK${flags.has("--verify") ? " (byte-identical)" : ""} — ${mod.wordCoveragePct}% word-covered, ${mod.literalTokens} bespoke slots`);
}

main();
