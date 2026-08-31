# repo-dsl — the engine

English-as-source for a TypeScript corpus. You edit the `.en`, the `.ts` is derived, and the
derivation is byte-exact for every file. `../PRD.md` is the design; **this file is the map** —
what is live, what is a one-off, and what every file in this directory is for.

New here? Read `../../README.md` first, then `npm run roots`.

**This repo holds ENGINE CODE + PRD ONLY.** It has a public remote. Every corpus-derived artifact
lives with the corpus and resolves through `engine/artifact-contract.js` → `pathFor(kind, corpus)`.
`engine/artifact-location.test.js` fails if that ever stops being true.

## THE LIVE PIPELINE — the only one that produces a `.en`

Run it from the skill root (`npm run build`) or step by step from here:

```
1. MINE      npm run mine          node build-lzw-generators.js
                engine/fanout.js  -> bottom-up AST node stream
                engine/wordlzw.js -> LZW dictionary (a word = an entry = a generator)
             reads   <SOURCE>/**/*.ts
             writes  <CORPUS>/sen/catalog/generators-lzw.json

2. NAME      npm run name          node name-words-lzw.js worksheet
             emits the Tier-2 naming WORKSHEET. It does NOT apply names.
             npm run reconcile     node reconcile-names.js
             orphan ledger + re-adoption PROPOSALS after a re-mine. Never automatic.
             writes  <CORPUS>/sen/catalog/word-names.json      (SOURCE-PROTECTED, §8A)
                     <CORPUS>/.cache/spec-derived/name-queue.json

3. RENDER    npm run render        node write-en-files.js
                engine/enfile.js  -> spans, labels, per-site prose productions (PRD §5C)
                engine/enlzw.js   -> span selection, unit-boundary rule, byte gate
             writes  <CORPUS>/sen/files/**/*.en   and the en-index in the corpus cache

4. COMPILE   engine/enfile.js  compileFileEn(en)  ->  the original bytes, exactly

5. MEASURE   npm run measure       node measure-english.js
             THE SCOREBOARD (PRD §7.0): byte-identity, vacuous-clause count, English-completeness
             npm run measure:uncollapsed   un-collapsed recurring structure (§7)
             npm run stamp:check           every artifact honours the contract (§8B)
```

`npm run build` = mine → name → render → measure, in that order.

Everything else in this directory is a **library**, a **manual tool**, or lives in `archive/`.
The table under "Every file in this directory" says which.

## ARTIFACTS — what is live, and where it lives

`sen` is a folder name inside `CORPUS`, spelled exactly once in the live tree
(`engine/corpus-root.js`, `LAYOUT.sen`). It is not a configurable root.

| artifact | home | protection |
|---|---|---|
| `generators-lzw.json` | `<CORPUS>/sen/catalog/` | tracked, SOURCE-PROTECTED (§8A) |
| `mined-library.json` | `<CORPUS>/sen/catalog/` | tracked, SOURCE-PROTECTED (§8A) |
| `word-names.json` | `<CORPUS>/sen/catalog/` | tracked, SOURCE-PROTECTED (§8A) — hand/LLM-authored, a re-mine cannot rebuild it |
| `corpus-coverage.json`, `gate.json`, `name-queue.json`, `uncollapsed.json` | `<CORPUS>/.cache/spec-derived/` | gitignored, regenerable |
| `mined-library.v1.json` | `<CORPUS>/catalog/` (unchanged) | HISTORICAL snapshot, published pre-LZW-switch — not the live library |

Every one carries a header — `schema`, `artifactVersion`, `corpus`, `generated`, `fingerprint` —
and every consumer validates it and REFUSES on mismatch. There is no silent fallback. Publish
through `AC.stamp`, never a hand-written header.

**`<CORPUS>/catalog/` and `<CORPUS>/sen/catalog/` are different trees. Never merge them.** The
first is the legacy STEP-4 tree and still load-bearing (`coined-words.json` is hand-curated); the
second is the §8B tracked artifact home. See `../../CLAUDE.md` §5.

