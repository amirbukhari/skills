"use strict";
/**
 * build-lzw-generators.js — mine the RECURSIVE WORD DICTIONARY (Amir's LZW-as-primary design).
 *
 * Replaces the FLAT window-cluster catalog (build-generators.js -> generators.json, PRD §4A
 * defect) with an LZW dictionary run over per-statement CANONICAL SYMBOLS. Output is a word
 * GRAPH: leaf words (one statement key) and composite words (m:[prefixWord, appendedLeaf])
 * — generators referencing generators, with emergent depth d. The word-graph fields (len/d/sym/m)
 * are the canonical short forms shared verbatim by the writer (engine/wordlzw.js) and the reader
 * (engine/enlzw.js); see wordlzw.js's header for why they are abbreviated.
 *
 * Corpus is READ-ONLY (walked, never written). The catalog is written into the SKILLS REPO
 * (catalog/generators-lzw.json), NOT under hydra-source — the SOURCE-PROTECTED generators.json
 * (s1's live flat catalog) is left untouched. Deterministic; zero model calls.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const G = require("./engine/generators");
const W = require("./engine/wordlzw");

const CORPUS = process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source";
const OUT = path.join(__dirname, "catalog", "generators-lzw.json"); // SKILLS REPO, not corpus
// MUST match write-en-files.js SKIP exactly. When it did not (this set excluded "tests"), the
// dictionary was mined over 956 files but applied to 1037, so every recurring body in a test file
// had no word by construction — 696 of 937 un-collapsed bodies traced to that one mismatch.
const SKIP = new Set(["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "spec", "catalog", ".cache", "demo", "coined-demo"]);
// MIN_SKEL = minimum skeleton bytes per statement before a word may be promoted. It is the
// readability dial, not a correctness one: every span is byte-gated at emission regardless.
// Measured over the full corpus (byte-identity 1037/1037 at every point):
//   12 -> filesUsing 649, netStatementReduction 5187   (was the default; too strict)
//    8 -> filesUsing 715, netStatementReduction 6920   <- the knee, and the default
//    6 -> filesUsing 719, netStatementReduction 7123
//    4 -> filesUsing 732, netStatementReduction 7209, but English coverage jumps 35.9% -> 45.4%
//         by promoting near-trivial skeletons, which makes the .en noisier to read.
// Lower it via MIN_SKEL= if more collapse is wanted; it cannot break byte-identity.
const MIN_COUNT = 2, MIN_SKEL = +(process.env.MIN_SKEL || 8), MAXWIN = +(process.env.MAXWIN || 16);

function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
function blocks(sf) { const out = []; const visit = (n) => { if (ts.isBlock(n) || ts.isSourceFile(n)) { if (n.statements.length) out.push([...n.statements]); } ts.forEachChild(n, visit); }; visit(sf); return out; }

/* Per-block: maximal runs of foldable statements -> per-statement symbol streams (one per axis).
 * A statement whose parts don't refill exactly (generalStmtParts === null) splits the run. */
function symbolStreams(sf, wide) {
  const streams = [];
  for (const stmts of blocks(sf)) {
    let cur = [];
    for (const st of stmts) {
      const p = G.isFoldable(st) ? G.generalStmtParts(st, sf, wide) : null;
      if (!p) { if (cur.length) { streams.push(cur); cur = []; } continue; }
      cur.push(G.keyOf(p));
    }
    if (cur.length) streams.push(cur);
  }
  return streams;
}

const files = walk(CORPUS);
const narrowStreams = [], wideStreams = [];
let parsed = 0;
for (const abs of files) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const s of symbolStreams(sf, false)) narrowStreams.push(s);
  for (const s of symbolStreams(sf, true)) wideStreams.push(s);
  parsed++;
}

/* Build + promote each axis, then serialize a render-friendly graph keyed on symbol STRINGS. */
function buildAxis(streams, axis) {
  const model = W.buildSaturated(streams, { maxWin: MAXWIN, minCount: MIN_COUNT });
  const prom = W.promote(model, { minCount: MIN_COUNT, minSkelPerStmt: MIN_SKEL, skelBytesOf: G.skelBytes, saturated: true });
  // serialize: words{}, leaf{sym->wordId}, ext{prefixWordId|appendedSym -> wordId}.
  // promote() already emits the canonical word-graph fields (len/d/sym/m), so this is a straight
  // projection — no field renaming — keeping only the fields the on-disk catalog carries.
  const words = {}, leaf = {}, ext = {};
  let maxDepth = 0, composites = 0, edges = 0;
  for (const idStr in prom.words) {
    const w = prom.words[idStr];
    if (w.len === 1) {
      words[w.id] = { len: 1, d: w.d, sym: w.sym };
      leaf[w.sym] = w.id;
    } else {
      words[w.id] = { len: w.len, d: w.d, m: w.m }; // m=[prefixWordId, appendedLeafWordId]
      const appendedSym = model.symOfId[model.dict[w.m[1]].appended];
      ext[w.m[0] + "|" + appendedSym] = w.id;
      composites++; edges += 2;
      if (w.d > maxDepth) maxDepth = w.d;
    }
  }
  const leaves = Object.keys(leaf).length;
  return { axis, minCount: MIN_COUNT, minSkel: MIN_SKEL, counts: { leaves, composites, maxDepth, compositionEdges: edges, dictEntries: model.dict.length }, words, leaf, ext };
}

const narrow = buildAxis(narrowStreams, "narrow");
const wide = buildAxis(wideStreams, "wide");

// PROVENANCE — §8A protects this artifact, which is only meaningful if the next person can
// regenerate it rather than treat it as a mystery blob. Record the exact corpus and command.
const catalog = {
  schema: "sdd-repo-dsl/generators-lzw/1",
  builtFrom: path.basename(CORPUS),
  corpus: path.resolve(CORPUS),
  minedAt: new Date().toISOString(),
  regenerate: `HYDRA_CORPUS=${path.resolve(CORPUS)} node build-lzw-generators.js`,
  tool: "build-lzw-generators.js",
  node: process.version,
  fileCount: parsed, gap: W.GAP, narrow, wide,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(catalog));

console.log("=== build-lzw-generators ===");
console.log("corpus files parsed:", parsed);
console.log("NARROW  leaves:", narrow.counts.leaves, " composites:", narrow.counts.composites, " maxDepth:", narrow.counts.maxDepth, " dictEntries:", narrow.counts.dictEntries);
console.log("WIDE    leaves:", wide.counts.leaves, " composites:", wide.counts.composites, " maxDepth:", wide.counts.maxDepth, " dictEntries:", wide.counts.dictEntries);
console.log("wrote", OUT, "(" + (fs.statSync(OUT).size / 1e6).toFixed(2) + " MB)");
