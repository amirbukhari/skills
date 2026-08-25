/**
 * BEHAVIORAL ORACLE — verbatim transcription of the real Hydra functions from
 * `billing-system/packages/hydra-internal/src/subscriptionHelpers.ts`, used ONLY
 * to check the spec-generated implementation.
 *
 * Two symbols the original imports are inlined here by their EXACT upstream
 * definitions so this file runs under plain Node with zero dependencies:
 *   - `floatVal`  from `@jamesgmarks/utilities` (dist/misc/floatVal.js)
 *   - `assertIVariableBasePriceArray` / `isIVariableBasePrice`
 *                 from `./interfaces/IVariableBasePrice`
 * Nothing else is changed: the five exported functions are byte-for-byte the
 * upstream logic.
 */

export interface IVariableBasePrice {
  id: number;
  maxValue: string | null;
  basePrice: string;
  costPerUnit: string | null;
}

export interface IRangedVariableBasePrice extends Omit<IVariableBasePrice, "id"> {
  id?: number;
  range: string;
}

// --- inlined from @jamesgmarks/utilities (exact) ---
const floatVal = (x: unknown): number => (typeof x === "number" ? x : parseFloat(`${x ?? ""}`));

// --- inlined from ./interfaces/IVariableBasePrice (exact) ---
const isIVariableBasePrice = (obj: unknown): obj is IVariableBasePrice => {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  const object = obj as Record<string, unknown>;
  return (
    typeof object.id === "number" &&
    (object.maxValue === null || typeof object.maxValue === "string") &&
    typeof object.basePrice === "string" &&
    (object.costPerUnit === null || typeof object.costPerUnit === "string")
  );
};
const isIVariableBasePriceArray = (arr: unknown): arr is IVariableBasePrice[] =>
  Array.isArray(arr) && arr.every(isIVariableBasePrice);
const assertIVariableBasePriceArray = (arr: unknown): IVariableBasePrice[] => {
  if (!isIVariableBasePriceArray(arr)) {
    throw new Error(
      "Invalid IVariableBasePrice array. Expected an array containing only valid IVariableBasePrice objects."
    );
  }
  return arr;
};

// --- the five functions, verbatim ---
export const variablePriceSortComparer = (a: IVariableBasePrice, b: IVariableBasePrice): number => {
  const A = floatVal(a.maxValue);
  const B = floatVal(b.maxValue);
  if (Number.isNaN(A)) {
    return 1;
  }
  if (Number.isNaN(B)) {
    return -1;
  }
  return A > B ? 1 : -1;
};

export const getSortedPriceBracketsForSubscription = (subscription: {
  baseSubscription: { variableBasePrices: IVariableBasePrice[] };
  variableBasePriceOverrides: IVariableBasePrice[];
}) => {
  if (subscription.variableBasePriceOverrides.length !== 0) {
    return subscription.variableBasePriceOverrides.sort(variablePriceSortComparer) as IVariableBasePrice[];
  }
  return subscription.baseSubscription.variableBasePrices.sort(variablePriceSortComparer) as IVariableBasePrice[];
};

export const getSortedVariablePriceBrackets = (subscription: {
  baseSubscription: { variableBasePrices: IVariableBasePrice[] };
}) => assertIVariableBasePriceArray(subscription.baseSubscription.variableBasePrices.sort(variablePriceSortComparer));

export const getSortedVariablePriceOverrideBrackets = (subscription: {
  variableBasePriceOverrides: IVariableBasePrice[];
}) =>
  subscription.variableBasePriceOverrides.length > 0
    ? assertIVariableBasePriceArray(subscription.variableBasePriceOverrides.sort(variablePriceSortComparer))
    : [];

export const appendRangeToSortedPriceBracketsForSubscription = (
  vbpData: { maxValue: string | null; basePrice: string; costPerUnit: string | null }[]
) =>
  vbpData.reduce<IRangedVariableBasePrice[]>((acc, curr, index, array) => {
    const currentMaxValue = parseInt(curr.maxValue ?? "0", 10);
    const previousMaxValue = parseInt(array[index - 1]?.maxValue ?? "0", 10);
    if (curr.maxValue === null && index !== array.length - 1) {
      throw new Error(`Null max value must be the last item in the array.`);
    }
    if (index === array.length - 1 && curr.maxValue === null) {
      return acc.concat({
        ...curr,
        range: `${previousMaxValue + 1}+`,
      });
    }
    if (index === 0) {
      return acc.concat({
        ...curr,
        range: currentMaxValue > 1 ? `1 - ${currentMaxValue}` : `${currentMaxValue}`,
      });
    }
    return acc.concat({
      ...curr,
      range: `${previousMaxValue + 1} - ${currentMaxValue}`,
    });
  }, []);
