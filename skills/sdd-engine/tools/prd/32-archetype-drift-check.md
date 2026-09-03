# §5F — Architecture drift detection: residual is the drift signal

*The archetype tier (§5E) already classifies every file and tiles its top level. This section names
what falls out of that tiling as a **drift check** and makes it a requirement. Kraken's dashboard
drives it over `GET /api/sdd/check`, but the mechanism is the engine's: the HTTP route is a caller,
not the definition.*

---

## 1. The claim a generative archetype makes

The classifier assigns every file exactly one archetype from a fixed vocabulary
(`engine/archetypes.js classifyFile`). Most archetypes are **descriptive** — `TestSuite`,
`IndexBarrel`, `PureModule`, `Other` and the rest say what a file *is* and stop there.

A small subset is **generative**: it carries a real slot schema and a template, which together are a
falsifiable claim — *files of this kind are made of exactly these parts*. `GENERATIVE` is declared
once, in `engine/archetypes.js`, and is the only place the set is spelled.

The distinction is the whole basis of the check. A descriptive archetype cannot drift, because it
never claimed a shape to drift from. **Only a generative archetype can be wrong**, and only
generative files are counted.

## 2. Residual, and why it is the signal

`tileTop` walks a file's top level and types every segment with one of exactly four type strings:
`glue`, `import`, `preambleType`, or **`residual`**. `preambleType` is the slot-bearing one — the
structured, templatable statements that are part of the module's declared surface. ("Slot" is the
concept the source comments use; it is not a type string, and the PRD should not invent one.)

> **Residual is a top-level statement the file's own archetype has no slot for.**

That is the drift signal, stated plainly: *the file has grown structure its own architecture does not
describe*. Not a style violation, not a lint — a file whose shape has moved away from the schema its
kind claims, detected by the schema failing to account for it.

**Conformance is not residual alone.** A generative file conforms when three things hold together:

1. its archetype's **structural condition** (an `Entity` has exactly one entity class; a
   `RouterModule` has at least one router var and at least one route; and so on),
2. **`residual.length === 0`**, and
3. the tiling is **byte-identical** — the segments reassemble to the exact source.

Condition 3 is losslessness and is reported *separately* from conformance, because the two answer
different questions. A file can tile byte-identically and still carry residual: the tiler understood
every byte and the archetype still failed to account for the structure. That file is **drifted, not
broken**, and conflating the two would either hide drift behind a passing tiling number or condemn a
lossless tiling for a schema's shortfall.

## 3. What the check reports

- **Corpus roll-up, per generative archetype:** `N of M conform` alongside the separate
  byte-identical tiling count, so a drop in conformance can never be read as a loss of losslessness
  or vice versa.
- **Worst-first non-conformers**, each with the reason that produced it — for residual, the distinct
  statement kinds that were left over, not a bare count.
- **A per-file drill-in** giving the exact offending statements.

**What exists today, measured 2026-09-01.** `engine/sdd.js` `check({ projectDir })` walks the `.ts`
tree, skips non-generative archetypes outright, and returns
`{ scanned, generative, conforming, nonConforming, nonConformers }`, each non-conformer carrying
`{ rel, archetype, reason }` — so the `N of M conform / K drifted` roll-up and the non-conformer list
are **implemented**. Three parts of this requirement are **not** yet in that roll-up: the per-archetype
breakdown, the byte-identical tiling count as a second number beside conformance (`byteIdentical` is
computed per file in `checkFile` but is not aggregated), and worst-first ordering (`nonConformers` is
emitted in walk order). Those are the open edge of R-ARCH-20, not a claim about present behaviour.

## 4. The drill-in recomputes; it does not serve a verdict

The per-file answer **MUST** be recomputed from the file's current source at the moment it is asked
for. A drift check that answers from a stored verdict reports the drift of whenever the artifact was
last built, which is precisely the staleness it exists to detect — and it would fail silently, with a
confident number, which is the §8B producer/consumer shape with the dashboard as the consumer.

