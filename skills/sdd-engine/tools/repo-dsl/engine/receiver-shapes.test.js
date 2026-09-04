"use strict";
/* receiver-shapes.test.js — R-LANG-24 AT THE SHAPES THE RECEIVER RUNG COULD NOT REACH.
 *
 * R-LANG-24 — "name the RECEIVER, not the method" — is SHIPPED and measured (`1b20b62`;
 * register row `tools/prd/11-requirements-register.md:175`). Its rung fires whenever
 * `dottedText(receiver)` succeeds, which is every receiver that is a plain dotted name. This test
 * covers the RESIDUE: statements whose receiver is NOT a plain dotted name, so the rung declined
 * and the method was left standing alone.
 *
 * MEASURED FRESH 2026-09-04, corpus-wide, over all 33,918 statements. Method-call statements whose
 * receiver is not a plain dotted name, bucketed by the receiver's AST shape:
 *
 *     54  a CALL              getManager('hydra').save(...)   ->  "await save"
 *      8  an ELEMENT ACCESS   acc[lineId].push(ui)            ->  "call push"
 *      7  await/parenthesised (await acc).push(...p)          ->  "await push"
 *      2  an ARRAY LITERAL    [a, b].forEach(...)             ->  "call for each"
 *     ---
 *     71 sites in 44 files
 *
 * (A further 303 method-call statements render without naming their receiver because an EARLIER
 * rung claims them and reads better — "log a message “… cpus available”", "serve GET `/`". Those
 * are not in the class and must not move.)
 *
 * THE RULE THE FIX HAD TO OBEY, and it is the whole reason only 8 of the 71 are reached — Amir:
 * "I want to be able to type English and get deterministic code. If grammer rules is the answer
 * then that's what we do. And we do our naming of our patterns in a way that fits the grammer
 * then". Naming is SUBORDINATE to grammar: a lead-in must EXPAND a production, never REPLACE it.
 *
 * So the question asked of each shape was not "can I word it?" but "does the phrasebook ALREADY
 * have a noun phrase for this receiver?" — because filling the existing `‹verb› ‹method› on
 * ‹receiver›` slot with a phrase the phrasebook already produces is expansion, and coining one is
 * replacement. Measured per shape, by rendering each receiver through `NKR.render`:
 *
 *     element access       8 of 8   render   ->  REACHED
 *     array literal        2 of 2   render   ->  DECLINED, see below
 *     await/parenthesised  1 of 7   render   ->  DECLINED, see below
 *     a call               0 of 54  render   ->  DECLINED BY CONSTRUCTION
 *
 * THE 54 ARE A REFUSAL WITH EVIDENCE, not an omission. The phrasebook's CallExpression rule
 * declines any method outside its VERBS list, and `getManager`, `where`, `orWhere`, `mockResolved
 * Value` are all outside it. There is no existing production to expand, so naming those receivers
 * would mean coining a lead-in — the thing the ruling forbids. They stay as they are.
 *
 * THE 2 + 1 THAT *COULD* RENDER ARE DECLINED DELIBERATELY, and this is a judgement, not a
 * mechanism: both glosses SYNTHESISE structure words rather than naming something in the source —
 * "…, and 30 more entries as a list", "`invoice.splitIds` if it is set, otherwise an empty list".
 * Hung off a statement verb, that trailing qualifier reads as if it conditioned the CALL. That is
 * the same falseness the optional-chain reach was cut back to avoid (optional-chain.test.js), and
 * the line drawn here is the same one: REACH ONLY WHERE THE RECEIVER GLOSS NAMES THINGS THAT ARE
 * IN THE SOURCE. An element access names two — the base and the index.
 *
 * WHAT ACTUALLY MOVED: 8 sites in 6 files, and nothing else, of 33,918 statements. Every one is
 * `‹base›[‹key›].push(‹x›)`; every one was "call push" before; none loses a name.
 *
 * NEGATIVE CONTROLS — the two halves fail against different engines, as in optional-chain.test.js:
 *   - Assertions 1-2 (the reach) FAIL against HEAD~1, where the shape rendered "call push".
 *   - The DECLINE assertions pass at HEAD~1 by construction, so their control is a WIDER CUT.
 *     Measured against a copy of this file with the dotted-base bar removed:
 *       getRows()[0].push(x)   ->  "call `push` on the result of `getRows` at `0`"
 *     "the result of" is a synthesised noun — exactly what the bar exists to keep out, so
 *     assertion 6 is load-bearing and provably able to fail.
 *   - Assertion 5 (`acc[compute(k)]`) declines even in that wider cut: its control is the
 *     phrasebook's OWN index decline, not this rung's bar. Recorded rather than claimed.
 */
