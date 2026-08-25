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

function floatVal(value: any): number {
  if (typeof value === 'number') {
    return value;
  }
  return parseFloat(String(value ?? ""));
}

function assertIVariableBasePriceArray(array: any[]): void {
  for (const item of array) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.id !== 'number' ||
      (item.maxValue !== null && typeof item.maxValue !== 'string') ||
      typeof item.basePrice !== 'string' ||
      (item.costPerUnit !== null && typeof item.costPerUnit !== 'string')
    ) {
      throw new Error("Invalid IVariableBasePrice array. Expected an array containing only valid IVariableBasePrice objects.");
    }
  }
}

export const variablePriceSortComparer = (a: IVariableBasePrice, b: IVariableBasePrice): number => {
  const A = floatVal(a.maxValue);
  const B = floatVal(b.maxValue);
  
  if (isNaN(A)) {
    return 1;
  } else if (isNaN(B)) {
    return -1;
  } else {
    return A > B ? 1 : -1;
  }
};

export const getSortedPriceBracketsForSubscription = (subscription: {
  baseSubscription: { variableBasePrices: IVariableBasePrice[] };
  variableBasePriceOverrides: IVariableBasePrice[];
}): IVariableBasePrice[] => {
  if (subscription.variableBasePriceOverrides.length > 0) {
    return subscription.variableBasePriceOverrides.sort(variablePriceSortComparer);
  } else {
    return subscription.baseSubscription.variableBasePrices.sort(variablePriceSortComparer);
  }
};

export const getSortedVariablePriceBrackets = (subscription: {
  baseSubscription: { variableBasePrices: IVariableBasePrice[] };
}): IVariableBasePrice[] => {
  const sorted = subscription.baseSubscription.variableBasePrices.sort(variablePriceSortComparer);
  assertIVariableBasePriceArray(sorted);
  return sorted;
};

export const getSortedVariablePriceOverrideBrackets = (subscription: {
  variableBasePriceOverrides: IVariableBasePrice[];
}): IVariableBasePrice[] => {
  if (subscription.variableBasePriceOverrides.length === 0) {
    return [];
  }
  const sorted = subscription.variableBasePriceOverrides.sort(variablePriceSortComparer);
  assertIVariableBasePriceArray(sorted);
  return sorted;
};

export const appendRangeToSortedPriceBracketsForSubscription = (
  vbpData: { maxValue: string | null; basePrice: string; costPerUnit: string | null }[]
): IRangedVariableBasePrice[] => {
  return vbpData.reduce((acc, curr, index, array) => {
    const currentMaxValue = parseInt(curr.maxValue ?? "0", 10);
    const previousMaxValue = parseInt(array[index - 1]?.maxValue ?? "0", 10);
    
    let range: string;
    
    if (curr.maxValue === null && index !== array.length - 1) {
      throw new Error("Null max value must be the last item in the array.");
    } else if (index === array.length - 1 && curr.maxValue === null) {
      range = `${previousMaxValue + 1}+`;
    } else if (index === 0) {
      range = currentMaxValue > 1 ? `1 - ${currentMaxValue}` : `${currentMaxValue}`;
    } else {
      range = `${previousMaxValue + 1} - ${currentMaxValue}`;
    }
    
    acc.push({ ...curr, range });
    return acc;
  }, [] as IRangedVariableBasePrice[]);
};
