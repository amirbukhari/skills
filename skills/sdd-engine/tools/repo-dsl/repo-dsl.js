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
 *   (RETIRED 2026-09-04 -- `verify-expand <calc>` and `expand <file.calc>` were here.
 *    Amir: "yeah kill that lol". The .calc IR is retired corpus-wide: the corpus holds
 *    1,037 .en and ZERO .calc, .cache/compose/ does not exist, and no step of the 14-step
 *    sdd-run manifest reads or writes one. The implementations are in archive/verify-expand.js
 *    and in git history. The .en rendering under sen/files/ is the user-facing view.
 *    NOTE: expander.js itself is NOT retired -- engine/dsl-surface.test.js and
 *    refine-language.js both still call expand() over IN-MEMORY composition trees, which
 *    never touch a .calc file. Retiring the IR is not retiring the expander.)
 *   repo-dsl explain <calc>             Emit the GENERATOR TREE a composition invokes
 *                                       (composites + leaf ids + typed signatures,
 *                                       nesting order) as machine JSON for the panel.
 *   repo-dsl refine-language <dir>      LLM "librarian" pass: propose readable names
 *                        [--apply]      for mined g_<len>_<hash> composites, gated on
 *                        [--only naming] byte-identity + coverage invariance. Dry-run
 *                                       writes a proposal report; --apply promotes v2.
 *   repo-dsl language <dir> [--json]    Publish the DSL VOCABULARY (leaf primitives +
 *                                       composite words) and the auto-derived positional
 *                                       GRAMMAR. --json emits the machine document (and
 *                                       persists it) for the Kraken panel's Syntax/Grammar
 *                                       tabs; bare prints the human view. Every fact is read
 *                                       live from generators.js/dsl.js, so it cannot go stale.
 *   repo-dsl report                     Reprint the last mine rollup.
 *
 * Robust by design: a file that doesn't fully reduce lowers its coverage and adds
 * residue — it never crashes the run.
 */

const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const { mine } = require("./engine/pipeline");
const { tokenize } = require("./engine/fanout");
const CR = require("./engine/corpus-root");

// The engine mines an EXTERNAL corpus; this repo intentionally contains none (PRD §8).
// SOURCE/CORPUS resolve through engine/corpus-root.js — the single resolver. The literal
// below is only a developer convenience and is never trusted without an existence check.
const DEFAULT_CORPUS = CR.sourceRoot();   // the tree `mine`/`gate`/`verify` walk
/* Corpus-rooted (PRD §8B) — the engine tree never receives corpus-derived output. */
const RESULTS = path.join(CR.corpusRoot(), ".cache", "spec-derived");
/* The three §8B kinds this CLI publishes are located BY THE CONTRACT, not by re-joining the
 * layout here. AC.HOMES owns "sen/catalog" and ".cache/spec-derived"; a second spelling of
 * either is how two producers end up writing one kind to two places. */
const CATALOG = path.join(CR.senDir(), "catalog");
const COVERAGE_JSON = AC.pathFor("corpus-coverage");
const LIBRARY_JSON = AC.pathFor("mined-library");

/**
 * Resolve the corpus directory and PROVE it exists. A missing corpus must fail loudly and
 * name its own fix: silently proceeding against whatever catalog happens to be on disk
 * yields confident numbers about a corpus that was never read. Never return an unverified path.
 */
function resolveCorpus(dir, cmd) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) {
    console.error(`corpus not found: ${abs}`);
    console.error("");
    console.error("The repo-DSL engine mines an EXTERNAL corpus. This repo deliberately contains");
    console.error("no corpus and no Hydra source, so a checkout alone cannot mine anything.");
    console.error("");
    console.error("Point it at one:");
    console.error(`  SOURCE=/path/to/corpus node repo-dsl.js ${cmd}`);
    console.error(`  node repo-dsl.js ${cmd} /path/to/corpus`);
    process.exit(2);
  }
  return abs;
}

