"use strict";
/* NAMES ARE COSMETIC BY CONSTRUCTION (PRD §2.2).
 *
 * The claim under test is not "the names we happen to have are harmless" — it is that NO name can
 * ever change a byte. That is structural: renderFileEn emits «▶ label ⟪payload⟫» and compileChunk
 * locates the payload with lastIndexOf(PAY_OPEN), decoding only what follows. The label region is
 * never an input to compilation. These assertions pin that reading, and the hash keying that
 * decides which label is emitted.
 *
 * §10 compliance: the oracle is real source through a round-trip. The catalog is an INPUT (§10.2). */
const assert = require("assert");
const path = require("path");
const EN = require("./enfile");
const WN = require("./word-names");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const SRC = [
  "import { Alpha } from './alpha';",
  "import { Beta, Gamma } from './beta';",
  "import Delta from './delta';",
  "export { Epsilon } from './epsilon';",
  "",
  "export const run = async (ctx: { body: unknown; status: number }) => {",
  "  const rows = await Alpha.load(Beta, Gamma);",
  "  ctx.body = { data: rows, meta: {} };",
  "  ctx.status = 200;",
  "};",
  "",
].join("\n");

const idx = EN.loadIndex("");
const withNames = EN.renderFileEn(SRC, idx).en;

/* THE CATALOG IS AN INPUT, SO THE NON-VACUITY FIXTURE IS BUILT, NOT ASSUMED (§10.2).
 *
 * This file used to assert the literal string "import one name from a module" appeared in the
 * render — i.e. that the SHIPPED catalog happened to contain a name for the import skeleton. That
 * premise died with §5D.3G (2026-09-01): the rule-coverage filter deliberately does NOT spend a
 * model call on a leaf a node-kind rule already renders, and imports are the best-covered kind in
 * the corpus, so no such name is ever authored again. The assertion was measuring naming POLICY
 * while claiming to measure the naming MECHANISM, and it went red when the policy changed.
 *
 * So the fixture installs a name for every leaf skeleton in the catalog and asserts the mechanism
 * carries it to the label. That is immune to which leaves the naming pass chooses to name — the set
 * is deliberately shrinking — and it is a STRICTLY STRONGER test of what this file is about: it
 * cannot pass vacuously, because a skeleton that reaches no label is exactly what it would catch. */
function probeNames(en) {
  const cat = idx._lzw;
  const out = {};
  if (cat) {
    for (const sym of Object.keys(cat.wide.leaf || {})) out[WN.hashOf("wide", sym)] = { en, sym };
    for (const sym of Object.keys(cat.narrow.leaf || {})) out[WN.hashOf("narrow", sym)] = { en, sym };
  }
  return out;
}
/** render SRC with `names` standing in for the live catalog, then put the catalog back. */
function renderWith(names) {
  const live = EN.NAMES.names;
  const saved = Object.assign({}, live);
  for (const k of Object.keys(live)) delete live[k];
  Object.assign(live, names);
  try { return EN.renderFileEn(SRC, idx).en; }
  finally { for (const k of Object.keys(live)) delete live[k]; Object.assign(live, saved); }
}
const SENTINEL = "a named leaf reached this label";

/* 1. the round trip is byte-exact WITH names */
ok("renderFileEn/compileFileEn is byte-identical with names loaded", () => {
  assert.strictEqual(EN.compileFileEn(withNames, idx), SRC);
});

/* 2. names actually reached the label — otherwise 3-5 would pass vacuously */
ok("a named leaf reached the label region (non-vacuity)", () => {
  const en = renderWith(probeNames(SENTINEL));
  assert.ok(en.includes(SENTINEL),
    "a name on every leaf skeleton reached no label at all; got:\n" + en.slice(0, 400));
});

/* 3. DELIBERATELY WRONG names change the prose and CANNOT change the bytes.
 *    Every name is replaced with a lie; the compiled output must be identical anyway. */
ok("a wrong name changes prose but never bytes", () => {
  const bare = renderWith({});
  const lied = renderWith(probeNames("PURPLE MONKEY DISHWASHER"));
  assert.notStrictEqual(lied, bare, "the lie should have changed the prose");
  assert.ok(lied.includes("PURPLE MONKEY DISHWASHER"), "the lie should appear in the label");
  assert.strictEqual(EN.compileFileEn(lied, idx), SRC, "wrong names must still compile byte-exact");
});

/* 4. NO names at all still compiles, and still renders — the fallback is spanProse, not failure. */
ok("an empty name catalog degrades to spanProse, byte-identical", () => {
  const real = EN.NAMES.names;
  const saved = Object.assign({}, real);
  for (const k of Object.keys(real)) delete real[k];
  let bare;
  try { bare = EN.renderFileEn(SRC, idx).en; } finally { Object.assign(real, saved); }
  assert.ok(!/import one name from a module/.test(bare), "names should be gone");
  assert.strictEqual(EN.compileFileEn(bare, idx), SRC, "unnamed render must still compile byte-exact");
});

/* 5. the two renders differ ONLY inside label regions (between ▶ and ⟪), never in a payload. */
ok("named and unnamed renders have identical payloads", () => {
  const payloads = (en) => (en.match(/⟪[^⟫]*⟫/g) || []);
  /* compared against the PROBE render, not the shipped one: with the live catalog these two can be
   * the same string, and two identical renders agree on their payloads for no reason at all. */
  const named = renderWith(probeNames(SENTINEL));
  const bare = renderWith({});
  assert.notStrictEqual(named, bare, "the two renders must actually differ for this to mean anything");
  assert.deepStrictEqual(payloads(named), payloads(bare));
});

/* 6. the name key is the CONTENT of the skeleton, not its position. */
ok("hashOf is content-addressed, axis-separated, and stable", () => {
  const s = "import‹gap›{‹gap›‹id›‹gap›}‹gap›from‹gap›‹str›;";
  assert.strictEqual(WN.hashOf("wide", s), WN.hashOf("wide", s), "same input -> same hash");
  assert.notStrictEqual(WN.hashOf("wide", s), WN.hashOf("narrow", s), "axes must not collide");
  assert.notStrictEqual(WN.hashOf("wide", s), WN.hashOf("wide", s + " "), "a changed skeleton must change the hash");
  assert.strictEqual(WN.hashOf("wide", s).length, 2 + WN.HASH_LEN);
});

/* 7. an unknown hash yields no name rather than a wrong one — the safe failure. */
ok("an unmatched skeleton returns no clauses instead of guessing", () => {
  const cat = idx._lzw;
  assert.ok(cat, "catalog must be loaded for this assertion to mean anything");
  assert.strictEqual(WN.clausesFor(cat, { a: "w", w: 0 }, {}), null);
});

console.log(`\n${pass} assertions passed`);
