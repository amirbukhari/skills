# Module — `money`

Integer-cents arithmetic, banker's rounding, and USD formatting. The only module
that formats amounts or rounds fractional values (standards C6). No dependencies.

Behaviour is defined for a reader by the contract in `contracts/money.contract.md`
and inherited standards; it is defined for the **generator** by the machine-
authoritative `spec-codegen` block below. The fenced block is the source of truth
for generation — editing it is what changes the generated `money.js`.

- `add` / `sub` / `mul` — integer arithmetic over cents (C1).
- `roundHalfEven` — reduce a fractional value to integer cents via the
  `round_half_even` intrinsic (C5). Used by `cart.tax`.
- `format` — render integer cents as `[-]$<whole>.<2 digits>` via the
  `format_currency` intrinsic, parameterised by this module's `currencySymbol`
  and `decimalPlaces` constants.

Every function is covered by an executable fixture in `fixtures/`.

```spec-codegen
{
  "module": "money",
  "inherits": ["standards/conventions.md"],
  "dependsOn": [],
  "functions": [
    {
      "name": "add",
      "params": ["a", "b"],
      "returns": "int",
      "body": { "op": "+", "args": [ { "param": "a" }, { "param": "b" } ] }
    },
    {
      "name": "sub",
      "params": ["a", "b"],
      "returns": "int",
      "body": { "op": "-", "args": [ { "param": "a" }, { "param": "b" } ] }
    },
    {
      "name": "mul",
      "params": ["cents", "qty"],
      "returns": "int",
      "body": { "op": "*", "args": [ { "param": "cents" }, { "param": "qty" } ] }
    },
    {
      "name": "roundHalfEven",
      "params": ["value"],
      "returns": "int",
      "body": { "intrinsic": "round_half_even", "arg": { "param": "value" } }
    },
    {
      "name": "format",
      "params": ["cents"],
      "returns": "string",
      "body": {
        "intrinsic": "format_currency",
        "arg": { "param": "cents" },
        "symbol": { "const": "currencySymbol" },
        "decimals": { "const": "decimalPlaces" }
      }
    }
  ]
}
```
