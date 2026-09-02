"use strict";
/**
 * rule-coverage.test.js — PINS THE FILTER THAT STOPS THE PILOT'S REGRESSION RECURRING
 * (PRD §5D.3F §2d, §5D.3C, R-LANG-16).
 *
 * The 80-leaf pilot stripped 72% of the concrete identifiers out of the corpus's labels because a
 * leaf NAME is hole-free and a node-kind RULE is hole-filled. The claim under test is that this
 * module can tell those two cases apart FROM EVIDENCE — real clauses rendered by the real rule path
 * — rather than from a hand-maintained list of node kinds, which would go stale the first time a
 * rule was added.
 *
 * The decisive assertion is the VARIANCE one: a clause that changes from site to site is a clause no
 * single name can reproduce. Everything else in the classification follows from that.
 *
 * UNIT tier: synthetic clause sets plus a tiny in-process render. No corpus, no artifacts.
 */
const assert = require("assert");
const ts = require("typescript");
const RC = require("./rule-coverage");
const EN = require("./enfile");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };
const SN = EN.SAYS_NOTHING;

/* ---- THE VARIANCE CRITERION -------------------------------------------------------------- */
ok("clauses that VARY across instances are rule-covered — a name cannot stand in for all of them", () => {
  const c = RC.classify([
    "import `Alpha` from `./alpha`",
    "import `Beta` from `./beta`",
    "import `Gamma` from `./gamma`",
  ], SN);
  assert.strictEqual(c.klass, "rule-covered-varying");
  assert.strictEqual(RC.isNamable(c), false, "this is exactly the pilot's 72% — naming it regresses");
  assert.match(c.reason, /reading the holes/);
});

ok("ONE constant clause that quotes the code is rule-covered — good prose already", () => {
  const c = RC.classify(["describe the shape `Config` with `token`", "describe the shape `Config` with `token`"], SN);
  assert.strictEqual(c.klass, "rule-covered-constant");
  assert.strictEqual(RC.isNamable(c), false);
});

ok("ONE constant GENERIC clause is UNREACHED — the rule ignores the specifics, so a name improves it", () => {
  const c = RC.classify(["declare a constant", "declare a constant", "declare a constant"], SN);
  assert.strictEqual(c.klass, "unreached-generic");
  assert.strictEqual(RC.isNamable(c), true);
});

ok("a SAYS-NOTHING clause is UNREACHED whatever else is present — highest-value naming target", () => {
  for (const empty of ["run a step", "call a step", "await a step", "compute a value", null]) {
    const c = RC.classify(["import `A` from `./a`", empty], SN);
    assert.strictEqual(c.klass, "unreached-says-nothing", `${empty} should mark the skeleton unreached`);
    assert.strictEqual(RC.isNamable(c), true);
  }
});

ok("says-nothing OUTRANKS variance — a shape that sometimes renders as nothing is not covered", () => {
  const c = RC.classify(["call a step", "call a step", "call a step"], SN);
  assert.strictEqual(c.klass, "unreached-says-nothing");
});

ok("the says-nothing list is the RENDERER'S, not a copy — one definition of 'carries nothing'", () => {
  assert.ok(EN.SAYS_NOTHING instanceof RegExp, "enfile must export it");
  assert.strictEqual(RC.saysNothingOf(EN), EN.SAYS_NOTHING, "rule-coverage must use that exact object");
});

ok("a skeleton with no observed instance is UNKNOWN, and unknown is not namable", () => {
  const c = RC.classify([], SN);
  assert.strictEqual(c.klass, "unknown");
  assert.strictEqual(RC.isNamable(c), false, "never spend a model call on a shape we have no evidence about");
});

/* ---- AGAINST THE REAL RULE PATH ---------------------------------------------------------- */
ok("the real ImportDeclaration rule is measured as rule-covered — the pilot's actual regression", () => {
  const files = [
    { rel: "a.ts", source: "import { Alpha } from './alpha';\n" },
    { rel: "b.ts", source: "import { Beta } from './beta';\n" },
  ];
  const scan = RC.scanClauses(EN, files);
  const rows = [...scan.values()].filter((r) => r.axis === "w" && /^import/.test(r.sym));
  assert.ok(rows.length, "the import skeleton must have been bucketed");
  const c = RC.classify(rows[0].clauses, SN);
  assert.strictEqual(c.klass, "rule-covered-varying",
    "two imports of the same shape render different clauses — naming this shape is the 72% loss");
});

