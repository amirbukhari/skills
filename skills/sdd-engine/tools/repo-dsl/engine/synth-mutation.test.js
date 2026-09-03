/* synth-mutation.test.js — DOES THE VOCABULARY SPAN THE AST? RED.
 *
 * A dictionary can look impressive and still be a lookup table. The way to tell is to PERTURB the
 * input one axis at a time and check that the right thing moves: change a literal and only the
 * literal slot may move; change `const` to `let` and the PATTERN TOKEN itself must move. Amir's
 * table (2026-09-03) lists twenty-one such perturbations with the consequence each must have, and
 * this file is that table, mechanised row for row.
 *
 * HOW EACH ROW IS MEASURED, and why not by comparing sentences. The consequences are stated about
 * the PATTERN and its SLOTS separately — "only the literal slot changes", "AST-pattern token
 * changes", "folder AST changes; code AST does NOT". Two different patterns can render the same
 * sentence and one pattern renders different sentences from different fills, so prose cannot decide
 * any of these. Each row therefore mines a two-file corpus — the base program and its mutant, in
 * ONE dictionary so their words are comparable — and compares:
 *      PATTERN  the leaf skeletons behind each chunk, expanded through composites. Keyed by
 *               skeleton text, never by word id: ids are array indices and renumber on every mine
 *               (R-PAY-6), so an id comparison across mines measures nothing.
 *      SLOTS    the per-site hole fills.
 *
 * THE EXPECTATION VOCABULARY, kept to five shapes so a row cannot be quietly reinterpreted to
 * whatever happened:
 *      SAME_PATTERN_DIFF_SLOTS  one pattern, different fills — the perturbation was absorbed by a
 *                               slot. This is the claim "only the literal slot changes".
 *      SAME_PATTERN_SAME_SLOTS  nothing about the code AST moved at all.
 *      DIFF_PATTERN             the pattern token itself changed. The perturbation was structural
 *                               and the dictionary noticed.
 *      PATTERN_GREW             the mutant's pattern is built from strictly more leaves — a body
 *                               that expanded, or a control-flow form that composed.
 *      COMPOSED                 the mutant's pattern CONTAINS the base's pattern as a part, plus
 *                               something new. Composition, not replacement — the strongest of the
 *                               five, and the one that separates a grammar from a template store.
 *
 * WHY A ROW CAN PASS AND STILL BE BAD NEWS, stated because several do. "DIFF_PATTERN" is satisfied
 * by a dictionary that simply memorises every distinct program text: change anything at all and it
 * has a different entry. So rows expecting DIFF_PATTERN are weak evidence on their own and are read
 * against the rows expecting SAME_PATTERN — a vocabulary that spans the AST has to pass BOTH kinds,
 * and a memoriser passes only the first. The summary at the end reports the split for exactly this
 * reason.
 */
const S = require("./synth-corpus");

let pass = 0, fail = 0;
const results = [];
const ok = (c, m) => { if (!c) { console.error("  FAIL: " + m); fail++; process.exitCode = 1; } else { pass++; console.log("  ok - " + m); } };

const atomics = (obs) => obs.filter((c) => c.kind === "atomic");
const pat = (obs) => atomics(obs).map((c) => c.syms.join("|")).join(" || ");
const slots = (obs) => JSON.stringify(atomics(obs).map((c) => c.slots));
const leafN = (obs) => atomics(obs).reduce((a, c) => a + c.syms.length, 0);
const symList = (obs) => atomics(obs).flatMap((c) => c.syms);

/* base and mutant live at the SAME relative path inside two folders, so a row that is about paths
 * can vary them explicitly and every other row is path-identical by construction. */