/**
 * Refuse to read a persisted artifact that was mined from a DIFFERENT corpus than the one
 * being asked about. Same contract cmdPublish enforces in the other direction: one project's
 * library must never be reported as another's. Cross-corpus reuse is silent and looks correct.
 */
function assertSameCorpus(artifactPath, artifactCorpus, corpusDir) {
  if (!artifactCorpus) {
    console.error(`refusing to use ${path.relative(process.cwd(), artifactPath)}: it records no corpus, so it cannot be verified against ${corpusDir}`);
    console.error("Re-mine it:  node repo-dsl.js mine " + corpusDir);
    process.exit(2);
  }
  if (path.resolve(artifactCorpus) !== path.resolve(corpusDir)) {
    console.error(`refusing to use ${path.relative(process.cwd(), artifactPath)}: it was mined from`);
    console.error(`  ${artifactCorpus}`);
    console.error(`but you asked about`);
    console.error(`  ${corpusDir}`);
    console.error("These are different corpora; the numbers would not describe the corpus you named.");
    console.error("Re-mine it:  node repo-dsl.js mine " + corpusDir);
    process.exit(2);
  }
}

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
  /* AC.stamp, never a hand-written header (CLAUDE.md §8). This wrote `res.library` raw: no
   * artifactVersion, no generated, no fingerprint — so `node repo-dsl.js mine` against the real
   * corpus overwrote a valid stamped artifact with one every consumer's AC.load REFUSES
   * ("expected: a `fingerprint` field / got: none"). Measured against a throwaway corpus. */
  fs.writeFileSync(LIBRARY_JSON, JSON.stringify(AC.stamp("mined-library", res.library, { corpus: dir }), null, 2) + "\n");
  res.publishedTo = publishLibrary(dir, res.library);
  // Provenance so a stored report can never be mistaken for a live one (see cmdReport).
  fs.writeFileSync(COVERAGE_JSON, JSON.stringify(AC.stamp("corpus-coverage", {
    minedAt: new Date().toISOString(), regenerate: `node repo-dsl.js mine ${dir}`,
    minCount: res.minCount,
    rollup: res.rollup, files: res.fileReports, residueSamples: res.residueSamples,
  }, { corpus: dir }), null, 2) + "\n");
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
  const dir = resolveCorpus(args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS, "mine");
  const lift = parseLift(args);
  if (lift) console.log(`(lift knob: ${Object.entries(lift).filter(([, v]) => v).map(([k]) => k).join("+") || "none"})`);
  printRollup(runMine(dir, +flag(args, "--min", 2), lift));
}

/** Load the persisted mine output (for gate --no-mine): coverage rollup + library. */
function loadPersisted(corpusDir) {
  if (!fs.existsSync(COVERAGE_JSON) || !fs.existsSync(LIBRARY_JSON))
    throw new Error(`--no-mine needs a prior run: ${path.relative(process.cwd(), COVERAGE_JSON)} and ${path.relative(process.cwd(), LIBRARY_JSON)} must exist (run: repo-dsl mine)`);
  const cov = JSON.parse(fs.readFileSync(COVERAGE_JSON, "utf8"));
  const library = JSON.parse(fs.readFileSync(LIBRARY_JSON, "utf8"));
  // A persisted result is only valid for the corpus it was mined from (§ cmdPublish contract).
  assertSameCorpus(COVERAGE_JSON, cov.corpus, corpusDir);
  assertSameCorpus(LIBRARY_JSON, library.corpus, corpusDir);
  return { rollup: cov.rollup, fileReports: cov.files, library, corpus: cov.corpus };
}

