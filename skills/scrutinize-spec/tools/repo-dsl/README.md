# repo-dsl — the SDD CODE stage (generators composing generators)

The `CODE` stage of the SDD pipeline (`INTENT → SPEC → CODE → OUTPUT`). Instead
of an LLM writing a full implementation that fixtures then validate, the LLM
emits a **composition tree** and **deterministic generators** expand it into
real native code. The LLM's whole output surface is a tree of **readable**
generator names with **small, typed params**; there is no free-text / raw-code
hole anywhere in the expansion.

## The four pieces

| File | Role |
|---|---|
| `miner.js` | AST/structural miner over a corpus, at **three granularities**: SMALL recurring bricks (statements, imports, sub-expressions) → **opaque ids** `p_xxxxxxxx`; **MID** interior sub-trees (block bodies, closures, reshapes) mined by **recursing into composite interiors** and kept only when they repeat across **≥2 files**; COMPOSITE shapes (whole exported declarations / files) → **readable** names in the library. Also emits **hierarchy edges** (small ⊂ mid ⊂ large, via skeleton containment). Writes `catalog/patterns.json`. |
| `generators.js` | The generator library. **Leaves** (opaque ids) emit one mined brick each; params are `identifier` / `typeName` / `moduleSpecifier` / `identifierList` / `enumChoice` **only** — never prose. **Composites** are multi-level: a **MID** composite (`volumeCostingBody`, mined `p_16906662`) is built of leaves; a **LARGE** composite (`makeVolumeCostingCalculatorFn`, mined `p_c9fc5db5`) is built of the mid composite — a composite built of another composite, not a flat run of leaves. Composites emit **no raw code**; every mined-backed generator carries its `patternId`. |
| `expander.js` | Walks a composition tree → validates every leaf param against its declared type → emits code. The type validation is what makes "no free-text hole" real: a sentence, a newline-bearing blob, or raw code passed to any param is **rejected**. |
| `verify-coverage.js` | The falsifiable metric. Expands each composition, line-LCS diffs it against the **real committed file**, and reports the exact `%` reproduced + the exact lines composition could not reach. No rounding up. Also audits that used generators are backed by mined patterns. Writes `results/coverage.json`. |

## The concept, enforced (not just intended)

1. **Two-granularity mining** — `miner.js` records SMALL and COMPOSITE patterns separately.
2. **Each pattern → a deterministic generator** emitting that pattern's real code.
3. **Large generators are composed of smaller ones** — a composite's `build()` returns only child nodes; it never emits a string. Leaves are the floor.
4. **Leaves bottom out in small, typed, enumerable params** — enforced by the expander's validator. A leaf that would need free text is a **mining failure**, surfaced (see below), not papered over.
5. **Naming is strict** — small/leaf → opaque `p_xxxxxxxx`; large/composite → readable `makeX`. Readable names are the LLM's vocabulary; they expand into trees of ID leaves.

## Corpus & proof

Corpus (read-only): `src/rentsync-api/calculators/` in `billing-system` — **all 39 files**.
Miner (min-count 2): **266 small** + **26 mid** + **13 composite** recurring patterns;
**5/26** mid patterns are contained in a composite (real small→mid→large edges);
**264/266** small patterns are typed-leaf-clean.

Three real calculators reproduced by **pure composition**, diffed against the real files:

| Target | Line coverage | Generator-call depth | Miss |
|---|---|---|---|
| `liftBuildingCostCalculator.ts` | **8/8 = 100%** | 2 (large→leaf; no interior) | — |
| `volumeV2Calculators/activeFeatureCostCalculator.ts` | **13/14 = 92.9%** | **3 (large→mid→leaf)** | trailing `// 15;` comment |
| `volumeV2Calculators/propertyVolumeV2CostCalculator.ts` | **13/14 = 92.9%** | **3 (large→mid→leaf)** | trailing `// 14;` comment |

