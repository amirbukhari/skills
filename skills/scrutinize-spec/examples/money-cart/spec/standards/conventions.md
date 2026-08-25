# Standards — money-cart conventions

Durable conventions inherited by **every** module in this spec folder. A module
declares `"inherits": ["standards/conventions.md"]` in its codegen block and is
scored against this document together with its own spec. Modules must **not**
restate anything defined here.

## C1 — Amounts are integer cents

Every monetary amount is an integer number of cents. There are no floating-point
dollars anywhere in a function signature or return value. A value that is
conceptually fractional cents (e.g. an intermediate tax computation) is a plain
`number` and must be reduced to an integer via the `round_half_even` intrinsic
before it is treated as an amount again.

## C2 — Functions are pure

Every function specified in this folder is a pure function of its arguments:
no I/O, no wall-clock time, no randomness, no mutation of its inputs, no global
state. This is what makes the generated code a pure function of the spec and the
fixtures a complete acceptance oracle.

## C3 — Input is assumed valid

Functions assume their inputs already satisfy the declared parameter types.
Input validation, coercion, and error signalling are **out of scope** for this
example (see `unspecified.md`); a function given malformed input has undefined
behaviour and no fixture covers that case.

## C4 — The codegen value grammar

Each function body in a module's `spec-codegen` block is a **value node** drawn
from this closed grammar. The generator (see `regenerate.md`) is a deterministic
renderer of this grammar and nothing else:

| Node | Shape | Meaning |
|---|---|---|
| parameter | `{"param": "<name>"}` | one of the function's declared params |
| literal | `{"lit": <number>}` | a numeric literal written inline |
| constant | `{"const": "<name>"}` | a value resolved from the owning module's `constants.md`, inlined literally into the generated code |
| arithmetic | `{"op": "+"\|"-"\|"*"\|"/", "args": [<node>, <node>]}` | binary arithmetic, rendered as `(a op b)` |
| local call | `{"call": {"fn": "<name>"}, "args": [<node>...]}` | call another function in the same module |
| cross-module call | `{"call": {"module": "<m>", "fn": "<name>"}, "args": [<node>...]}` | call a function in a module named in `dependsOn`, through its contract |
| intrinsic | `{"intrinsic": "<name>", ...}` | a named, canned operation the generator implements (C5) |

## C5 — The intrinsic catalogue

Intrinsics are the fixed primitive operations the generator knows how to emit.
A module may only use an intrinsic named here. Adding a new primitive is a change
to the generator + this catalogue, not something a module can invent.

| Intrinsic | Shape | Contract |
|---|---|---|
| `round_half_even` | `{"intrinsic":"round_half_even","arg":<node>}` | round the node's numeric value to the nearest integer; exact `.5` ties go to the even integer (banker's rounding). |
| `format_currency` | `{"intrinsic":"format_currency","arg":<node>,"symbol":{"const":"..."},"decimals":{"const":"..."}}` | render an integer-cents value as `[-]<symbol><whole>.<fraction>`, where the fraction is `decimals` digits, zero-padded, and `whole = floor(abs / 10^decimals)`. No thousands separators. |
| `sum_line_items` | `{"intrinsic":"sum_line_items","arg":{"param":"..."}}` | given an array of `{unitPrice, quantity}` (both integers), return `Σ unitPrice * quantity` as an integer. Iteration order does not affect the result. |

## C6 — Module boundaries

Only the `money` module formats amounts for display and rounds fractional values.
Any other module that needs those behaviours calls `money` through its contract
in `contracts/`; it never re-implements them. This keeps a single owner for each
behaviour (see `partitionIntegrity` in the folder rubric).