## THREE PIPELINES EXISTED. Only one is live — this is what cost us the day

| | pipeline | status |
|---|---|---|
| **A** | `build-lzw-generators.js` → `generators-lzw.json` → `enfile`/`enlzw` → `.en` | **LIVE.** The `.en` compiles through this and nothing else. |
| B | `repo-dsl mine` → `engine/pipeline.js` → `mined-library.json` + `corpus-coverage.json` | **MEASUREMENT ONLY.** The compose layer. Does NOT invoke the LZW miner, so `repo-dsl mine` does not rebuild the live dictionary. |
| C | `engine/sdd.js` steps → `build-archetypes.js`, `build-skeletons.js`, `package-hydra-source.js` | **PANEL/EXPERIMENT.** Writes catalogs no live consumer reads. `build-archetypes.js` is deliberately NOT wired in (PRD §5 tier 1). |

To rebuild the live dictionary you run **`build-lzw-generators.js`**, not `repo-dsl mine`. A panel
number sourced from B or C describes a different vocabulary from the one your `.en` compiles
through, and will not move when you press Mine.

## Every file in this directory

Forty-odd scripts sit flat in this folder and only eleven are reachable from an npm script. This
table is how you tell them apart. **PIPELINE** = step A above. **LIBRARY** = required by other
modules, not a CLI. **TOOL** = a real CLI you run by hand. **ONE-OFF** = a proof, demo or
investigation, kept for its findings; not on any path.

