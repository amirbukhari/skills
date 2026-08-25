/**
 * GENERATED from spec/ (standards S3/S4 + contract + constants) by the LLM
 * generation path — for Phase 1, authored by Claude acting as the generator.
 * Do not hand-edit; it is a build artifact of the spec.
 *
 * Deliberately structured differently from the Hydra reference (plain arithmetic
 * rather than string padStart/slice) to demonstrate the SPEC — not the original
 * source — drove this implementation. Behavioural parity is checked by the
 * fixtures (tools/verify.js) and the sweep (tools/behavioral-diff.js).
 */

const CENTS_DECIMALS = 2;
const CENT_MULTIPLIER = 10 ** CENTS_DECIMALS; // 100
const CORRECTION_UNIT = 0.01;
const ROUND_EPSILON = 1e-10;

// Standards S3: reduce a float to a cents-valid number.
export const roundFloatToCents = (
  float: number,
  algorithm: 'up' | 'down' | 'nearest' = 'nearest',
): number => {
  const sign = float < 0 ? -1 : 1;
  const magnitudeCents = Math.abs(float) * CENT_MULTIPLIER + ROUND_EPSILON;
  const rounder =
    algorithm === 'nearest' ? Math.round : algorithm === 'up' ? Math.ceil : Math.floor;
  const cents = rounder(magnitudeCents);
  return (cents / CENT_MULTIPLIER) * sign;
};

// Standards S4: split total into count cents-valid parts summing exactly to total.
export const evenlySplitWithCorrection = (total: number, count: number): number[] => {
  const each = roundFloatToCents(total / count);
  const parts = new Array(count).fill(each);

  const distributed = parts.reduce((acc: number, val: number) => acc + val, 0);
  const diff = roundFloatToCents(total - distributed);
  const numCorrections = Math.min(count, Math.round(Math.abs(diff) / CORRECTION_UNIT));
  const correctionUnit = diff > 0 ? CORRECTION_UNIT : -CORRECTION_UNIT;

  // Corrections land on the tail (highest indices), per S4.
  const firstCorrectedIndex = count - numCorrections;
  return parts.map((val: number, idx: number) =>
    idx >= firstCorrectedIndex ? roundFloatToCents(val + correctionUnit) : val,
  );
};