**Hierarchy.** The two volume calculators expand through a genuine middle tier: the
LARGE composite `makeVolumeCostingCalculatorFn` (mined `p_c9fc5db5`) is built out of
the MID composite `volumeCostingBody` (mined `p_16906662`, the function-body block that
recurs across both volume files), which is built out of the primitive leaves
(`p_bcbbcc46` filter, `p_bad2f718` delegate, `p_e8dacf98` return). `liftBuilding` stays
two-tier **honestly** — it is a one-line delegating arrow with no interior to mine.

### Where composition couldn't reach (the honest gap)

- **The two volume calculators lose exactly one line each**: the const's trailing
  inline comment `// 15;` / `// 14;`. Comments are **trivia, not AST nodes**, so the
  structural miner never sees them. Closing it would need a *trailing-numeric-comment*
  trivia leaf (a typed int, still not prose) — deliberately **not** added so the metric
  shows precisely where structural mining ends. The generated code is otherwise identical.
- **Corpus-wide mining failures, flagged not hidden**: the miner marked **2** small
  patterns (`p_606ad039`, `p_6ba74cf1`) as *not* typed-leaf-clean — they are TypeORM
  query-builder chains whose `.andWhere(\`…SQL…\`)` arguments are **template-literal SQL
  strings = genuine free text**. These are the leaves that *cannot* be reduced to typed
  params; a calculator built on them cannot be a pure composition without a new
  approach (parameterised query fragments). This is the concept's predicted failure
  mode, made concrete.

## The DSL surface layer (readable concrete syntax)

The JSON composition tree stays the internal IR; `dsl.js` adds a readable,
declarative surface that the LLM emits and a human reviews. The grammar is
**auto-derived from the generator signatures** (`deriveGrammar()` reads
`COMPOSITES` in `generators.js`) — not hand-authored: each composite's readable
name becomes a production, and each typed param becomes a named field whose
value syntax is fixed by its kind (`identifier`/`typeName`/`enumChoice` →
bareword, `moduleSpecifier` → quoted string, `identifierList` → `[a, b]`).
**Opaque leaf ids never appear in the surface** — leaves stay internal.

`activeFeatureCostCalculator` in the surface (`surface/activeFeatureCostCalculator.calc`):

```
makeVolumeCostingCalculatorFn {
  exportName = activeFeatureCostCalculator
  billingTypeConst = BILLING_TYPE_ACTIVE_FEATURE
  elemType = ISubscriptionUsage
  costType = ISubscriptionCost
  sharedFn = getVolumeCostingItems
  importElemFrom = '@src/rentsync-api/ISubscriptionUsage'
  importCostFrom = '@src/rentsync-api/ISubscriptionCost'
  importBillingFrom = '@llws/hydra-shared'
  importSharedFrom = './shared'
}
```

`dsl.js` provides a **parser** (`parseText`, DSL → tree) and a **printer**
(`printTree`, tree → DSL). `verify-dsl.js` proves they round-trip losslessly on
all three calculators: `tree → DSL → tree` is identity (canonical, key-order
insensitive), and `DSL → tree → expand` is byte-identical to `tree → expand`
(so the committed `.calc` and the JSON IR are two views of the same code). The
surface also inherits the typed guarantee — an opaque leaf id, an unknown field,
an unquoted module specifier, or a prose value are all **rejected at parse**.

```
node dsl.js --grammar                    # the auto-derived grammar
node dsl.js --print compositions/activeFeatureCostCalculator.json   # IR -> DSL
node dsl.js --parse surface/activeFeatureCostCalculator.calc        # DSL -> IR
node verify-dsl.js                        # lossless round-trip proof
```

## Reproduce

```
cd skills/scrutinize-spec/tools/repo-dsl
npm install                       # typescript 5.4.5 (only dep; node_modules gitignored)
node miner.js /home/amir/Documents/Rentsync/billing-system/src/rentsync-api/calculators
node expander.js compositions/activeFeatureCostCalculator.json
node verify-coverage.js           # the coverage metric + generator-provenance audit
```

Additive to the existing SDD tools (`sdd-*.js`); nothing else is touched.
