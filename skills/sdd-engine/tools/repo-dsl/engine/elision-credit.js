"use strict";
/**
 * elision-credit.js — A SECOND FIGURE BESIDE THE FROZEN ONE. It does not replace it, narrow it, or
 * touch it (R-ARCH-16B's own pattern: old number first, always).
 *
 * WHY THIS EXISTS. `statement-kind-coverage.test.js` scores a clause SITE-SPECIFIC iff it quotes
 * something that appears VERBATIM in the statement. The renderer, meanwhile, writes `…` where an
 * interpolation stood, because splicing `${String(key)}` into an English sentence would put code in
 * it. Those two correct decisions disagree:
 *
 *     throw new Error(`Invalid data: ${String(key)} must be a number, numeric string, or null.`);
 *       clause:  throw “Invalid data: … must be a number, numeric string, or null”
 *       scored:  GENERIC — because "Invalid data: … must be" is not in the source
 *
 * The clause is the author's own sentence, lifted correctly. Measured 2026-09-04 by
 * engine/phrasebook-worklist.js, the top two blocking kinds are dominated by this shape —
 * `NewExpression` 361 blocked sites (346 in ThrowStatement) and `PrefixUnaryExpression` 322 (302 in
 * IfStatement) — and R-ARCH-16B counts 337 of ThrowStatement's 349 independently. Every phrasebook
 * rule is scored by a number this inflates.
 *
 * WHAT THIS IS NOT, AND THE RULE THAT SHAPES IT. Amir, verbatim: *"If you ever find yourself editing
 * the definition of mute in the same commit as a drop in mutes, stop and tell me."* Teaching the
 * frozen predicate its own `…` convention is shape-identical to re-baselining a check. So:
 *
 *   - `VACUOUS`, `SAYS_NOTHING` and the frozen site-specific predicate are UNCHANGED and remain the
 *     published series (4,646 -> 2,362; corpus generic 2,284 -> 1,729).
 *   - this module adds a SEPARATELY NAMED second figure, printed AFTER the frozen one everywhere.
 *   - whether the definition of mute ever changes is Amir's ruling, in its own pass. Nothing here
 *     makes that call, and no consumer of this module may be wired into an assertion.
 *
 * THE CREDIT RULE, deliberately narrow. A quote is credited only if it CONTAINS `…` and its literal
 * segments occur IN ORDER in the statement text. Order matters: without it, two common words
 * scattered anywhere would credit an unrelated sentence. Segments shorter than two characters are
 * dropped, mirroring the frozen predicate's own `bare.length >= 2`, and a quote whose segments are
 * all shorter than that credits nothing.
 *
 * IT DELIBERATELY DOES NOT CREDIT THE `?.` CASE. `if (!responseJson?.response?.roles)` renders as
 * `` `responseJson.response.roles` `` — correct, naming the right thing, and unmatchable because the
 * engine drops the optional-chaining marks. That is ~72 sites and a separate question (render or
 * measure?), tracked as its own backlog item. Folding it in here would make one figure answer two
 * questions and neither cleanly.
 */

const ELLIPSIS = "…";

/** Does this clause quote the site's own words, allowing for the renderer's `…` elision? */
function creditsElision(clause, stmtText) {
  const quoted = String(clause).match(/`[^`]+`|“[^”]+”/g) || [];
  for (const q of quoted) {
    const bare = q.slice(1, -1).trim();
    if (!bare.includes(ELLIPSIS)) continue;      /* no elision -> the frozen predicate's business */
    const segs = bare.split(ELLIPSIS).map((s) => s.trim()).filter((s) => s.length >= 2);
    if (!segs.length) continue;                  /* nothing substantial enough to match on */
    let pos = 0, ok = true;
    for (const s of segs) {
      const at = stmtText.indexOf(s, pos);
      if (at < 0) { ok = false; break; }
      pos = at + s.length;                       /* IN ORDER, and non-overlapping */
    }
    if (ok) return true;
  }
  return false;
}

module.exports = { creditsElision, ELLIPSIS };
