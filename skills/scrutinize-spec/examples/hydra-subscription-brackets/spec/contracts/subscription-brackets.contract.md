# Contract — `subscription-brackets`

TypeScript surface the generated module MUST export. Types are structural; the
module defines them and implements all behaviour inline (S2 — no imports).

## Types

```ts
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
```

## Functions

```ts
// S3 — comparer for Array.prototype.sort. Never returns 0.
export const variablePriceSortComparer: (a: IVariableBasePrice, b: IVariableBasePrice) => number;

// S4 — if overrides is non-empty, sort & return it (in place); else sort & return
// the base subscription's variableBasePrices (in place). No shape assertion.
export const getSortedPriceBracketsForSubscription: (subscription: {
  baseSubscription: { variableBasePrices: IVariableBasePrice[] };
  variableBasePriceOverrides: IVariableBasePrice[];
}) => IVariableBasePrice[];

// S4 + S5 — sort the base variableBasePrices in place, assert the sorted array,
// return it. Throws (S5) if any element is not a valid IVariableBasePrice.
export const getSortedVariablePriceBrackets: (subscription: {
  baseSubscription: { variableBasePrices: IVariableBasePrice[] };
}) => IVariableBasePrice[];

// S4 + S5 — if overrides is non-empty, sort in place + assert + return it;
// otherwise return a new empty array []. Throws (S5) on invalid non-empty input.
export const getSortedVariablePriceOverrideBrackets: (subscription: {
  variableBasePriceOverrides: IVariableBasePrice[];
}) => IVariableBasePrice[];

// S6 — map a sorted array to ranged copies. Throws if a null maxValue is not last.
export const appendRangeToSortedPriceBracketsForSubscription: (
  vbpData: { maxValue: string | null; basePrice: string; costPerUnit: string | null }[]
) => IRangedVariableBasePrice[];
```

## Guarantees

- **Comparer (S3):** `variablePriceSortComparer` returns `1`, `-1` per S3; never
  `0`. `NaN`-coercing `maxValue`s (non-numeric or `null`) sort toward the end.
- **In-place (S4):** the sort functions return the same array reference they
  sorted; the caller's array is mutated. `getSortedVariablePriceOverrideBrackets`
  returns a **fresh** `[]` only in the empty-overrides case.
- **Validation (S5):** `getSortedVariablePriceBrackets` and (for non-empty input)
  `getSortedVariablePriceOverrideBrackets` throw the S5 error if any element is
  not a valid `IVariableBasePrice`. The sort still happened (input mutated) before
  the throw.
- **Ranges (S6):** output element count equals input count; each output copies the
  input element's fields and adds `range`; branch order is exactly S6 (1→2→3→4).

## Error / edge behaviour

- Callers pass well-formed argument objects (the `subscription` shape, or a
  `vbpData` array). Passing `undefined`/wrong-shaped top-level arguments is out of
  scope and unguarded, matching the reference.
- `appendRange…` throws on a `null` `maxValue` that is not the last element (S6.1).
- The assert functions throw on element shape violations (S5). Non-numeric
  `maxValue` strings are **not** errors — they coerce to `NaN` (S1/S6) and are
  handled by the sort/range rules.
