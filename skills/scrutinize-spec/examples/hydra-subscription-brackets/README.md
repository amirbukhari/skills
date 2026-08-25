# Example — `hydra-subscription-brackets` (Phase 3: a harder real surface)

The second real-billing proof, on a **harder surface** than two scalar functions.
Target: five interdependent pure functions lifted from
`billing-system/packages/hydra-internal/src/subscriptionHelpers.ts` —

- `variablePriceSortComparer(a, b)` — the comparer the others sort with.
- `getSortedPriceBracketsForSubscription(subscription)` — overrides win over base.
- `getSortedVariablePriceBrackets(subscription)` — base, sorted + shape-asserted.
- `getSortedVariablePriceOverrideBrackets(subscription)` — overrides, sorted +
  asserted, or `[]`.
- `appendRangeToSortedPriceBracketsForSubscription(vbpData)` — label each bracket
  with a human-readable `range` string.

Harder than `hydra-invoice-split` because it involves **entity-shaped objects**
(`IVariableBasePrice`), an **internal helper the other functions depend on**,
**in-place array mutation** (`Array.prototype.sort`), **runtime shape
validation** that throws, and **edge-heavy string formatting** — and because it
had **no existing Hydra tests**, so the fixtures were written from the spec, not
lifted.

## Behavioural subtleties the spec pins down (and the generation preserved)

- The comparer **never returns `0`**: equal valid values return `-1`, and the two
  `NaN` checks are order-sensitive (`NaN` `maxValue`s sort to the end). — S3
- Sorts are **in place**: the functions mutate the caller's array and return that
  same reference. — S4
- The asserts throw an **exact** error message on any element shape violation. — S5
- Range formatting has **ordered branches** (null-not-last throws; null-last →
  `${prev+1}+`; index 0 → `1 - N` or `N`; else `${prev+1} - N`), with `parseInt`
  coercion so a non-numeric `maxValue` yields the literal `"NaN"`. — S6

## Why this is the LLM path (not the template grammar)

The behaviour needs `Array.prototype.sort` with a comparer, `parseFloat`/`parseInt`
coercion, `reduce`, spreads, and `throw` — none expressible in the money-cart
template grammar. So there is **no `spec-codegen` block**; the module is generated
by the LLM path. The spec is the source of truth:

- `spec/standards/conventions.md` — S1 coercion, S2 purity, S3 comparer, S4
  in-place sort, S5 validation, S6 range formatting
- `spec/contracts/subscription-brackets.contract.md` — exact TS signatures + guarantees
- `spec/modules/subscription-brackets/` — `spec.md`, `constants.md`, `fixtures/`
- `reference/subscription-brackets.reference.ts` — the verbatim Hydra logic (with
  the two upstream imports `floatVal` and `assertIVariableBasePriceArray` inlined
  by their exact definitions), used ONLY as the behavioural oracle
- `generated/subscription-brackets.ts` — produced from the spec by the `claude`
  CLI, fixtures **and** reference withheld from the prompt

## The proof (reproduce)

From `skills/scrutinize-spec/`:

```
node scripts/score.js examples/hydra-subscription-brackets/.analysis/subscription-brackets.json
node tools/sdd-build.js examples/hydra-subscription-brackets --scrutinize-stub --min-score 85 --model claude-sonnet-4-5
node examples/hydra-subscription-brackets/tools/verify.js
node examples/hydra-subscription-brackets/tools/behavioral-diff.js
node tools/sdd-check.js examples/hydra-subscription-brackets
```

| Check | Result |
|---|---|
| **Scrutinize score** (document mode) | **90.0**, `cappedBy: []` — no gate binds |
| Generation | claude CLI, **fixtures + reference withheld**, passed on **attempt 1** |
| **Fixtures** (exact + throws) | **28/28** pass |
| **Behavioral diff** vs verbatim Hydra reference | **23,477 comparisons, ZERO divergences** — return-value, thrown-error, in-place-mutation, and array-identity parity, over all 5 functions across bracket arrays of length 0–4 (numeric, decimal, negative, duplicate, non-numeric, `null`), the override/base selection, and the range edge cases |
| Drift (`sdd-check`) | in sync |

The CLI saw the spec but not the fixtures and not the reference, and still
reproduced the real Hydra billing behaviour exactly — including the deliberately
non-standard comparer and the in-place mutation.

## Honest limits of this proof

- **Still pure functions.** Harder than invoice-split (entity-shaped objects,
  mutation, validation, internal dependency), but no DB, HTTP, or async. Entities
  and routers need an execution substrate for fixtures (in-memory SQLite via
  TypeORM, a disposable test Postgres, or mocked repositories) — an architecture
  decision, and the next boundary.
- **Fixtures derived from the reference.** With no existing Hydra tests, the
  fixtures' expected values were computed from the verbatim reference (the
  behavioural oracle), then withheld from the generator. The behavioral-diff sweep
  is the independent, denser check.
- **`isNaN` vs `Number.isNaN`.** The generation used `isNaN`; since `floatVal`
  always returns a number, the two agree here (the sweep confirms zero
  divergences). On non-number inputs they would differ — not reachable given S1.
