# Module spec — `flatFeeCostCalculator`

> The **self-evolution** demo: the case the two mined-shaped words
> (`volumeCosting`, `delegatingCost`) could not express. The language was grown a
> new **hand-authored** word — `scalarProduct` (catalog v4) — and this module's
> DSL composition expands to the lean file deterministically, byte-identical, with
> no model spend. See `SELF-EVOLUTION.md` in the flat-fee experiment.

## Behaviour

`flatFeeCostCalculator(flatFee: number, count: number): number` returns the plain
scalar product `flatFee * count` — a flat per-unit fee times a count. There is
**no** filter, no `billingTypeId`, no shared-helper delegate, and no imports: none
of the volume-costing scaffolding the mined words carry. It is the minimal
"multiply two numbers and return" shape.

## Governing inputs

- Inputs: `flatFee` (number), `count` (number).
- Output: `number` (the product).
- No billing-type constant, element/cost interface, or shared helper.

## CODE-stage vocabulary

Emit a single DSL composition using the `scalarProduct` surface form (the
hand-authored domain word, catalog v4):

```
scalarProduct <exportName>
  multiply <multiply> by <by>
```

The composite emits only leaves (the authored scalar function header, the scalar
return, and the shared function-close leaf) — no raw code. It exists **because**
the frontier calculator could not be said in the mined vocabulary; adding the word
is the language growing, gated the same way every change here is gated.

## Acceptance criteria

The emitted `composition.calc` is valid iff it parses and type-checks against the
auto-derived DSL grammar (known composite, every param typed, no prose) and its
expansion is **byte-identical** to this module's `source.ts` (the 3-line lean
file). This is the "new word" case shown beside `activeFeatureCostCalculator`, the
"existing mined words" case.
