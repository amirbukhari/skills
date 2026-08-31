"use strict";
// Drift guard: the RECURSIVE WORD DICTIONARY has two halves — the writer (wordlzw.promote, via
// build-lzw-generators) and the reader (enlzw). They once skewed: the writer emitted
// `members`/`hierarchyDepth` while the reader read `m`/`d`, reconciled only by a silent rename in
// build-lzw-generators. This test pins BOTH halves to the single canonical short vocabulary
// (len / d / sym / m) so they can never drift apart again — behaviourally (a round-trip through the
// real reader) and structurally (no word may carry the legacy long names), on both the freshly
// built graph and the on-disk catalog.
const fs = require("fs");
const AC = require("./artifact-contract");
const path = require("path");
const W = require("./wordlzw");
const EL = require("./enlzw");

let passed = 0;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } passed++; console.log("  ok:", m); };

const CANONICAL_COMPOSITE = ["id", "len", "freq", "m", "d"]; // graph fields promote emits for a composite
const LEGACY = ["members", "hierarchyDepth"];                // the pre-reconciliation spellings — forbidden

/* ---- writer side: run the real promote() on a synthetic recurring corpus ---- */
const A = "constAAAAAAAAAAAAAAAA", B = "constBBBBBBBBBBBBBBBB", C = "constCCCCCCCCCCCCCCCC";
const streams = [[A, B, C], [A, B, C], [A, B]]; // "A,B" recurs 3x, "A,B,C" 2x -> composites promoted
const model = W.buildSaturated(streams, { maxWin: 8, minCount: 2 });
const prom = W.promote(model, { minCount: 2, minSkelPerStmt: 1, saturated: true });

const wordList = Object.values(prom.words);
const composites = wordList.filter((w) => w.len >= 2);
ok(composites.length > 0, "promote emits at least one composite word");

for (const w of wordList) {
  for (const bad of LEGACY) ok(!(bad in w), `word ${w.id} does NOT carry legacy field "${bad}"`);
}
for (const w of composites) {
  ok("m" in w && Array.isArray(w.m) && w.m.length === 2, `composite ${w.id} carries m:[prefix, appended]`);
  ok("d" in w && typeof w.d === "number", `composite ${w.id} carries numeric d`);
}
for (const w of wordList.filter((x) => x.len === 1)) {
  ok("sym" in w && "d" in w, `leaf ${w.id} carries sym + d`);
}

/* ---- reader side: project to the on-disk axis shape (as build-lzw-generators does) and let the
 *      REAL reader consume it. If the reader expected different names, expandKey would throw/NaN. */
const words = {}, leaf = {}, ext = {};
for (const w of wordList) {
  if (w.len === 1) { words[w.id] = { len: 1, d: w.d, sym: w.sym }; leaf[w.sym] = w.id; }
  else {
    words[w.id] = { len: w.len, d: w.d, m: w.m };
    const appendedSym = model.symOfId[model.dict[w.m[1]].appended];
    ext[w.m[0] + "|" + appendedSym] = w.id;
  }
}
const axis = { words, leaf, ext };
const deepest = composites.slice().sort((a, b) => b.len - a.len)[0];
const expanded = EL.expandKey(axis, deepest.id);           // reader recurses .m -> leaf .sym
const expectedLeaves = W.expandSymbols(prom.words[deepest.id], { words: prom.words, symOfId: model.symOfId });
ok(expanded === expectedLeaves.join(W.GAP), "enlzw.expandKey reconstructs the writer's leaf-symbol key from the canonical fields");

/* ---- on-disk artifact: the shipped catalog must use the same canonical vocabulary ---- */
const catPath = AC.pathFor("generators-lzw");
if (fs.existsSync(catPath)) {
  const cat = JSON.parse(fs.readFileSync(catPath, "utf8"));
  for (const axisName of ["narrow", "wide"]) {
    const ws = Object.values(cat[axisName].words);
    const comp = ws.find((w) => w.len >= 2);
    ok(comp && "m" in comp && "d" in comp, `on-disk ${axisName}: composites carry m + d`);
    for (const w of ws.slice(0, 200)) for (const bad of LEGACY) ok(!(bad in w), `on-disk ${axisName}: no "${bad}"`);
  }
} else {
  console.log("  skip: catalog/generators-lzw.json absent (regenerable) — build-time projection still pinned above");
}

console.log(`\nPASS ${passed} assertions — writer and reader agree on canonical fields (len/d/sym/m).`);