const ROWS = [
  { id: "literal 1 -> 10", expect: "SAME_PATTERN_DIFF_SLOTS",
    base: 'export const one = 1;\n', mut: 'export const one = 10;\n' },

  { id: "identifier one -> foo", expect: "SAME_PATTERN_DIFF_SLOTS",
    base: 'export const one = 1;\n', mut: 'export const foo = 1;\n' },

  { id: "const -> let", expect: "DIFF_PATTERN",
    base: 'export const one = 1;\n', mut: 'export let one = 1;\n' },

  { id: "remove export", expect: "DIFF_PATTERN",
    base: 'export const one = 1;\n', mut: 'const one = 1;\n' },

  { id: "add a parameter", expect: "DIFF_PATTERN",
    base: 'export function three(x: number): number { return x + 1; }\n',
    mut:  'export function three(x: number, y: number): number { return x + 1; }\n' },

  { id: "operator x + 1 -> x - 1", expect: "DIFF_PATTERN",
    base: 'export function three(x: number): number { return x + 1; }\n',
    mut:  'export function three(x: number): number { return x - 1; }\n' },

  { id: "add a second statement", expect: "PATTERN_GREW",
    base: 'export function three(x: number): number { return x + 1; }\n',
    mut:  'export function three(x: number): number { const y = x; return y + 1; }\n' },

  { id: "add an if", expect: "COMPOSED",
    base: 'export function three(x: number): number { return x + 1; }\n',
    mut:  'export function three(x: number): number { if (x > 0) { return x + 1; } return 0; }\n' },

  { id: "import from a sibling folder", expect: "SAME_PATTERN_DIFF_SLOTS",
    base: 'import { one } from "../alpha/one";\nexport const a = one;\n',
    mut:  'import { one } from "../delta/one";\nexport const a = one;\n' },

  { id: "move file between folders", expect: "SAME_PATTERN_SAME_SLOTS", movePath: true,
    base: 'export const one = 1;\n', mut: 'export const one = 1;\n' },

  { id: "rename an imported symbol", expect: "SAME_PATTERN_DIFF_SLOTS",
    base: 'import { one } from "../alpha/one";\nexport const a = one;\n',
    mut:  'import { uno } from "../alpha/one";\nexport const a = uno;\n' },

  { id: "duplicate function structure", expect: "SAME_PATTERN_DIFF_SLOTS",
    base: 'export function three(x: number): number { return x + 1; }\n',
    mut:  'export function nine(y: number): number { return y + 7; }\n' },

  { id: "nested call a(b(c))", expect: "COMPOSED",
    base: 'export const r = b(c);\n', mut: 'export const r = a(b(c));\n' },

  { id: "object literal", expect: "DIFF_PATTERN",
    base: 'export const o = 1;\n', mut: 'export const o = { k: 1 };\n' },

  { id: "interface / type declaration", expect: "DIFF_PATTERN",
    base: 'export interface I { a: number; }\n', mut: 'export type I = { a: number; };\n' },

  { id: "async / await", expect: "COMPOSED",
    base: 'export function f(): number { return g(); }\n',
    mut:  'export async function f(): Promise<number> { return await g(); }\n' },

  { id: "try / catch", expect: "COMPOSED",
    base: 'export function f(): number { return g(); }\n',
    mut:  'export function f(): number { try { return g(); } catch (e) { return 0; } }\n' },

  { id: "generic type", expect: "DIFF_PATTERN",
    base: 'export const xs: Array = [];\n', mut: 'export const xs: Array<number> = [];\n' },

  { id: "union type", expect: "DIFF_PATTERN",
    base: 'export type T = string;\n', mut: 'export type T = string | number;\n' },

  { id: "callback / function expression in a call", expect: "COMPOSED",
    base: 'export const r = xs.map(f);\n', mut: 'export const r = xs.map((x) => f(x));\n' },

  { id: "chained member access", expect: "COMPOSED",
    base: 'export const v = a.b;\n', mut: 'export const v = a.b.c.d;\n' },
];

/* ---- the five decidable expectations ---------------------------------------------------------- */
function check(row, ob, om) {
  const pb = pat(ob), pm = pat(om), sb = slots(ob), sm = slots(om);
  const sameP = pb === pm, sameS = sb === sm;
  switch (row.expect) {
    case "SAME_PATTERN_DIFF_SLOTS":
      return { held: sameP && !sameS, why: sameP ? (sameS ? "the slots did not change either — nothing moved" : "") : "the pattern token changed, so the mutation was not absorbed by a slot" };
    case "SAME_PATTERN_SAME_SLOTS":
      return { held: sameP && sameS, why: sameP ? "the slots changed" : "the pattern changed" };
    case "DIFF_PATTERN":
      return { held: !sameP, why: "the pattern token is unchanged — the dictionary did not notice a structural change" };
    case "PATTERN_GREW":
      return { held: leafN(om) > leafN(ob), why: "the mutant is built from " + leafN(om) + " leaf pattern(s), the base from " + leafN(ob) + " — it did not grow" };
    case "COMPOSED": {
      /* the mutant's pattern must CONTAIN the base's, and add to it. Containment is over the leaf
       * skeleton multiset, which is what "known patterns + new arrangement" means: the pieces the
       * dictionary already had, rearranged, not replaced by one new monolithic entry. */
      const bl = symList(ob), ml = symList(om);
      const pool = ml.slice();
      let contained = bl.length > 0;
      for (const s of bl) { const i = pool.indexOf(s); if (i < 0) { contained = false; break; } pool.splice(i, 1); }
      return { held: contained && ml.length > bl.length,
        why: !contained ? "the mutant does not reuse the base's pattern — it is a NEW monolithic entry, not a composition"
                        : "the mutant reuses the base's pattern but adds nothing" };
    }
    default: return { held: false, why: "unknown expectation " + row.expect };
  }
}

