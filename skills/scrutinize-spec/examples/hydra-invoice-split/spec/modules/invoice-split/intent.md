# Intent — invoice-split

This module does the two pieces of invoice money-math that Hydra needs when it
divides a bill: rounding a dollar amount to whole cents, and splitting a total
across N line items so the parts are each valid cents **and** add back up to the
original total exactly.

`roundFloatToCents(amount, algorithm = 'nearest')` rounds a JS number of dollars
to two decimal places. The default rounds half **up by magnitude** (so a
mathematically-exact half-cent like `1.005` becomes `1.01`, and `-2.675` becomes
`-2.68`), and it must be robust against IEEE-754 under-representation — the case
`2.675`, which floating point stores just below the true value, must still round
to `2.68`. Passing `'up'` always rounds a fractional cent up (ceil to cents) and
`'down'` always truncates it (floor to cents). A value that is already whole
cents comes back unchanged.

`evenlySplitWithCorrection(total, count)` returns an array of `count` amounts,
each rounded to cents, whose sum is exactly `total`. It rounds each share and
then distributes the leftover rounding error one cent at a time so nothing is
lost or invented: e.g. `100 / 3` gives two shares of `33.33` and one of `33.34`.
When rounding overshoots (e.g. `0.03 / 2`), the correction removes cents instead
of adding them. `count = 1` returns the whole total; a `total` of `0` returns all
zeros. Callers are trusted to pass a finite `total` and an integer `count >= 1`;
invalid input is out of scope and not guarded.

## Constants

```json
{
  "CENTS_DECIMALS": 2,
  "CORRECTION_UNIT": 0.01,
  "ROUND_EPSILON": 1e-10
}
```

- `CENTS_DECIMALS` — decimal places an amount is rounded to (cent multiplier `10 ^ 2 = 100`).
- `CORRECTION_UNIT` — one cent; the unit added or removed per correction, and the
  divisor that turns a leftover difference into a number of corrections.
- `ROUND_EPSILON` — the IEEE-754 nudge added before rounding so exact half-cents
  round up despite float under-representation (matches the Hydra reference `1e-10`).

## Acceptance examples

- roundFloatToCents(1.005) => 1.01                # half-cent rounds up via epsilon
- roundFloatToCents(2.675) => 2.68                # classic float case
- roundFloatToCents(0.015) => 0.02
- roundFloatToCents(1.004) => 1                   # below half rounds down
- roundFloatToCents(-0.01) => -0.01               # negative keeps sign
- roundFloatToCents(-2.675) => -2.68              # negative classic
- roundFloatToCents(33.33333333) => 33.33         # repeating decimal to nearest
- roundFloatToCents(1.001, "up") => 1.01          # algorithm 'up' ceils
- roundFloatToCents(1.009, "down") => 1           # algorithm 'down' floors
- roundFloatToCents(25) => 25 | roundsToCents=true   # already cents, stays valid
- evenlySplitWithCorrection(100, 4) => [25, 25, 25, 25] | sumEquals=100, length=4
- evenlySplitWithCorrection(100, 3) => [33.33, 33.33, 33.34] | length=3, sumEquals=100, allBetween=[33.33, 33.34], roundsToCents=true   # one penny to the tail
- evenlySplitWithCorrection(0.03, 2) => [0.02, 0.01] | length=2, sumEquals=0.03   # over-rounds then corrects down
- evenlySplitWithCorrection(100, 1) => [100]      # single item
- evenlySplitWithCorrection(0, 3) => [0, 0, 0]    # zero total
- evenlySplitWithCorrection(99.99, 7) => [14.28, 14.28, 14.28, 14.28, 14.29, 14.29, 14.29] | length=7, sumCloseTo=[99.99, 2], roundsToCents=true
- evenlySplitWithCorrection(100, 13) => [7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.69, 7.7, 7.7, 7.7] | length=13, sumEquals=100
- evenlySplitWithCorrection(10, 3) => [3.33, 3.33, 3.34] | roundsToCents=true, sumEquals=10