Persisted archetype artifacts (`sen/archetypes/<rel>.arch.json` and the catalog roll-ups) are a
**cache and a roll-up**, never the answer to "does this file conform right now".

*Verified 2026-09-01 by reading both paths in `engine/sdd.js`:* `checkFile` re-reads the source,
re-runs `A.classifyFile(A.analyzeFile(...))` and re-runs `A.EXTRACTORS[archetype]` on it, reaching for
no stored artifact at all. The function that *does* load `sen/archetypes/<rel>.arch.json` is `render`,
a different entry point with a different job. **This requirement is satisfied by the current
implementation** — it is recorded so a later cache-the-verdict optimisation has to argue with it.

## 5. Three different mechanisms, deliberately not merged

These are named together because they are easy to conflate and are not the same check:

| | question | mechanism |
|---|---|---|
| **Architecture drift (this section)** | does a file still match the shape its own archetype claims? | residual computation over the top-level tiling of generative files |
| **Spec-vs-code staleness** | has the `.ts` moved away from the `.en` that is supposed to describe it? | byte-identity on the render/compile round trip (R-REND-1) |
| **Orphan re-adoption** (§5C, R-LANG-7) | has a name silently re-attached to a skeleton it merely resembles? | rename-queue proposals scored by edit distance, never auto-applied |

The second is about *this file versus its own English*. The third is about *a name versus a
skeleton*. Only the first is about *a file versus its architecture*, and only the first is what
"drift check" means in this section.

## 6. Known gaps — stated, not hidden

- **The archetype artifacts are outside the §8B contract.** `build-archetypes.js` writes
  `<CORPUS>/catalog/archetypes.json` (line 111) and `<CORPUS>/archetype-index.json` (line 132 — the
  corpus **ROOT**, no `catalog/` prefix) with hand-written `schema` strings and no `fingerprint`, and
  neither kind is in the registry — so `AC.validate` can never run on them. This is the shape §8B
  exists to prevent, and it is the same one found in three other producers on 2026-08-31.
  Registering them is queued, not done — and it is **not** a stamp swap: every registered kind
  resolves into `AC.HOMES`, so registration would move the index off the corpus root and break both
  `package-hydra-source.js:205` and the out-of-tree dashboard consumer that reads it there.

  *(This bullet said `catalog/archetype-index.json` until 2026-09-02. It never lived there. The
  stale path cost a real diagnosis: an error naming `<CORPUS>/archetype-index.json` was read as a
  consumer looking in the wrong place, when the consumer was right and this sentence was wrong.)*
- **~~The check has not been run against the current corpus.~~ RUN 2026-09-02.** It was true on
  2026-09-01, when `catalog/archetypes.json` and the root `archetype-index.json` were both **absent**
  and no figure here could have been reproduced. `node build-archetypes.js` then
  `node engine/sdd.js check <CORPUS>`, both roots self-hosting, now give: 1038 files, 17 archetypes,
  16 named (>=3) covering 99.8%; **140 generative** (Entity 64, RouterModule 35, ReduxModule 36,
  DtoBuilder 5) and 898 descriptive; **118 of 140 conform, 22 drifted**, and — the second number,
  kept apart per §2 — **140 of 140 tile byte-identical**, so every non-conformer is *drifted, not
  broken*. Per archetype: Entity 58/64, RouterModule 23/35, ReduxModule 34/36, DtoBuilder 3/5.
  16 of the 22 are residual `VariableStatement(const/let)` (12 of those routers).

  Two denominators here do not match, and neither one is wrong: `check()` reports **scanned 943**
  because `engine/sdd.js:82` narrows to `<projectDir>/src`, while `build-archetypes.js` walks all
  1038. The generative totals agree exactly, which is the measurement that says **all 140 generative
  files live under `src/`** — so the roll-up above is unaffected. The three gaps named in §3 are
  still open: `check()` aggregates no per-archetype breakdown, no byte-identical count (the 140/140
  above comes from `build-archetypes.js`, not from `check`), and no worst-first ordering.
