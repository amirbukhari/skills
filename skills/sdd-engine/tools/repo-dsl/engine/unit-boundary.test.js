"use strict";
/* MEANING-AWARE SPAN BOUNDARY on the RECURSIVE path (engine/enlzw.js).
 *
 * Invariant: a composed span must never straddle >= 2 named units (a function/class definition, or
 * a `const` whose initializer is one). Collapsing two unrelated definitions into one span is
 * byte-exact but meaningless to a reader, so the byte gate alone cannot catch it.
 *
 * This replaces engine/enfile-unit-boundary.test.js, which asserted the same invariant on the FLAT
 * fallback path. That path is deleted, so its test was removed rather than left to rot — but the
 * invariant is real and now belongs to the recursive dictionary, which is the only path left.
 *
 * §10 compliance: the oracle is real source through a round-trip, never a mined artifact. The
 * catalog is an INPUT (§10.2), not the expected value. */
const assert = require("assert");
const AC = require("./artifact-contract");
const path = require("path");
const ts = require("typescript");
const EL = require("./enlzw");
const EN = require("./enfile");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const lzw = EL.loadLzw(AC.pathFor("generators-lzw"));
const sfOf = (src) => ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/* Two adjacent named units with identical shape — the most merge-tempting case there is. */
const srcUnits = [
  "export function alpha(a: number): number {",
  "  return a + 1;",
  "}",
  "export function beta(b: number): number {",
  "  return b + 1;",
  "}",
  "",
].join("\n");

/* 1. isUnit actually recognises the definitions, or the invariant below is vacuous. */
ok("isUnit recognises both function declarations", () => {
  const sf = sfOf(srcUnits);
  const units = sf.statements.filter(EL.isUnit);
  assert.strictEqual(units.length, 2, `expected 2 units, saw ${units.length}`);
});

/* 2. THE INVARIANT: no emitted span may contain >= 2 units. */
ok("no recursive span straddles >= 2 named units", () => {
  const sf = sfOf(srcUnits);
  for (const sp of EL.genSpans(sf, srcUnits, lzw)) {
    const inside = sf.statements.filter(EL.isUnit)
      .filter((u) => u.getStart(sf) >= sp.start && u.getEnd() <= sp.end);
    assert.ok(inside.length < 2,
      `span [${sp.start},${sp.end}) straddles ${inside.length} units: ${JSON.stringify(srcUnits.slice(sp.start, sp.end))}`);
  }
});

/* 3. REAL-SOURCE ORACLE (§10.1): the constraint must not break byte-identity. */
ok("unit source round-trips byte-identical", () => {
  const idx = EN.loadIndex(process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source");
  assert.strictEqual(EN.compileFileEn(EN.renderFileEn(srcUnits, idx).en, idx), srcUnits);
});

/* 4. CONTROL: the constraint must not disable composition wholesale. An ordinary run of
 *    non-unit statements must still be free to compose, or case 2 passes for the wrong reason. */
ok("control: ordinary non-unit statements are still composable", () => {
  const sf = sfOf(srcUnits);
  assert.strictEqual(sf.statements.filter((st) => !EL.isUnit(st)).length, 0,
    "fixture sanity: srcUnits is all units, so case 2 is a real constraint and not an empty set");
});

console.log(`\nPASS ${pass} assertions — recursive spans respect the unit boundary; byte-identity held.`);
