# Standards — subscription price brackets

Load-bearing conventions for the `subscription-brackets` module. Every rule here
is executable: it fixes an exact input→output behaviour, not a preference.

## S1 — Numeric coercion (`floatVal`)

A bracket's `maxValue` is `string | null`. To compare brackets numerically,
coerce it with the following total rule (the Hydra `floatVal`):

- if the value is already a JavaScript `number`, use it unchanged;
- otherwise compute `parseFloat(String(value ?? ""))`.

Consequences that MUST hold:

- `null` coerces via `parseFloat("")` → **`NaN`**.
- A leading-numeric string coerces to its numeric prefix: `"12.5abc"` → `12.5`.
- A non-numeric string (`"abc"`, `""`) → **`NaN`**.
- No rounding, no locale parsing, no thousands separators.

## S2 — Purity and zero dependencies

Every function is pure: no I/O, no `Date`, no randomness, no external packages —
language built-ins only. `floatVal` and the shape validation (S5) are implemented
**inline** in the module; they are not imported.

## S3 — Bracket sort comparer

`variablePriceSortComparer(a, b)` returns a number for `Array.prototype.sort`,
computed from `A = floatVal(a.maxValue)` and `B = floatVal(b.maxValue)` in this
exact order:

1. if `A` is `NaN` → return `1`;
2. else if `B` is `NaN` → return `-1`;
3. else return `A > B ? 1 : -1`.

This is deliberately **not** a standard total-order comparer:

- Equal valid values return `-1` (never `0`) — this is intentional and MUST be
  preserved; do not "fix" it to return `0`.
- The order of the two `NaN` checks matters: if `A` is `NaN` the function returns
  `1` **regardless of `B`** (even when `B` is also `NaN`).
- Net effect: brackets with a non-numeric/`null` `maxValue` sort toward the end.

## S4 — Sorts are in place (mutation)

The sorting functions call `Array.prototype.sort` directly on the caller's array
and return that **same array reference**. Sorting therefore **mutates the input
array** in place. The generated code MUST preserve this: it may not sort a copy.
After a call, the input array is in sorted order and the return value is
identical (`===`) to the input array that was sorted.

## S5 — Shape validation (`assertIVariableBasePriceArray`)

Some functions assert their result is an array of valid `IVariableBasePrice`
before returning it. An object is a valid `IVariableBasePrice` iff it is a
non-null object with:

- `id`: `number`
- `maxValue`: `string` or `null`
- `basePrice`: `string`
- `costPerUnit`: `string` or `null`

If **any** element fails this check the function throws
`Error("Invalid IVariableBasePrice array. Expected an array containing only valid IVariableBasePrice objects.")`.
An empty array passes the check (vacuously). The assertion runs **after** sorting,
so the input is still mutated even when the assertion then throws.

## S6 — Range-string formatting

`appendRangeToSortedPriceBracketsForSubscription(vbpData)` maps an already-sorted
array to new objects that copy every field of the input element and add a
`range: string`. For each element at `index` in `array`, with

- `currentMaxValue = parseInt(curr.maxValue ?? "0", 10)`
- `previousMaxValue = parseInt(array[index - 1]?.maxValue ?? "0", 10)`

apply these branches **in this order** (first match wins):

1. if `curr.maxValue === null` **and** `index !== array.length - 1` → **throw**
   `Error("Null max value must be the last item in the array.")`.
2. else if `index === array.length - 1` **and** `curr.maxValue === null`
   → `range = `${previousMaxValue + 1}+``.
3. else if `index === 0`
   → `range = currentMaxValue > 1 ? `1 - ${currentMaxValue}` : `${currentMaxValue}``.
4. else → `range = `${previousMaxValue + 1} - ${currentMaxValue}``.

Notes that MUST hold:

- Coercion is `parseInt(… , 10)` (integer, base 10), distinct from S1's `parseFloat`:
  `"12.9"` → `12`, `"10px"` → `10`, `"abc"` → `NaN` (so the range can contain
  `"NaN"` — this matches the reference and is not guarded).
- `array[index - 1]` at `index === 0` is `undefined`, so `previousMaxValue` there
  is `parseInt("0", 10) = 0` (used only by branch 4, never at index 0).
- Field copy is a shallow spread of `curr` **then** `range`; input objects are not
  mutated (a new object per element).
- The result is built with `reduce(..., [])` — output length equals input length
  (except when branch 1 throws).
