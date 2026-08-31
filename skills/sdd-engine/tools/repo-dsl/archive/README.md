# archive/ — retired, NOT deleted

Nothing in here is deleted, because this effort has already destroyed irreplaceable
artifacts once. Nothing below is part of the live **pipeline**, and keeping it in the
engine root was costing us real time — six
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
| `engine/patterns.js` | the FLAT mined-generator matcher wired into the `.en` renderer | superseded by `engine/enlzw.js`. Its own header claims it is "wired into the .en renderer", but the live renderer builds spans solely from `EL.genSpans(...index._lzw)` — `enfile.js` has no flat pass. Its only two callers, `miner.js` and `verify-coverage.js`, were already in here. |
| `engine/compose.js` | the per-file compositional DSL (`file = [word, literalSlot, ...]`) | the tiling layer the recursive LZW dictionary replaced. No live file requires it. Its only two references, `compose-expand.js` and `build-compositions.js`, were already retired here — and their `./engine/compose` requires had been dangling from `archive/` since then; moving this module to `archive/engine/` happens to make them resolve again. |
| `engine/hydra-dsl.js` | editable concrete syntax over the mined whole-file words, for the panel's Author step | reads the retired `catalog/dsl-words.json`; its only two callers, `author-hydra-modules.js` and `hydra-expand.js`, were already in here. |
| `engine/mine-statement-idioms.js` + `engine/mine-statement-idioms.test.js` | the statement-idiom miner, and its suite | **the last live remnant of THE 616.** Four producers/consumers of that layer were retired above while the miner itself stayed in `engine/`; a tree-wide grep for `statement-idioms` outside this folder now returns nothing. The module's only caller was its own test. |
| `supersede-hashes.js` | made the named idioms supersede the anonymous compose-tier `c_` hashes | reads `catalog/compose-words.json`, whose only producer (`build-compositions.js`) was already retired here. Also writes the pre-§8B root `word-names.json` shape. |
| `gate-grammar.js` | deterministic round-trip gate for the logic-English grammar rules | **calls itself a gate and has no caller.** Not in SKILL.md, `../README.md` or the PRD, and no verb, npm script or CI step invokes it — the live gates are `measure-english.js` and `test-gen-roundtrip.js`. It still runs; nothing runs it. |
| `prose-llm-render.js` | rendered 3 target files twice, deterministic vs. model-named | reads `catalog/domain-names.json` and a merged `catalog/word-names.json` — both the **v0 sidecar shape from drift incident 5**, whose producers (`name-domain.js`, `name-words.js`) were already retired here. |
| `prose-render.js` | rendered 3 hardcoded files as plain-language narrative | one-off demo of `engine/prose.js`, superseded by the `.en` render path. |
| `author-roundtrip.js` | slots → controlled English → parse back, "N/58 slot-identical" | one-off proof harness; the standing proof is byte-identity in `measure-english.js`. |

`archive/engine/` mirrors the `engine/` path a module was retired from, so its origin is
recoverable by moving it back. Note that a retired module's *relative* requires (`./operations`,
`../lib/skeleton.js`) resolved from its ORIGINAL location, so a file in here may not run in place
— true of `miner.js` and `build-statement-idioms.js` since this folder was created. These are
retired, not maintained; restore a file to its old path before running it.

Nothing here is required to build a `.en`. To confirm that claim rather than trust it:
`node measure-english.js` must still report byte-identity 1037/1037 with this folder
present or absent.
