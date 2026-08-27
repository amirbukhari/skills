# repo-dsl — the SDD CODE stage (generators composing generators)

The `CODE` stage of the SDD pipeline (`INTENT → SPEC → CODE → OUTPUT`). Instead
of an LLM writing a full implementation that fixtures then validate, the LLM
emits a **composition tree** and **deterministic generators** expand it into
real native code. The LLM's whole output surface is a tree of **readable**
generator names with **small, typed params**; there is no free-text / raw-code
hole anywhere in the expansion.

There are **two layers** here. The **production engine** (`engine/` + the
`repo-dsl` CLI) mines an entire directory automatically with an LZW core and
reports honest coverage; the **curated layer** (`generators.js`, `dsl.js`,
`compositions/`, `surface/`) is the hand-verified, byte-exact vocabulary that the
DSL surface is authored in. Start with the engine.

## Production engine: fan-out → LZW → generators → DSL → expand → verify

A single CLI (`repo-dsl.js`) runs the pipeline over a whole calculators directory.
The stages are named in the code:

| Stage | Module | What it does |
|---|---|---|
| **1. Fan-out** | `engine/fanout.js` | Linearize each file's TypeScript AST into a canonical pre-order **token stream**. The AST *cuts* the stream (a statement owning a block — function/arrow bodies, if/else, loops, callbacks — splits into a `… {` head, its inner statements, and a `} …` tail), and the lexical scanner *normalizes* each token's slice into a whitespace-insensitive **shape** (structural token-kinds with identifiers/numbers/strings replaced by typed slots `ID`/`NUM`/`STR`), the ordered **slot bindings**, and a **template** that refills to the exact original bytes. Token spans + gaps tile the file exactly (lossless). |
| **2. LZW mining** | `engine/lzw.js` | An LZW-style dictionary builder over the shape streams of **every** file. The incrementally grown dictionary **is** the pattern set: the alphabet is the distinct shapes; encoding grows multi-symbol entries, each referencing an earlier entry + one symbol, giving the natural **small ⊂ mid ⊂ large** hierarchy; frequencies are kept. `segment()` re-encodes greedily against the final dictionary to attribute tokens to the largest pattern that covers them. |
| **3. Generators** | `engine/pipeline.js` | Promote every dictionary entry above the frequency threshold into a **generator**. Length-1 entries → **opaque-id leaves** (`p_xxxxxxxx`) with typed params; length-≥2 entries → **readable composites** that reference smaller entries (**composites of composites**, all the way down to leaves). No generator emits raw code. Anything irreducible (a `NoSubstitutionTemplateLiteral` carrying SQL for a TypeORM `andWhere`, prose, etc.) surfaces as an **unmined residue**, flagged not papered over. |
| **4. DSL surface** | `dsl.js` | The readable concrete syntax over the composition tree (see below), auto-derived from generator signatures, with mined import resolution. |
| **5. Expand** | `expander.js` | Walk a composition/DSL tree → validate typed params → emit native code. |
| **6. Verify + gate** | `repo-dsl.js` | Per-file + corpus **coverage** (chars reproduced by pure composition), **residue** classes, byte-identity **plumbing** check, and a machine-readable **coverage gate** for wiring into the SDD flow. |

### Coverage — the honest metric

A token counts as **reproduced** iff its shape **recurs** (mined ≥ `minCount`),
**all** its slots are **typed** (small ident / type / number / short string —
never prose or embedded SQL), *and* the shape's canonical (plurality) template
refills to that token's **exact** source bytes. Everything else is **residue**,
classified so nothing hides:

- **A — non-recurring shape**: genuinely unique/bespoke logic (the bulk, across 39 diverse calculators).
- **B — free-text slot**: a long/multiline string slot, e.g. TypeORM `andWhere(\`…SQL…\`)` — the irreducible free text the concept predicts.
- **C — comment/trivia**: comments between tokens (not AST nodes).
- **D — formatting variance**: a recurring, typed shape whose *this* occurrence is spaced differently from the plurality template.

Coverage is `reproducedChars / totalChars` — **no rounding up**. A file that
doesn't reduce lowers its own number and grows a residue class; it never crashes
the run.

### CLI

```
node repo-dsl.js mine   [<dir>] [--min N]           # fan-out+LZW+promote; writes catalog/mined-library.json + results/corpus-coverage.json
node repo-dsl.js gate   [<dir>] --min P [--min-file Q] [--no-mine]  # pass/fail on corpus coverage; results/gate.json; exit 1 on fail
node repo-dsl.js verify [<dir>]                     # byte-identity plumbing: every file reconstructs exactly from its tokens
node repo-dsl.js verify-expand <calc> [--against F] [--min P]  # PER-MODULE gate: expand one .calc, byte-diff vs its target
node repo-dsl.js expand  <file.calc|composition.json>  # curated surface -> native code
node repo-dsl.js explain <file.calc|composition.json>  # the GENERATOR TREE a composition invokes (machine JSON, for the panel)
node repo-dsl.js report                             # reprint the last rollup
```

