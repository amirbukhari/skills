"use strict";
/**
 * FINER-GRANULARITY SWEEP.
 *
 * Sweeps the cut-depth knob (0 = whole-statement leaves = baseline, >0 subdivides
 * each leaf statement into expression / sub-tree spans down to that AST depth) over
 * the delonix corpus and reports, per grain:
 *
 *   - corpus coverage %  (reproduced-by-composition chars / total chars)
 *   - MEANINGFUL coverage % (excludes trivial 1-2 char punctuation tokens, so we
 *     can see whether finer cutting buys real reuse or just tiles `.`/`(`/`;`)
 *   - per-file distribution (how many of the bespoke files climbed, and to what)
 *   - vocabulary: distinct reproduced shapes ("words") + avg files-per-word reuse
 *   - word-count inflation vs trivial-word share
 *   - BYTE-IDENTITY: tokens+gaps must refill every file exactly (hard gate)
 *
 * Deterministic, zero LLM, read-only (does not write catalog/coverage).
 *   node finer-granularity-sweep.js [corpusDir] [--grains 0,1,2,3,4,6,8]
 */
const fs = require("fs");
const path = require("path");
const { mine } = require("./engine/pipeline");
const { tokenize, fill } = require("./engine/fanout");
const { slotsAreTyped } = require("./lib/skeleton");
const CR = require("./engine/corpus-root");
const { SKIP } = require("./engine/walk-skip");   // the ONE canonical corpus walk-skip set — this walker had NONE

const DEFAULT_CORPUS = CR.sourceRoot();
const argv = process.argv.slice(2);
let corpus = DEFAULT_CORPUS;
let grains = [0, 1, 2, 3, 4, 6, 8];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--grains") grains = argv[++i].split(",").map((x) => parseInt(x, 10));
  else if (!argv[i].startsWith("--")) corpus = argv[i];
}

const isTrivial = (txt) => txt.trim().length <= 2; // punctuation / tiny operators

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const files = walk(corpus).sort();

// Byte-identity gate: for a grain, refill tokens+gaps for every file, compare to source.
function byteIdentityHolds(cutDepth) {
  for (const f of files) {
    const source = fs.readFileSync(f, "utf8");
    const { tokens, gaps } = tokenize(f, source, undefined, cutDepth);
    const items = [
      ...tokens.map((t) => ({ s: t.start, txt: fill(t.templateParts, t.slots) })),
      ...gaps.map((g) => ({ s: g.start, txt: g.text })),
    ].sort((a, b) => a.s - b.s);
    if (items.map((i) => i.txt).join("") !== source) return { ok: false, file: path.relative(corpus, f) };
  }
  return { ok: true };
}

// Reuse / vocabulary stats need shape -> set(files) reproduced, computed from mine internals.
function analyze(cutDepth) {
  const res = mine(corpus, { cutDepth });
  const { rollup, fileReports, internals } = res;
  const { canonical } = internals;

  // recompute per-token repro with the same rule as pipeline, and gather reuse.
  const shapeFiles = new Map();   // reproduced shape -> Set(rel)
  const shapeReproChars = new Map();
  let meaningfulRepro = 0, trivialRepro = 0, totalChars = 0;
  const wordCountByFile = new Map();
  const shapeCounts = res.internals.model.shapeCounts;

  for (const pf of internals.perFile) {
    for (const t of pf.tokens) {
      const recurs = (shapeCounts.get(t.shape) || 0) >= res.minCount;
      const typed = slotsAreTyped(t.slots);
      const matches = recurs && typed && fill(canonical.get(t.shape), t.slots) === t.text;
      if (!matches) continue;
      if (!shapeFiles.has(t.shape)) shapeFiles.set(t.shape, new Set());
      shapeFiles.get(t.shape).add(pf.rel);
      shapeReproChars.set(t.shape, (shapeReproChars.get(t.shape) || 0) + t.text.length);
      if (isTrivial(t.text)) trivialRepro += t.text.length; else meaningfulRepro += t.text.length;
    }
  }
  for (const fr of fileReports) totalChars += fr.chars;

  const words = [...shapeFiles.keys()];
  const trivialWords = words.filter((s) => {
    // a "word" is trivial if every reproduced instance was trivial text — approximate
    // by: shape has no typed slot marker AND its avg reproduced char is tiny.
    const hasSlot = /(?:^| )(ID|NUM|STR|BOOL|TYPE|NULLC)(?: |$)/.test(s);
    const avg = shapeReproChars.get(s) / [...shapeFiles.get(s)].length;
    return !hasSlot && avg <= 3;
  });
  const totalReuse = words.reduce((a, s) => a + shapeFiles.get(s).size, 0);
  const avgFilesPerWord = words.length ? totalReuse / words.length : 0;

  return {
    cutDepth,
    coveragePct: rollup.coveragePct,
    meaningfulPct: +(100 * meaningfulRepro / totalChars).toFixed(1),
    trivialPct: +(100 * trivialRepro / totalChars).toFixed(1),
    words: words.length,
    trivialWords: trivialWords.length,
    avgFilesPerWord: +avgFilesPerWord.toFixed(2),
    alphabet: rollup ? res.library.counts.alphabet : null,
    leaves: res.library.counts.leafGenerators,
    composites: res.library.counts.compositeGenerators,
    tokens: rollup.tokens,
    fileReports,
  };
}

