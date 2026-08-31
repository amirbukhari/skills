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

/* 1. the round trip is byte-exact WITH names */
ok("renderFileEn/compileFileEn is byte-identical with names loaded", () => {
  assert.strictEqual(EN.compileFileEn(withNames, idx), SRC);
});

/* 2. names actually reached the label — otherwise 3-5 would pass vacuously */
ok("a named leaf reached the label region (non-vacuity)", () => {
  assert.ok(/import one name from a module/.test(withNames),
    "expected an authored name in the .en; got:\n" + withNames.slice(0, 400));
});

/* 3. DELIBERATELY WRONG names change the prose and CANNOT change the bytes.
 *    Every name is replaced with a lie; the compiled output must be identical anyway. */
ok("a wrong name changes prose but never bytes", () => {
  const real = EN.NAMES.names;
  const lies = {};
  for (const k of Object.keys(real)) lies[k] = Object.assign({}, real[k], { en: "PURPLE MONKEY DISHWASHER" });
  const saved = {};
  for (const k of Object.keys(real)) { saved[k] = real[k]; real[k] = lies[k]; }
  let lied;
  try { lied = EN.renderFileEn(SRC, idx).en; } finally { for (const k of Object.keys(saved)) real[k] = saved[k]; }
  assert.notStrictEqual(lied, withNames, "the lie should have changed the prose");
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
  const real = EN.NAMES.names;
  const saved = Object.assign({}, real);
  for (const k of Object.keys(real)) delete real[k];
  let bare;
  try { bare = EN.renderFileEn(SRC, idx).en; } finally { Object.assign(real, saved); }
  assert.deepStrictEqual(payloads(withNames), payloads(bare));
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