`<dir>` defaults to the Hydra calculators corpus (read-only). The `gate` command
is the SDD hook — same spirit as the scrutinize gate: it emits machine-readable
JSON (`{pass, source, corpusCoveragePct, worstFile, generators, thresholds}`) and
a non-zero exit on failure. `--no-mine` makes `gate` read the persisted
`catalog/mined-library.json` + `results/corpus-coverage.json` from the last
`mine` instead of re-mining the whole corpus each call (snappy on a large corpus;
`"source": "persisted"` in the JSON records which path ran). Default behaviour
(mine every call) is unchanged.

### Per-module gate — `verify-expand`

The corpus `verify`/`gate` look at the whole directory; `verify-expand` gives the
panel a **true per-module verdict**. It expands one `.calc` and byte-diffs the
result against the module's target — an explicit `--against <file>`, or by default
the module's generated file (`generated/<module>.ts`, resolved from a
`spec/modules/<m>/composition.calc` path). Machine JSON:

```json
{ "schema": "sdd-repo-dsl/verify-expand/1", "pass": true, "module": "activeFeatureCostCalculator",
  "target": "…/generated/activeFeatureCostCalculator.ts", "byteIdentical": true, "coveragePct": 100,
  "residueClasses": { "A": 0, "B": 0, "C": 0, "D": 0 }, "min": 100, "residue": [] }
```

`byteIdentical` (strict `===`) is reported **independently** of `pass`
(`coveragePct >= --min`, default 100), so the panel can distinguish "exact" from
"exact-modulo-trivia". Every unreproduced target line is classified with the same
residue legend as the corpus engine (A non-recurring/bespoke · B free-text/SQL ·
C comment/trivia · D formatting). Against the **real Hydra source**, `activeFeature`
reports `byteIdentical:false, coveragePct:91.9, C:57` — the single trailing `// 15;`
editorial comment, correctly classified **C** and nothing papered over; against its
generated file it is `byteIdentical:true, 100%`.

### Generator tree — `explain`

`explain` emits, as stable machine JSON, the generator tree a composition
**actually invokes** — the readable composites and the opaque leaf IDs beneath
them, each with its typed param **signature** (declared kinds) and the concrete
**args** bound at this call site, in nesting order (large → mid → leaf). This
feeds the panel's "Generators" section, which shows only the generators a given
composition uses (full library one click away). Structural `gap`/`indent` nodes
are elided; indentation is transparent. Shape:

```json
{ "schema": "sdd-repo-dsl/explain/1", "module": "activeFeatureCostCalculator",
  "composite": "makeVolumeCostingCalculatorFn",
  "tree": {
    "kind": "composite", "name": "makeVolumeCostingCalculatorFn", "tier": "composite", "label": "…",
    "signature": { "exportName": "identifier", "elemType": "typeName", "…": "…" },
    "args":      { "exportName": "activeFeatureCostCalculator", "elemType": "ISubscriptionUsage", "…": "…" },
    "children": [
      { "kind": "leaf", "id": "p_2c6b9735", "tier": "leaf", "label": "named-import (single specifier)",
        "signature": { "name": "identifier", "from": "moduleSpecifier" },
        "args": { "name": "BILLING_TYPE_ACTIVE_FEATURE", "from": "'@llws/hydra-shared'" } },
      { "kind": "composite", "name": "volumeCostingBody", "tier": "mid", "children": [ … leaves … ] }
    ]
  },
  "generators": { "composites": [ { "name", "tier", "label", "signature" } ],
                  "leaves":     [ { "id",   "tier", "label", "signature" } ] },
  "counts": { "composites": 2, "leaves": 8, "leafInstances": 11, "maxDepth": 2 } }
```

For `activeFeatureCostCalculator` this is the genuine three-tier tree: the large
`makeVolumeCostingCalculatorFn` → the mid `volumeCostingBody` → the primitive
leaves (`p_bcbbcc46` filter, `p_bad2f718` delegate, `p_e8dacf98` return), plus the
import/const/struct leaves.

### Closing the loop — `sdd-code-from-spec` (the composition emitter)

`sdd-code-from-spec.js` is the CODE-stage sibling of `tools/sdd-spec-from-intent.js`
(same CLI shape, verdict line, and exit codes), one stage downstream. It is the
**"model emits DSL"** step that closes `intent → spec → .calc → expand`:

```
node sdd-code-from-spec.js <exampleDir> [--module m] [--stub <file>] [--model <id>] [--verify]
```

It reads `spec/modules/<m>/spec.md` plus the auto-derived DSL grammar + mined
generator vocabulary, and has a generator emit `spec/modules/<m>/composition.calc`.
Backends mirror `sdd-generate`: default shells out to the `claude` CLI (real
emission); `--stub <file>` emits a file verbatim (zero-cost double). **Deterministic
guard** (the trustworthy seam, exactly like the fixtures guard upstream): after
emission the candidate is **parsed against the grammar and fully expanded** —
rejecting an unknown composite, an unknown marker, prose, or any untyped param —
**before anything is written**. On violation the module FAILs (non-zero exit) and
no `.calc` is written; on success the **canonical `printTree` form** is written
(lossless round-trip), so the committed artifact is deterministic even though a
model chose its content. `--verify` additionally runs `verify-expand` and folds
`pass`/coverage/`byteIdentical` into the verdict. Provenance (spec hash → `.calc`
hash → composite) is stamped in `.sdd-code-provenance.json`.

