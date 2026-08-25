const CENTS_DECIMALS = 2;
const CORRECTION_UNIT = 0.01;
const ROUND_EPSILON = 1e-10;

export const roundFloatToCents = (
  float: number,
  algorithm: 'up' | 'down' | 'nearest' = 'nearest'
): number => {
  const mag = Math.abs(float);
  const sign = float < 0 ? -1 : 1;
  
  const centCountWithEpsilon = mag * 100 + ROUND_EPSILON;
  
  let centCount: number;
  if (algorithm === 'up') {
    centCount = Math.ceil(centCountWithEpsilon);
  } else if (algorithm === 'down') {
    centCount = Math.floor(centCountWithEpsilon);
  } else {
    centCount = Math.round(centCountWithEpsilon);
  }
  
  return (centCount / 100) * sign;
};

export const evenlySplitWithCorrection = (
  total: number,
  count: number
): number[] => {
  const unrounded = total / count;
  const parts = new Array(count).fill(0).map(() => roundFloatToCents(unrounded));
  
  const sum = parts.reduce((acc, val) => acc + val, 0);
  const diff = roundFloatToCents(total - sum);
  
  const numCorrections = Math.min(count, Math.round(Math.abs(diff) / CORRECTION_UNIT));
  const correctionUnit = diff > 0 ? CORRECTION_UNIT : -CORRECTION_UNIT;
  
  for (let i = 0; i < numCorrections; i++) {
    const idx = count - 1 - i;
    parts[idx] = roundFloatToCents(parts[idx] + correctionUnit);
  }
  
  return parts;
};
