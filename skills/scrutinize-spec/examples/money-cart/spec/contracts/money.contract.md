# Contract — `money`

The interface `money` exposes to other modules. `cart` depends on this contract
and reaches `money` only through the signatures below — never into `money`'s
internals. All amounts are integer cents (standards C1).

| Function | Signature | Behaviour |
|---|---|---|
| `add` | `add(a: int, b: int) -> int` | `a + b` |
| `sub` | `sub(a: int, b: int) -> int` | `a - b` |
| `mul` | `mul(cents: int, qty: int) -> int` | `cents * qty` |
| `roundHalfEven` | `roundHalfEven(value: number) -> int` | nearest integer, `.5` ties to even (standards C5 `round_half_even`) |
| `format` | `format(cents: int) -> string` | `[-]$<whole>.<2 digits>` (standards C5 `format_currency` with `money`'s constants) |

**Error cases:** none defined. Per standards C3, inputs are assumed valid; there
are no exceptions to catch across this boundary.

**Consumers:** `cart` (`dependsOn: ["money"]`). No other module may depend on
`money` without adding itself here.
