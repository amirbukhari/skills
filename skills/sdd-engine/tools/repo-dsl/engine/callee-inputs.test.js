"use strict";
/* callee-inputs.test.js — A RECEIVER IS NEVER PASSED. CLASS 3, the residue.
 *
 * `655c55e` fixed the first half of this: `inputsOf` learned to skip callees, taking the class from
 * 77 sites to 3. What it did NOT reach is the RECEIVER. `inputsOf` deliberately walks through a
 * method call to `callee.expression` — rightly, because `hydraManager.save(x)` really is about
 * `hydraManager` — and `condGloss`'s call frame filtered out only the bare METHOD name. So the
 * receiver arrived in the INPUT list:
 *
 *     if (Number.isNaN(A))   ->   "stop early when `Number` and `A` passes `isNaN`"
 *
 * which states that `Number` is an argument to `isNaN`. It is not, and no receiver ever is.
 * Measured 2026-09-04, corpus-wide: 65 sites in 42 files.
 *
 * THIS IS A TRUTH FIX, NOT A COVERAGE FIX. Every one of those sites quotes an identifier that is
 * really in its statement, so all 65 already counted as SITE-SPECIFIC successes and the coverage
 * TOTAL cannot see any of this. It is expected not to move, and it did not.
 *
 * THE RECEIVER MOVES, IT IS NOT DELETED — assertion 2 is the whole reason. Deleting it gives "`A`
 * passes `isNaN`", which is true and perfectly good for a namespace like `Number`, and the SAME
 * edit turns `acc.includes(aptu.id)` into "`aptu.id` passes `includes`", losing where the lookup
 * happens. That is CLASS 3's and CLASS 4's lesson pointed the other way: the name was correct and
 * only its POSITION was a lie, so the fix is a move. Measured: 0 of the 65 lose a name.
 */
const assert = require("assert");
const ts = require("typescript");
const EN = require("./enfile");

const R = require("./test-report").report(__filename);
const { ok, count } = R;

function clause(inner) {
  const sf = ts.createSourceFile("f.ts", "function f(){ " + inner + " }", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const st = sf.statements[0].body.statements[0];
  const r = EN.spanActions([st], sf);
  return (r && r.actions && r.actions[0]) || (r && r.guards && r.guards[0]) || "<none>";
}
/* The condition is unchanged; only the sentence it fails with is. */
const eq = (inner, want) => assert.equal(clause(inner), want,
  `the TypeScript ${JSON.stringify(inner)} should be described as "${want}", but it is described as "${clause(inner)}"`);

/* ── 1. THE DEFECT ─────────────────────────────────────────────────────────────────────────────
 * A namespace receiver is part of the operation's NAME, and belongs inside the same quotes. */
ok("a namespace receiver becomes part of the operation's name rather than one of its inputs", () => {
  const c = clause("if (Number.isNaN(A)) { g(); }");
  assert.equal(c, "when `A` passes `Number.isNaN`, g");
  assert.ok(!c.includes("`Number` and"), "`Number` is not an argument to `isNaN`: " + c);
});
ok("a negated call is described as failing the operation, not as passing it", () => eq("if (!Array.isArray(y)) { g(); }", "when `y` fails `Array.isArray`, g"));
ok("a receiver several properties deep moves into the operation's name as one whole path", () => eq("if (a.b.c.has(k)) { g(); }", "when `k` passes `a.b.c.has`, g"));

/* ── 2. THE NAME IS MOVED, NOT DELETED — the assertion that rejects the cheaper fix ────────────
 * `acc` is where the lookup happens. Dropping it would satisfy "the receiver is not an input"
 * while destroying a correct name, which is exactly what CLASS 3 and CLASS 4 were about. */
ok("a receiver that is a value is still named as the thing acted on, rather than dropped", () => {
  const c = clause("if (acc.includes(x)) { g(); }");
  assert.equal(c, "when `x` passes `acc.includes`, g");
  assert.ok(c.includes("acc"), "the receiver must survive somewhere: " + c);
});

/* ── 3. THE GATE: A NO-ARGUMENT CALL MUST NOT MOVE ─────────────────────────────────────────────
 * `tokenSet.expired()` has nothing but its receiver. `inputsOf`'s own header records why it is
 * named at all — "an operation's name beats silence", after the strict pass turned 2 clauses
 * VACUOUS and 4 GENERIC. Moving the receiver here would empty the input list and degrade the
 * clause to "`expired` holds", so the fix declines whenever removal would empty the list.
 * WITHOUT that gate this assertion fails; it is the one that prices the fix's own blast radius. */
ok("a method call with no arguments is left as it was, because the receiver is the only thing there is to name", () =>
  eq("if (tokenSet.expired()) { g(); }", "when `tokenSet` passes `expired`, g"));
ok("a plain call with no arguments is left as it was", () =>
  eq("if (doesTokenFileExist()) { g(); }", "when `doesTokenFileExist` holds, g"));

/* ── 4. CONTROL: no receiver, nothing to move ─────────────────────────────────────────────────*/
ok("a callee that is a plain name is left untouched, which is the control on all of the above", () => eq("if (isReady(x)) { g(); }", "when `x` passes `isReady`, g"));

R.done("how a callee and its inputs are named");

