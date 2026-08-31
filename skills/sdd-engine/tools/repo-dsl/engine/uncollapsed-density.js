"use strict";
/* §7(a2) PLACEHOLDER DENSITY — the discriminator that keeps the un-collapsed metric honest.
 *
 * A body's WIDE-axis key is its per-statement canonical keys joined, with any statement that does
 * not generalize written as the hole symbol. A body whose statements ALL become holes keys as
 * "·<GAP>·", so every such body collides with every other one and each scores freq >= 2 — the
 * frequency test reports "repeated structure" for two functions that share no content at all.
 *
 * Frozen and decidable: of the N parts of the key, let h be the number equal to HOLE. The body is
 * evidence of recurrence iff h/N < MAX_HOLE_FRAC. Exactly one half is NOT enough (strict <).
 *
 * Lives in its own module so the rule is testable without running the corpus walk. */

const HOLE = "·";
const MAX_HOLE_FRAC = 0.5;

/* An empty key is all-hole by convention: no parts means no evidence. */
function holeFraction(parts) {
  return parts.length === 0 ? 1 : parts.filter((p) => p === HOLE).length / parts.length;
}

function passesDensity(parts) {
  return holeFraction(parts) < MAX_HOLE_FRAC;
}

module.exports = { HOLE, MAX_HOLE_FRAC, holeFraction, passesDensity };
