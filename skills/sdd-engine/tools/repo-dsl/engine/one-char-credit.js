"use strict";
/**
 * one-char-credit.js — THE THIRD FIGURE. Report-only, exactly like `elision-credit.js`.
 *
 * WHAT IT COUNTS. `statement-kind-coverage.test.js`'s `isSiteSpecific` accepts a clause as
 * site-specific only if it quotes a run of length **>= 2** that appears verbatim in the statement.
 * A clause that quotes exactly ONE character which IS in the statement therefore scores GENERIC
 * although it is already the site's own words:
 *
 *     serve GET `/`            <-  accountsRouter.get('/', async (ctx) => { ... })
 *     return `0`               <-  return 0;
 *     get `A` from float val   <-  const A = floatVal(a.maxValue);
 *
 * WHY IT EXISTS. The ranking metric has now measured the wrong thing twice. The `…` elision was the
 * first (921 sites, `elision-credit.js`); this is the second, and it was found the expensive way —
 * all 17 route-family sites were ranked as a VOCABULARY GAP and funded as work, when `ROUTE_VERBS`
 * was already wired and every one of them already read correctly. A rule written for them would have
 * gained nothing and overwritten good English.
 *
 * WHAT IT IS NOT. It does NOT change what counts as generic, and it is NOT a proposal to change it.
 * `isSiteSpecific`'s `>= 2` threshold is FROZEN: whether the definition of mute ever moves is Amir's
 * ruling, unmade, and it is not made here or in the same commit as any drop it would cause. This
 * module measures AROUND the threshold and feeds no assertion. Old number first, always.
 *
 * THRESHOLD DUPLICATION IS DELIBERATE AND NARROW. The `>= 2` below is written out rather than
 * imported so that this file cannot alter the frozen predicate by being edited — the two must be
 * able to disagree, or a change here would silently move the published series.
 */

/** True iff the clause quotes a ONE-CHARACTER run that is present verbatim in the statement. */
function creditsOneChar(clause, stmtText) {
  const quoted = String(clause).match(/`[^`]+`|“[^”]+”/g) || [];
  for (const q of quoted) {
    const bare = q.slice(1, -1).trim();
    if (bare.length !== 1) continue;          /* >= 2 is the frozen predicate's own business */
    if (stmtText.includes(bare)) return true;
  }
  return false;
}

module.exports = { creditsOneChar };
