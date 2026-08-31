"use strict";
/**
 * entity-sentence.test.js — PINS AT-ARCH-1 (PRD §5E, acceptance test 1): the English sentence and
 * the TypeScript entity are two spellings of ONE model, and the loop between them is an identity.
 *
 *   FORWARD   sentence --parse--> model --emit--> .ts        (new-archetype.js)
 *   BACKWARD  .ts --extract--> model' --render--> sentence'  (the mine)
 *   AT-ARCH-1 sentence' === sentence, byte for byte.
 *
 * WHY THE FIXPOINT TURN IS ALSO CHECKED. A one-turn match can be luck: a renderer that normalises
 * (say, sorts columns) matches on any sentence it happens to have already normalised, and drifts on
 * the next. Running the loop a SECOND time on its own output catches that class, because a
 * normaliser that is not already at its fixpoint moves on turn two.
 *
 * WHY REFUSALS ARE TESTED AS HARD AS ACCEPTANCES. The forward command's value is that it will not
 * write a file it cannot re-mine (§5E.8 mechanic 1). A test that only proves the good path proves
 * nothing about that guarantee — the guard has to be shown to FIRE (§10.3).
 */
const S = require("./entity-sentence.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`);
const throws = (fn, m) => { try { fn(); ok(false, m + " (did not throw)"); } catch (_) { pass++; } };

/* THE REFERENCE SENTENCE. Amir's own, verbatim — the one the grammar was built to accept. Do not
 * "tidy" it; its exact punctuation and its mix of spoken column names (`account id`) with a
 * verbatim join column (`account_id`) are the two conventions the grammar encodes. */
const REF =
  "PaymentPlan is an entity stored in payment_plans. It has an auto-generated id, " +
  "a required account id (int), a required amount (decimal), an optional note (varchar), " +
  "and a required status (enum EPaymentPlanStatus). It belongs to a BillingAccount (join account_id). " +
  "It has many Installments.";

/* ---- 1. sentence -> model -> sentence ---- */
{
  const m = S.parseEntitySentence(REF);
  eq(m.className, "PaymentPlan", "class name parsed");
  eq(m.table, "payment_plans", "table parsed");
  eq(m.members.filter((x) => x.role === "column").length, 5, "column count");
  eq(m.members.filter((x) => x.role === "relation").length, 2, "relation count");
  eq(S.renderEntitySentence(m), REF, "AT-ARCH-1 leg 1: sentence -> model -> sentence");
}

/* ---- 2. the full loop through real TypeScript ---- */
const G = require("./generate.js");
{
  const ts = G.emitEntityCanonical(S.parseEntitySentence(REF));
  const back = S.sentenceFromSource(ts, "PaymentPlan.ts");
  eq(back, REF, "AT-ARCH-1 leg 2: sentence -> .ts -> extract -> sentence");

  /* THE JOIN COLUMN, EXPLICITLY. This is the field that was silently dropped until 2026-08-31:
   * only the first decorator on a member was read, so `@JoinColumn({ name: 'account_id' })` existed
   * nowhere in the slots — and byte-identity stayed GREEN throughout, because member bytes re-emit
   * verbatim from their span. Only the sentence round-trip could see it. Keep this assertion. */
  ok(/join account_id/.test(back), "join column survives the round trip");
  ok(/@JoinColumn\(/.test(ts), "emitted .ts carries a @JoinColumn");

  /* ---- 3. FIXPOINT: a second turn must not move ---- */
  const ts2 = G.emitEntityCanonical(S.parseEntitySentence(back));
  eq(S.sentenceFromSource(ts2, "PaymentPlan.ts"), back, "AT-ARCH-1 fixpoint: turn two is identical");
  eq(ts2, ts, "the emitted TypeScript is itself a fixpoint");
}

/* ---- 4. the grammar's two spelling conventions, isolated ---- */
{
  const m = S.parseEntitySentence(
    "Thing is an entity stored in things. It has an auto-generated id, a required owner id (int). " +
    "It belongs to a Owner (join owner_id).");
  const col = m.members.find((x) => x.prop === "ownerId");
  ok(col, "spoken `owner id` becomes the property ownerId");
  const rel = m.members.find((x) => x.role === "relation");
  eq(rel.join, "owner_id", "a join column is taken VERBATIM, not spoken");
}

/* ---- 5. the guards FIRE (§10.3) ---- */
throws(() => S.parseEntitySentence("PaymentPlan stores payment_plans."), "refuses a non-sentence");
throws(() => S.parseEntitySentence("PaymentPlan is an entity stored in payment_plans"), "refuses a missing full stop");
throws(() => S.parseEntitySentence("PaymentPlan is an entity stored in payment_plans. It has a required amount (decimal) blah blah."),
  "refuses trailing text it cannot account for");

console.log(`entity-sentence.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
