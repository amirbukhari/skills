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

### Worksheets are the one derived thing that stays in the engine tree

`name-words-lzw.js` writes `name-words-lzw-worksheet.json` next to itself, not under
`<CORPUS>`. That looks like a §8B location violation and is not one — it is deliberate, and
three things say so:

- the repo `.gitignore` has a section headed *"Wipable-derived per §8A (.calc IR, coverage/index
  reports, worksheets)"* listing this file by fully-qualified path, alongside `name-worksheet.json`
  and `name-generators.names.json`. It cannot reach the public remote.
- `engine/artifact-location.test.js` enforces §8B in two parts — every **registered** artifact
  resolves outside the engine tree, and no file whose **name is in the `DERIVED` set** sits here on
  disk. The worksheet is in neither the registry nor `DERIVED`, so it is exempt by construction,
  not by an oversight in the guard.
- it is an authoring *input*, not a published artifact. Nothing reads it but the human filling it
  in; the apply step is separate and never automatic.

**Do not "fix" this by moving it to `<CORPUS>/.cache/spec-derived/` without asking.** A worksheet
that a person has partly filled in is hand-authored content, and `.cache/` is defined as
regenerable and wipable. Hand-authored names have already been lost once in this project — that is
why `word-names.json` is SOURCE-PROTECTED. Which side of that line a half-filled worksheet belongs
on is Amir's call, not a cleanup.

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

## Driving the pipeline from a UI — `sdd-run.js`

Amir is wiring these steps into a UI. `sdd-run.js` is the machine-callable front end that makes
that possible **without modifying a single pipeline script**.

```
node sdd-run.js --list                 the step manifest — what a UI renders as the pipeline
node sdd-run.js --status               resolved roots + which artifacts exist right now
node sdd-run.js <step> [-- <argv...>]  run one step; everything after `--` goes to the script
```

Or through npm: `npm run steps`, `npm run status`, `npm run sdd-run -- <step>`.

The `register` step wraps `verify-register.js` (owned by another lane). Its `coverageWarning`
field exists because the exit code alone is misleading: **MANUAL is not a pass, and a row absent
from the runner is not a row that holds.** A UI must show the mechanized fraction beside the
result.

**Do not read a coverage count out of this file.** Coverage moves every time a row is mechanized,
so any number written here is stale by the next commit — this paragraph itself carried "13 rows of
a ~100-row register" until 2026-08-31, when the real figure was 35 of 119 with one row failing.
Read `summary` from `node verify-register.js --json` (`holds`, `fails`, `manual`, `total`,
`mechanizedRows`); the runner prints the same line in human mode. Note the runner **exits 1 while
any row fails**, and one does today — read `summary.fails` rather than treating non-zero as a
broken runner. Capture that exit code directly: piping through `tail` or `head` reports the
pipe's status, not the runner's.

**The stdout contract:** stdout carries **exactly one JSON document** and nothing else. Child
prose is relayed to stderr, so a UI parses stdout with no heuristic and streams stderr as the
live log. Exit code is the child's, unchanged; `2` means sdd-run itself refused. Every envelope
carries `ok`, so a UI never interprets prose to learn whether a step succeeded.

**Why a wrapper and not `--json` on eleven scripts.** Only `measure-uncollapsed.js` speaks JSON
today. Adding an output mode to each of the others means editing every one, including the
byte-identity path, where a change is a regression risk for no functional gain. Delete
`sdd-run.js` and nothing else changes behaviour.

**Readiness is per-step, and a block names the artifact.** Each step declares `needs` — the §8B
artifact kinds it actually loads — and a step that cannot run yet reports `kind: "not-ready"`
with the missing kind by name, not a blanket "the corpus is not mined". `run-tests.js` already
made and removed the all-or-nothing version of this gate; its comment records that one absent
artifact skipped all six corpus tests and misreported four of them. Do not reintroduce it.

**The manifest is measured, not asserted.** Every step was run end to end on 2026-08-31 and the
`reads`/`writes`/timing claims corrected against what the scripts actually do. Four were wrong on
the first pass — the most consequential being `measure`, which does **not** read `.en` files from
disk: it walks `<SOURCE>/**/*.ts` and renders in memory, so it does not depend on `render` having
run and reports `1037/1037` on a corpus with zero `.en` on disk. A UI must not draw `measure`
downstream of `render`. Steps carry `measuredMs` where a real run produced a number.

