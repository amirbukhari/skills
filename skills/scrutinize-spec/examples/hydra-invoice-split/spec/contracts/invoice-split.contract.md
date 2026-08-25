# Contract — `invoice-split`

Public TypeScript interface of the module. Types are the real Hydra types.

```ts
/** Round a float to a cents-valid number (2 dp). See standards S3. */
export const roundFloatToCents: (
  float: number,
  algorithm?: 'up' | 'down' | 'nearest', // default 'nearest'
) => number;

/**
 * Split `total` into `count` cents-valid parts that sum EXACTLY to `total`.
 * Remainder pennies are applied to the last parts. See standards S4.
 */
export const evenlySplitWithCorrection: (
  total: number,
  count: number,
) => number[];
```

## Behavioral guarantees (what a test / the fixtures pin)

`roundFloatToCents`
- Result has at most 2 decimal places: `Number(r.toFixed(2)) === r`.
- `'nearest'` rounds half **up** by magnitude (epsilon-corrected, S3); `'up'`/`'down'` are ceil/floor by magnitude; sign is preserved.

`evenlySplitWithCorrection`
- `result.length === count`.
- `sum(result) === total` for cent-valued totals (exact), or `≈ total` to 2 dp for totals with sub-cent error.
- Every element is cents-valid (S1/S3).
- When `count` divides `total` into equal cents, all elements are equal (no spurious correction).
- Corrections are applied to the highest indices first (S4), so the distribution is determined, not arbitrary.

## Error / edge behavior

- `count === 1` → `[roundFloatToCents(total)]`.
- `total === 0` → `count` zeros.
- Negative `total` is handled by S3's sign rule (magnitude rounded, sign reapplied); corrections use a negative unit.
- Invalid input (`count <= 0`, non-finite `total`) is **out of scope** — the Hydra function does not guard it and neither does this spec (standards S2 assumes valid input). No fixture covers it.

## Dependencies

`evenlySplitWithCorrection` depends only on `roundFloatToCents` (intra-module).
No other module, no external package. Runs under plain Node.
