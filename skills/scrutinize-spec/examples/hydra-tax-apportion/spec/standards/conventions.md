# Standards — apportioned provincial tax

Load-bearing conventions for the `tax-apportion` module. This is a **decimal-
DEPENDENT** slice: its behaviour reads and returns the exact `tax_rate` string, so
it is only valid on a substrate where `decimal` columns read back as exact strings
(Postgres), not as lossy numbers (SQLite). Every rule fixes an exact behaviour.

## S1 — Applicable active rate selection

For a query `(date, provinceId)`, the applicable base rate is the row of
`TaxByProvince` where **all** hold:

- `provinceId = :provinceId`, and
- `hydraState = 'active'` (the enum value), and
- `effectiveFrom <= date`, and
- `effectiveUntil IS NULL OR effectiveUntil >= date` (inclusive both ends).

If several rows match, the applicable one is chosen by ordering **`effectiveFrom`
DESC, then `id` DESC** and taking the first (the most recently-effective, latest-id
row). If no row matches, there is no applicable rate.

Dates are ISO `YYYY-MM-DD` strings (lexicographic order = chronological).

## S2 — Exact-decimal rate parsing (`taxRateToMillionths`)

A rate string is converted to an integer number of **millionths** with no float
arithmetic:

1. `trimmed = String(rate ?? '0').trim()`.
2. If `trimmed` does not match `^\d+(\.\d+)?$` (a plain non-negative decimal),
   **throw** `ValidationError` with the exact message
   `` `A mass credit tax rate must be a non-negative decimal (got '${rate}').` ``
   (uses the original `rate`, not the trimmed value). Negative rates and any
   non-numeric text are rejected here.
3. Split `trimmed` on `"."` into `whole` and `fraction` (`fraction = ''` if absent).
4. Right-pad `fraction` with zeros and take the first 6 digits:
   `paddedFraction = `${fraction}000000`.slice(0, 6)`.
5. Return `intVal(whole + paddedFraction)`, where
   `intVal(x) = parseInt(String(x ?? ''), 10)`.

Examples: `'0.13'` → `130000`; `'13.005'` → `13005000`; `'13'` → `13000000`;
`'0.130000'` → `130000`; `'0.000001'` → `1`.

## S3 — Apportioned tax (`computeApportionedTaxMinorUnits`)

Given `amountMinorUnits` (an integer number of cents) and a rate string:

1. `rateMillionths = taxRateToMillionths(rate)` (S2).
2. `scaled = amountMinorUnits * rateMillionths` (integer product).
3. Return `Math.floor((scaled + 500000) / 1000000)`.

This is **half-up rounding on the exact integer product** — the resulting cent must
never depend on a float's last bit. Money is never multiplied by a float rate.

## S4 — Return shape and decimal fidelity

`computeApportionedProvincialTax` returns
`{ taxRate: string | null, taxMinorUnits: number }`:

- when S1 finds a row: `taxRate` is that row's **exact `tax_rate` string** (scale
  preserved, e.g. `'0.130000'` stays `'0.130000'`), and `taxMinorUnits` is S3
  applied to it;
- when S1 finds nothing: `{ taxRate: null, taxMinorUnits: 0 }` (no rate, no tax).

The exactness of `taxRate` is load-bearing: it is compared as a string. On a
substrate that returns `decimal` as a JS number (in-memory SQLite) this value would
be the wrong type and lossy — so this module **requires Postgres**, where the
column reads back as its exact string.

## S5 — Access pattern (read-only)

The function receives an initialised TypeORM `DataSource` and reads via
`dataSource.getRepository("TaxByProvince").createQueryBuilder("tbp")`. It performs
no writes and does not mutate its arguments.

## S6 — Purity of the arithmetic

`taxRateToMillionths` and `computeApportionedTaxMinorUnits` are pure integer
functions (no I/O, no `Date`, no randomness, no float multiplication of money by a
rate, no external packages). `ValidationError` is a plain `Error` subclass defined
in the module; `intVal` is implemented inline.
