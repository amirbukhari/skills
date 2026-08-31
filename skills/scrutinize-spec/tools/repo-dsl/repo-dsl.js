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
 *                        [--no-mine]    coverage; machine JSON to results/, exit 1 on fail.
 *                                       --no-mine reads the persisted catalog instead
 *                                       of re-mining (snappy on a large corpus).
 *   repo-dsl verify <dir>               Byte-identity plumbing check: every file
 *                                       reconstructs exactly from its token stream.
 *   repo-dsl verify-expand <calc>       PER-MODULE gate: expand one .calc and byte-
 *                        [--against F]  diff it against its target (default the
 *                        [--min P]      module's generated file); machine JSON verdict
 *                                       {pass, coveragePct, byteIdentical, residueClasses}.
 *   repo-dsl expand <file>              Curated surface -> code: expand a .calc
 *                                       (DSL) or composition .json to native code.
 *   repo-dsl explain <calc>             Emit the GENERATOR TREE a composition invokes
 *                                       (composites + leaf ids + typed signatures,
 *                                       nesting order) as machine JSON for the panel.
 *   repo-dsl refine-language <dir>      LLM "librarian" pass: propose readable names
 *                        [--apply]      for mined g_<len>_<hash> composites, gated on
 *                        [--only naming] byte-identity + coverage invariance. Dry-run
 *                                       writes a proposal report; --apply promotes v2.
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

/** Parse `--lift bool,type,null` into a lift config, or undefined (current behavior). */
function parseLift(args) {
  const raw = flag(args, "--lift", null);
  if (!raw) return undefined;
  const set = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  const all = set.has("all");
  return { bool: all || set.has("bool"), type: all || set.has("type"), nullc: all || set.has("null") || set.has("nullc") };
}

/* The reporting contract with the SDD panel. The panel reads
 * `<corpusDir>/catalog/mined-library.v<N>.json` and renders `counts` verbatim — it does no
 * depth arithmetic of its own, so whatever this file declares IS what the operator sees and
 * makes decisions from. Two rules follow, and both are enforced in publishLibrary():
 *
 *   1. The artifact lives WITH the corpus it describes. Writing only to the engine's shared
 *      catalog is what let a different project's library be served for this one: the reader
 *      finds no library beside the corpus, falls back to the shared catalog, and renders
 *      another repo's numbers as though they were this corpus's. A per-corpus artifact makes
 *      that substitution impossible rather than merely unlikely.
 *   2. Declared counts must equal what was actually walked. A number smaller than the truth is
 *      the dangerous failure here, because it is indistinguishable from a real answer once it
 *      reaches the panel. So the fidelity check throws instead of writing.
 */
const LIBRARY_SCHEMA_VERSION = 1;

/** Highest `hierarchyDepth` actually present on the mined composites, or 0 when there are none. */
function observedMaxHierarchyDepth(composites) {
  return composites.reduce((deepest, c) => (
    typeof c.hierarchyDepth === "number" && c.hierarchyDepth > deepest ? c.hierarchyDepth : deepest
  ), 0);
}

/**
 * Write the mined library beside the corpus it describes, as the versioned file the SDD panel
 * reads. The SINGLE writer of a `mined-library.v<N>.json` — `mine` and `publish` both route
 * here, so a second producer can never disagree with the first about what the corpus contains.
 *
 * Refuses to write a library that under-reports its own tree: if `counts.maxHierarchyDepth`
 * disagrees with the deepest composite actually mined, or composites carry no depth at all,
 * it throws rather than emitting a smaller, plausible-looking number the panel would render as
 * truth. A loud failure is recoverable; a quiet under-report is not.
 *
 * @param corpusDir Absolute path of the mined corpus; the artifact is written to its `catalog/`.
 * @param library The mined library object (`counts`, `composites`, `leaves`).
 * @returns The absolute path written.
 */
function publishLibrary(corpusDir, library) {
  const composites = library.composites || [];
  const declared = library.counts ? library.counts.maxHierarchyDepth : undefined;
  const observed = observedMaxHierarchyDepth(composites);

  if (composites.length && !composites.some((c) => typeof c.hierarchyDepth === "number")) {
    throw new Error(`mined-library: ${composites.length} composites carry no hierarchyDepth — `
      + "refusing to publish a library whose depth cannot be verified");
  }
  if (declared !== observed) {
    throw new Error(`mined-library: declared maxHierarchyDepth ${declared} != observed ${observed} `
      + `over ${composites.length} composites — refusing to publish an under-reporting library`);
  }

  const dest = path.join(corpusDir, "catalog", `mined-library.v${LIBRARY_SCHEMA_VERSION}.json`);
  const artifact = {
    schema: `sdd-repo-dsl/mined-library/v${LIBRARY_SCHEMA_VERSION}`,
    version: `v${LIBRARY_SCHEMA_VERSION}`,
    corpus: corpusDir,
    generatedAt: new Date().toISOString(),
    // Asserted above, then stated in the artifact so a consumer can reject a partial library
    // instead of quietly rendering it.
    complete: true,
    minCount: library.minCount,
    counts: library.counts,
    leaves: library.leaves || [],
    composites,
  };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(artifact, null, 2) + "\n");
  return dest;
}

