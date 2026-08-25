/**
 * REFERENCE IMPLEMENTATION — lifted VERBATIM from the Hydra billing repo:
 *   billing-system/packages/hydra-internal/src/helpers.ts
 *   (roundFloatToCents ~line 133, evenlySplitWithCorrection ~line 438)
 *
 * This file exists ONLY as the behavioral oracle for the proof in this example
 * (see tools/behavioral-diff.js). It is NOT the spec and NOT the generated code.
 * It is not modified from the original. Nothing here is written back to Hydra.
 */

export const roundFloatToCents = (float: number, algorithm: 'up' | 'down' | 'nearest' = 'nearest') => {
  const absFloat = Math.abs(float);
  const isNegativeMultiplier = float < 0 ? -1 : 1;
  // eslint-disable-next-line no-nested-ternary
  const rounder = algorithm === 'nearest' ? Math.round : (algorithm === 'up' ? Math.ceil : Math.floor);
  const nearestPennyUp = `${rounder(absFloat * 100 + 1e-10)}`.padStart(2, '0');

  return (
    parseFloat(`${nearestPennyUp.slice(0, -2)}.${nearestPennyUp.slice(-2)}`) * isNegativeMultiplier
  );
};

export const evenlySplitWithCorrection = (total: number, count: number): number[] => {
  const unrounded = total / count;
  const rounded = Array(count).fill(0).map(() => roundFloatToCents(unrounded));
  const sum = rounded.reduce((acc, val) => acc + val, 0);
  const diff = roundFloatToCents(total - sum);
  const numCorrections = Math.min(count, Math.round(Math.abs(diff) / 0.01));
  const correctionUnit = diff > 0 ? 0.01 : -0.01;
  return rounded.map((val, idx) => (idx >= count - numCorrections ? roundFloatToCents(val + correctionUnit) : val));
};
