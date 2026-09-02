# §5D.3F THE NAMING PASS — built, and the three Q-9 mechanics PROPOSED

*[index](README.md) · Built 2026-09-01 against the settled decisions: §5D.2 (two stages), §5D.3A
(deterministic shell / model supplies spellings), §5D.3C (node-kind rules), §5D.3E (bottom-up
order). **§1 and §2 are what exists and what it measured. §3 is a PROPOSAL on the three mechanics
Q-9 leaves open — batch size, transport, retry — recorded here so it can be overruled, not
silently adopted. Amir's call.***

## 1. What was built

Three modules and one CLI, all of them on the code-owned side of §5D.3A's line:

| file | what it owns | model calls |
|---|---|---|
| `engine/naming-plan.js` | WHICH words are asked about, IN WHAT ORDER, with WHAT evidence | **0** |
| `engine/namer.js` | the only place a model is spoken to: prompt out, `[{index,name,rationale}]` back, validation, injectivity | the run's |
| `engine/naming-gate.js` | byte-identity + payload identity + coverage invariance over affected files | **0** |
| `name-words.js` | `plan` (deterministic sweep) and `name --tier N [--apply]` | via `namer` |

**The order is checked, not asserted.** `orderViolations()` walks the plan and reports any word that
would be asked about before every leaf it is built from. `plan` REFUSES to write a plan with one
violation, and `name --tier N` (N>0) REFUSES to run while any leaf skeleton in the plan is unnamed —
the run-time half of R-LANG-20/21. *Verified by running it:* asking for d=1 today prints
*"REFUSING d=1 — 2767 of 2767 leaf skeletons are still unnamed"* and exits 1.

**The blast radius is one module and it is pinned by tests.** `namer.test.js` asserts that a
`production`, `slots` or `holes` field invented by the model has nowhere to land; that a name which
is a sentence, carries a render sentinel (`« » ⟪ ⟫ ▶`) or a hole marker (`‹ ›`), or ends in a full
stop is refused rather than sanitized; and that a refusal costs a re-ask, never a corpus edit.

**The gate is shown FAILING, per invariant.** Names are cosmetic by construction, so against the
real renderer this gate can only pass — which would make a broken comparison indistinguishable from
a working one. `naming-gate.test.js` therefore injects a renderer that breaks exactly one invariant
at a time: byte-identity, payload identity, coverage invariance. Each fails; the clean one passes.
It also reports `proseChanged` — if a batch changes no file's prose, the names never reached a label
and banking them would be **vacuous**, the failure mode `word-names.test.js` names.

**Tests:** `naming-plan.test.js` 13, `namer.test.js` 15, `naming-gate.test.js` 8 — 36 assertions,
UNIT tier, zero model calls, no corpus. Existing `chunk-naming.test.js` (34), `word-names.test.js`
(5) and `artifact-location.test.js` (6) still pass; the new `naming-plan` artifact kind is
registered and validates.

## 2. THE MEASUREMENT — the target is 2,052 at `8882830`, and 5,408 is superseded

**Amir's ruling, 2026-09-02: restate R-LANG-20/22 to the re-measured figures; 5,408 is superseded.**
Done. What follows is the provenance, because the figure is only as good as the state it was taken
in — and this one moved three times in one evening.

### 2a. The figures, pinned to a commit

Measured at **`216f928`** ("remove the mining ceilings"), against the catalog re-mined at 20:52 and
the render the same lane published at 20:53:

| | superseded | **current** |
|---|---|---|
| files swept | 943 | **1,037** |
| spans | 3,921 | **4,787** |
| distinct used words | 3,237 | **3,575** |
| leaf skeletons (d=0) | 2,619 | **2,767** |
| used words d=1–8 | 2,789 | **3,094** |
| **naming target** | **5,408** | **5,861** |

**Two independent producers agree at that state.** `name-words.js plan` swept 4,787 spans;
`en-index.json`'s `generators.calls`, published by the *renderer* from committed code, reads 4,787.
That agreement is the check that the plan names the words the corpus actually shows.