const assert = require("assert");
const ts = require("typescript");
const EN = require("./enfile");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.message}`); process.exitCode = 1; } };

function clause(inner) {
  const sf = ts.createSourceFile("f.ts", "function f(){ " + inner + " }", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const st = sf.statements[0].body.statements[0];
  const r = EN.spanActions([st], sf);
  return (r && r.actions && r.actions[0]) || (r && r.guards && r.guards[0]) || "<none>";
}
const eq = (inner, want) => assert.equal(clause(inner), want, JSON.stringify(inner) + " -> " + JSON.stringify(clause(inner)));

/* ── THE REACH ────────────────────────────────────────────────────────────────────────────────── */

/* 1. The corpus shape, verbatim from src/routers/invoices.ts:670. */
ok("an element-access receiver is named, base and index", () =>
  eq("acc[lineId].push(ui);", "call `push` on `acc` at `lineId`"));

/* 2. The index may itself be dotted — doMultipleSubscriptionsHaveSameBuilding.ts:40. */
ok("a dotted index is named too", () =>
  eq("acc[shb.buildingId].push(shb.subscriptionId);", "call `push` on `acc` at `shb.buildingId`"));

/* ── THE GATES ────────────────────────────────────────────────────────────────────────────────── */

/* 3. THE 54. No production exists for this receiver, so the method stands alone. */
ok("a CALL receiver is declined — no production to expand", () =>
  eq("getManager('hydra').save(Invoice, x);", "call save"));

/* 4. The await/parenthesised shape, verbatim from clientMonthly.ts:187. */
ok("an awaited receiver is declined", () =>
  eq("(await acc).push(...p);", "await push"));

/* 5. An index that is itself a call — the phrasebook declines the index, so the whole receiver
 *    declines. Its control is the phrasebook, not this rung (see the header). */
ok("an unnameable index declines the whole receiver", () =>
  eq("acc[compute(k)].push(x);", "call push"));

/* 6. THE DOTTED-BASE BAR. Without it this renders "on the result of `getRows` at `0`" — a
 *    synthesised noun in a slot that is supposed to hold names from the source. */
ok("a base the phrasebook would have to synthesise is declined", () =>
  eq("getRows()[0].push(x);", "call push"));

/* 7. The array-literal receiver — declined by judgement, recorded in the header. */
ok("an array-literal receiver is declined", () =>
  eq("[a, b].forEach((x) => { g(x); });", "call for each"));

/* ── NO-MOVE CONTROLS ─────────────────────────────────────────────────────────────────────────── */

/* 8. The shipped R-LANG-24 rung is untouched: a plain dotted receiver still wins, and wins FIRST. */
ok("a plain dotted receiver is unchanged", () =>
  eq("cacheProxy.set(a, b);", "call `set` on `cacheProxy`"));

/* 9. CALLING an element — `acc[lineId](ui)` — is a different rung, earlier in the ladder, and this
 *    change must not have moved it. It says "call `acc` at `lineId`", with no method to name. */
ok("calling an element access is unchanged", () =>
  eq("acc[lineId](ui);", "call `acc` at `lineId`"));

console.log(`\n${pass} assertions passed`);
