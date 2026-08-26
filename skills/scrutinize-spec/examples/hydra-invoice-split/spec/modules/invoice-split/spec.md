# Module spec — `invoice-split`  (DERIVED — do not hand-edit)

> Compiled from `spec/modules/invoice-split/intent.md` (intent hash `bfc656d14e16`)
> by `tools/sdd-spec-from-intent.js`. The English intent is the sole review
> surface; this file, `constants.md`, and `fixtures/` are mechanical derivations
> and are regenerated whenever the intent changes.

## Behaviour

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

## Governing inputs

- `spec/standards/conventions.md` — governing standard
- `spec/contracts/invoice-split.contract.md` — signatures + guarantees
- `constants.md` — literal values (derived from intent)
- `fixtures/` — executable input→expected / property cases (derived from intent)

## Acceptance criteria

The generated implementation is valid iff every fixture in `fixtures/` passes
(exact `expect` and every `property`). Compiled from 18 acceptance example(s):

1. `roundFloatToCents(1.005)` => 1.01
2. `roundFloatToCents(2.675)` => 2.68
3. `roundFloatToCents(0.015)` => 0.02
4. `roundFloatToCents(1.004)` => 1
5. `roundFloatToCents(-0.01)` => -0.01
6. `roundFloatToCents(-2.675)` => -2.68
7. `roundFloatToCents(33.33333333)` => 33.33
8. `roundFloatToCents(1.001, "up")` => 1.01
9. `roundFloatToCents(1.009, "down")` => 1
10. `roundFloatToCents(25)` => 25  [{"roundsToCents":true}]
11. `evenlySplitWithCorrection(100, 4)` => [25,25,25,25]  [{"sumEquals":100}, {"length":4}]
12. `evenlySplitWithCorrection(100, 3)` => [33.33,33.33,33.34]  [{"length":3}, {"sumEquals":100}, {"allBetween":[33.33,33.34]}, {"roundsToCents":true}]
13. `evenlySplitWithCorrection(0.03, 2)` => [0.02,0.01]  [{"length":2}, {"sumEquals":0.03}]
14. `evenlySplitWithCorrection(100, 1)` => [100]
15. `evenlySplitWithCorrection(0, 3)` => [0,0,0]
16. `evenlySplitWithCorrection(99.99, 7)` => [14.28,14.28,14.28,14.28,14.29,14.29,14.29]  [{"length":7}, {"sumCloseTo":[99.99,2]}, {"roundsToCents":true}]
17. `evenlySplitWithCorrection(100, 13)` => [7.69,7.69,7.69,7.69,7.69,7.69,7.69,7.69,7.69,7.69,7.7,7.7,7.7]  [{"length":13}, {"sumEquals":100}]
18. `evenlySplitWithCorrection(10, 3)` => [3.33,3.33,3.34]  [{"roundsToCents":true}, {"sumEquals":10}]
