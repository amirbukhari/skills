# archive/ — retired, NOT deleted

Nothing in here is deleted, because this effort has already destroyed irreplaceable
artifacts once. Everything below still runs; it is simply **not part of the live
pipeline**, and keeping it in the engine root was costing us real time — six
producer/consumer drift incidents in one day, all rooted in the same thing: several
parallel pipelines coexisting with no way to tell which one was live.

The live pipeline is stated in `../README.md`. If a script is in here, it is **not** it.

| retired | what it was | why it was retired |
|---|---|---|
| `miner.js` | flat anti-unification / clone-detection miner → `catalog/patterns.json` | superseded by `build-lzw-generators.js`. PRD §4A: the flat path is deleted; this is its miner. |
| `verify-coverage.js` | coverage report over `patterns.json` | reads the flat catalog above; measures a vocabulary nothing compiles through. |
| `build-statement-idioms.js` | statement-idiom miner → `catalog/statement-idioms.json` | **THE 616.** `repo-dsl mine` never invoked it, so its count was frozen at the last manual run and pressing Mine could not move it. Traced: `engine/enfile.js` and `engine/enlzw.js` contain ZERO references to statement-idioms — nothing on the `.en` compile path reads it. |
| `name-statement-idioms.js` | LLM naming overlay for the above | its input catalog is retired. |
| `english-idiom-names.js` | LLM naming overlay → `catalog/english-idioms.json` | producer of a display-only overlay built on the retired statement-idiom layer. `engine/prose.js` still READS `english-idioms.json` if present — labels are cosmetic (`compileChunk` never reads them), so nothing regenerates and nothing breaks. |
| `patch-coverage.js` | patched `COVERAGE.json` from the statement-idiom catalog | same retired layer. |
| `build-operation-idioms.js` | operation-idiom builder (PRD §5 tier 2, hand-rolled) | no consumer; the LZW dictionary discovers these as words. |
| `build-consolidation-catalog.js` | consolidation catalog builder | no consumer. |
| `build-compositions.js` | compose-layer builder → `compose-words.json`, `files-index.json` | no consumer on the live path. |
| `compose-expand.js` | expander for the above | same. |
| `name-words.js` + `name-words.test.js` | the **v0** word-name sidecar `{name, hint, tier}` | **drift incident 5's producer.** Superseded by `author-names.js`, which writes v1 `{sym, en, sites, named}` keyed by content hash. Two producers for one sidecar is how a consumer ends up reading a shape nobody writes. |
| `name-domain.js` | LLM overlay writing the same v0 sidecar | second producer of the retired v0 shape. |
| `author-hydra-modules.js`, `hydra-expand.js`, `generate-proof.js` | one-off corpus-specific demo/authoring scripts | corpus-specific by name and by content; the engine is generic (PRD §8B). |

Nothing here is required to build a `.en`. To confirm that claim rather than trust it:
`node measure-english.js` must still report byte-identity 1037/1037 with this folder
present or absent.