/* ---- run the table --------------------------------------------------------------------------- */
console.log("");
for (const row of ROWS) {
  const files = row.movePath
    ? { "src/alpha/x.ts": row.base, "src/beta/x.ts": row.mut }
    : { "src/m/base.ts": row.base, "src/m/mutant.ts": row.mut };
  const relB = row.movePath ? "src/alpha/x.ts" : "src/m/base.ts";
  const relM = row.movePath ? "src/beta/x.ts" : "src/m/mutant.ts";

  let C, ob, om, bi = null;
  try {
    C = S.build({ files, name: "mut" });
    bi = C.allByteIdentical();
    ob = C.observe(relB); om = C.observe(relM);
  } catch (e) {
    console.log("  " + row.id);
    ok(false, row.id + " — the fixture could not be mined or rendered: " + e.message.split("\n")[0]);
    results.push({ row, held: false });
    continue;
  }

  const r = check(row, ob, om);
  console.log("  " + row.id + "   [" + row.expect + "]");
  console.log("      base   pattern: " + (pat(ob) || "(no atomic pattern — rendered verbatim)"));
  console.log("      mutant pattern: " + (pat(om) || "(no atomic pattern — rendered verbatim)"));
  if (pat(ob) === pat(om)) console.log("      slots  " + slots(ob) + "  ->  " + slots(om));
  console.log("      English: " + JSON.stringify(C.labels(relB)) + "  ->  " + JSON.stringify(C.labels(relM)));

  /* THE FLOOR, PER ROW. A mutation that breaks the round-trip is a byte-identity failure first and
   * a vocabulary question second, and must never be reported as the latter. */
  ok(bi.bad.length === 0, row.id + " — both programs still round-trip byte-identically"
    + (bi.bad.length ? " (" + bi.bad.join(", ") + ")" : ""));
  ok(r.held, row.id + " — " + row.expect + (r.held ? "" : ": " + r.why));

  /* CROSS-CUTTING, AND IT IS NOT ON AMIR'S TABLE — it fell out of running it. Several rows change
   * the program and leave the English WORD FOR WORD IDENTICAL: `return g()` and `return await g()`
   * both read "return g"; `xs.map(f)` and `xs.map((x) => f(x))` both read "get `r` from map";
   * `Array` and `Array<number>` both read "set `xs` to an empty list". Whatever the pattern axis
   * does, a controlled LANGUAGE over the AST cannot render two different programs as the same
   * sentence — that is not a weak description, it is an ambiguous one, and it breaks the §5C
   * lifecycle outright: if the sentence is to be authoritative, two programs that read alike are
   * two programs an editor cannot tell apart or edit into each other. Asserted per row because the
   * base and the mutant are different programs — EXCEPT the file-move row, whose two files are the
   * same text at two paths on purpose. There, reading alike is the correct answer (the code AST did
   * not change) and asserting otherwise would demand that the renderer leak a path into a sentence
   * about code. So that row is exempted by comparing the SOURCES, not by naming it. */
  {
    const lb = JSON.stringify(C.labels(relB)), lm = JSON.stringify(C.labels(relM));
    const distinct = lb !== lm;
    if (row.base !== row.mut) {
      ok(distinct, row.id + " — the two programs do not render as the SAME English"
        + (distinct ? "" : ": both read " + lb));
    }
    results.push({ row, held: r.held, distinct: row.base === row.mut ? null : distinct });
  }
  continue;
}

/* ---- the split that decides whether this is a grammar or a memoriser -------------------------- */
{
  const byKind = new Map();
  for (const { row, held } of results) {
    if (!byKind.has(row.expect)) byKind.set(row.expect, { held: 0, total: 0 });
    const k = byKind.get(row.expect); k.total++; if (held) k.held++;
  }
  console.log("\n  BY EXPECTATION KIND");
  for (const [k, v] of byKind) console.log("    " + k.padEnd(24) + v.held + " / " + v.total);
  const amb = results.filter((r) => r.distinct === false);
  if (amb.length) {
    console.log("\n  PROGRAMS THAT RENDER AS IDENTICAL ENGLISH (" + amb.length + " of " + results.length + " rows)");
    for (const a of amb) console.log("    " + a.row.id);
  }
  const strict = ["SAME_PATTERN_DIFF_SLOTS", "SAME_PATTERN_SAME_SLOTS", "COMPOSED", "PATTERN_GREW"]
    .reduce((a, k) => { const v = byKind.get(k); return { held: a.held + (v ? v.held : 0), total: a.total + (v ? v.total : 0) }; }, { held: 0, total: 0 });
  const weak = byKind.get("DIFF_PATTERN") || { held: 0, total: 0 };
  console.log("\n    DIFF_PATTERN rows are the WEAK evidence — a dictionary that memorises every");
  console.log("    distinct program text passes all of them: " + weak.held + " / " + weak.total);
  console.log("    The rows that require the pattern to be REUSED or COMPOSED are the real test:");
  console.log("      " + strict.held + " / " + strict.total);
  console.log("");
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail) console.error("\nRED ON PURPOSE. Each failing row names an AST axis the vocabulary does not span.");
