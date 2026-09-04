"use strict";
/* optional-chain.test.js — THE `?.` FRAME TABLE, WITH ITS NEGATIVE CONTROLS.
 *
 * `dottedText` walks `a?.b` and `a.b` to the same string. That is RIGHT in the presence frame
 * ("`a.b` is missing", "`a.b` is set" — both stay true when `a` is null) and FALSE at a bare VALUE
 * position: `return accountRecord?.accountId` said "return `accountRecord.accountId`", asserting a
 * plain read that THROWS where the source yields undefined.
 *
 * THE FIRST CUT OF THE FIX WAS ITSELF FALSE, on 4 sites, and that is why this file exists rather
 * than one more assertion in enfile.test.js. Qualifying every comparison with "`a` is set and …"
 * is only true when `undefined OP r` is FALSE. Under `!==` it is TRUE — `if (!user?.email &&
 * user?.id !== 1)` fires PRECISELY when `user` is missing, and "`user` is set and …" says the
 * opposite. A reach built to delete false clauses manufacturing four of its own is this item's own
 * defect one layer up, so the frame is a TABLE and the two DECLINES are load-bearing.
 *
 * Every case below has its `?.`-free twin asserted beside it, so a frame that fired unconditionally
 * — or never fired at all — fails here rather than reading as a pass.
 *
 * SHOWN ABLE TO FAIL, and the two halves fail against DIFFERENT engines, which is the point of
 * keeping both. Against the parent of the commit that added this file, 4 of the 13 fail — the four
 * REACHES; the 5 DECLINE cases pass there by construction, because declining is what the old engine
 * did everywhere. Their negative control is the FIRST CUT of this fix, which qualified every
 * comparison and was measured turning 4 corpus sites false. A decline assertion checked only
 * against HEAD is a guard that cannot fire (§3), so it is written to name the frame it forbids.
 */
const assert = require("assert");
const ts = require("typescript");
const EN = require("./enfile");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.message}`); process.exitCode = 1; } };

/* the first clause the renderer produces for the single statement inside `f` */
function clause(inner) {
  const src = "function f(){ " + inner + " }";
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const st = sf.statements[0].body.statements[0];
  const r = EN.spanActions([st], sf);
  return (r && r.actions && r.actions[0]) || (r && r.guards && r.guards[0]) || "<none>";
}
const eq = (inner, want) => assert.equal(clause(inner), want, JSON.stringify(inner) + " -> " + JSON.stringify(clause(inner)));

/* ── 1. THE VALUE POSITION ─────────────────────────────────────────────────────────────────────
 * "`a.b` if `a` is set, otherwise nothing" is NOT new phrasing: it is what the phrasebook's
 * ConditionalExpression rule already emits for the desugared `a ? a.b : null`. */
ok("return a?.b carries the qualifier", () => eq("return a?.b;", "return `a.b` if `a` is set, otherwise nothing"));
ok("CONTROL: return a.b does not", () => eq("return a.b;", "return `a.b`"));

/* ── 2. `===` / `==` / relational -> "is set and" ──────────────────────────────────────────────
 * `undefined` compares false against any non-nullish right side, so the conjunction is exact. It
 * is condGloss's own `&&` join, i.e. what `if (a && a.b === 1)` renders as today. */
ok("a?.b === 1 -> `a` is set and …", () => eq("if (a?.b === 1) { g(); }", "when `a` is set and `a.b` is `1`, g"));
ok("CONTROL: a.b === 1 -> no frame", () => eq("if (a.b === 1) { g(); }", "when `a.b` is `1`, g"));
ok("a?.b > 1 -> `a` is set and … (relational is false for undefined against anything)",
  () => eq("if (a?.b > 1) { g(); }", "when `a` is set and `a.b` is over `1`, g"));

/* ── 3. `!==` / `!=` -> "is missing or" — THE SOUNDNESS CASE ───────────────────────────────────
 * The polarity flips. This is the assertion the first cut failed on 4 corpus sites. */
ok("a?.b !== 1 -> `a` is missing or … (NOT `a` is set and …)", () => {
  const c = clause("if (a?.b !== 1) { g(); }");
  assert.equal(c, "when `a` is missing or `a.b` is not `1`, g");
  assert.ok(!c.includes("`a` is set"), "the conjunction here would be FALSE whenever `a` is missing: " + c);
});

/* ── 4. DECLINE: a right side that is a NAME ───────────────────────────────────────────────────
 * `state.currentCreditNote?.id === payload.id` is TRUE when both are undefined, and no frame here
 * can say that without asserting something about `payload.id` we have not read. The flattened
 * clause stands — weaker, and not false. */
ok("a?.b === c.d declines both frames", () => eq("if (a?.b === c.d) { g(); }", "when `a.b` is `c.d`, g"));
ok("a?.b === undefined declines (undefined === undefined is TRUE)",
  () => eq("if (a?.b === undefined) { g(); }", "when `a.b` is `undefined`, g"));
ok("a?.b == null declines (undefined == null is TRUE)",
  () => eq("if (a?.b == null) { g(); }", "when `a.b` is nothing, g"));

/* ── 5. DECLINE: an operand of `&&` / `||` ─────────────────────────────────────────────────────
 * Neither frame survives that composition unbracketed — "`user.email` is missing and `user` is
 * missing or `user.id` is not `1`" reads two ways depending on where the reader puts the brackets.
 * Same rule as `negate`'s whitelist: a phrase inside a compound declines rather than guessing.
 * NOTE the assertion is on "`a` is set", not on "is set" — `x`'s own gloss supplies that phrase,
 * and a substring check would have passed here no matter what the frame did. */
ok("a?.b === 1 inside `&&` declines", () => {
  const c = clause("if (x && a?.b === 1) { g(); }");
  assert.equal(c, "when `x` is set and `a.b` is `1`, g");
  assert.ok(!c.includes("`a` is set"), c);
});

/* ── 6. DECLINE: more than one `?.` ────────────────────────────────────────────────────────────
 * One qualifier cannot carry two independent guards. */
ok("a?.b?.c === 1 declines", () => eq("if (a?.b?.c === 1) { g(); }", "when `a.b.c` is `1`, g"));

/* ── 7. THE PRESENCE FRAME IS UNTOUCHED — 33 corpus sites depend on it ─────────────────────────
 * These read correctly with `?.` flattened, and the fix must not move them. */
ok("!a?.b keeps the flattened presence gloss", () => eq("if (!a?.b) { g(); }", "when `a.b` is missing, g"));
ok("a?.b keeps the flattened presence gloss", () => eq("if (a?.b) { g(); }", "when `a.b` is set, g"));

console.log(`optional-chain.test: ${pass} passed`);
