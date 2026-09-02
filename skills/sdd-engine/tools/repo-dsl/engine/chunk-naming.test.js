"use strict";
/**
 * chunk-naming.test.js — PINS THE TWO NAMING LEVELS (PRD §5D.3C, §5D.3D, R-LANG-16..19, R-ARCH-17).
 *
 * Amir, 2026-09-01: a recurring run of similar statements must be recognised as a PATTERN and
 * collapsed under ONE name covering the whole chunk, not rendered as N clauses joined by "then".
 * Three mechanisms implement that, and each is pinned here BOTH ways — firing and declining:
 *
 *   1. CHUNK RULES keyed to a node kind, cardinality as a parameter of the rule (R-LANG-16).
 *   2. GENERIC CARDINALITY — adjacent identical clauses collapse with a count.
 *   3. WHOLE-CHUNK NAMES outrank member composition (R-LANG-19).
 *
 * And the gate that consumes them: `chunkGloss` decides whether a whole-run word may be emitted at
 * all (R-ARCH-17). It is tested as hard as the acceptances, because a gate that cannot be shown to
 * FIRE is not a gate (§10.3) — and this one replaced an unconditional refusal that was costing
 * 308 of 943 files their whole-file word.
 */
const ts = require("typescript");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EN = require("./enfile.js");
const WN = require("./word-names.js");
const AC = require("./artifact-contract.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`);
const sfOf = (src) => ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const stmts = (src) => { const sf = sfOf(src); return [[...sf.statements], sf]; };

/* ---- 1. THE IMPORT CHUNK RULE ------------------------------------------------------------- */
{
  const [st, sf] = stmts(
    "import { LiftPartner } from '../entities/hydra';\n" +
    "import { getManager } from '../helpers';\n" +
    "import { memoize } from './caching/node-cache';\n");
  const g = EN.spanProse(st, sf);
  eq(g, "import `LiftPartner` from `../entities/hydra`, `getManager` from `../helpers`, and `memoize` from `./caching/node-cache`",
    "three imports render as ONE clause naming each import (§5D.3B's target prose)");
  ok(!/ then /.test(g), "the import run contains no 'then' — it is one clause, not three");
  ok(!/import 1 name from a module/.test(g), "the old name-free per-statement gloss is gone");
}
{ // CARDINALITY IS A PARAMETER: the same rule renders one import.
  const [st, sf] = stmts("import { only } from './one';\n");
  eq(EN.spanProse(st, sf), "import `only` from `./one`", "one import uses the SAME rule, no list");
}
{ // every import shape the rule handles, in one run
  const [st, sf] = stmts(
    "import def from './d';\nimport * as ns from './n';\nimport { a, b } from './ab';\n");
  const g = EN.spanProse(st, sf);
  ok(/`def` \(its default\)/.test(g), "a default import is described as the default");
  ok(/all of `ns`/.test(g), "a namespace import is described as the whole module");
  ok(/`a` and `b` from `\.\/ab`/.test(g), "a multi-name import lists its names");
}
{ // THE RULE DECLINES rather than lying: a side-effect-only import has no names to list.
  const [st, sf] = stmts("import './polyfill';\nimport { x } from './x';\n");
  const g = EN.spanProse(st, sf);
  ok(g.length > 0, "a declining rule still produces prose (it falls through per statement)");
  ok(!/undefined|null/.test(g), "declining never leaks a null into the label");
}

/* ---- 1b. THE EXPORT CHUNK RULE (§5D.4E) ---------------------------------------------------
 * Written because the rule-coverage measurement found the asymmetry, not because a shape was
 * missing from a list: the import rule QUOTED its symbol and module while exports only COUNTED
 * ("re-export 1 name from another module") across 9 leaf skeletons / 113 sites. The alternative
 * was naming those 9 skeletons, which serves this corpus only; the rule serves the language. */
{
  const [st, sf] = stmts("export { LiftPartner } from '../entities/hydra';\n");
  eq(EN.spanProse(st, sf), "re-export `LiftPartner` from `../entities/hydra`",
    "a re-export QUOTES the symbol and the module — the gap this rule closes");
  ok(!/1 name/.test(EN.spanProse(st, sf)), "the counting fallback is gone for this shape");
}
{ // CARDINALITY IS A PARAMETER, same as imports: one rule, one clause, any number of statements.
  const [st, sf] = stmts("export { A } from './a';\nexport { B, C } from './b';\n");
  const g = EN.spanProse(st, sf);
  eq(g, "re-export `A` from `./a` and `B` and `C` from `./b`", "a run of re-exports is ONE clause");
  ok(!/ then /.test(g), "no 'then' — it is one clause, not two");
}
{ // every export shape the rule handles
  const [st1, sf1] = stmts("export * from './all';\n");
  eq(EN.spanProse(st1, sf1), "re-export everything from `./all`", "a star re-export names its module");
  const [st2, sf2] = stmts("export * as helpers from './helpers';\n");
  eq(EN.spanProse(st2, sf2), "re-export all of `helpers` from `./helpers`", "a namespace re-export names both");
  const [st3, sf3] = stmts("export { internal as publicName } from './m';\n");
  eq(EN.spanProse(st3, sf3), "re-export `internal` as `publicName` from `./m`",
    "a rename is quoted on BOTH sides — the reader cannot recover it from the path");
  const [st4, sf4] = stmts("export { Local };\n");
  eq(EN.spanProse(st4, sf4), "export `Local` from this module", "a local export uses the other verb");
  const [st5, sf5] = stmts("export type { T } from './t';\n");
  eq(EN.spanProse(st5, sf5), "re-export `T` from `./t`", "a type-only re-export renders like any other");
}
{ /* THE RULE DECLINES rather than fudging one verb onto two different things. Declining is safe:
   * it falls through to the per-statement path, which is correct, just less compact (R-LANG-17). */
  const [st, sf] = stmts("export { A } from './a';\nexport { Local };\n");
  const g = EN.spanProse(st, sf);
  ok(/ then /.test(g), "a MIXED run declines and falls through per statement");
  ok(!/undefined|null/.test(g), "declining never leaks a null into the label");
}
{ // ADDING A RULE MUST NOT REGRESS A FILE (R-LANG-17): imports are untouched by the export rule.
  const [st, sf] = stmts("import { X } from './x';\nexport { Y } from './y';\n");
  const g = EN.spanProse(st, sf);
  ok(/import `X` from `\.\/x`/.test(g), "the import rule still fires beside the new one");
  ok(/re-export `Y` from `\.\/y`/.test(g), "and the export rule fires on its own kind");
}

/* ---- 1c. A CLAUSE PUBLISHES WHICH STATEMENTS IT COVERS (R-LANG-23) -------------------------
 * This is what makes "a name is a label, not a structure" enforceable rather than aspirational.
 * namedLabel substitutes a name ONLY into a clause covering exactly one statement; a clause
 * covering two or more is a rule speaking about a pattern, and a leaf name — one statement's
 * spelling — has no standing to replace it. Before this existed, namedLabel composed one clause
 * per statement and DISSOLVED every fold in any run containing a named leaf: measured at 1 -> 284
 * unfolded import repeats corpus-wide, with byte-identity, payloads, coverage and every quoted
 * identifier intact, which is why nothing caught it. */
{
  const [st, sf] = stmts("import { A } from './a';\nimport { B } from './b';\nconst x = 1;\n");
  const r = EN.spanActions(st, sf);
  eq(r.covers.length, r.raw.length, "every clause reports its range — one definition, not a parallel guess");
  eq(JSON.stringify(r.covers[0]), "[0,2]", "the folded import clause covers BOTH import statements");
  eq(JSON.stringify(r.covers[1]), "[2,3]", "and the variable statement covers only itself");
  ok(r.covers[0][1] - r.covers[0][0] > 1, "so a name is refused on it, by the width alone");
}
{ // a fold is not special-cased: an unruled run reports one statement per clause, all nameable
  const [st, sf] = stmts("const a = 1;\nconst b = 2;\n");
  const r = EN.spanActions(st, sf);
  ok(r.covers.every(([f, t]) => t - f === 1), "no rule fired, so every clause is one statement wide");
}

/* ---- 2. GENERIC CARDINALITY --------------------------------------------------------------- */
{
  const [st, sf] = stmts("res.set('a', 1);\nres.set('a', 1);\n");
  const g = EN.spanProse(st, sf);
  eq(g, "call set twice", "two adjacent identical clauses collapse with a count");
  ok(!/ then /.test(g), "collapsed cardinality leaves no 'then'");
}
{
  const [st, sf] = stmts("res.set('a', 1);\nres.set('a', 1);\nres.set('a', 1);\n");
  eq(EN.spanProse(st, sf), "call set 3 times", "three collapse to a count, not to 'twice'");
}
{ // NON-ADJACENT identicals are genuinely interleaved and MUST NOT collapse.
  const [st, sf] = stmts("a();\nb();\na();\n");
  eq(EN.spanProse(st, sf), "call a, call b, then call a",
    "A B A stays three clauses — interleaving is not repetition");
}

/* ---- 3. chunkGloss — THE R-ARCH-17 GATE, both directions --------------------------------- */
{
  const [st, sf] = stmts(
    "import { LiftPartner } from '../entities/hydra';\n" +
    "export const get = memoize(async (id: number) => id);\n");
  ok(EN.chunkGloss(st, sf), "a run of two DIFFERENT actions is glossable — 'then' between unlike clauses is fine English");
}
{ /* FIRES: a clause that says nothing must be refused even AFTER the cardinality collapse has
   * hidden the repetition. "run a step" twice collapses to "run a step twice", which is not in
   * the says-nothing set — so the check runs on the PRE-collapse clauses. This assertion is the
   * one that caught that bug. */
  const [st, sf] = stmts("1 + 2;\n3 + 4;\n");
  eq(EN.spanProse(st, sf), "call a step twice", "the collapse does hide the repetition ...");
  ok(EN.chunkGloss(st, sf) === null, "... and the gate still REFUSES it, because it checks pre-collapse");
}
{ // two DIFFERENT if-statements read as real English and are allowed through.
  const [st, sf] = stmts("if (a) { x(); }\nif (b) { y(); }\n");
  ok(EN.chunkGloss(st, sf), "two unlike conditionals are glossable — 'then' between unlike clauses is fine");
}
{ // FIRES: repetition that the collapse cannot reach (non-adjacent) is refused.
  const [st, sf] = stmts("a();\nb();\na();\n");
  ok(EN.chunkGloss(st, sf) === null, "non-adjacent repetition is refused — the rule for it is not written yet");
}
{ // ... while the ADJACENT form of the very same repetition IS collapsed and allowed.
  const [st, sf] = stmts("a();\na();\nb();\n");
  eq(EN.chunkGloss(st, sf), "call a twice then call b", "adjacent repetition collapses and passes the gate");
}
{ // a single meaningful statement IS glossable — the gate refuses meaninglessness, not brevity
  const [st, sf] = stmts("x();\n");
  eq(EN.chunkGloss(st, sf), "call x", "one meaningful clause is a valid chunk gloss");
}

/* ---- 4. WHOLE-CHUNK NAMES OUTRANK COMPOSITION (R-LANG-19) -------------------------------- */
{
  /* A synthetic two-leaf dictionary, so this pins the KEYING and the PRECEDENCE without needing
   * the real catalog. leavesOf walks w.m = [prefix, appended], which is binary and left-leaning. */
  const axis = { words: { 1: { len: 1, d: 0, sym: "SYM_A" }, 2: { len: 1, d: 0, sym: "SYM_B" }, 3: { len: 2, d: 1, m: [1, 2] } } };
  const cat = { wide: axis, narrow: axis };
  const payload = { d: "lzw", a: "w", w: 3, h: [] };

  const key = WN.chunkKeyOf("wide", axis, 3);
  ok(/^wc:[0-9a-f]{16}$/.test(key), "a chunk key is axis-marked 'wc:' and content-hashed — never a word id");
  ok(key !== WN.hashOf("wide", "SYM_A"), "a chunk key can never collide with a leaf key");
  eq(WN.chunkKeyOf("wide", axis, 1), null, "a single leaf is NOT a chunk — that is what `names` is for");

  eq(WN.chunkNameFor(cat, payload, {}), null, "no name -> null, so the caller falls back to composition");
  eq(WN.chunkNameFor(cat, payload, { [key]: { en: "set up the request context" } }), "set up the request context",
    "a whole-chunk name is returned for the whole word");

  /* PRECEDENCE, AS AMENDED 2026-09-01 (R-LANG-19). With BOTH a chunk name and leaf names present,
   * the chunk name comes FIRST — it is what the reader sees, so a recurring run still reads as one
   * recognised pattern (§5D.3D). It does NOT come instead. The assertion here used to be
   * `=== "set up the request context"`, i.e. one hole-free string replacing every clause the rules
   * had filled with the code's own identifiers; s11 measured that 63% of the corpus's concrete
   * identifiers live in d>=1 chunk labels, so that reading would have deleted ~23,000 of them the
   * first time composite naming ran. A name is a label ALONGSIDE the content, never a replacement. */
  const names = { [WN.hashOf("wide", "SYM_A")]: { en: "first thing" }, [WN.hashOf("wide", "SYM_B")]: { en: "second thing" } };
  const composed = WN.clausesFor(cat, payload, names);
  eq(composed && composed.join("|"), "first thing|second thing", "member composition still works on its own");
  /* namedLabel re-parses the covered SOURCE to align clause i with statement i, so the fallback
   * leg needs a slice whose statement count matches the leaf count (2). */
  const src2 = "a();\nb();\n";
  const span = { payload, start: 0, end: src2.length, stmts: 2 };
  eq(EN.namedLabel(span, src2, cat, names, { [key]: { en: "set up the request context" } }),
    "set up the request context: first thing then second thing",
    "R-LANG-19: the chunk name LEADS, and the hole-filled content survives behind it");
  {
    const withChunk = String(EN.namedLabel(span, src2, cat, names, { [key]: { en: "set up the request context" } }));
    const noChunk = String(EN.namedLabel(span, src2, cat, names, {}));
    ok(withChunk.endsWith(noChunk), "a chunk name is PURELY ADDITIVE — it prefixes, it never edits");
    ok(withChunk.length > noChunk.length, "and it can only make a label say more, never less");
  }
  /* A chunk name with NO leaf names still keeps the rules' content, which is the case that carries
   * the identifiers: composite naming is expected to run against a corpus whose leaves are almost
   * entirely rule-covered (§5D.4E: 1,394 of 1,414), so this is the COMMON path, not the corner. */
  {
    const only = String(EN.namedLabel(span, src2, cat, {}, { [key]: { en: "set up the request context" } }));
    ok(/^set up the request context: /.test(only), "the name leads");
    eq(only, "set up the request context: call a then call b",
      "and the rules' own clauses are still there behind it, both of them");
  }
  ok(/first thing/.test(String(EN.namedLabel(span, src2, cat, names, {}))),
    "with no chunk name, composition is still the fallback — the override is purely additive");
  ok(EN.namedLabel(span, src2, cat, {}, {}) === null,
    "no names of either kind -> null, so the caller falls through to genLabel");

  /* the key is stable against a re-mine that moves ids but not skeletons */
  const moved = { words: { 41: { len: 1, d: 0, sym: "SYM_A" }, 42: { len: 1, d: 0, sym: "SYM_B" }, 77: { len: 2, d: 1, m: [41, 42] } } };
  eq(WN.chunkKeyOf("wide", moved, 77), key, "the same leaf sequence under different ids keeps its key (ids move on every re-mine)");
  /* and it MOVES when the skeletons genuinely change — an orphan, not a silent re-attach */
  const changed = { words: { 1: { len: 1, d: 0, sym: "SYM_A" }, 2: { len: 1, d: 0, sym: "SYM_C" }, 3: { len: 2, d: 1, m: [1, 2] } } };
  ok(WN.chunkKeyOf("wide", changed, 3) !== key, "a changed skeleton orphans the name rather than re-attaching it");
}

/* ---- 5. THE ARTIFACT IS REGISTERED AND VALIDATES ----------------------------------------- */
{
  const spec = AC.specOf ? AC.specOf("word-names") : null;
  if (spec) ok(spec.requires.indexOf("chunks") >= 0, "the word-names contract DECLARES `chunks` (R-ART-4: consumers can read it)");
  else pass++; // specOf not exported — the load check below is the real gate

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wn-"));
  const f = path.join(dir, "word-names.json");
  fs.writeFileSync(f, JSON.stringify(AC.stamp("word-names", { names: {}, orphans: {}, chunks: {} })));
  const r = AC.load("word-names", f, { optional: true });
  ok(r.ok, "a stamped word-names with an empty `chunks` validates");
  /* PRESENT-BUT-WRONG must throw, not return empty: incident 5 was a v0 file read as v1. */
  fs.writeFileSync(f, JSON.stringify({ names: {}, orphans: {} }));
  let threw = false;
  try { const bad = AC.load("word-names", f, { optional: true }); if (!bad.ok) threw = true; } catch (_) { threw = true; }
  ok(threw, "a word-names missing `chunks` is REJECTED, not silently read as empty");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`chunk-naming.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
