# Module — `subscription-brackets`

Real Hydra billing logic lifted from
`packages/hydra-internal/src/subscriptionHelpers.ts`: sorting a subscription's
variable price brackets and labelling them with human-readable ranges. Five
interdependent pure functions over entity-shaped objects — a harder surface than
two scalar functions (multi-field domain inputs, an internal helper the other
functions call, in-place mutation, shape validation, and edge-heavy string
formatting).

**This module has no `spec-codegen` block.** Its behaviour is not expressible in
the money-cart template grammar (it needs `Array.prototype.sort` with a comparer,
`parseFloat`/`parseInt` coercion, `reduce`, spreads, and `throw`). It is generated
by the **LLM generation path** from the spec alone. The behavioural sources of
truth are:

- `standards/conventions.md` — S1 coercion, S2 purity, S3 comparer, S4 in-place
  sort, S5 shape validation, S6 range formatting
- `contracts/subscription-brackets.contract.md` — the exact TS signatures + guarantees
- `constants.md` — the literal values the rules reference
- `fixtures/` — executable input→expected and input→throws cases

## Functions

- `variablePriceSortComparer(a, b)` — S3. The primitive the others sort with.
- `getSortedPriceBracketsForSubscription(subscription)` — S4; overrides win over
  base, sorted in place.
- `getSortedVariablePriceBrackets(subscription)` — S4 + S5; base, sorted + asserted.
- `getSortedVariablePriceOverrideBrackets(subscription)` — S4 + S5; overrides,
  sorted + asserted, or `[]` when empty.
- `appendRangeToSortedPriceBracketsForSubscription(vbpData)` — S6; label each
  bracket with a `range` string.

## Acceptance

The generated implementation is valid iff every fixture in `fixtures/` passes
(exact `expect` and every `throws`). Beyond the fixtures, `tools/behavioral-diff.js`
sweeps a broad space of bracket arrays — numeric, decimal, negative, duplicate,
non-numeric, and `null` `maxValue`s, over array lengths 0…5, plus the override /
base selection and the range edge cases — and compares the generated output
**elementwise against the verbatim Hydra reference**, including the in-place
mutation (S4) and thrown errors. That is the proof the spec, not the source, drove
a behaviourally-identical implementation.

## Assumptions

- **Well-formed argument objects.** Callers pass the documented `subscription`
  shape (with the named array fields present) or a `vbpData` array. Malformed
  top-level arguments are out of scope and unguarded — the Hydra reference does not
  guard them and neither does the generated code (contract "Error / edge behaviour").
- **`maxValue` may be non-numeric.** Non-numeric or `null` `maxValue` strings are
  valid input, not errors: they coerce to `NaN` (S1/S6) and are ordered/labelled by
  the sort and range rules. Only *shape* violations (S5) throw.
- **In-place mutation is part of the contract.** The reference sorts the caller's
  array in place (S4); this is preserved deliberately, not treated as an
  implementation detail. If billing ever needed non-mutating sorts that is a spec
  change (S4), which would regenerate the code.
- **Execution** — the generated `.ts` runs under Node's native type-stripping
  (Node ≥ 23) or any TS toolchain; it uses only language built-ins, no packages (S2).
