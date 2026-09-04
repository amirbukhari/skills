"use strict";
/**
 * optional-chain-credit.js — THE FIFTH FIGURE. Report-only, exactly like `elision-credit.js`,
 * `one-char-credit.js` and `escape-credit.js`.
 *
 * WHAT IT COUNTS. `isSiteSpecific` accepts a clause only if a quoted run appears VERBATIM in the
 * statement. The renderer names a property path in its normalised form, so a source that reads
 * `a?.b` produces a clause that reads `` `a.b` `` — already the site's own words, and already
 * correct English — which the verbatim test cannot match:
 *
 *     return `accountRecord.accountId`                <-  return accountRecord?.accountId;
 *     stop early when `salesRep.user.email` is set    <-  if (salesRep?.user.email) { ... }
 *     when `ctx.state.token.userId` is missing, throw <-  if (!ctx.state.token?.userId) { ... }
 *
 * The test here is deliberately narrow: the run must be ABSENT from the raw statement and PRESENT
 * once `?.` is flattened to `.`. A clause that already matches verbatim never reaches this file,
 * and a clause quoting something the statement does not contain at all is not credited.
 *
 * WHY IT EXISTS. It is the fourth time the ranking metric has measured the wrong thing. The `…`
 * elision was first (921), the routes' one-character quotes second (117), escaped literals third
 * (15). Every one of them was found only after sites had been ranked as work: 17 route sites were
 * funded as a vocabulary gap while already reading correctly. Measured 2026-09-04, these 33 sites
 * were sitting inside the NEITHER bucket and in the family/kind tables, indistinguishable from
 * silence.
 *
 * WHAT IT IS NOT. It does NOT change what counts as generic, it is NOT wired into `real`, and it
 * is NOT a proposal to move the published series. `isSiteSpecific` is FROZEN and untouched;
 * subtracting this figure from `real` would drop the published count with no renderer change,
 * which is the exact shape the freeze exists to prevent. It prints BESIDE the series, feeds no
 * assertion, no gate and no exit code. Old number first, always.
 *
 * THRESHOLD DUPLICATION IS DELIBERATE AND NARROW, for the reason `one-char-credit.js` records: the
 * `>= 2` below is written out rather than imported so that this file cannot alter the frozen
 * predicate by being edited. The two must be able to disagree.
 *
 * THIS FIGURE MAY UNDERCOUNT, AND FOR THE BLOCKED DEFECT'S OWN REASON. The quoted-run match below
 * is the SAME ordered alternation as `isSiteSpecific`'s, so a backticked path inside a “…” run is
 * swallowed by the “…” branch and never tested here either. Harmless for a report-only figure —
 * it can only under-report, never over-report — but 39 / 33 is a FLOOR, not an exact count.
 * Recorded 2026-09-04, deliberately without a recount: the recount belongs with the defect.
 *
 * NOT THE SAME BUG AS THE TOKENISER DEFECT. `isSiteSpecific`'s quoted-run regex is an ordered
 * alternation that swallows backticked identifiers inside a “…” run; that is a separate finding,
 * it is BLOCKED, and it is Amir's ruling. This file does not touch it and does not depend on it.
 */

/** True iff a quoted run is absent from the statement but present once `?.` is flattened to `.`. */
function creditsOptionalChain(clause, stmtText) {
  const t = String(stmtText);
  if (t.indexOf("?.") === -1) return false;         /* no optional chain -> nothing to explain */
  const flat = t.split("?.").join(".");
  const quoted = String(clause).match(/`[^`]+`|“[^”]+”/g) || [];
  for (const q of quoted) {
    const bare = q.slice(1, -1).trim();
    if (bare.length < 2) continue;                  /* the one-char artifact is a different file */
    if (!t.includes(bare) && flat.includes(bare)) return true;
  }
  return false;
}

module.exports = { creditsOptionalChain };