**The 0-violations invariant R-LANG-20 rests on was re-verified on the new catalog**: every composite
is `prefix + exactly one leaf` across **115,832 wide / 126,338 narrow** entries, **0 exceptions**, at
the new maxDepth **76**. Removing the ceiling deepened the dictionary; it did not touch the shape the
naming order depends on.

### 2b. The MAXWIN fix is NOT what moved the number — measured either side of it

The supersession was expected to be explained by s7's removal of the `MAXWIN = 64` ceiling and the
recurrence-gate distinction. **It is not.** The same sweep run either side of that change:

| | before the fix (pre-`216f928`) | after the fix (`216f928`) |
|---|---|---|
| spans | 4,788 | 4,787 |
| used words | 3,576 | 3,575 |
| naming target | 5,862 | **5,861** |

**One name.** The ceiling removal changes the target by 1, because it deepens chains that were
already being counted rather than admitting new words. The real causes of 5,408 → 5,861 are the two
recorded when the gap was first found: the **conditional LIFT** (`4edebd3`), and the **file-set
denominator** — 943 in the earlier sweep against `en-index.json`'s own `totalFiles: 1037`, the same
discrepancy §5D.4A shows from the other side (308/943 = 32.7% then, 316/1037 = 30.5% now). What
"mineable" meant in the 943 sweep is still not written down anywhere, and is **still not guessed at
here.**

### 2c. AND IT MOVED AGAIN THE SAME HOUR — the figure must carry a commit

While §2a was being written, the lane's `enlzw.js` work landed as **`8882830`** ("one word per file
over compression — 30.6% -> 93.1%"): the whole-run exemption for `isUnit`, plus `ONE_WORD_FIRST`,
which prefers a word that covers the whole file over the weight-maximising choice. The same `plan`
command, same catalog, 25 minutes apart:

| | `216f928` | **`8882830` (current)** |
|---|---|---|
| spans | 4,787 | **1,135** |
| distinct used words | 3,575 | **1,018** |
| leaf skeletons (d=0) | 2,767 | **1,414** |
| used words d=1–8 | 3,094 | **638** |
| **naming target** | **5,861** | **2,052** |

Both producers agree at the new state too — `plan` swept 1,135 spans and `en-index.json` reports
`generators.calls: 1,135`, `oneWordPct: 93.1`.

**The mechanism is not a loss.** A file that renders as one word emits one span instead of five, so
fewer *distinct* words are emitted and the d>=9 tier absorbs most of them (380 words at d>=9). The
corpus did not get smaller; the unit of naming got bigger — which is R-ARCH-15 working.

**So R-LANG-22's figure now carries the commit it was measured at, and the requirement says it must.**
5,408 (943 files, pre-LIFT) -> 5,861 (`216f928`) -> **2,052 (`8882830`)**, in one day. A naming target
quoted without a commit is not a measurement, it is a memory.

## 2d. THE PILOT — 80 leaves named, and the result was a 72% LOSS of information

**Run 2026-09-02 on Amir's instruction: ~80 leaves, 2 batches of 40, `--apply`, real model calls.**
Mechanically it went perfectly, and that is what makes the outcome worth recording.

| | |
|---|---|
| asked / accepted / rejected | 80 / **80** / 0 |
| model calls | **2** |
| gate | **PASSED** — byte-identity, payload identity, coverage invariance over 152 affected files |
| non-vacuity | 152 of 152 files read differently |

**The names themselves are good English.** *"import one named export from a module"*, *"export a
constant function"*, *"declare a test suite"*, *"register a GET route handler"*, *"export a compiled
schema or validator"*. Nothing was rejected; the validator never fired.

**And applying them made the corpus WORSE.** Measured over every file whose prose changed:

| | without the 80 names | with them |
|---|---|---|
| files whose prose changed | — | 982 |
| **concrete identifiers in labels** | **27,673** | **7,644** |
| files that LOST identifiers | — | **975** |
| files that GAINED any | — | **0** |

**72% of the concrete identifiers in the corpus's labels were replaced by generic clauses**, and not
one file improved. The mechanism is visible in a single line:

```
BEFORE  ▶ import `ITokenData` from `./hydra-ui/src/customHooks/ITokenData` then describe ...
AFTER   ▶ import one named export from a module then describe ...
```

