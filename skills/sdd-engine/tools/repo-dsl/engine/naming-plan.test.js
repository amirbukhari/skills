"use strict";
/**
 * naming-plan.test.js — PINS THE NAMING ORDER (R-LANG-20, R-LANG-21, R-LANG-22; PRD §5D.3E).
 *
 * The claim under test is not "the plan we happen to produce looks sensible" — it is that the plan
 * CANNOT ask for a name it could not ground. §5D.3E measured the dependency relation to be a total
 * order along each chain (every composite is prefix + exactly one leaf, 0 violations across
 * 115,661 / 126,167 entries), and the only naming producer that existed sorted depth DESCENDING.
 * So the order is the defect this file exists to make impossible to reintroduce.
 *
 * §10 compliance: synthetic dictionaries, shaped exactly like the real one (`w.m = [prefix,
 * appended]`, appended always a leaf). No corpus, no artifacts — UNIT tier, always runs.
 */
const assert = require("assert");
const NP = require("./naming-plan");
const WN = require("./word-names");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

/* A four-leaf chain exactly as LZW builds one: 10,11,12,13 are leaves; each composite is the
 * previous entry plus ONE leaf. w20 = [A,B] (d=1), w21 = [w20,C] (d=2), w22 = [w21,D] (d=3). */
const axis = {
  words: {
    10: { len: 1, d: 0, sym: "SYM_A" },
    11: { len: 1, d: 0, sym: "SYM_B" },
    12: { len: 1, d: 0, sym: "SYM_C" },
    13: { len: 1, d: 0, sym: "SYM_D" },
    20: { len: 2, d: 1, m: [10, 11] },
    21: { len: 3, d: 2, m: [20, 12] },
    22: { len: 4, d: 3, m: [21, 13] },
  },
};
const cat = { wide: axis, narrow: { words: {} } };

const spans = [
  { axis: "w", id: 22, depth: 3, stmts: 4, file: "a.ts", snippet: "deep()" },
  { axis: "w", id: 20, depth: 1, stmts: 2, file: "b.ts", snippet: "shallow()" },
  { axis: "w", id: 20, depth: 1, stmts: 2, file: "c.ts", snippet: "shallow()" },
  { axis: "w", id: 21, depth: 2, stmts: 3, file: "d.ts", snippet: "mid()" },
];
const used = NP.usedWordsFromSpans(spans);

ok("distinct words aggregate, sites count occurrences", () => {
  assert.strictEqual(used.size, 3);
  assert.strictEqual(used.get("w:20").sites, 2);
  assert.strictEqual(used.get("w:22").sites, 1);
});

/* ---- R-LANG-20: ASCENDING DEPTH, LEAVES FIRST -------------------------------------------- */
ok("tiers come back in ASCENDING depth order, index 0 being the leaves", () => {
  const tiers = NP.tiersOf(cat, used, { to: 3 });
  assert.deepStrictEqual(tiers.map((t) => t.depth), [0, 1, 2, 3]);
});

ok("no word is asked about before every leaf it is built from — 0 order violations", () => {
  const tiers = NP.tiersOf(cat, used, { to: 3 });
  assert.deepStrictEqual(NP.orderViolations(cat, tiers), []);
});

/* The regression this file exists for: the shape name-words-lzw.js:89 actually produced. */
ok("a DESCENDING plan is caught by orderViolations — the check can FAIL, so it is a check", () => {
  const reversed = NP.tiersOf(cat, used, { to: 3 }).slice().reverse();
  const bad = NP.orderViolations(cat, reversed);
  assert.ok(bad.length > 0, "reversing the tiers must produce ungrounded words");
  assert.strictEqual(bad[0].depth, 3, "the deepest word is the first one that cannot be grounded");
});

/* ---- R-LANG-21: d=0 IS INSIDE EVERY SCOPE ------------------------------------------------ */
ok("the leaf tier holds every distinct skeleton the used words are built from", () => {
  const leaves = NP.leafTier(cat, used);
  assert.deepStrictEqual(leaves.map((r) => r.sym).sort(), ["SYM_A", "SYM_B", "SYM_C", "SYM_D"]);
});

