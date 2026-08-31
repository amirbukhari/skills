# 8. Constants

*PART IV — CONTRACTS, CONFIGURATION AND LAYOUT · [index](README.md)*

Every threshold the implementation depends on, with its literal value and source of truth.

| Constant | Value | Where |
|---|---|---|
| `MIN_COUNT` (word recurrence threshold) | **1** — a word need not recur; a file's own shape is admissible (§4B). Env-overridable, so 1 is the **default**, not an invariant | `build-lzw-generators.js:59` |
| `MAXWIN` (max window length) | **64** — binds only `maxDepth`; past the longest node stream in the corpus the parameter is inert, so this is a ceiling, not a tuning choice (§4B). Env-overridable | `build-lzw-generators.js:59` |
| `MIN_SKEL` (minimum skeleton bytes to promote a word) | **8** — settled; lowering it buys files with near-trivial words (§4B). Env-overridable | `build-lzw-generators.js:59` |
| Skeleton-name key | **`sha256(canonical skeleton)[0:16]`**, axis-prefixed — never the word id (§5C) | `engine/word-names.js` |
| Frozen vacuous-clause list | frozen; **may be added to, never removed to lower the count** (§7.0) | `engine/clause-quality.js` `VACUOUS` |
| `MIN_WORD_CHARS` (ignore trivial punctuation tokens as words) | **4** — **RETIRED constant.** It belonged to the flat composer, which no longer exists on any live path (R-MECH-7). The only definition left is `archive/engine/compose.js:23`; nothing live reads it | `archive/engine/compose.js:23` (retired) |
| Gate corpus-coverage threshold | **≥ 20%**; note the `--min` flag default in code is 80 | `repo-dsl gate --min` |
| Gate worst-file threshold | **disabled (null)** — no per-file floor is enforced | `results/gate.json → thresholds.perFile` = `null`; `repo-dsl gate --min-file` unset |
| Byte-identity requirement | **every file, always — the floor** (§7.0) | §7 |
| Enfile-layer walk SKIP set | `node_modules, .git, .worktrees, dist, build, coverage, sen, spec, catalog, .cache, demo, coined-demo` (both `sen` and `spec` on purpose — §1B.2) | `write-en-files.js` `SKIP` |
| Roots | **not a constant** — `SOURCE` (read) and `CORPUS` (write), resolved per root: flag > env > `<engine>/.env` > engine-relative default (§1B.1) | `engine/corpus-root.js` `ROOTS` |
| Composition depth target (live `.en`) | **`generators.maxDepth ≥ 2`** | §7 |

**Corrected 2026-08-31 — three of these four rows named the wrong file.** `MIN_COUNT`, `MAXWIN` and
`MIN_SKEL` were cited to `engine/compose.js` and `engine/enlzw.js`; all three actually live on one
line, `build-lzw-generators.js:59`:

```js
const MIN_COUNT = +(process.env.MIN_COUNT || 1), MIN_SKEL = +(process.env.MIN_SKEL || 8), MAXWIN = +(process.env.MAXWIN || 64);
```

The **values were right and are unchanged** (1, 8, 64) — only the pointers were wrong, which is the
more dangerous failure: `engine/compose.js` is retired to `archive/engine/compose.js` and defines
`MIN_COUNT = 2`, so an agent verifying R-MINE-1 at the cited location reads **2**, concludes the
requirement is violated, and is wrong. `engine/enlzw.js` defines neither `MAXWIN` nor `MIN_SKEL` at
all. Verified by `grep -rn` across the live tree and `archive/`.

Note the three are `process.env`-overridable. "`MIN_COUNT` **MUST** be 1" is therefore a statement
about the default, and a run with `MIN_COUNT=2` in the environment satisfies the code and violates
the requirement silently. Whether that override should exist at all is not settled here.

---

## 8A. SOURCE-PROTECTED artifacts (never wipable-derived)

**All SOURCE-PROTECTED artifacts live in the CORPUS tree, never in the engine tree (§8B).** **TRANSITIONAL, NOT A CLAIM ABOUT AUTHORSHIP.** §1 states the `.en` is the source and the `.ts` is derived; §1B.5 records that the built direction is currently the opposite and that the question is open. The protections below cover the period in which the `.ts` is still the only copy — a sequence, not a contradiction. The composition capability was nearly lost by being treated as deletable derived output. The following are **SOURCE-PROTECTED**: they are the mined vocabulary the English source *depends on to compile and to compose*, and must **never** be classified as regenerable-cache, gitignored-away, or deleted in any cleanup — even though a mine can rebuild them, deleting them without a full re-mine breaks `.en → .ts`:

- **`<corpus>/sen/catalog/generators-lzw.json`** — the recursive LZW word dictionary; the ONLY generator
  vocabulary the live `.en` compiles through (§4A). It supersedes `catalog/generators.json`, which
  belonged to the deleted flat path and is no longer read by anything.
- **`<corpus>/sen/catalog/mined-library.json`** (the compose-layer composites — `compositeGenerators`, `builtFromComposites`, `maxHierarchyDepth`) — the **composition graph** (§4A, §5B). This is the artifact that was nearly lost; protect it explicitly.
- **`<corpus>/sen/catalog/word-names.json`** — the NAMES of the dictionary's leaf words, keyed by content hash
  of each canonical skeleton (§2.2). Hand-authored and *not* reproducible by a re-mine: the mine
  rebuilds the words, never their names. It also carries the `orphans` ledger, which is the only
  record of names authored for skeletons that have since drifted — deleting it destroys work that
  no amount of re-mining brings back.
- **`word-library.json` / coined-word catalog** and **`catalog/english-idioms.json`** — read-time coined-phrase and narration vocabularies.

Only `.calc` IR, coverage/index reports, and naming worksheets are wipable-derived (§5 on-disk layout). A cleanup that cannot tell these apart must **stop and ask**, never delete a catalog.

---