ok("a shape the rules do NOT reach is measured as unreached", () => {
  const files = [
    { rel: "a.ts", source: "1 + 2;\n" },
    { rel: "b.ts", source: "3 + 4;\n" },
  ];
  const scan = RC.scanClauses(EN, files);
  const namable = [...scan.values()].map((r) => RC.classify(r.clauses, SN)).filter(RC.isNamable);
  assert.ok(namable.length, "a bare arithmetic statement carries no rule — it must be namable");
});

ok("a statement maps to the MINER'S skeleton key, so a bucket is the word the dictionary holds", () => {
  const WN = require("./word-names");
  const G = require("./generators");
  const src = "import { Alpha } from './alpha';\n";
  const scan = RC.scanClauses(EN, [{ rel: "a.ts", source: src }]);
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true);
  const sym = G.keyOf(G.generalStmtParts(sf.statements[0], sf, true));
  assert.ok(scan.has(WN.hashOf("wide", sym)), "the key must be word-names.hashOf of the miner's own keyOf");
});

ok("both axes are bucketed separately — they are genuinely different words", () => {
  const scan = RC.scanClauses(EN, [{ rel: "a.ts", source: "const x = foo.bar(1);\n" }]);
  const axes = new Set([...scan.values()].map((r) => r.axis));
  assert.deepStrictEqual([...axes].sort(), ["n", "w"]);
});

/* ---- THE ROLLUP -------------------------------------------------------------------------- */
ok("summarize reports the split per class, in skeletons AND sites, and can be scoped to a key set", () => {
  const files = [
    { rel: "a.ts", source: "import { Alpha } from './alpha';\n" },
    { rel: "b.ts", source: "import { Beta } from './beta';\n" },
    { rel: "c.ts", source: "1 + 2;\n" },
  ];
  const scan = RC.scanClauses(EN, files);
  const all = RC.summarize(scan, EN);
  assert.ok(all.total > 0 && all.namable >= 1);
  assert.ok(Object.values(all.byKlass).every((b) => b.skeletons > 0 && b.sites > 0));
  const oneKey = new Set([[...scan.keys()][0]]);
  assert.strictEqual(RC.summarize(scan, EN, oneKey).total, 1, "scoping to the plan's leaf tier must work");
});

console.log(`\n${pass} assertions passed`);

/* ---- REGRESSION: A GUARD IS A RENDERED CLAUSE ---------------------------------------------
 * Caught by reading the first corpus measurement rather than by reasoning: `spanActions` files a
 * guard throw under `guards`, not `actions`, so nine `if (!x) { throw new E(...) }` shapes were
 * reported as "no rule reaches this" while the rule was rendering them WITH the throw message.
 * Naming those would have repeated the pilot's regression on the shapes that can least afford it. */
{
  let p2 = 0;
  const ok2 = (n, fn) => { try { fn(); p2++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };
  ok2("a guard throw is measured as RULE-COVERED, not as an empty clause", () => {
    const files = [
      { rel: "a.ts", source: "function f(x){ if (!x) { throw new Error('x is required'); } }\n" },
      { rel: "b.ts", source: "function g(y){ if (!y) { throw new Error('y is missing'); } }\n" },
    ];
    const scan = RC.scanClauses(EN, files);
    const guardRows = [...scan.values()].filter((r) => /throw new/.test(r.sym) && r.axis === "w");
    assert.ok(guardRows.length, "the guard skeleton must be bucketed");
    for (const r of guardRows) {
      assert.ok(r.clauses.every(Boolean), "a guard must not record a null clause");
      const c = RC.classify(r.clauses, EN.SAYS_NOTHING);
      assert.ok(!RC.isNamable(c), `a guard renders as real English and must not be namable (got ${c.klass})`);
    }
  });
  console.log(`\n${p2} regression assertion(s) passed`);
}
