# Module — `cart`

Turns line items into a subtotal, tax, and total. Depends on `money` (through
`contracts/money.contract.md`) for rounding and addition — it never re-implements
them (standards C6). All amounts are integer cents (C1).

The `spec-codegen` block below is the source of truth for generation. `cart`'s
`dependsOn` names `money`, which is what makes the generated `cart.js` `require`
the generated `money.js`, and what the folder rubric checks for dependency cycles.

- `subtotal(items)` — `Σ unitPrice * quantity` over the line items, via the
  `sum_line_items` intrinsic (C5). A line item is `{ unitPrice: int, quantity: int }`.
- `tax(subtotalCents, taxRateBps)` — tax at `taxRateBps` basis points, i.e.
  `round_half_even(subtotalCents * taxRateBps / basisPointsDivisor)`, rounded via
  **`money.roundHalfEven`**. The rate is a caller-supplied input, not a constant,
  so `cart` carries no business policy.
- `total(subtotalCents, taxCents)` — `money.add(subtotalCents, taxCents)`.

Every function is covered by an executable fixture in `fixtures/`.

```spec-codegen
{
  "module": "cart",
  "inherits": ["standards/conventions.md"],
  "dependsOn": ["money"],
  "functions": [
    {
      "name": "subtotal",
      "params": ["items"],
      "returns": "int",
      "body": { "intrinsic": "sum_line_items", "arg": { "param": "items" } }
    },
    {
      "name": "tax",
      "params": ["subtotalCents", "taxRateBps"],
      "returns": "int",
      "body": {
        "call": { "module": "money", "fn": "roundHalfEven" },
        "args": [
          {
            "op": "/",
            "args": [
              { "op": "*", "args": [ { "param": "subtotalCents" }, { "param": "taxRateBps" } ] },
              { "const": "basisPointsDivisor" }
            ]
          }
        ]
      }
    },
    {
      "name": "total",
      "params": ["subtotalCents", "taxCents"],
      "returns": "int",
      "body": {
        "call": { "module": "money", "fn": "add" },
        "args": [ { "param": "subtotalCents" }, { "param": "taxCents" } ]
      }
    }
  ]
}
```