function cmdGate(args) {
  const dir = resolveCorpus(args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS, "gate");
  const min = +flag(args, "--min", 80);        // corpus coverage threshold (%)
  const minFile = flag(args, "--min-file", null); // optional worst-file threshold (%)
  const noMine = args.includes("--no-mine");
  const res = noMine ? loadPersisted(dir) : runMine(dir, +flag(args, "--min-count", 2)); // LZW recurrence threshold
  const corpus = res.rollup.coveragePct;
  const worst = res.fileReports[0];
  const corpusPass = corpus >= min;
  const filePass = minFile == null || worst.coveragePct >= +minFile;
  const pass = corpusPass && filePass;
  const out = {
    pass, source: noMine ? "persisted" : "mined",
    thresholds: { corpus: min, perFile: minFile == null ? null : +minFile },
    corpusCoveragePct: corpus, worstFile: { rel: worst.rel, coveragePct: worst.coveragePct },
    generators: res.library.counts,
  };
  /* `gate` is a registered §8B kind. Its schema string was typed by hand here and the file was
   * written by re-joining RESULTS, so it carried no fingerprint and nothing could verify it. */
  const stamped = AC.stamp("gate", out);
  const gatePath = AC.pathFor("gate");
  fs.mkdirSync(path.dirname(gatePath), { recursive: true });
  fs.writeFileSync(gatePath, JSON.stringify(stamped, null, 2) + "\n");
  console.log(JSON.stringify(stamped, null, 2));
  console.log(pass ? "\nGATE: PASS" : "\nGATE: FAIL");
  process.exit(pass ? 0 : 1);
}

function cmdVerify(args) {
  const dir = resolveCorpus(args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS, "verify");
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
  const dir = resolveCorpus(args[0] && !args[0].startsWith("--") ? args[0] : DEFAULT_CORPUS, "refine-language");
  const out = refineLanguage(dir, {
    apply: args.includes("--apply"),
    only: flag(args, "--only", "naming"),
    stub: flag(args, "--stub", null),
    model: flag(args, "--model", null),
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.gate.passed ? 0 : 1);
}

/**
 * language — publish the vocabulary + grammar for a cross-repo consumer.
 *
 * `--json` writes the machine document to stdout (and persists it under the §8B cache home so a
 * consumer can read a file instead of shelling out); bare `language` prints the human view.
 *
 * The document is DERIVED from generators.js/dsl.js at call time, never hand-maintained — see the
 * header of language.js for why that is the correctness argument rather than a style choice.
 */
function cmdLanguage(args) {
  const dir = resolveCorpus(args.find((a) => !a.startsWith("--")) || DEFAULT_CORPUS, "language");
  const { buildLanguage, renderHuman } = require("./language");
  const doc = buildLanguage(dir);

  if (!args.includes("--json")) { process.stdout.write(renderHuman(doc)); return; }

  /* Persisted as well as printed. Located BY THE CONTRACT — a second spelling of the layout here
   * is how one kind ends up written to two places (see the CATALOG note at the top of this file). */
  const dest = AC.pathFor("language", dir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(doc, null, 2) + "\n");
  process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
}

function cmdReport() {
  if (!fs.existsSync(COVERAGE_JSON)) { console.error("no results yet — run: repo-dsl mine"); process.exit(1); }
  const j = JSON.parse(fs.readFileSync(COVERAGE_JSON, "utf8"));
  // Numbers describe the corpus they were mined from. Say which, and whether it is still there,
  // so a stale report can never read as a live one.
  const c = j.corpus || "(unrecorded)";
  const present = j.corpus && fs.existsSync(j.corpus);
  console.log(`corpus: ${c}`);
  if (j.minedAt) console.log(`mined:  ${j.minedAt}`);
  if (!present) {
    console.log("STALE:  that corpus is not present on this machine — these numbers are a stored");
    console.log("        snapshot, not a live measurement. Re-mine before citing them:");
    console.log(`          SOURCE=/path/to/corpus node repo-dsl.js mine`);
  }
  console.log("");
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
    case "explain": return cmdExplain(args);
    case "language": return cmdLanguage(args);
    case "refine-language": return cmdRefineLanguage(args);
    case "report": return cmdReport();
    default:
      console.error("usage: repo-dsl <mine|publish|gate|verify|explain|language|refine-language|report> [args]  (see README)");
      process.exit(1);
  }
}

main();