function runMine(dir, minCount, lift) {
  const res = mine(dir, { minCount, lift });
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.mkdirSync(CATALOG, { recursive: true });
  fs.writeFileSync(LIBRARY_JSON, JSON.stringify(res.library, null, 2) + "\n");
  res.publishedTo = publishLibrary(dir, res.library);
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
  const lift = parseLift(args);
  if (lift) console.log(`(lift knob: ${Object.entries(lift).filter(([, v]) => v).map(([k]) => k).join("+") || "none"})`);
  printRollup(runMine(dir, +flag(args, "--min", 2), lift));
}

/** Load the persisted mine output (for gate --no-mine): coverage rollup + library. */
function loadPersisted() {
  if (!fs.existsSync(COVERAGE_JSON) || !fs.existsSync(LIBRARY_JSON))
    throw new Error(`--no-mine needs a prior run: ${path.relative(process.cwd(), COVERAGE_JSON)} and ${path.relative(process.cwd(), LIBRARY_JSON)} must exist (run: repo-dsl mine)`);
  const cov = JSON.parse(fs.readFileSync(COVERAGE_JSON, "utf8"));
  const library = JSON.parse(fs.readFileSync(LIBRARY_JSON, "utf8"));
  return { rollup: cov.rollup, fileReports: cov.files, library, corpus: cov.corpus };
}

function cmdGate(args) {
  const dir = args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS;
  const min = +flag(args, "--min", 80);        // corpus coverage threshold (%)
  const minFile = flag(args, "--min-file", null); // optional worst-file threshold (%)
  const noMine = args.includes("--no-mine");
  const res = noMine ? loadPersisted() : runMine(dir, +flag(args, "--min-count", 2)); // LZW recurrence threshold
  const corpus = res.rollup.coveragePct;
  const worst = res.fileReports[0];
  const corpusPass = corpus >= min;
  const filePass = minFile == null || worst.coveragePct >= +minFile;
  const pass = corpusPass && filePass;
  const out = {
    schema: "sdd-repo-dsl/gate/1", pass, source: noMine ? "persisted" : "mined",
    thresholds: { corpus: min, perFile: minFile == null ? null : +minFile },
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

function cmdVerifyExpand(args) {
  const { verifyExpand } = require("./verify-expand");
  const calc = args.find((a) => !a.startsWith("--"));
  if (!calc) { console.error("usage: repo-dsl verify-expand <calc> [--against <file>] [--min <pct>]"); process.exit(1); }
  const out = verifyExpand(path.resolve(process.cwd(), calc), {
    against: flag(args, "--against", null), min: flag(args, "--min", 100),
  });
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, `verify-expand-${out.module}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.pass ? 0 : 1);
}

function cmdExplain(args) {
  const { explainTree } = require("./explain");
  const calc = args.find((a) => !a.startsWith("--"));
  if (!calc) { console.error("usage: repo-dsl explain <calc>"); process.exit(1); }
  const p = path.resolve(process.cwd(), calc);
  const tree = p.endsWith(".json") ? JSON.parse(fs.readFileSync(p, "utf8")) : require("./dsl").parseText(fs.readFileSync(p, "utf8"));
  process.stdout.write(JSON.stringify(explainTree(tree), null, 2) + "\n");
}

function cmdRefineLanguage(args) {
  const { refineLanguage } = require("./refine-language");
  const dir = args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS;
  const out = refineLanguage(dir, {
    apply: args.includes("--apply"),
    only: flag(args, "--only", "naming"),
    stub: flag(args, "--stub", null),
    model: flag(args, "--model", null),
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.gate.passed ? 0 : 1);
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

/**
 * `repo-dsl publish <corpusDir> [--from <library.json>]` — re-publish an already-mined library
 * beside its corpus, through the same writer `mine` uses. For a corpus whose library was mined
 * before the artifact was written per-corpus; it re-runs no mining, so it cannot invent numbers.
 * The `--from` library must name that corpus, so one project's library can't be published as
 * another's — the substitution this whole contract exists to prevent.
 */
function cmdPublish(args) {
  const corpusDir = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : null;
  if (!corpusDir) { console.error("usage: repo-dsl publish <corpusDir> [--from <library.json>]"); process.exit(1); }
  const from = path.resolve(flag(args, "--from", LIBRARY_JSON));
  if (!fs.existsSync(from)) { console.error(`no mined library at ${from} — run: repo-dsl mine ${corpusDir}`); process.exit(1); }

  let library;
  try { library = JSON.parse(fs.readFileSync(from, "utf8")); }
  catch (e) { console.error(`cannot parse ${from}: ${e.message}`); process.exit(1); }

  if (path.resolve(library.corpus || "") !== corpusDir) {
    console.error(`refusing to publish: ${from} was mined from ${library.corpus}, not ${corpusDir}`);
    process.exit(1);
  }

  let dest;
  try { dest = publishLibrary(corpusDir, library); }
  catch (e) { console.error(e.message); process.exit(1); }
  const c = library.counts || {};
  console.log(`published ${dest}`);
  console.log(`  ${c.leafGenerators} primitives · ${c.compositeGenerators} words · depth ${c.maxHierarchyDepth}`);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "mine": return cmdMine(args);
    case "publish": return cmdPublish(args);
    case "gate": return cmdGate(args);
    case "verify": return cmdVerify(args);
    case "verify-expand": return cmdVerifyExpand(args);
    case "expand": return cmdExpand(args);
    case "explain": return cmdExplain(args);
    case "refine-language": return cmdRefineLanguage(args);
    case "report": return cmdReport();
    default:
      console.error("usage: repo-dsl <mine|publish|gate|verify|verify-expand|expand|explain|refine-language|report> [args]  (see README)");
      process.exit(1);
  }
}

main();
