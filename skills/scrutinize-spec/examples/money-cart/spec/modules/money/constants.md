# Constants — `money`

Every literal value `money` needs, with a concrete value. The generator inlines
these into the generated code, so changing a value here and regenerating changes
`generated/money.js`.

```json
{
  "currencySymbol": "$",
  "decimalPlaces": 2,
  "roundingMode": "half_even"
}
```

- `currencySymbol` — prefix used by `format` (after any minus sign).
- `decimalPlaces` — number of fractional digits `format` emits; also fixes the
  cents divisor as `10 ^ decimalPlaces`.
- `roundingMode` — documents the rule `roundHalfEven` implements. Fixed at
  `half_even`; the `round_half_even` intrinsic (standards C5) is its realisation.
