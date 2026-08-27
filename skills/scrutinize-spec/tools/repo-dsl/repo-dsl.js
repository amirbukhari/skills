#!/usr/bin/env node
"use strict";
/**
 * repo-dsl — single CLI entrypoint for the SDD CODE-stage engine.
 *
 * Pipeline (see engine/*.js and README): fan-out -> LZW -> generators -> DSL
 * surface -> expand -> verify. Commands:
 *
 *   repo-dsl mine   <dir> [--min N]     Mine a directory: fan-out + LZW + promote
 *                                       generators, write the library + coverage.
 *   repo-dsl gate   <dir> --min P       Coverage GATE for the SDD pipeline: pass/
 *                        [--min-file Q] fail on corpus (and optional worst-file)
 *                                       coverage; machine JSON to results/, exit 1 on fail.
 *   repo-dsl verify <dir>               Byte-identity plumbing check: every file
 *                                       reconstructs exactly from its token stream.
 *   repo-dsl expand <file>              Curated surface -> code: expand a .calc
 *                                       (DSL) or composition .json to native code.
 *   repo-dsl report                     Reprint the last mine rollup.
 *
 * Robust by design: a file that doesn't fully reduce lowers its coverage and adds
 * residue — it never crashes the run.
 */

const fs = require("fs");
const path = require("path");
const { mine } = require("./engine/pipeline");
const { tokenize } = require("./engine/fanout");

const DEFAULT_CORPUS = "/home/amir/Documents/Rentsync/billing-system/src/rentsync-api/calculators";
const RESULTS = path.join(__dirname, "results");
const CATALOG = path.join(__dirname, "catalog");
const COVERAGE_JSON = path.join(RESULTS, "corpus-coverage.json");
const LIBRARY_JSON = path.join(CATALOG, "mined-library.json");

function flag(args, name, def) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

function runMine(dir, minCount) {
  const res = mine(dir, { minCount });
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.mkdirSync(CATALOG, { recursive: true });
  fs.writeFileSync(LIBRARY_JSON, JSON.stringify(res.library, null, 2) + "\n");
  fs.writeFileSync(COVERAGE_JSON, JSON.stringify({
    schema: "sdd-repo-dsl/corpus-coverage/1", corpus: dir, minCount: res.minCount,
    rollup: res.rollup, files: res.fileReports, residueSamples: res.residueSamples,
  }, null, 2) + "\n");
  return res;
}

function printRollup(res) {
  const r = res.rollup, c = res.library.counts;
  console.log(`\n=== SDD CODE-stage: mined ${r.files} files, ${r.tokens} tokens ===`);
  console.log(`corpus coverage (chars reproduced by pure composition): ${r.coveragePct}%`);
  console.log(`generators: ${c.leafGenerators} leaves + ${c.compositeGenerators} composites ` +
    `(${c.compositesBuiltFromComposites} composite-of-composite, max hierarchy depth ${c.maxHierarchyDepth}); ` +
    `alphabet ${c.alphabet}, dict entries ${c.dictEntries}`);
  console.log(`residue chars by class: A(${res.residueLegend.A})=${r.residueChars.A}  ` +
    `B(${res.residueLegend.B})=${r.residueChars.B}  C(${res.residueLegend.C})=${r.residueChars.C}  ` +
    `D(${res.residueLegend.D})=${r.residueChars.D}`);
  console.log(`\nlowest-coverage files:`);
  for (const f of res.fileReports.slice(0, 8))
    console.log(`  ${f.coveragePct.toString().padStart(5)}%  ${f.rel}  (residue A${f.residue.A} B${f.residue.B} C${f.residue.C} D${f.residue.D})`);
  console.log(`\nhighest-coverage files:`);
  for (const f of res.fileReports.slice(-5))
    console.log(`  ${f.coveragePct.toString().padStart(5)}%  ${f.rel}`);
  console.log(`\nwrote ${path.relative(process.cwd(), LIBRARY_JSON)} and ${path.relative(process.cwd(), COVERAGE_JSON)}`);
}

function cmdMine(args) {
  const dir = args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS;
  printRollup(runMine(dir, +flag(args, "--min", 2)));
}

function cmdGate(args) {
  const dir = args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS;
  const min = +flag(args, "--min", 80);        // corpus coverage threshold (%)
  const minFile = flag(args, "--min-file", null); // optional worst-file threshold (%)
  const res = runMine(dir, +flag(args, "--min-count", 2)); // LZW recurrence threshold
  const corpus = res.rollup.coveragePct;
  const worst = res.fileReports[0];
  const corpusPass = corpus >= min;
  const filePass = minFile == null || worst.coveragePct >= +minFile;
  const pass = corpusPass && filePass;
  const out = {
    schema: "sdd-repo-dsl/gate/1", pass, thresholds: { corpus: min, perFile: minFile == null ? null : +minFile },
    corpusCoveragePct: corpus, worstFile: { rel: worst.rel, coveragePct: worst.coveragePct },
    generators: res.library.counts,
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, "gate.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(pass ? "\nGATE: PASS" : "\nGATE: FAIL");
  process.exit(pass ? 0 : 1);
}

function cmdVerify(args) {
  const dir = args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS;
  const files = require("./engine/pipeline").walkDir(dir).sort();
  let ok = 0, fail = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    let recon;
    try {
      const { tokens, gaps } = tokenize(f, src);
      const spans = [...tokens.map((t) => ({ s: t.start, text: t.text })), ...gaps.map((g) => ({ s: g.start, text: g.text }))]
        .sort((a, b) => a.s - b.s);
      recon = spans.map((x) => x.text).join("");
    } catch (e) { recon = null; }
    if (recon === src) ok++;
    else { fail++; console.log(`  RECON MISMATCH: ${path.relative(dir, f)}`); }
  }
  console.log(`byte-identity plumbing: ${ok}/${files.length} files reconstruct exactly from their token stream${fail ? `, ${fail} FAILED` : ""}`);
  process.exit(fail ? 1 : 0);
}

function cmdExpand(args) {
  const file = args[0];
  if (!file) { console.error("usage: repo-dsl expand <file.calc|composition.json>"); process.exit(1); }
  const { expand } = require("./expander");
  let tree;
  if (file.endsWith(".json")) tree = JSON.parse(fs.readFileSync(file, "utf8"));
  else tree = require("./dsl").parseText(fs.readFileSync(file, "utf8"));
  process.stdout.write(expand(tree));
}

function cmdReport() {
  if (!fs.existsSync(COVERAGE_JSON)) { console.error("no results yet — run: repo-dsl mine"); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(COVERAGE_JSON, "utf8"));
  console.log(`corpus ${j.rollup.coveragePct}% over ${j.rollup.files} files; residue chars A${j.rollup.residueChars.A} B${j.rollup.residueChars.B} C${j.rollup.residueChars.C} D${j.rollup.residueChars.D}`);
  for (const f of j.files) console.log(`  ${f.coveragePct.toString().padStart(5)}%  ${f.rel}`);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "mine": return cmdMine(args);
    case "gate": return cmdGate(args);
    case "verify": return cmdVerify(args);
    case "expand": return cmdExpand(args);
    case "report": return cmdReport();
    default:
      console.error("usage: repo-dsl <mine|gate|verify|expand|report> [args]  (see README)");
      process.exit(1);
  }
}

main();
