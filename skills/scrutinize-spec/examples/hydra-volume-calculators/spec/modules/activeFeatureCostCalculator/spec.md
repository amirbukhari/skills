# Module spec — `activeFeatureCostCalculator`

> The review surface for a Hydra volume-costing **cost calculator**. The CODE
> stage does not hand-write the implementation: `tools/repo-dsl/sdd-code-from-spec.js`
> has the model emit a **DSL composition** (`composition.calc`) against the mined
> generator library, and the deterministic generators expand it to native code.

## Behaviour

`activeFeatureCostCalculator(usages: ISubscriptionUsage[]): ISubscriptionCost[]`
is a **volume-costing** calculator for the `ACTIVE_FEATURE` billing type.

It follows the shared volume-costing shape used across the cost calculators:

1. Bind the billing-type id from the `ACTIVE_FEATURE` billing-type constant.
2. Filter the incoming `usages` down to the rows whose `billingTypeId` matches
   that constant (the incoming data is assumed to already be filtered for the
   billing type — the filter is defensive).
3. Delegate the filtered subscriptions to the shared `getVolumeCostingItems`
   helper, passing the billing-type id, and return its `ISubscriptionCost[]`.

This is the `volumeCosting` surface form: a filter-by-billing-type followed by a
hand-off to the shared volume-costing helper.

## Governing inputs

- Billing-type constant: `ACTIVE_FEATURE` (imported from `@llws/hydra-shared`).
- Element type: `ISubscriptionUsage`; cost type: `ISubscriptionCost`.
- Shared helper: `getVolumeCostingItems` (from the sibling `./shared`).

## CODE-stage vocabulary

Emit a single DSL composition using the `volumeCosting` surface form. The
positional grammar (auto-derived from the generator signatures) is supplied to
the generator alongside this spec; the composition names the export, the element
and cost types (`ElemType -> CostType`), the billing-type suffix, and the shared
delegate (`via <fn>`). Module specifiers are resolved from the mined import map
and must not appear unless a symbol is genuinely ambiguous.

## Acceptance criteria

The emitted `composition.calc` is valid iff it parses and type-checks against the
auto-derived DSL grammar (known composite, every param typed, no prose) and its
expansion is byte-identical to the module's generated file.
