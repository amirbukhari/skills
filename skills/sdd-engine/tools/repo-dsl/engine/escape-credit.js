"use strict";
/**
 * escape-credit.js — THE FOURTH FIGURE. Report-only, exactly like `elision-credit.js` and
 * `one-char-credit.js`.
 *
 * WHAT IT COUNTS. `statement-kind-coverage.test.js`'s `isSiteSpecific` asks whether a quoted run
 * appears in `st.getText(sf)` — the RAW SOURCE. A string literal's prose is its DECODED value, so a
 * clause that quotes it correctly is compared against a backslash that was never in the prose:
 *
 *     clause:  specify “rounds an artefact reproduced from that button's own expression”
 *     source:  it('rounds an artefact reproduced from that button\'s own expression', () => {
 *
 * The clause is already the site's own words. It scores generic because of an escape.
 *
 * WHY IT EXISTS. The ranking metric has now measured the wrong thing three times — the `…` elision
 * (921 sites), the one-character quote (117, which had funded the route family as a vocabulary gap),
 * and this. It was found while auditing rule 10's target: 11 of `Block`'s 18 ungated sites are this,
 * and every one of them already reads correctly.
 *
 * WHAT IT IS NOT. It does NOT change what counts as generic and is NOT a proposal to change it.
 * Whether `isSiteSpecific` ever compares against decoded text is Amir's ruling, unmade, and it is
 * not made here or in the same commit as any drop it would cause. Old number first, always.
 *
 * THE DECODER IS DELIBERATELY MINIMAL. It undoes backslash escapes of quote characters and of the
 * backslash itself — the only ones that actually occur in this corpus's literals. It does NOT
 * evaluate the literal (no \n, \u, no template substitution): a fuller decoder would start CLAIMING
 * matches rather than measuring them, and this file must never be able to flatter the number it
 * reports.
 */

/** Undo the escapes that make a correctly-quoted literal fail a verbatim comparison. */
const deEscape = (text) => String(text).replace(/\\(['"`\\])/g, "$1");

/** True iff the clause quotes a run of length >= 2 present in the statement ONCE ESCAPES ARE UNDONE
 *  but not in the raw source. The `>= 2` mirrors the frozen predicate and is written out, not
 *  imported, so the two can never move together by accident. */
function creditsEscape(clause, stmtText) {
  const quoted = String(clause).match(/`[^`]+`|“[^”]+”/g) || [];
  const decoded = deEscape(stmtText);
  if (decoded === String(stmtText)) return false;   /* nothing escaped here — not this artifact */
  for (const q of quoted) {
    const bare = q.slice(1, -1).trim();
    if (bare.length < 2) continue;                  /* one-char is the THIRD figure's business */
    if (!stmtText.includes(bare) && decoded.includes(bare)) return true;
  }
  return false;
}

module.exports = { creditsEscape, deEscape };
