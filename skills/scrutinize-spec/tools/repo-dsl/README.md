# repo-dsl — the engine

English-as-source for a TypeScript corpus. You edit the `.en`, the `.ts` is derived, and the
derivation is byte-exact for every file. See `PRD.md` for the design; this file is the map.

**This repo holds ENGINE CODE + PRD ONLY.** It has a public remote. Every corpus-derived artifact
lives with the corpus and resolves through `engine/artifact-contract.js` → `pathFor(kind, corpus)`.
`engine/artifact-location.test.js` fails if that ever stops being true.

## THE LIVE PIPELINE — the only one that produces a `.en`

```
1. MINE      node build-lzw-generators.js
                engine/fanout.js  -> bottom-up AST node stream
                engine/wordlzw.js -> LZW dictionary (a word = an entry = a generator)
             writes  <corpus>/spec/catalog/generators-lzw.json

2. NAME      node author-names.js          propose names for leaf skeletons
             node reconcile-names.js       orphan ledger + re-adoption PROPOSALS (never automatic)
             writes  <corpus>/spec/catalog/word-names.json          (SOURCE-PROTECTED, §8A)
                     <corpus>/.cache/spec-derived/name-queue.json

3. RENDER    node write-en-files.js
                engine/enfile.js  -> spans, labels, per-site prose productions (PRD §5C)
                engine/enlzw.js   -> span selection, unit-boundary rule, byte gate
             writes  <corpus>/spec/files/**/*.en   and the en-index in the corpus cache

4. COMPILE   engine/enfile.js  compileFileEn(en)  ->  the original bytes, exactly

5. MEASURE   node measure-english.js        THE SCOREBOARD (PRD §7.0): byte-identity,
                                            vacuous-clause count, English-completeness
             node measure-uncollapsed.js    un-collapsed recurring structure (§7)
             node stamp-artifacts.js --check   every artifact honours the contract (§8B)
```

Everything else in this directory is a **manual tool** or lives in `archive/`.

## ARTIFACTS — what is live, and where it lives

| artifact | home | protection |
|---|---|---|
| `generators-lzw.json` | `<corpus>/spec/catalog/` | tracked, SOURCE-PROTECTED (§8A) |
| `mined-library.json` | `<corpus>/spec/catalog/` | tracked, SOURCE-PROTECTED (§8A) |
| `word-names.json` | `<corpus>/spec/catalog/` | tracked, SOURCE-PROTECTED (§8A) — hand/LLM-authored, a re-mine cannot rebuild it |
| `corpus-coverage.json`, `gate.json`, `name-queue.json`, `uncollapsed.json` | `<corpus>/.cache/spec-derived/` | gitignored, regenerable |
| `mined-library.v1.json` | `<corpus>/catalog/` (unchanged) | HISTORICAL snapshot, published pre-LZW-switch — not the live library |

Every one carries a header — `schema`, `artifactVersion`, `corpus`, `generated`, `fingerprint` —
and every consumer validates it and REFUSES on mismatch. There is no silent fallback.

## THREE PIPELINES EXISTED. Only one is live — this is what cost us the day

| | pipeline | status |
|---|---|---|
| **A** | `build-lzw-generators.js` → `generators-lzw.json` → `enfile`/`enlzw` → `.en` | **LIVE.** The `.en` compiles through this and nothing else. |
| B | `repo-dsl mine` → `engine/pipeline.js` → `mined-library.json` + `corpus-coverage.json` | **MEASUREMENT ONLY.** The compose layer. Does NOT invoke the LZW miner, so `repo-dsl mine` does not rebuild the live dictionary. |
| C | `engine/sdd.js` steps → `build-archetypes.js`, `build-skeletons.js`, `package-hydra-source.js` | **PANEL/EXPERIMENT.** Writes catalogs no live consumer reads. `build-archetypes.js` is deliberately NOT wired in (PRD §5 tier 1). |

To rebuild the live dictionary you run **`build-lzw-generators.js`**, not `repo-dsl mine`. A panel
number sourced from B or C describes a different vocabulary from the one your `.en` compiles
through, and will not move when you press Mine.

## archive/

Retired, not deleted — see `archive/README.md` for what each one was and why. Nothing there is
needed to build a `.en`; `node measure-english.js` reports 1037/1037 with or without it.