**Every run records the mining constants.** `MIN_COUNT`, `MIN_SKEL` and `MAXWIN` are
env-overridable at `build-lzw-generators.js`, and §R binds their **defaults** — so a run with
`MIN_COUNT=2` exported satisfies the code and violates the register with nothing on screen to say
so. The envelope carries `miningConstants` and `constantsOverridden`, `--status` reports them, and
an override prints a warning to stderr saying the run does not satisfy the register even at exit 0.

The defaults are **parsed out of the declaring file, never restated here** — a second copy of a
constant is exactly the drift that rotted three §R cites (they pointed at `engine/compose.js` and
`engine/enlzw.js`, neither of which defines these). If the declaration changes shape, this reports
`unknown` rather than a stale number. Verified: a reshaped `Number(process.env.X ?? 1)` yields
`defaultKnown: false`, not `1`.

**Destructive steps refuse by default.** `clean:sen` needs `--allow-destructive`, and
`sdd-clean.js` still independently requires `--go` before it deletes anything. This wrapper must
not become a one-click way to delete the English tree.

`sdd-run.js` writes nothing and resolves roots and artifact state only through
`engine/corpus-root.js` and `engine/artifact-contract.js`, so it cannot drift from what the real
tools resolve.

## Every file in this directory

Forty-odd scripts sit flat in this folder and only eleven are reachable from an npm script. This
table is how you tell them apart. **PIPELINE** = step A above. **LIBRARY** = required by other
modules, not a CLI. **TOOL** = a real CLI you run by hand. **ONE-OFF** = a proof, demo or
investigation, kept for its findings; not on any path.

