# Standards — invoice-split conventions

Durable conventions for this module. Unlike the money-cart example (integer
cents), this slice mirrors the real Hydra code: amounts are **JavaScript
`number` dollars** rounded to cents, because that is what the billing repo does.

## S1 — Amounts are float dollars, rounded to cents

An amount is a JS `number` representing dollars (e.g. `33.34`), not integer
cents. Values that must be currency-valid are reduced to 2 decimal places via the
rounding primitive S3. Float representation error is expected and is the reason
S3 exists.

## S2 — Functions are pure

Every function here is a pure function of its arguments: no I/O, no `Date`, no
randomness, no mutation of inputs, no global state. This is what makes the
committed fixtures a complete acceptance oracle and the behavioral diff against
the Hydra reference meaningful.

## S3 — The cents-rounding rule (load-bearing)

`roundFloatToCents(float, algorithm)` reduces a float to a cents-valid number:

1. Let `mag = |float|` and `sign = float < 0 ? -1 : 1`.
2. Select a rounder by `algorithm`: `'nearest' → round-half-up`, `'up' → ceil`,
   `'down' → floor`. Rounding is applied to the **cent count** `mag * 100`.
3. Before rounding, add `ROUND_EPSILON` (constants) to `mag * 100` to correct
   IEEE-754 underrepresentation, so a value mathematically equal to `x.xx5`
   (e.g. `1.005`) rounds up rather than down. This epsilon is why the result is
   robust to float error and is **required** for behavioral parity.
4. The cent count is an integer; the result is `centCount / 100 * sign`.

Determined cases this rule fixes precisely:
- `roundFloatToCents(1.005) === 1.01` (epsilon lifts `100.4999…` to round up).
- `roundFloatToCents(-0.01) === -0.01` (magnitude rounded, sign reapplied).
- `roundFloatToCents(0.015) === 0.02`.

## S4 — The correction-distribution rule (load-bearing)

`evenlySplitWithCorrection(total, count)` splits `total` into `count` cent-valid
parts that sum **exactly** to `total`:

1. `unrounded = total / count`; build `count` parts each `= roundFloatToCents(unrounded)`.
2. `diff = roundFloatToCents(total − Σ parts)` — the leftover, positive or negative.
3. `numCorrections = min(count, round(|diff| / CORRECTION_UNIT))`.
4. `correctionUnit = diff > 0 ? +CORRECTION_UNIT : −CORRECTION_UNIT`.
5. Apply the correction to the **last `numCorrections` parts** (highest indices):
   each becomes `roundFloatToCents(part + correctionUnit)`. Earlier parts are
   unchanged. Iteration order is fixed: corrections land on the tail of the array.

The tail-distribution choice is contractual (a reader must not guess which parts
absorb the remainder); the exact per-part values follow from it deterministically.
