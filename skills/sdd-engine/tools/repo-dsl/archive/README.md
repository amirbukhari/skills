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
| `cnl-author.js` | controlled-English logic authoring, end-to-end proof | **ARCHIVED 2026-09-03.** Classified ONE-OFF in `../README.md`. Zero references anywhere in the repo outside that one classification row — no npm script, no `require`, no doc, no test. |
| `strip-comments.js` | deterministic AST-safe comment stripper | **ARCHIVED 2026-09-03.** ONE-OFF. Zero references outside its `../README.md` row. The corpus is mined and rendered from source as written; nothing on the `.en` path strips comments. |
| `coin-word.js` | coin-a-word demo, proves the growth loop end to end | **ARCHIVED 2026-09-03.** ONE-OFF demo. Zero code references; the only mentions are historical entries in `../../../ASSUMPTIONS.md` recording that it was gated for byte-identity even though it was never a §7.0 gate. |
| `package-delonix.js` | packages a corpus from the Delonix tree | **ARCHIVED 2026-09-03.** Its own `../README.md` row already read **"ONE-OFF, do not run"**: it targets a path that `../../CLAUDE.md` §1 puts out of bounds and that `.claude/settings.json` denies reads to. Kept for history; it cannot legitimately be run from this repo. |
| `selfhost-package.js` | pipeline C's zero-LLM self-hosting package: `mine -> decompose -> .calc -> expand -> verify` | **ARCHIVED 2026-09-04 — the `.calc` retirement.** Amir: *"I dont think we do .calc anymore bro"*, then *"yeah kill that lol"*. **PROVEN DEAD**: zero code references anywhere, no test, never wired to an npm script or an `sdd-run` step. Note its "self-hosting" is NOT the sense the PRD uses today — there it means `SOURCE === CORPUS` (R-CFG-2/R-CFG-9), which is live and unaffected. |
| `decompose.js` | the deterministic `.calc` author (no LLM) | **ARCHIVED 2026-09-04 — the `.calc` retirement.** **PROVEN DEAD**: its only live caller was `selfhost-package.js`, archived in the same pass. Moving it here also repairs `package-delonix.js:28`'s `require("./decompose")`, which had been dangling since that file was archived alone on 2026-09-03. |
| `verify-expand.js` | the per-module gate: expand one `.calc`, byte-diff it against its target | **ARCHIVED 2026-09-04 — the `.calc` retirement.** **PROVEN DEAD**: its only two callers were `repo-dsl.js`'s `verify-expand` subcommand (retired in the same pass) and `sdd-code-from-spec.js` (archived in the same pass). Labelled **TEST** in `../README.md` but never listed in `run-tests.js` and not under `engine/`, so the glob never picked it up — **nothing ever ran it**. |
| `sdd-code-from-spec.js` | the code-stage composition emitter: `spec.md -> composition.calc -> native code` | **ARCHIVED 2026-09-04 — the `.calc` retirement.** **SUSPECTED DEAD, NOT PROVEN.** Zero code references and no test — but it is a **human-invoked CLI**, and a CLI whose caller is a person cannot be proven unused by grep. Archived on Amir's explicit word, not on evidence. If it is ever wanted back, it needs `expander.js` (still live) and `archive/verify-expand.js`. |

`archive/engine/` mirrors the `engine/` path a module was retired from, so its origin is
recoverable by moving it back. Note that a retired module's *relative* requires (`./operations`,
`../lib/skeleton.js`) resolved from its ORIGINAL location, so a file in here may not run in place
— true of `miner.js` and `build-statement-idioms.js` since this folder was created. These are
retired, not maintained; restore a file to its old path before running it.

Nothing here is required to build a `.en`. To confirm that claim rather than trust it:
`node measure-english.js` must still report byte-identity 1037/1037 with this folder
present or absent.

## On the four archived 2026-09-04, and the one that was not

`expander.js` **stayed live** and is not in this folder. Retiring the `.calc` IR is not the same as
retiring the expander: `engine/dsl-surface.test.js:36` and `refine-language.js:45` both call
`expand()` over an **in-memory** composition tree and never open a `.calc` file. Archiving it would
have broken a green unit test that runs in plain `npm test`, so it was not archived — see
`../../../ASSUMPTIONS.md`.

**The standard applied here, stated so the next reader can hold us to it:** a human-invoked CLI
cannot be proven unused by grep, because its caller is a person, not a `require`. So each row above
says **PROVEN DEAD** (zero code references, no live test, superseded in the docs) or **SUSPECTED
DEAD, NOT PROVEN** (the same grep result, but a human entry point). All four were archived either
way, on Amir's word — the distinction records what we could actually demonstrate, not what we
decided.
