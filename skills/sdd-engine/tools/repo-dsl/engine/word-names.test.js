"use strict";
/* NAMES CANNOT PRODUCE WRONG BYTES (PRD §2.2, AS NARROWED BY §5C RULE 2 ON 2026-09-03).
 *
 * >>> THIS HEADER USED TO SAY "NAMES ARE COSMETIC BY CONSTRUCTION", AND THE MECHANISM IT CITED IS
 * >>> NO LONGER TRUE. Kept verbatim rather than quietly rewritten, per CLAUDE.md §9:
 * >>>
 * >>>   "The claim under test is not 'the names we happen to have are harmless' — it is that NO
 * >>>    name can ever change a byte. That is structural: renderFileEn emits «▶ label ⟪payload⟫»
 * >>>    and compileChunk locates the payload with lastIndexOf(PAY_OPEN), decoding only what
 * >>>    follows. The label region is never an input to compilation."
 *
 * The last sentence is false as of the R-REND-6 cut-2 commit: the label region IS an input to
 * compilation now, because §5C rule 2 makes the sentence authoritative. "Cosmetic" and
 * "authoritative" cannot both describe the same region, and §5C is the settled policy.
 *
 * *** THIS IS A PRD-LEVEL CONFLICT AND IT IS NOT MINE TO CLOSE. §2.2's wording ("names are
 * *** cosmetic by construction") is now in direct tension with §5C rule 2, and reconciling the two
 * *** is Amir's call, not a test file's. This header records the conflict; it does not resolve it.
 *
 * WHAT SURVIVES, AND IT IS THE PART THAT WAS ALWAYS THE POINT. The reason "cosmetic" mattered was
 * never the mechanism — it was the guarantee that renaming a word cannot corrupt the compiled
 * output. That guarantee is intact and is now asserted directly rather than via the mechanism:
 *
 *     a name the compiler cannot re-derive yields IDENTICAL BYTES or a LOUD REFUSAL — never
 *     different bytes, and never silence.
 *
 * And it now catches something the old form accepted. Assertion 3 renders under a LIED-ABOUT name
 * catalog and compiles under the real one — which is a producer/consumer mismatch, an `.en` written
 * by a different naming catalog than the compiler holds. Pre-flip that was silently absorbed;
 * post-flip it is a refusal naming both sides. That is the naming analogue of the canon gate
 * skills-4a landed in 90ea07b for skeletons, and the same argument applies: a mismatch that
 * compiles quietly is the failure that is hard to notice.
 *
 * THE REAL PIPELINE IS UNAFFECTED, measured: render and compile read the SAME catalog, so the
 * derived label always equals the written one — byte-identity 1037/1037 with all of this live.
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

/* 3. DELIBERATELY WRONG names change the prose and CANNOT produce WRONG BYTES.
 *    Every name is replaced with a lie, and the .en is then compiled against the REAL catalog — so
 *    this is a name the compiler cannot re-derive. Two outcomes are acceptable and one is not:
 *      identical bytes  -> fine (what happened before the flip, and still happens with the check off)
 *      loud refusal     -> fine, and better: the mismatch is named instead of absorbed
 *      DIFFERENT bytes  -> the failure this assertion exists to forbid, in either era.
 *    Asserted as that disjunction, which is the same shape as sentence-authority.test.js's test 8
 *    and for the same reason: it is the invariant that holds on both sides of the flip. */
ok("a wrong name changes prose but never produces wrong bytes", () => {
  const bare = renderWith({});
  const lied = renderWith(probeNames("PURPLE MONKEY DISHWASHER"));
  assert.notStrictEqual(lied, bare, "the lie should have changed the prose");
  assert.ok(lied.includes("PURPLE MONKEY DISHWASHER"), "the lie should appear in the label");
  let outcome;
  try { outcome = { compiled: EN.compileFileEn(lied, idx) }; }
  catch (e) { outcome = { threw: e.message.split("\n")[0] }; }
  if (outcome.compiled !== undefined) {
    assert.strictEqual(outcome.compiled, SRC,
      "a wrong name produced DIFFERENT BYTES — this is the one forbidden outcome");
  } else {
    assert.match(outcome.threw, /SENTENCE AND PAYLOAD DISAGREE|HEADING AND BODY DISAGREE/,
      "the refusal must be the R-REND-6 one, naming the disagreement — not an incidental crash");
  }
});

/* 3b. AND THE ESCAPE HATCH STILL GIVES THE OLD GUARANTEE LITERALLY. With the derive check off, the
 *     label region is not read at all, so the original "cosmetic by construction" claim is exactly
 *     true — which is worth pinning, because it is what makes the refusal above a POLICY and not a
 *     limitation of the encoding. The bytes were always recoverable; the engine now declines to
 *     recover them silently from a sentence that disagrees. */
ok("with the derive check off, a wrong name is still literally cosmetic — byte-exact", () => {
  const lied = renderWith(probeNames("PURPLE MONKEY DISHWASHER"));
  assert.strictEqual(EN.compileFileEn(lied, idx, { deriveCheck: false }), SRC,
    "with the label region unread, wrong names must compile byte-exact");
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
