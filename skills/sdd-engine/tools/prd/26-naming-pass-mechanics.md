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

## 2. THE MEASUREMENT — the target is 5,862, not 5,408, and here is why

**R-LANG-22's figures predate the conditional-LIFT commit and should be re-stated.** Reproducing
§5D.3E's method with the same catalog and the *render's own* span set:

| | §5D.3E (2026-09-01, earlier) | this sweep (2026-09-01, post-LIFT) |
|---|---|---|
| files swept | 943 "mineable" | **1,037** |
| spans | 3,921 | **4,788** |
| distinct used words | 3,237 | **3,576** |
| leaf skeletons (d=0) | 2,619 | **2,767** |
| used words d=1–8 | 2,789 | **3,095** |
| **naming target** | **5,408** | **5,862** |

**The sweep is the render, not a re-implementation of it.** It calls `enlzw.genSpans` with the same
`wholeRunOk: (run, sf) => !!chunkGloss(run, sf)` the renderer passes at `enfile.js:1026`, and its
4,788 spans match `en-index.json`'s `generators.calls: 4788` from the last render **exactly** — which
is the check that the plan names the words the corpus actually shows.

**Two causes, one confirmed and one not.** Re-running the same sweep with the LIFT switched off
(`wholeRunOk: () => false`, the pre-`4edebd3` behaviour) gives 5,731 spans / 3,588 used words /
2,507 leaves — so the LIFT moved the figures, but *neither* setting reproduces 3,921 spans. The
remaining gap is the **file set**: 943 against 1,037, and `en-index.json` itself reports
`totalFiles: 1037` for the render it gated. §5D.4A's 943 denominator (308/943 = 32.7%) and today's
(316/1037 = 30.5%) are the same discrepancy seen from the other side. **Recorded, not resolved** —
what "mineable" meant in the 943 sweep is not written down anywhere I can find, and guessing at it
would be exactly the reframing CLAUDE.md §7 warns about.

**What does NOT change is the direction R-LANG-22 exists to state.** The target is still MORE names
than naming every used word today — 5,862 against 3,576, where the old pair was 5,408 against 3,237.
It is a cost, and the ratio (1.64×) is essentially unmoved.

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

## 5. Requirements touched

- **R-LANG-20** — now has a compliant producer (`name-words.js` + `engine/naming-plan.js`), checked
  at plan time (`orderViolations`) and at run time (the d>0 refusal). The FAILING note stands for
  `name-words-lzw.js`, which is superseded but untouched.
- **R-LANG-21** — enforced: `tiersOf` refuses to start above d=0 unless the caller states the leaves
  are already named, and the CLI refuses a composite tier while any leaf is unnamed.
- **R-LANG-22** — the target figures are re-measured post-LIFT (§2). The requirement's *shape* —
  state it as a cost, never as a saving — is implemented in `summarize()`, which cannot report the
  target without also reporting today's figure.