Proven end-to-end on `activeFeatureCostCalculator`: the live `claude` CLI emitted
exactly `volumeCosting activeFeatureCostCalculator / ISubscriptionUsage ->
ISubscriptionCost / billingType ACTIVE_FEATURE via getVolumeCostingItems`, it
passed the grammar guard, and `verify-expand` confirmed its expansion is
byte-identical to the generated file (`cov=100% byteIdentical=true`).

### Full-corpus result (39 files, `--min 2`)

- **Corpus coverage: 30.5%** of source chars reproduced by pure composition.
- **Generators: 173 leaves + 33 composites**, of which **6 are composite-of-composite** (max hierarchy depth **4**); alphabet 667 shapes, 1852 dictionary entries.
- **Residue chars**: A (non-recurring) 90 493 · B (free-text/SQL) 5 503 · C (comment/trivia) 26 931 · D (formatting) 2 555.
- **Byte-identity plumbing: 39/39** files reconstruct exactly from their token stream.
- Small delegating calculators reduce to **~99%**; bespoke-logic and pure-interface files (e.g. `tieredUnitCountUsageCalculator/types.ts`) are honestly low — most residue is **class A**, i.e. genuinely unique logic, exactly what a real corpus of distinct calculators should show. The engine finds the shared *boilerplate spine* (imports, filter→delegate, function scaffolding, return) and is honest about the rest.

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

The JSON composition tree stays the internal IR; `dsl.js` adds a **positional,
declarative** surface that reads like a language, not a property bag. The grammar
is **auto-derived from the generator signatures** (`classify()` reads `COMPOSITES`
in `generators.js`) — not hand-authored. **Opaque leaf ids never appear** — leaves
stay internal.

`activeFeatureCostCalculator` in the surface (`surface/activeFeatureCostCalculator.calc`):

```
volumeCosting activeFeatureCostCalculator
  ISubscriptionUsage -> ISubscriptionCost
  billingType ACTIVE_FEATURE via getVolumeCostingItems
```

Two signature-driven transforms produce that form:

- **Positional rendering.** `keyword` = composite name minus `make`/`CalculatorFn`
  (lower-initial); the `typeName` params join with ` -> `; an identifier param
  whose name ends `Const` renders as `billingType <suffix>` (marker = name minus
  `Const`; the SCREAMING_SNAKE of the marker, `BILLING_TYPE_`, is the dropped
  const prefix); an identifier param whose name ends `Fn` renders as `via <fn>`.
- **Import dropping.** Params flagged `derived` in a composite are module
  specifiers for a symbol named by another param. `resolve-imports.js` mines a
  `symbol -> canonical specifier` map from the real imports across the corpus
  (`catalog/import-resolution.json`; canonical = the strictly-dominant specifier).
  An import is **dropped** from the surface only when the stored value equals the
  mined canonical (so expansion stays byte-exact) and **re-derived on parse**.
  When a symbol is genuinely ambiguous (stored ≠ canonical) the import is **kept
  inline** — `Type from '<module>'` — rather than guessed.

That ambiguity is real in this corpus: `ISubscriptionUsage`/`ISubscriptionCost`
are imported under **five** different relative/alias specifiers across the 39
files. The alias `'@src/rentsync-api/…'` dominates, so `activeFeature` and
`liftBuilding` (which use it) go fully import-free, but `propertyVolumeV2` uses
the `'../../../…'` relative form and honestly keeps those two imports visible:

```
volumeCosting propertyVolumeV2CostCalculator
  ISubscriptionUsage from '../../../ISubscriptionUsage' -> ISubscriptionCost from '../../../ISubscriptionCost'
  billingType PROPERTY_VOLUME_V2 via getVolumeCostingItems
```

`dsl.js` provides a **parser** (`parseText`, DSL → tree) and a **printer**
(`printTree`, tree → DSL). `verify-dsl.js` proves lossless round-trip on all
three calculators: `tree → DSL → tree` is identity (canonical), `DSL → tree → DSL`
is string-identity, and `DSL → tree → expand` is byte-identical to `tree → expand`
(so the committed `.calc` and the JSON IR are two views of the same code — still
differing from the real file by only the known `// 15;`/`// 14;` trivia). The
surface inherits the typed guarantee: an opaque leaf id, an unknown keyword or
marker, an unquoted module specifier, a prose value, or an **unresolvable dropped
import** are all **rejected at parse**.

```
node resolve-imports.js                   # mine the symbol -> module map
node dsl.js --grammar                     # the auto-derived positional grammar
node dsl.js --print compositions/activeFeatureCostCalculator.json   # IR -> DSL
node dsl.js --parse surface/activeFeatureCostCalculator.calc        # DSL -> IR
node verify-dsl.js                         # lossless round-trip proof
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
