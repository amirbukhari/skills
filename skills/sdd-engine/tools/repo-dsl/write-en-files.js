#!/usr/bin/env node
"use strict";
/**
 * write-en-files.js — STEP 7. Makes the English SOURCE real on disk:
 *   1. writes <corpus>/sen/files/<rel>.en for every source file (the canonical human
 *      artifact — STEP-6 data-as-English + cnl logic grammar), each verified .en -> .ts
 *      BYTE-IDENTICAL before it is written;
 *   2. relocates the DERIVED compose IR (.calc) OUT of the spec tree into the gitignored
 *      <corpus>/.cache/ so the sen folder Amir reads/edits holds .en (+ specs), no .calc;
 *   3. writes hydra-source/.gitignore ( .cache/ ) so the cache is regenerable, not committed.
 *
 * The .en -> .ts round-trip is the gate: it must hold for ALL files. Deterministic; 0 model.
 *   node write-en-files.js
 *
 * --no-write (alias --dry-run): run the FULL render + verify + report path without mutating the
 * corpus — no .calc relocation, no .en writes, no .gitignore, and no en-index unless --out <dir>
 * is given. Lets the production code path prove the byte-identity gate and the recursive/flat
 * instrumentation against a protected corpus.
 *   node write-en-files.js --no-write [--out <dir>]
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./engine/enfile");
const CR = require("./engine/corpus-root");
const AC = require("./engine/artifact-contract");

const CORPUS = CR.corpusRoot();   // WRITE root: sen/, .cache/
const SRC = CR.sourceRoot();      // READ root: the .ts tree
// --no-write / --dry-run: prove the gate + instrumentation with ZERO corpus mutation.
const DRY = process.argv.includes("--no-write") || process.argv.includes("--dry-run");
const outFlag = process.argv.indexOf("--out");
const OUT_DIR = outFlag >= 0 ? process.argv[outFlag + 1] : null;
const { SKIP } = require("./engine/walk-skip");   // the ONE canonical corpus walk-skip set
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; };
const walkAll = (d, pred, o = []) => { if (!fs.existsSync(d)) return o; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkAll(p, pred, o); else if (pred(p)) o.push(p); } return o; };

/* ---------- 1. relocate existing .calc OUT of the spec tree ---------- */
const senDir = CR.senDir();
const calcFiles = walkAll(senDir, (p) => p.endsWith(".calc"));
let movedFiles = 0, movedOther = 0;
if (!DRY) for (const abs of calcFiles) {
  const relFromSpec = path.relative(senDir, abs); // e.g. files/src/foo.ts.calc  OR  modules/x/composition.calc
  let dest;
  if (relFromSpec.startsWith("files" + path.sep)) {
    // files/<rel>.calc -> .cache/compose/files/<rel>.calc  (matches the repointed producer/expander)
    dest = path.join(CORPUS, ".cache", "compose", "files", relFromSpec.slice(("files" + path.sep).length));
    movedFiles++;
  } else {
    dest = path.join(CORPUS, ".cache", "spec-derived", relFromSpec);
    movedOther++;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(abs, dest);
}
// prune now-empty sen/files subdir if it held only .calc
const enFilesDir = path.join(senDir, "files");

/* ---------- 2. render + verify + write .en ---------- */
const index = EN.loadIndex(CORPUS);
const src = walk(SRC);
let byteExact = 0, failures = [];
let totBytes = 0, engBytes = 0, stmtSpans = 0, dataSpans = 0, genSpans = 0, genStmtsCollapsed = 0, filesWithGen = 0;
/* R-ARCH-16 review surface: statements a human must still read as code. Summed, never averaged —
 * an average over files hides the worst file, which is the one that costs the review. */
let bodyStmts = 0, collapsedStmts = 0, restatedStmts = 0;
// recursive-producer instrumentation: recursive (word-of-words) vs flat-fallback spans, and the
// composition-depth distribution. A flat-fallback span is a permanent depth-1 hole in the language.
let genRecursive = 0, genFlatFallback = 0, filesWithFlat = 0, maxDepth = 0; const depthHist = {};
/* Dictionary-level counts, read from the catalog the renderer actually loaded (never recomputed
 * here — recomputing is how a producer and a consumer come to disagree, PRD §8B). The WIDE axis is
 * the one the renderer composes through. Absent dictionary -> zeros, which is honest: no dictionary
 * means no composition, and R-COMP-7 should read 0 rather than nothing. */
const dictCounts = (() => {
  const z = { composites: 0, compositionEdges: 0, maxDepth: 0, dictEntries: 0 };
  const c = index && index._lzw && (index._lzw.wide || index._lzw.narrow);
  return c && c.counts ? { ...z, ...c.counts } : z;
})();
const perFile = [];
for (const abs of src) {
  const rel = path.relative(SRC, abs);
  let source; try { source = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  let r, back;
  try { r = EN.renderFileEn(source, index); back = EN.compileFileEn(r.en, index); } catch (e) { failures.push([rel, "THREW: " + e.message]); continue; }
  if (back !== source) { failures.push([rel, "MISMATCH"]); continue; }
  byteExact++;
  if (!DRY) {
    const outPath = path.join(enFilesDir, rel + ".en");
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, r.en);
  }
  totBytes += r.stats.totalBytes; engBytes += r.stats.englishBytes; stmtSpans += r.stats.stmtSpans; dataSpans += r.stats.dataSpans;
  genSpans += r.stats.genSpans || 0; genStmtsCollapsed += r.stats.genStmtsCollapsed || 0; if (r.stats.genSpans) filesWithGen++;
  bodyStmts += r.stats.bodyStatements || 0; collapsedStmts += r.stats.collapsedStatements || 0;
  restatedStmts += r.stats.restatedStatements || 0;
  genRecursive += r.stats.genRecursive || 0; genFlatFallback += r.stats.genFlatFallback || 0; if (r.stats.genFlatFallback) filesWithFlat++;
  if ((r.stats.maxDepth || 0) > maxDepth) maxDepth = r.stats.maxDepth;
  for (const k of Object.keys(r.stats.depthHist || {})) depthHist[k] = (depthHist[k] || 0) + r.stats.depthHist[k];
  perFile.push({ rel, ...r.stats });
}

/* ---------- 3. .gitignore is a hand-maintained TRACKED source file now (lists derived paths to
 * ignore); the build no longer regenerates it. Create a minimal one only if it is missing. ---------- */
if (!DRY && !fs.existsSync(path.join(CORPUS, ".gitignore")))
  fs.writeFileSync(path.join(CORPUS, ".gitignore"), "# derived build intermediates — regenerable, never committed.\n.cache/\n");

/* ---------- 4. manifest + report ---------- */
perFile.sort((a, b) => b.englishPct - a.englishPct);
const manifest = {
  step: 7, kind: "english-source-of-truth", modelCalls: 0,
  specLayout: "<corpus>/sen/files/<rel>.en  (canonical human source; .ts is derived)",
  derivedCache: "<corpus>/.cache/  (gitignored: compose/ IR moved out of the sen tree)",
  gate: { totalFiles: src.length, byteIdentical: byteExact, allByteIdentical: byteExact === src.length && failures.length === 0 },
  englishBytesPct: totBytes ? +(100 * engBytes / totBytes).toFixed(1) : 0,
  stmtSpans, dataSpans,
  /* PRD R-COMP-6 names THREE fields a consumer reads: generators.maxDepth, .composites and
   * .compositionEdges. Only the first existed here, under a different name (maxCompositionDepth),
   * and the other two did not exist at all — so R-COMP-7's gate ("maxDepth >= 2 on the live path")
   * was reading `undefined` and comparing it, which is neither pass nor fail. That is the §8B drift
   * shape with the PRD as the consumer: the spec named fields the producer never wrote.
   *   maxDepth and dictionaryMaxDepth are DIFFERENT NUMBERS and are kept apart deliberately:
   *   - maxDepth           the deepest span the LIVE .en path actually emitted. This is the
   *                        R-COMP-7 gate value; it is what "the live compile composes" means.
   *   - dictionaryMaxDepth how deep the MINED dictionary goes. Always >= maxDepth, because a
   *                        deep word only counts once a file actually renders through it.
   * Conflating them would let a deep dictionary report a composing renderer that never composed.
   * maxCompositionDepth is retained as an alias so existing readers do not break. */
  generators: { calls: genSpans, statementsCollapsed: genStmtsCollapsed, netStatementReduction: genStmtsCollapsed - genSpans, filesUsing: filesWithGen,
    recursive: genRecursive, flatFallback: genFlatFallback, flatFallbackPct: genSpans ? +(100 * genFlatFallback / genSpans).toFixed(1) : 0,
    filesWithFlatFallback: filesWithFlat,
    maxDepth: maxDepth, maxCompositionDepth: maxDepth, depthHistogram: depthHist,
    composites: dictCounts.composites, compositionEdges: dictCounts.compositionEdges,
    dictionaryMaxDepth: dictCounts.maxDepth, dictEntries: dictCounts.dictEntries },
  /* THE HEADLINE METRIC (PRD R-ARCH-16, §7 "Review surface is the metric"). Statements a human
   * must still read as TypeScript. Kept OUT of `generators` because it is not a property of the
   * generator layer — it is the property of the corpus that the whole engine exists to move. */
  reviewSurface: {
    bodyStatements: bodyStmts,
    /* Only `collapsed` removes review work. `restated` is English but one clause per statement,
     * which §4 calls a failure mode, so it is reported and NOT credited. */
    collapsedStatements: collapsedStmts, restatedStatements: restatedStmts,
    verbatimStatements: Math.max(0, bodyStmts - collapsedStmts - restatedStmts),
    residualStatements: Math.max(0, bodyStmts - collapsedStmts),
    /* §7.3 FROZEN DEFINITION, corpus view. reviewSurface = calls + unfolded statements; the
     * collapse ratio is netStatementReduction / S. One definition, two granularities — the per-file
     * view is `perFile[].reviewSurface`. */
    netStatementReduction: collapsedStmts - genSpans,
    reviewSurface: genSpans + Math.max(0, bodyStmts - collapsedStmts),
    collapseRatioPct: bodyStmts ? +(100 * (collapsedStmts - genSpans) / bodyStmts).toFixed(1) : 0,
    filesFullyCovered: perFile.filter((f) => (f.residualStatements || 0) === 0 && (f.bodyStatements || 0) > 0).length,
    worstFiles: perFile.slice().sort((a, b) => (b.reviewSurface || 0) - (a.reviewSurface || 0))
      .slice(0, 15).map((f) => ({ rel: f.rel, reviewSurface: f.reviewSurface, residualStatements: f.residualStatements, bodyStatements: f.bodyStatements })),
  },
  calcRelocated: { fromSpecFiles: movedFiles, fromSpecOther: movedOther },
  topEnglishFiles: perFile.slice(0, 15),
};
/* en-index.json is DERIVED -> the gitignored cache, never the sen/ tree. The location comes from
 * AC.pathFor, not a hand-built path.join: this file publishes three gates (byte-identity, R-COMP-6's
 * counts, R-ARCH-16's review surface) and used to be written with NO contract header at all — no
 * schema, no fingerprint, no corpus pin — which is the §8B incident-5 shape (a producer publishing
 * numbers with nothing for a consumer to verify). Registered as a kind and stamped now.
 * In --no-write mode it goes to --out <dir> if given, keeping the registry's filename; else skipped. */
const enIndexSpec = AC.specOf("en-index");
const enIndexOut = DRY
  ? (OUT_DIR ? path.join(OUT_DIR, enIndexSpec.file) : null)
  : AC.pathFor("en-index", CORPUS);
if (enIndexOut) {
  const stamped = AC.stamp("en-index", manifest, { corpus: CORPUS });
  fs.mkdirSync(path.dirname(enIndexOut), { recursive: true });
  fs.writeFileSync(enIndexOut, JSON.stringify(stamped, null, 2));
  /* Read it straight back through the contract. A producer that cannot pass its own validator has
   * published a file its consumers will refuse, and finding that out here is cheaper than finding
   * it out in the gate. */
  AC.load("en-index", enIndexOut, { corpus: CORPUS });
}

const residualCalc = walkAll(senDir, (p) => p.endsWith(".calc")).length;
console.log(`=== STEP 7 — ENGLISH SOURCE OF TRUTH ===${DRY ? "  (DRY RUN — no corpus writes)" : ""}`);
console.log(`  .en ${DRY ? "rendered (not written)" : "written ............."} ${byteExact}/${src.length}  ${DRY ? "" : "-> sen/files/<rel>.en"}`);
console.log(`  .en -> .ts BYTE-IDENTICAL ..... ${byteExact}/${src.length}   ${manifest.gate.allByteIdentical ? "(ALL PASS)" : "FAILURES: " + failures.length}`);
for (const f of failures.slice(0, 10)) console.log(`       FAIL ${f[0]} ${f[1]}`);
console.log(`  english coverage (bytes) ...... ${manifest.englishBytesPct}%   (${stmtSpans} logic-stmt spans + ${dataSpans} data spans)`);
/* NOT "recursive X / flat Y (Y% fallback)". There is no flat producer (engine/enfile.js pass 0b),
 * so a 0% fallback figure is a tautology dressed as a measurement — the class of number PRD
 * R-MECH-8 forbids publishing. Printed as a structural fact plus a tripwire instead. */
console.log(`  generator spans ............... ${genSpans}   all recursive (no flat producer exists)`);
if (genFlatFallback) console.log(`  !! FLAT SPANS: ${genFlatFallback} — a flat producer was re-introduced; re-check the R-COMP-7 gate`);
console.log(`  composition depth ............. live path ${maxDepth} (R-COMP-7 needs >= 2), dictionary ${dictCounts.maxDepth}; ${dictCounts.composites} composites / ${dictCounts.compositionEdges} edges`);
const rs = manifest.reviewSurface;
console.log(`  REVIEW SURFACE (R-ARCH-16) .... ${rs.reviewSurface} things to read, from S=${rs.bodyStatements} statements  (${rs.collapseRatioPct}% left the reader's view)`);
console.log(`                                 = ${genSpans} generator calls + ${rs.residualStatements} unfolded (of which ${rs.restatedStatements} restated 1:1, NOT credited per §4; ${rs.verbatimStatements} verbatim)`);
console.log(`                                 ${rs.filesFullyCovered}/${src.length} files fully accounted for by words (target: all, PRD §5D.4)`);
console.log(`  .calc relocated out of spec ... ${movedFiles} (files/) + ${movedOther} (modules,skeletons) -> .cache/${DRY ? "  (skipped: dry run)" : ""}`);
console.log(`  .calc REMAINING under sen/ .... ${residualCalc}   ${residualCalc === 0 ? "(sen tree is .calc-free)" : "(!!)"}`);
/* s12, 2026-08-31: this line used to say `wrote .gitignore ( .cache/ ) + sen/en-index.json`, but
 * en-index.json is written to <corpus>/.cache/spec-derived/. A log that names the wrong path is how
 * a reader looks for an artifact in the sen tree and concludes it was never produced. */
console.log(`  en-index ...................... ${enIndexOut || "(not written: pass --out <dir> to emit)"}`);
console.log(`\n  worst review surface (statements still read as code):`);
for (const f of rs.worstFiles.slice(0, 8)) console.log(`     surface ${String(f.reviewSurface).padStart(4)} of S=${String(f.bodyStatements).padEnd(5)} (${f.residualStatements} unfolded)  ${f.rel}`);
console.log(`\n  most-English files:`);
for (const f of perFile.slice(0, 8)) console.log(`     ${String(f.englishPct).padStart(5)}%  ${f.rel}`);

/* ---------- EXIT CODE — gate 1 must be able to fail a caller ----------
 * PRD R-REND-1 / §7.0 gate 1: `compileFileEn(renderFileEn(src)) === src` for EVERY file, always;
 * "the floor and it never regresses". This script computed `manifest.gate.allByteIdentical`,
 * printed "FAILURES: N" — and then exited 0 regardless, so the one guarantee this project sells
 * was invisible to every automated caller.
 *
 * It matters more since `sdd-run.js` landed. Its contract is "EXIT CODE = the child's exit code,
 * unchanged … exitCode === 0, so a UI never has to interpret prose to know whether a step
 * succeeded." A child that cannot exit non-zero makes that promise false: `sdd-run render` would
 * report ok:true on a byte-identity regression. This is the missing half of that wrapper, not a
 * competing mechanism.
 *
 * A dry run reports and does not gate — it writes nothing, so it is a measurement, not a build.
 * Measured before the change: 1037/1037 byte-identical, so this exits 0 on today's corpus. */
if (!DRY && !manifest.gate.allByteIdentical) {
  console.error(`\nBYTE-IDENTITY FLOOR BREACHED — ${byteExact}/${src.length} files round-trip; ${failures.length} failed.`);
  console.error(`  PRD R-REND-1: this is the floor and it never regresses. Refusing to report success.`);
  for (const [rel, why] of failures.slice(0, 10)) console.error(`    ${why.padEnd(10)} ${rel}`);
  if (failures.length > 10) console.error(`    ... and ${failures.length - 10} more`);
  process.exit(1);
}