console.log(`corpus: ${corpus}`);
console.log(`files:  ${files.length}`);
console.log(`grains: ${grains.join(", ")}\n`);

const rows = [];
const baselineByFile = new Map();
for (const g of grains) {
  const bi = byteIdentityHolds(g);
  if (!bi.ok) {
    console.error(`\n!! BYTE-IDENTITY BROKEN at cutDepth=${g} on ${bi.file} — backing out this grain.`);
    rows.push({ cutDepth: g, broken: true });
    continue;
  }
  const a = analyze(g);
  a.byteIdentity = "EXACT";
  rows.push(a);
  if (g === 0) for (const fr of a.fileReports) baselineByFile.set(fr.rel, fr.coveragePct);
}

// ---- coverage-vs-granularity curve ----
console.log("cut  cov%   meaning%  trivial%  words  triv-words  reuse(files/word)  tokens  byte");
console.log("---  -----  --------  --------  -----  ----------  -----------------  ------  ----");
for (const r of rows) {
  if (r.broken) { console.log(`${String(r.cutDepth).padStart(3)}  BYTE-IDENTITY BROKEN — backed out`); continue; }
  console.log(
    `${String(r.cutDepth).padStart(3)}  ` +
    `${String(r.coveragePct).padStart(5)}  ` +
    `${String(r.meaningfulPct).padStart(8)}  ` +
    `${String(r.trivialPct).padStart(8)}  ` +
    `${String(r.words).padStart(5)}  ` +
    `${String(r.trivialWords).padStart(10)}  ` +
    `${String(r.avgFilesPerWord).padStart(17)}  ` +
    `${String(r.tokens).padStart(6)}  ${r.byteIdentity}`
  );
}

// ---- per-file climb: how many files rose vs baseline, and the biggest movers ----
const last = rows.filter((r) => !r.broken).pop();
if (last && last.cutDepth !== 0 && baselineByFile.size) {
  const movers = [];
  for (const fr of last.fileReports) {
    const base = baselineByFile.get(fr.rel);
    if (base === undefined) continue;
    movers.push({ rel: fr.rel, base, now: fr.coveragePct, delta: +(fr.coveragePct - base).toFixed(1) });
  }
  movers.sort((a, b) => b.delta - a.delta);
  const climbed = movers.filter((m) => m.delta > 0.5).length;
  console.log(`\nper-file climb (cutDepth ${last.cutDepth} vs baseline 0): ${climbed}/${movers.length} files rose >0.5%`);
  console.log("biggest movers:");
  for (const m of movers.slice(0, 12)) {
    console.log(`  ${m.delta >= 0 ? "+" : ""}${m.delta}%  ${m.base}% -> ${m.now}%   ${m.rel}`);
  }
}
