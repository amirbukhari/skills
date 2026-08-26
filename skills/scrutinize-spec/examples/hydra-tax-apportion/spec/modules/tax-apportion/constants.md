# Constants — `tax-apportion`

Every load-bearing literal the rules reference, enumerated. No unpopulated values.

| Constant | Value | Used by | Meaning |
|---|---|---|---|
| `MILLIONTHS_SCALE` | `1000000` | S2, S3 | Fixed-point scale: a rate is stored as integer millionths; the product is divided by this. |
| `FRACTION_DIGITS` | `6` | S2 | Fractional digits kept from the rate string (right-padded, then truncated). |
| `HALF_UP_OFFSET` | `500000` | S3 | Added before the floor to round half-up on the integer product (`MILLIONTHS_SCALE / 2`). |
| `RATE_REGEX` | `^\d+(\.\d+)?$` | S2 | A valid rate is a plain non-negative decimal; anything else throws. |
| `RATE_DEFAULT` | `"0"` | S2 | Substituted for a nullish rate before trimming (`String(rate ?? "0")`). |
| `VALIDATION_MESSAGE` | `` `A mass credit tax rate must be a non-negative decimal (got '${rate}').` `` | S2 | Exact `ValidationError` message (interpolates the original rate). |
| `ACTIVE_STATE` | `"active"` | S1 | `hydraState` enum value selected. |
| `ENTITY_NAME` | `"TaxByProvince"` | S1, S5 | Repository name for provincial tax rows. |
| `TABLE_NAME` | `taxes_by_province` | reference | Underlying table. |
| `ORDER_BY` | `effectiveFrom DESC, id DESC` | S1 | Tie-break ordering to pick the applicable row. |
| `EMPTY_RESULT` | `{ taxRate: null, taxMinorUnits: 0 }` | S1, S4 | Returned when no rate applies. |

The generated code need not name these constants; it must reproduce the exact
literal values, the regex, the error message, and the ordering.
