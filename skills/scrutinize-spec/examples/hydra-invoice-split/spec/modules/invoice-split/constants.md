# Constants — `invoice-split`

```json
{
  "CENTS_DECIMALS": 2,
  "CORRECTION_UNIT": 0.01,
  "ROUND_EPSILON": 1e-10
}
```

- `CENTS_DECIMALS` — decimal places an amount is rounded to (S1/S3). Fixes the
  cent multiplier as `10 ^ CENTS_DECIMALS = 100`.
- `CORRECTION_UNIT` — one cent; the unit added/removed per correction in S4, and
  the divisor that turns a leftover `diff` into a number of corrections.
- `ROUND_EPSILON` — the IEEE-754 correction added to the cent count before
  rounding in S3, so mathematically-exact half-cents round up despite float
  underrepresentation. Matches the Hydra reference (`1e-10`).