ok("a leaf's sites sum the sites of every word that contains it", () => {
  const leaves = NP.leafTier(cat, used);
  const a = leaves.find((r) => r.sym === "SYM_A");
  // SYM_A is in w20 (2 sites), w21 (1) and w22 (1) = 4
  assert.strictEqual(a.sites, 4);
  const d = leaves.find((r) => r.sym === "SYM_D");
  assert.strictEqual(d.sites, 1, "SYM_D is only in the d=3 word");
});

ok("starting above d=0 is REFUSED unless the caller states the leaves are already named", () => {
  assert.throws(() => NP.tiersOf(cat, used, { from: 1, to: 3 }), /R-LANG-21/);
  assert.doesNotThrow(() => NP.tiersOf(cat, used, { from: 1, to: 3, leavesAlreadyNamed: true }));
});

/* ---- KEYS ARE CONTENT HASHES, NOT IDS ---------------------------------------------------- */
ok("a leaf row carries the key it will be written under", () => {
  const a = NP.leafTier(cat, used).find((r) => r.sym === "SYM_A");
  assert.strictEqual(a.key, WN.hashOf("wide", "SYM_A"));
});

ok("a composite row carries a chunk key, and it survives a re-mine that moves ids", () => {
  const [row] = NP.compositeTier(cat, used, 1);
  assert.strictEqual(row.key, WN.chunkKeyOf("wide", axis, 20));
  const moved = { words: { 90: { len: 1, d: 0, sym: "SYM_A" }, 91: { len: 1, d: 0, sym: "SYM_B" }, 99: { len: 2, d: 1, m: [90, 91] } } };
  const movedUsed = NP.usedWordsFromSpans([{ axis: "w", id: 99, depth: 1, stmts: 2, file: "b.ts" }]);
  const [movedRow] = NP.compositeTier({ wide: moved, narrow: { words: {} } }, movedUsed, 1);
  assert.strictEqual(movedRow.key, row.key, "same leaf sequence, different ids — same key");
});

ok("two words with the same leaf sequence ask for ONE name, not two", () => {
  const twin = { words: Object.assign({}, axis.words, { 30: { len: 2, d: 1, m: [10, 11] } }) };
  const u = NP.usedWordsFromSpans([
    { axis: "w", id: 20, depth: 1, stmts: 2, file: "a.ts" },
    { axis: "w", id: 30, depth: 1, stmts: 2, file: "b.ts" },
  ]);
  const rows = NP.compositeTier({ wide: twin, narrow: { words: {} } }, u, 1);
  assert.strictEqual(rows.length, 1, "one chunk key -> one row");
  assert.strictEqual(rows[0].sites, 2, "and the sites add up rather than being lost");
});

/* ---- ORDER WITHIN A TIER IS `count`, AND NOTHING ELSE ------------------------------------ */
ok("rows inside a tier are ordered by sites DESC, tie-broken by key (not by id)", () => {
  const leaves = NP.leafTier(cat, used);
  for (let i = 1; i < leaves.length; i++) assert.ok(leaves[i - 1].sites >= leaves[i].sites);
});

/* ---- R-LANG-22: THE TARGET IS A COST ----------------------------------------------------- */
ok("summarize states the target AND today's figure together, as a cost", () => {
  const s = NP.summarize(NP.tiersOf(cat, used, { to: 3 }), used.size);
  assert.strictEqual(s.namingTarget, 4 + 1 + 1 + 1);
  assert.strictEqual(s.todayEveryUsedWord, 3);
  assert.ok(/MORE names, not fewer/.test(s.statedAsCost));
});

/* ---- BATCHING is a partition — nothing dropped, nothing duplicated ----------------------- */
ok("batches partition a tier exactly", () => {
  const rows = NP.leafTier(cat, used);
  const b = NP.batches(rows, 3);
  assert.strictEqual(b.length, 2);
  assert.deepStrictEqual(b.flat().map((r) => r.key), rows.map((r) => r.key));
});

console.log(`\n${pass} assertions passed`);
