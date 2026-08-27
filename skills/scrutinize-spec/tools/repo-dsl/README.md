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
| `miner.js` | AST/structural miner over a corpus, at **two granularities**: SMALL recurring bricks (statements, imports, sub-expressions) → **opaque ids** `p_xxxxxxxx`; COMPOSITE shapes (whole exported declarations / files) → also carried, but the library gives these **readable** names. Writes `catalog/patterns.json`. |
| `generators.js` | The generator library. **Leaves** (opaque ids) emit one mined brick each; params are `identifier` / `typeName` / `moduleSpecifier` / `identifierList` / `enumChoice` **only** — never prose. **Composites** (readable: `makeVolumeCostingCalculatorFn`, `makeDelegatingCostCalculatorFn`) emit **no raw code**; they return a tree of child generator nodes. Every generator backed by a mined pattern carries its `patternId`. |
| `expander.js` | Walks a composition tree → validates every leaf param against its declared type → emits code. The type validation is what makes "no free-text hole" real: a sentence, a newline-bearing blob, or raw code passed to any param is **rejected**. |
| `verify-coverage.js` | The falsifiable metric. Expands each composition, line-LCS diffs it against the **real committed file**, and reports the exact `%` reproduced + the exact lines composition could not reach. No rounding up. Also audits that used generators are backed by mined patterns. Writes `results/coverage.json`. |

## The concept, enforced (not just intended)

1. **Two-granularity mining** — `miner.js` records SMALL and COMPOSITE patterns separately.
2. **Each pattern → a deterministic generator** emitting that pattern's real code.
3. **Large generators are composed of smaller ones** — a composite's `build()` returns only child nodes; it never emits a string. Leaves are the floor.
4. **Leaves bottom out in small, typed, enumerable params** — enforced by the expander's validator. A leaf that would need free text is a **mining failure**, surfaced (see below), not papered over.
5. **Naming is strict** — small/leaf → opaque `p_xxxxxxxx`; large/composite → readable `makeX`. Readable names are the LLM's vocabulary; they expand into trees of ID leaves.

## Corpus & proof

Corpus (read-only): `src/rentsync-api/calculators/` in `billing-system` — 39 files.
Miner (min-count 2): **266 small** + **13 composite** recurring patterns; **264/266**
small patterns are typed-leaf-clean.

Three real calculators reproduced by **pure composition**, diffed against the real files:

| Target | Line coverage | Miss |
|---|---|---|
| `liftBuildingCostCalculator.ts` | **8/8 = 100%** | — |
| `volumeV2Calculators/activeFeatureCostCalculator.ts` | **13/14 = 92.9%** | trailing `// 15;` comment |
| `volumeV2Calculators/propertyVolumeV2CostCalculator.ts` | **13/14 = 92.9%** | trailing `// 14;` comment |

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

## Reproduce

```
cd skills/scrutinize-spec/tools/repo-dsl
npm install                       # typescript 5.4.5 (only dep; node_modules gitignored)
node miner.js /home/amir/Documents/Rentsync/billing-system/src/rentsync-api/calculators
node expander.js compositions/activeFeatureCostCalculator.json
node verify-coverage.js           # the coverage metric + generator-provenance audit
```

Additive to the existing SDD tools (`sdd-*.js`); nothing else is touched.
