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

/* ---- 7. THE AT-ARCH-1 NEGATIVE CONTROL (PRD §20, "It must be able to fail") ---------------
 *
 * §20 states the requirement in its own words: AT-ARCH-1 "is nonetheless MUTATION-CHECKED at
 * authoring time (R-TEST-3) with an explicit negative control: de-register the archetype, re-run,
 * and assert en1 != en0. A test that cannot be made to fail is not evidence, whatever it prints."
 *
 * THAT CONTROL DID NOT EXIST. Section 6 carries a negative control for the DENOMINATOR -- no two
 * sources render the same sentence -- which is a different claim: it guards the population, not the
 * assertion. Every leg in section 6 is an identity check, and an identity check that is structurally
 * incapable of moving prints 58/58 forever. R-ARCH-4 records exactly that failure one layer down
 * (`checkTiling` re-slices the source and rejoins it, so `byteIdentical: 100%` is a tautology), and
 * §20 names it as the thing AT-ARCH-1 must not become.
 *
 * SO THIS SECTION MAKES THE LOOP READ RED ON PURPOSE. Each mutation changes ONE field of the model,
 * emits the .ts from the mutated model, re-mines it, and requires the sentence to MOVE. A mutation
 * the sentence does not notice is a field the grammar has stopped carrying -- and section 6 would
 * stay green through all of it. Run over the SAME 58 entities, not a specimen: a control measured on
 * one hand-picked file proves the field is carried there, which is not the claim.
 *
 * A mutation that makes emit or re-mine REFUSE also counts as detected, and is counted separately,
 * because refusing is a louder failure than a moved sentence and must not be confused with one. */
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
  const clone = (m) => JSON.parse(JSON.stringify(m));
  const cols = (m) => m.members.map((x, i) => [x, i]).filter(([x]) => x.role === "column");

  /* Each returns a mutated model, or null when this entity cannot carry the mutation. */
  const MUTATIONS = {
    "class name changed":        (m) => { const x = clone(m); x.className = x.className + "Zz"; return x; },
    "table name changed":        (m) => { const x = clone(m); x.table = x.table + "_zz"; return x; },
    /* MUTATE THE FIELD THAT CARRIES THE IDENTITY, NOT ONE DERIVED FROM IT. `prop` is DERIVED:
     * measured over all 58 entities, 611 columns, 355 of them carrying an explicit `name`,
     * `camel(name) === prop` on 355/355 -- so changing `prop` alone builds a model the emitter can
     * never emit, and a sentence that does not move is CORRECT there. The first version of this
     * control did exactly that and read 8/58; the 50 "silences" were its own bug, not a hole in
     * AT-ARCH-1. The invariant that makes this the right target is asserted below, so it can fail. */
    "a column renamed":          (m) => { const x = clone(m); const c = cols(x); if (c.length < 2) return null;
                                          const col = x.members[c[1][1]];
                                          if (col.name !== undefined) { col.name = col.name + "_zz"; col.src = col.name; }
                                          else col.prop = col.prop + "Zz";
                                          return x; },
    /* An enum column speaks through `enum`/`tsType`, so flipping `colType` alone leaves the
     * sentence rightly unmoved -- two of 58 are enum-first and were silent for that reason. Target
     * a non-enum column, and let the denominator fall rather than the assertion. */
    "a column's type changed":   (m) => { const x = clone(m); const c = cols(x).filter(([y]) => y.colType && y.colType !== "enum");
                                          if (!c.length) return null;
                                          x.members[c[0][1]].colType = x.members[c[0][1]].colType === "varchar" ? "text" : "varchar";
                                          return x; },
    "required <-> optional":     (m) => { const x = clone(m); const c = cols(x).filter(([y]) => y.nullable !== undefined);
                                          if (!c.length) return null;
                                          x.members[c[0][1]].nullable = !x.members[c[0][1]].nullable; return x; },
    "two columns swapped":       (m) => { const x = clone(m); const c = cols(x); if (c.length < 3) return null;
                                          const [i, j] = [c[1][1], c[2][1]];
                                          const t = x.members[i]; x.members[i] = x.members[j]; x.members[j] = t; return x; },
    "a column dropped":          (m) => { const x = clone(m); const c = cols(x); if (c.length < 2) return null;
                                          x.members.splice(c[c.length - 1][1], 1); return x; },
  };

  const tally = {}; for (const k of Object.keys(MUTATIONS)) tally[k] = { n: 0, moved: 0, refused: 0, silent: [] };
  let baseline = 0, population = 0, deregRefused = 0, deregSilent = [];
  let colTotal = 0, colNamed = 0, propDerived = 0, propIndependent = [];
  const camelOf = (x) => String(x).replace(/[_-]+(.)/g, (_, ch) => ch.toUpperCase());

  for (const f of walk(CR.sourceRoot()).filter((x) => /entities\//.test(x))) {
    const base = path.basename(f);
    let s0; try { s0 = S.sentenceFromSource(fs.readFileSync(f, "utf8"), base); } catch (_) { continue; }
    population++;
    let m0, ts0;
    try { m0 = S.parseEntitySentence(s0); ts0 = G.emitEntityCanonical(m0); } catch (_) { continue; }

    /* POSITIVE CONTROL FIRST. A mutation harness whose unmutated case is already broken proves
     * nothing at all -- every mutation would "move" and the section would pass while measuring
     * noise. This is the same order the enum work used: establish the baseline, then perturb it. */
    let sBase = null; try { sBase = S.sentenceFromSource(ts0, base); } catch (_) {}
    if (sBase === s0) baseline++;

    /* THE INVARIANT THE RENAME MUTATION RESTS ON, measured rather than assumed. */
    for (const c of m0.members.filter((x) => x.role === "column")) {
      colTotal++;
      if (c.name === undefined) continue;
      colNamed++;
      if (camelOf(c.name) === c.prop) propDerived++;
      else propIndependent.push(base + ": name=" + c.name + " prop=" + c.prop);
    }

    for (const [name, mutate] of Object.entries(MUTATIONS)) {
      let mm; try { mm = mutate(m0); } catch (_) { mm = null; }
      if (!mm) continue;
      const t = tally[name]; t.n++;
      let s1 = null, refused = false;
      try { s1 = S.sentenceFromSource(G.emitEntityCanonical(mm), base); }
      catch (_) { refused = true; }
      if (refused) t.refused++;
      else if (s1 !== s0) t.moved++;
      else t.silent.push(base);
    }

    /* THE CONTROL §20 NAMES BY NAME -- de-register the archetype. Strip the @Entity decorator and
     * the loop must REFUSE, not fabricate a sentence from a class that is no longer an entity. */
    const dereg = ts0.replace(/@Entity\([^)]*\)\n/, "");
    if (dereg === ts0) { deregSilent.push(base + " (no @Entity to strip)"); continue; }
    let sd = null; try { sd = S.sentenceFromSource(dereg, base); } catch (_) { sd = null; }
    if (!sd) deregRefused++; else deregSilent.push(base + " -> " + sd.slice(0, 40));
  }

  console.log(`  AT-ARCH-1 NEGATIVE CONTROL over the same ${population} entities`);
  console.log(`    POSITIVE CONTROL, unmutated emit re-mines to the same sentence   ${baseline}/${population}`);
  for (const [name, t] of Object.entries(tally))
    console.log(`    ${name.padEnd(26)} detected ${String(t.moved + t.refused).padStart(3)}/${String(t.n).padEnd(3)}` +
      `  (moved ${t.moved}, refused ${t.refused})   SILENT ${t.silent.length}` +
      (t.silent.length ? "  <-- " + t.silent.slice(0, 3).join(", ") : ""));
  console.log(`    de-registered (@Entity stripped) refuses a sentence               ${deregRefused}/${population}`);
  console.log(`    invariant: columns ${colTotal}, carrying an explicit name ${colNamed}, camel(name) === prop ${propDerived}/${colNamed}`);

  eq(baseline, population, `POSITIVE CONTROL: the unmutated loop closes on every entity (${baseline}/${population})`);
  for (const [name, t] of Object.entries(tally)) {
    ok(t.n > 0, `the "${name}" mutation applies to at least one entity (${t.n})`);
    eq(t.silent.length, 0,
      `AT-ARCH-1 DETECTS "${name}" on every entity that can carry it -- ${t.moved + t.refused}/${t.n}` +
      (t.silent.length ? `, SILENT on ${t.silent.slice(0, 5).join(", ")}` : ""));
  }
  eq(deregSilent.length, 0,
    `de-registering the archetype refuses on every entity${deregSilent.length ? ", SILENT on " + deregSilent.slice(0, 3).join("; ") : ""}`);
  /* If this ever fails, `prop` has become independent state the sentence does not carry, and the
   * rename mutation above must target it directly again -- the AT-ARCH-1 loop would be lossy. */
  eq(propIndependent.length, 0,
    `every explicitly named column derives prop from name (${propDerived}/${colNamed} of ${colTotal} columns)` +
    (propIndependent.length ? ", INDEPENDENT on " + propIndependent.slice(0, 3).join("; ") : ""));
}

console.log(`entity-sentence.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