**A leaf NAME is hole-free; a node-kind RULE is hole-filled.** The `ImportDeclaration` rule
(§5D.3C, R-LANG-16) renders *this* import, with its actual symbol and module. The leaf name renders
*any* import of that shape. So for every leaf a rule already covers, naming it is a strict downgrade
— it can only discard the specifics the rule was reading out of the holes.

**This is §5D.2's "build the phrasebook first, name second" turned from an argument into a
measurement, and it sharpens it.** The instruction is not merely about ordering the work. **Naming a
rule-covered leaf is a regression, not a lower priority** — and the leaf tier is exactly where
rule coverage is densest: of the 28 highest-frequency names in the pilot, ~15 are import cardinality
variants (*"import two named exports"*, *"…three…"*, *"…with trailing comma"*), which R-LANG-16
already says must be **one rule with cardinality as a parameter**, not N names.

**The pilot was reverted.** `word-names.json` is restored byte-identical to its pre-pilot state
(0 names, 0 chunks, `modelCalls: 0`); nothing was left in the corpus. Re-running it is two model
calls.

> **SUPERSEDED — this paragraph is kept as the record of its moment, not as current state.** Re-measured **2026-09-01 (later)**: `word-names.json` holds **20 leaf names, 20 chunk names, `modelCalls: 2`** (read through `AC.pathFor("word-names")` at `sen/catalog/word-names.json`). Applied to the corpus, **103 of 1037 files carry at least one leaf name and 18 carry at least one chunk name**, byte-identity **1037/1037** — so the chunk-name path that this file elsewhere calls unexercised now has a population. The 20 names are a LATER and separate event from the 80-name pilot described above — that pilot was genuinely reverted, and this note does not undo that. See §5D.4E ([28-rule-coverage-filter.md](28-rule-coverage-filter.md)), which records the model call that produced them and the re-render that applied them. The claim that has expired is the PRESENT-TENSE one — "still holds 0 names" — not the history.

**What this does NOT overturn:** R-LANG-21 — d=0 still cannot be excluded from the naming *scope*,
because every chain still bottoms out at a leaf and a d>=9 word's tail is still bare leaves. The
finding is about WHICH leaves are worth a name, not whether the tier is in scope. **What it does
change is the shape of the leaf tier's work order**, and that is a question for Amir:

> **The plan should almost certainly filter out leaves a node-kind rule already renders**, and spend
> the model only on leaves the rules do not reach. That filter does not exist yet, and building it
> means measuring rule coverage per skeleton — which is a real piece of work, not a flag. Recorded
> as the open question the pilot produced, not decided here.

## 3. PROPOSED — the three mechanics Q-9 leaves open

**These are defaults chosen to be reversible, not rulings.** Each is one constant or one flag.

### 3a. Transport — an in-repo module that shells to the `claude` CLI

`refine-language.js` already does exactly this (`spawnSync("claude", ["-p", "--model", …,
"--append-system-prompt", …])`), and Q-9 framed the choice as *"a `namer` module with the prompt
in-repo, versus shelling to a CLI"*. **Proposed: both, as they are not alternatives.** The prompt,
the validation and the parse live in `engine/namer.js` — one file to audit for blast radius — and
the wire call is the same CLI spawn the tree already has, so there is one transport to change and no
API-key handling of our own. `--stub <file>` substitutes a file for the call, which is what makes
the whole pipeline testable at zero model calls.

**The cost of being wrong is one function.** `callModel()` is 8 lines and nothing else in the tree
knows how the model is reached.

### 3b. Batch size — 40 rows per call, never spanning a depth tier

**Proposed default `--batch 40`.** Reasoning, stated so it can be argued with:

- **A batch may never span two tiers.** That is not a tuning choice, it is R-LANG-20: a d=1 word's
  ask includes the names its leaves were given, so the leaf tier must be *finished* before the
  composite tier is *asked*. Batching is therefore always **within** a tier, and `--tier` is a
  separate invocation per tier by construction.
