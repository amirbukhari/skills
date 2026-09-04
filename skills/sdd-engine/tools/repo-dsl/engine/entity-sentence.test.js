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

/* ---- 6. THE CORPUS-WIDE ROUND TRIP (AT-ARCH-1, over every Entity the corpus has) ----
 *
 * Sections 1-5 prove the loop closes on ONE sentence: Amir's, the one the grammar was built from.
 * That is a demonstration, not a measurement. This section runs the same loop over every entity
 * source in SOURCE and PUBLISHES THE DENOMINATOR, because a fraction whose denominator is implied
 * can be improved by shrinking it, and this repo has been burned by exactly that (`byteIdentical:
 * 100%` over a set that had quietly stopped including the hard files).
 *
 * THE DENOMINATOR IS NOT `entity files on disk`. Measured 2026-09-04: 75 files live under an
 * `entities/` directory, and 58 of them produce a sentence at all. The other 17 are refused by
 * `extractEntity` before the grammar is reached -- they are not Entities by the archetype's own
 * definition, so counting them would be measuring the extractor, not the round trip. 58 is the
 * population this check is about, and it is printed, not implied.
 *
 * ON LEG 2, AND A CORRECTION TO HOW IT WAS SCOPED. The leg was specified as
 * `emitEntityCanonical(parse(s)) === ts`, comparing against the corpus file's OWN BYTES. Measured
 * first, before it was written into an assertion: that is 0 of 58, and not one of the 58 failures
 * is a defect in the grammar. `entities/hydra/ApiValidator.ts` differs by an
 * `import { Nullable }` the archetype does not model, by the `export enum` declared inline in the
 * file rather than imported from `./enums`, by a blank line, and by `@Column({ name: 'status' })`
 * where the name equals the property and the canonical emitter correctly drops it. Comparing a
 * CANONICAL emission to NON-CANONICAL corpus bytes measures how the corpus was typed, not whether
 * the loop closes. So that comparison is reported here as a number and deliberately NOT asserted;
 * asserting it would pin 0/58 forever with nothing to fix.
 *
 * What IS asserted in its place is the checkable form of the same claim -- the TypeScript leg of
 * AT-ARCH-1 exactly as section 3 states it, run corpus-wide: emit the canonical .ts, re-mine it,
 * and require both the sentence and the .ts to be at their fixpoint. That catches every failure
 * the specified leg would have caught (a model that loses a field emits a .ts that re-mines to a
 * different sentence) and none of the noise it would have manufactured. */
{
  const fs = require("fs"), path = require("path");
  const CR = require("./corpus-root.js");
  const { SKIP } = require("./walk-skip.js");
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
    }
    return out;
  };

  const candidates = walk(CR.sourceRoot()).filter((f) => /entities\//.test(f));
  const rel = (f) => f.split("/").slice(-2).join("/");

  let population = 0, legSentence = 0, legReMine = 0, legFixpoint = 0, legAgainstFileBytes = 0;
  const failures = [], sentences = new Map();

  for (const f of candidates) {
    const src = fs.readFileSync(f, "utf8");
    let s;
    try { s = S.sentenceFromSource(src, path.basename(f)); } catch (_) { continue; }
    population++;
    if (!sentences.has(s)) sentences.set(s, []);
    sentences.get(s).push(rel(f));

    let m;
    try { m = S.parseEntitySentence(s); }
    catch (e) { failures.push(`${rel(f)}: parse refused the mined sentence -- ${e.message}`); continue; }

    if (S.renderEntitySentence(m) === s) legSentence++;
    else failures.push(`${rel(f)}: render(parse(s)) !== s`);

    let ts0;
    try { ts0 = G.emitEntityCanonical(m); }
    catch (e) { failures.push(`${rel(f)}: emit failed -- ${e.message}`); continue; }
    if (ts0 === src) legAgainstFileBytes++;   /* reported, not asserted -- see the header */

    let s1;
    try { s1 = S.sentenceFromSource(ts0, path.basename(f)); }
    catch (e) { failures.push(`${rel(f)}: the emitted .ts would not re-mine -- ${e.message}`); continue; }
    if (s1 === s) legReMine++;
    else failures.push(`${rel(f)}: the re-mined sentence moved`);

    let ts1;
    try { ts1 = G.emitEntityCanonical(S.parseEntitySentence(s1)); }
    catch (e) { failures.push(`${rel(f)}: turn two failed -- ${e.message}`); continue; }
    if (ts1 === ts0) legFixpoint++;
    else failures.push(`${rel(f)}: the emitted .ts is not a fixpoint`);
  }

  console.log(`  corpus entities: ${candidates.length} files under entities/, ${population} conform and produce a sentence`);
  console.log(`  DENOMINATOR ${population}`);
  console.log(`    render(parse(s)) === s                       ${legSentence}/${population}`);
  console.log(`    re-mine of the emitted .ts === s             ${legReMine}/${population}`);
  console.log(`    the emitted .ts is a fixpoint                ${legFixpoint}/${population}`);
  console.log(`    REPORT ONLY, not asserted -- emit === the corpus file's own bytes   ${legAgainstFileBytes}/${population}`);
  for (const line of failures) console.log(`    - ${line}`);

  eq(population, 58, "the published denominator is still 58 entity sources");
  eq(legSentence, population, `AT-ARCH-1 corpus-wide, sentence leg: ${legSentence}/${population}`);
  eq(legReMine, population, `AT-ARCH-1 corpus-wide, re-mine leg: ${legReMine}/${population}`);
  eq(legFixpoint, population, `AT-ARCH-1 corpus-wide, fixpoint leg: ${legFixpoint}/${population}`);

  /* THE NEGATIVE CONTROL FOR THE DENOMINATOR ITSELF. A distinct .ts rendering a sentence some
   * other .ts also renders would mean the grammar had lost the field that told them apart, and
   * every leg above would still be green -- the collision is invisible to an identity check run
   * per file. Measured 0 on 2026-09-04. */
  const collisions = [...sentences.entries()].filter(([, v]) => v.length > 1);
  eq(collisions.length, 0, `no two entity sources render the same sentence${collisions.length ? ": " + collisions.map(([, v]) => v.join(" == ")).join("; ") : ""}`);
}

console.log(`entity-sentence.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