| file | kind | what it is |
|---|---|---|
| `build-lzw-generators.js` | **PIPELINE** 1 | mines the recursive word dictionary. `npm run mine` |
| `name-words-lzw.js` | **PIPELINE** 2 | Tier-2 naming worksheet. `npm run name` |
| `reconcile-names.js` | **PIPELINE** 2 | orphan ledger + re-adoption proposals after a re-mine. `npm run reconcile` |
| `write-en-files.js` | **PIPELINE** 3 | writes `<CORPUS>/sen/files/**/*.en`, byte-gated per file. `npm run render` |
| `measure-english.js` | **PIPELINE** 5 | THE SCOREBOARD (PRD §7.0). `npm run measure` |
| `measure-uncollapsed.js` | **PIPELINE** 5 | the §7 frozen classifier. `npm run measure:uncollapsed` |
| `stamp-artifacts.js` | **PIPELINE** 5 | re-stamps / verifies §8B headers, idempotent. `npm run stamp:check` |
| `roots.js` | **TOOL** | prints where the engine is pointed and which layer decided it. `npm run roots` — run this first when anything looks wrong |
| `run-tests.js` | **TOOL** | the three-tier test runner (unit / corpus / slow). `npm test` lands here |
| `sdd-clean.js` | **TOOL** | wipes derived content out of CORPUS. Dry-run unless `--wipe-sen --go`. Never touches SOURCE. `npm run clean` |
| `repo-dsl.js` | **TOOL** | the pipeline-B CLI: `mine\|publish\|gate\|verify\|verify-expand\|expand\|explain\|refine-language\|report`. `npm run gate` |
| `author-names.js` | **TOOL** (broken input) | proposes names for leaf skeletons. `npm run name:author` — **needs a census file as argv[2] and nothing live produces one**; it crashes without one. See `../../CLAUDE.md` §9 |
| `dsl.js` | **LIBRARY** | the readable surface over the composition-tree IR. 30 references — the most-used module here |
| `generators.js` | **LIBRARY** | the deterministic generator library for the SDD code stage |
| `expander.js` | **LIBRARY** | composition tree → code |
| `decompose.js` | **LIBRARY** | the deterministic `.calc` author (no LLM) |
| `explain.js` | **LIBRARY**/TOOL | walks a composition tree into the generator tree it invokes |
| `build-skeletons.js` | pipeline **C** | the skeleton tier over the whole corpus |
| `build-archetypes.js` | pipeline **C** | the archetype tier. Deliberately NOT wired in (PRD §5 tier 1) |
| `package-hydra-source.js` | pipeline **C** | deterministic packager for the billing-system corpus |
| `selfhost-package.js` | pipeline **C** | zero-LLM self-hosting package |
| `test-gen-roundtrip.js` | **TEST** (slow) | render every corpus `.ts` to `.en` and compile back; assert byte-identical. Minutes |
| `test-lzw-roundtrip.js` | **TEST** (slow) | the same gate through the recursive word dictionary. Minutes |
| `verify-dsl.js` | **TEST** | proves the surface layer is lossless |
| `verify-expand.js` | **TEST** | the per-module gate |
| `measure-bespoke-composites.js` | measurement | STEP 1 of the coverage push (MEASURE ONLY) |
| `measure-callgraph.js` | measurement | STEP 5 (MEASURE ONLY) |
| `measure-operations.js` | measurement | STEP 3 (MEASURE ONLY): discovers higher-level operations |
| `measure-logic-english.js` | measurement | re-runnable char-level metric for logic-English |
| `pattern-census.js` | measurement | READ-ONLY missed-pattern / line-level investigation |
| `narrate-census.js` | measurement | READ-ONLY scan of every `.ts` in the corpus |
| `finer-granularity-sweep.js` | **ONE-OFF** | granularity investigation |
| `guard-idiom.js` | **ONE-OFF** | guard-idiom probe |
| `cnl-author.js` | **ONE-OFF** | controlled-English logic authoring, end-to-end proof |
| `coin-word.js` | **ONE-OFF** | coin-a-word demo, proves the growth loop end to end |
| `wholefile-mine.js` | **ONE-OFF** | CLI over `engine/wholefile.js` |
| `resolve-imports.js` | **ONE-OFF** | mines a symbol → module-specifier map |
| `strip-comments.js` | **ONE-OFF** | deterministic AST-safe comment stripper |
| `refine-language.js` | LLM pass | the "librarian" pass over the mined language. Reaches into `../sdd-lib.js` |
| `sdd-code-from-spec.js` | LLM pass | the code-stage composition emitter. Sibling of `../sdd-spec-from-intent.js` |
| `package-delonix.js` | **ONE-OFF, do not run** | packages a corpus at a path that `../../CLAUDE.md` §1 puts **out of bounds** and `.claude/settings.json` denies reads to. Kept for history only |

### subdirectories

| | |
|---|---|
| `engine/` | the library modules every step above calls, each with its `*.test.js` beside it. `engine/SDD.md` documents the separate deterministic `sdd` CLI (generate / author / render / check / mine). |
| `lib/` | one file, `skeleton.js` — the **flat structural skeletonizer**, a different module from `engine/skeleton.js` (the skeleton *tier*). Same basename, different jobs; do not confuse them. |
| `proposals/` | design proposals, **nothing shipped**. Investigations with a stated north star, not specifications. |
| `archive/` | retired, **not deleted**. `archive/README.md` says what each one was and why it went. Nothing there is needed to build a `.en`. |

## Running the tests

Three tiers, declared in `run-tests.js`, not guessed from how a test fails:

```
npm test              # UNIT (+ CORPUS when the artifacts exist). Green on a fresh clone.
npm run test:unit     # UNIT only — needs nothing but the source
npm run test:corpus   # needs mined artifacts under <CORPUS>/sen/catalog/
npm run test:slow     # the full-corpus round-trips. Minutes each.
npm run test:all      # everything
```

On an un-mined corpus the CORPUS tier is reported **SKIPPED with the command that would produce
the artifacts** — absent is a state, not a failure. Present-and-wrong is a real failure and is
reported as one.

**Do not run the full suite casually.** It has OOM-killed on shared machines. Run the module you
changed: `node engine/<module>.test.js`.