| file | kind | what it is |
|---|---|---|
| `build-lzw-generators.js` | **PIPELINE** 1 | mines the recursive word dictionary. `npm run mine` |
| `name-words-lzw.js` | **PIPELINE** 2 | Tier-2 naming worksheet. `npm run name`. Writes `name-words-lzw-worksheet.json` **into this directory, deliberately** — see "Worksheets" below |
| `reconcile-names.js` | **PIPELINE** 2 | orphan ledger + re-adoption proposals after a re-mine. `npm run reconcile` |
| `write-en-files.js` | **PIPELINE** 3 | writes `<CORPUS>/sen/files/**/*.en`, byte-gated per file. `npm run render` |
| `measure-english.js` | **PIPELINE** 5 | THE SCOREBOARD (PRD §7.0). `npm run measure` |
| `measure-uncollapsed.js` | **PIPELINE** 5 | the §7 frozen classifier. `npm run measure:uncollapsed` |
| `stamp-artifacts.js` | **PIPELINE** 5 | re-stamps / verifies §8B headers, idempotent. `npm run stamp:check` |
| `roots.js` | **TOOL** | prints where the engine is pointed and which layer decided it. `npm run roots` — run this first when anything looks wrong |
| `run-tests.js` | **TOOL** | the three-tier test runner (unit / corpus / slow). `npm test` lands here |
| `verify-register.js` | **TOOL** | evaluates the §R requirements register mechanically. `npm run register`, or `--json` for a caller. `MANUAL` is not a pass |
| `apply-worksheet-names.js` | **TOOL** | writes the Tier-2 worksheet's proposed names into `word-names.json` as `chunks`, keyed by content hash. Dry-run unless `--apply` (**exits 3** on the dry run); refuses a worksheet older than the dictionary (R-PAY-6); snapshots the artifact first because `Examples/` is gitignored and it has no git history; **BYPASSES `engine/naming-gate.js`** — a 2026-09-02 user override, not an oversight. `npm run apply:worksheet-names` |
| `preflight.js` | **TOOL** | **ONE table** naming every artifact a consumer expects, its status, and the exact command that writes it, in dependency order. Four statuses that need four different fixes: `PRESENT`; `MISSING` (a live producer has not been run); `BLOCKED` (the producer runs but cannot publish — re-running cannot fix it); `LOST` (hand-authored and gone). Exit 0 all present / **2 something absent — a STATE, not a failure** / 1 preflight itself could not run; `--strict` for a hard gate, `--soft` always 0. `--json` is what a panel should call instead of inventing its own error string. `npm run preflight` |
| `run-tiers.js` | **DRIVER** | the tier pipeline: `build-archetypes.js` → `build-skeletons.js` → `package-hydra-source.js`, in dependency order, stopping on failure. These three had exactly one caller (`engine/sdd.js:101-103`, itself with no npm script), which is why eight of their artifacts were absent. A stage preflight reports as `BLOCKED` is **skipped with the reason printed**, never attempted. Ends by re-running preflight. Deliberately NOT chained off `npm run build` — that command ends with `preflight --soft` instead, so the two pipelines stay legibly separate. `npm run tiers` |
| `build-files-index.js` | **PRODUCER** | writes `<CORPUS>/files-index.json`, the whole-repo browse index a panel surface reads. Derived entirely from the stamped `en-index` — it re-measures nothing. Refuses (exit 3) if `en-index` is absent, naming `npm run render`. Replaces `archive/build-compositions.js`, whose `PROJECT` was hard-coded to a **delonix** path, so this artifact had no live producer at all. Carries the full §8B header with a real fingerprint but claims **no registry entry** — registering it would move the file off the corpus root, which is the path its consumer reads. `npm run files-index` |
| `report-server.js` | **TOOL** | the **reporting layer**: reads the published artifacts and renders one page. `npm run report` (http://127.0.0.1:8787), or `npm run report:once > out.html`. **READ-ONLY — GET only, no write path**: nothing here mines, renders, names or cleans, and an absent artifact is reported as a named miss with the command that produces it, never as a zero |
| `sdd-clean.js` | **TOOL** | wipes derived content out of CORPUS. Dry-run unless `--wipe-sen --go`. Never touches SOURCE. `npm run clean` |
| `repo-dsl.js` | **TOOL** | the pipeline-B CLI: `mine\|publish\|gate\|verify\|verify-expand\|expand\|explain\|language\|refine-language\|report`. `npm run gate` |
| `author-names.js` | **TOOL** (broken input, **deliberately unwired**) | proposes names for leaf skeletons — the third naming path, distinct from `name` (chunk worksheet) and `name:tier` (gated apply). **Needs a census file as argv[2] and nothing live produces one**; it crashes without one. Its `npm run name:author` entry was **REMOVED 2026-09-03**: line 34 defaults its OUTPUT to `AC.pathFor("word-names")` and line 125 writes it, so a "fixed" input would overwrite 3,820 chunk names with leaf names only, against a file with no git history. Only the §8B `requires` refusal stands in the way. Kept for its admission rules; do not re-wire. See `../../RUNBOOK.md` §10 and `../../CLAUDE.md` §9 |
| `language.js` | **LIBRARY**/TOOL | publishes the vocabulary + grammar as machine JSON for a cross-repo consumer. `repo-dsl language <dir> --json`. Hand-authors nothing: every name, param, keyword, marker, tier and token rule is read live from `generators.js`/`dsl.js` at call time, and `engine/language.test.js` fails if this file ever names a composite or leaf literally |
| `dsl.js` | **LIBRARY** | the readable surface over the composition-tree IR. 30 references — the most-used module here |
| `generators.js` | **LIBRARY** | the deterministic generator library for the SDD code stage |
| `expander.js` | **LIBRARY** (**LIVE — deliberately NOT archived**) | composition tree → code. **Kept when the rest of the `.calc` surface was retired on 2026-09-04**, because two live things still call `expand()` over an **in-memory** composition tree, which never touches a `.calc` file: `engine/dsl-surface.test.js:36` (a UNIT test, auto-discovered by `run-tests.js`'s `engine/*.test.js` glob, so it runs in plain `npm test` — **9 assertions, green 2026-09-04**) and `refine-language.js:45` (the live `repo-dsl refine-language` pass). Retiring the IR is not retiring the expander |
| `archive/decompose.js` | **ARCHIVED 2026-09-04** | was the deterministic `.calc` author (no LLM). Retired with the whole `.calc` surface — Amir: *"yeah kill that lol"*. **PROVEN DEAD**: its only live caller was `selfhost-package.js`, archived in the same pass |
| `explain.js` | **LIBRARY**/TOOL | walks a composition tree into the generator tree it invokes |
| `build-skeletons.js` | pipeline **C** | the skeleton tier over the whole corpus |
| `build-archetypes.js` | pipeline **C** | the archetype tier. Deliberately NOT wired in (PRD §5 tier 1) |
| `package-hydra-source.js` | pipeline **C** | deterministic packager for the billing-system corpus |
| `archive/selfhost-package.js` | **ARCHIVED 2026-09-04** | was pipeline **C**'s zero-LLM self-hosting package: `mine -> decompose -> .calc -> expand -> verify`. Retired with the `.calc` surface — Amir: *"yeah kill that lol"*. **PROVEN DEAD**: zero code references, no test, and its `self-hosting` sense is not the one the PRD uses today (there, self-hosting means `SOURCE === CORPUS`, R-CFG-2/R-CFG-9 — a different claim entirely) |
| `test-gen-roundtrip.js` | **TEST** (slow) | render every corpus `.ts` to `.en` and compile back; assert byte-identical. ~24s, ~850MB peak |
| `test-lzw-roundtrip.js` | **TEST** (slow) | the same gate through the recursive word dictionary. ~22s, ~840MB peak |
| `engine/dsl-surface.test.js` | **TEST** | proves the surface layer is lossless: print/parse round-trip and byte-identical expansion, over every form the live grammar reports. Replaces `verify-dsl.js`, which is now in `archive/` — it read `compositions/` and `surface/` fixtures that were gitignored as derived and so did not survive the skill extraction, and its producer `build-compositions.js` was already archived |
| `archive/verify-expand.js` | **ARCHIVED 2026-09-04** | was the per-module gate over one `.calc`. **PROVEN DEAD**: its two callers were `repo-dsl.js`'s `verify-expand` subcommand (retired in the same pass) and `sdd-code-from-spec.js` (archived in the same pass); it was never in `run-tests.js`, so despite the **TEST** label nothing ever ran it |
| `measure-bespoke-composites.js` | measurement | STEP 1 of the coverage push (MEASURE ONLY) |
| `measure-callgraph.js` | measurement | STEP 5 (MEASURE ONLY) |
| `measure-operations.js` | measurement | STEP 3 (MEASURE ONLY): discovers higher-level operations |
| `measure-logic-english.js` | measurement | re-runnable char-level metric for logic-English |
| `pattern-census.js` | measurement | READ-ONLY missed-pattern / line-level investigation |
| `narrate-census.js` | measurement | READ-ONLY scan of every `.ts` in the corpus |
| `finer-granularity-sweep.js` | **ONE-OFF** | granularity investigation |
| `guard-idiom.js` | **ONE-OFF** | guard-idiom probe |
| `archive/cnl-author.js` | **ONE-OFF** | controlled-English logic authoring, end-to-end proof — **ARCHIVED 2026-09-03**, see `archive/README.md` |
| `archive/coin-word.js` | **ONE-OFF** | coin-a-word demo, proves the growth loop end to end — **ARCHIVED 2026-09-03**, see `archive/README.md` |
| `archive/wholefile-mine.js` | **ARCHIVED 2026-09-02** | CLI over `engine/wholefile.js`. Retired with `catalog/mined-library.v5.json`: no npm script, no caller, artifact absent from the corpus. Requires repointed `../engine/`; `engine/wholefile.js` itself stays live (`package-hydra-source.js:22`) |
| `resolve-imports.js` | **ONE-OFF** | mines a symbol → module-specifier map |
| `archive/strip-comments.js` | **ONE-OFF** | deterministic AST-safe comment stripper — **ARCHIVED 2026-09-03**, see `archive/README.md` |
| `refine-language.js` | LLM pass | the "librarian" pass over the mined language. Reaches into `../sdd-lib.js` |
| `archive/sdd-code-from-spec.js` | **ARCHIVED 2026-09-04** | was the code-stage composition emitter (`spec.md -> composition.calc -> native code`). Retired with the `.calc` surface. **SUSPECTED DEAD, NOT PROVEN** — zero code references and no test, but it is a human-invoked CLI, so grep cannot prove nobody ran it. Archived on Amir's word, not on proof |
| `archive/package-delonix.js` | **ONE-OFF, do not run** | packages a corpus at a path that `../../CLAUDE.md` §1 puts **out of bounds** and `.claude/settings.json` denies reads to. Kept for history only — **ARCHIVED 2026-09-03**, see `archive/README.md` |

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
npm run test:slow     # the full-corpus round-trips. ~24s each, measured 2026-08-31.
npm run test:all      # everything
```

On an un-mined corpus the CORPUS tier is reported **SKIPPED with the command that would produce
the artifacts** — absent is a state, not a failure. Present-and-wrong is a real failure and is
reported as one.

**Do not run the full suite casually.** It has OOM-killed on shared machines. Run the module you
changed: `node engine/<module>.test.js`.