- **40 leaf skeletons is roughly 3–4k tokens of evidence** (a skeleton, up to two real snippets, up
  to three file paths) — small enough that a rejected batch is cheap to re-ask, large enough that
  the 2,767-row leaf tier is ~70 calls rather than 2,767.
- **The batch is also the injectivity window that matters least.** Collisions are checked against a
  ledger seeded from everything already on disk, so a smaller batch does not weaken the check; it
  only changes how many names a single re-ask has to re-propose.
- **What would change the number:** if rejections cluster (a whole batch refused for one systematic
  reason), smaller is better; if the model's naming quality improves with more sibling context,
  larger is. Neither is measured yet — **the honest state is that 40 is a starting point, and the
  first real run is the measurement that should replace it.**

### 3c. Retry — one re-ask carrying the reason, then leave it unnamed

**Proposed default `--retries 1`.** A rejected row is re-asked once, with its rejection reason
appended verbatim (*"#3 'Load the rows.' — ends with sentence punctuation"*), and a row that fails
again is **left unnamed**.

**Why shallow retries are the right shape here, and this is the load-bearing part:** an unnamed word
is not a failure state. It falls back to `spanProse`, which renders correct English and compiles
byte-identically — the fallback `word-names.js` was designed around ("an unmatched word falls back
to spanProse, which is the safe failure"). So the cost of giving up on one name is one word that
reads as it reads today, and the cost of retrying forever is a run that cannot terminate on a word
the model will never get right. **Naming is resumable by construction** — `name --tier 0` skips rows
that already have names — so the un-named remainder is simply the next run's input.

**A rejected batch never touches the corpus.** Rejection happens before the gate, the gate happens
before the write, and the gate restores the name maps in a `finally` whether it passed or threw.

### 3d. The worksheet survives as `--dry-run`, as Q-9 recommended

Not a separate script and not a separate artifact: **the default is a dry run** and `--apply` is the
flag that writes. `plan` writes `naming-plan.json` (a registered §8B `cache` artifact) and is the
worksheet in the sense that matters — every row, its evidence, its priority and the content key its
name will be written under.

## 4. What is still gated on Amir, and was NOT touched

- **`MIN_COUNT`.** Untouched, in the miner and everywhere else. §5D.3E §5.6 recommends it stay a
  *mining* parameter and that the naming path use count only as a priority within a tier — which is
  what `naming-plan.js` implements — but the open question of whether it moves to 2 is his.
- **`enlzw.js:121` / the LIFT.** Untouched. The plan reads whatever the renderer currently does.
- **The old producer.** `name-words-lzw.js` is left exactly as it is, still sorting depth DESCENDING
  and still worksheet-only. R-LANG-20's *"FAILING"* note refers to that file; the new producer is
  `name-words.js` and it satisfies the requirement. **Nothing was deleted.**
- **No model call has been made.** Every number in §2 is from a deterministic sweep; every test uses
  `--stub`. `word-names.json` still holds 0 names, 0 chunks, `modelCalls: 0`.
  > **SUPERSEDED 2026-09-01.** True of the work this section describes, and no longer true of the
  > corpus: `word-names.json` now records `modelCalls: 2`, 20 leaf names and 20 chunk names (§5D.3G,
  > and a later batch). Every number in §2
  > remains model-free — that part has not expired, and the two claims are separable.

## 5. Requirements touched

- **R-LANG-20** — now has a compliant producer (`name-words.js` + `engine/naming-plan.js`), checked
  at plan time (`orderViolations`) and at run time (the d>0 refusal). The FAILING note stands for
  `name-words-lzw.js`, which is superseded but untouched.
- **R-LANG-21** — enforced: `tiersOf` refuses to start above d=0 unless the caller states the leaves
  are already named, and the CLI refuses a composite tier while any leaf is unnamed.
- **R-LANG-22** — RESTATED per Amir's ruling, and now PINNED TO A COMMIT: **1,414 + 638 = 2,052 at `8882830`**, superseding 5,861 at `216f928`, which superseded 5,408 (§2). The requirement's *shape* —
  state it as a cost, never as a saving — is implemented in `summarize()`, which cannot report the
  target without also reporting today's figure.
