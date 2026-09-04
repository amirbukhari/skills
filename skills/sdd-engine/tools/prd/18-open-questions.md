# §Q Open questions — none of these may be resolved by inference

*PART VI — WHAT IS NOT DECIDED · [index](README.md)*

**Read this part before making any design decision.** Everything here is genuinely undecided.
Guessing at one of them and building on the guess is the most expensive mistake available in this
project, and it has happened. Each entry says who can close it and what closing it requires.

**Severity.** **BLOCKING** — work that depends on it must stop and ask. **DESIGN** — needs a written
design pass, then confirmation. **CLARIFY** — a contradiction or gap in this document that someone
must settle so the register stops being ambiguous.

---

## Q-1 — ~~Direction of truth: which side is authoritative?~~ **CLOSED 2026-09-03. BOTH ARE.** **Answered 2026-08-31 by Amir (YES); the mechanics landed in `a5501a7` and the last blocker — §2.2 — was ruled the same day.**

**THE TITLE WAS WRONG BEFORE THE ANSWER WAS.** It used to read *"Direction of truth: does English
ever become authoritative?"* — a question that presupposes ONE winner in a design that has two, and
invites "not yet" as an answer. Amir's ruling is that **neither side is derived**, so the question
was never "does English win"; it was "when do both directions hold". Corrected 2026-09-04, because
the body below had said so since 2026-09-03 while the title went on framing a flip — and a title is
what a reader in a hurry takes away. `CLAUDE.md` §6 inherited exactly that framing and cost a round
trip.

**Answered, not deduced.** Amir's §5D.0 statement 4 settles it: mine the codebase to get the `.en`,
**hand-edit the `.en`**, and it goes back into the codebase — *"neither direction is the derived
one"*. Statement 7 gives the reason it must be so: *"so that it can be editable."*

A hand-edit to the English **must** change the compiled TypeScript. That is the definition of
authoritative, and it is now a requirement (**R-REND-6, rewritten**; §10 "The sentence is
authoritative"; mechanics in §5E.5).

**What this question used to say, kept visible:** *"§1's thesis is that the `.en` is the source and
the `.ts` is derived. What is built is the opposite. Whether the project actually flips — and when —
is not decided and has never been scheduled."* The **whether** is now decided. The **when** is a
build sequence, not an open question.

**Still true, and now blockers rather than unknowns:**

- **R-PAY-6 must close first.** Word ids renumber on every re-mine, so authoritative English on top
  of mining-order ids lets one re-mine silently invalidate every `.en`. §5E.3.2's content-addressed
  ids are the fix.
- ~~**`compileChunk` must derive the payload from the sentence** rather than only reading it (§5E.5,
  open mechanic 5).~~ **BUILT 2026-09-03, for the hole layer.** `enfile.js repairFromSentence`
  inverts the payload's holes from the written sentence and accepts a repair **only** if
  re-deriving the gloss from the repaired payload reproduces the human's sentence byte-for-byte;
  anything it cannot prove it understood is the loud refusal §5C rule 3 requires. Measured: a
  hand-edit to a real `.en` (`src/hydra-api/redisJobs.ts.en`, `` `ESocketEvents` `` →
  `` `renamedByHand` ``) changes the compiled TypeScript; the same clause with added prose is
  refused naming file, written and derived. Byte-identity **1037/1037** before and after.
  The structural branch is closed too (`deriveStructuralGloss`): it holds an opinion on **9,611 of
  9,611** structural chunks and disagrees with **0**, so a heading edit is no longer silent.
  **Still open:** the §5E.3.2 grammar parser, i.e. an edit that restructures a clause, adds prose,
  or renames something the TEMPLATE supplied rather than a hole — that last case is a new word and
  belongs to the miner. Ruled deliberately: a **structural heading** edit alone is REFUSED, not
  honoured, because a heading is computed from its children and honouring it would silently rewrite
  clauses the human left alone; the edit stays expressible at the child, proved end-to-end in
  `engine/sentence-authority.test.js` §9.
- ~~**§2.2's "names are cosmetic by construction" conflicts with §5C rule 2.**~~ **RULED 2026-09-03:
  §5C wins.** §2.2 bundled two guarantees — (a) a name can never silently alter the program, and
  (b) the label region is inert. Rule 2 kills (b); (a) survives as *"identical bytes or a loud
  refusal, never different bytes"*, which is **stronger** than the wording it replaces because it
  holds in the presence of an input rather than by the absence of one. §2.2 amended in place with
  the superseded sentence quoted. **This was the last open item on Q-1, so Q-1 is CLOSED.**
- **A human must actually author a `.en` and review the compiled `.ts` as a diff.** Unchanged.
- **`sen/`'s wipe gate hardens from *"explicit flag"* to *"refuse"*** at the flip (§1B.3). The flip
  now has a direction; the trigger is when `compileChunk` reads sentences.

## Q-2 — ~~Is the LZW core front DONE?~~ **CLOSED 2026-08-31 by measurement. The LZW path is live.**

**Answer: the live `.en` path runs through the recursive LZW dictionary. It is not flat
anti-unification.** The §5/§4A/§4B claims were right; §2 P1's *"Deviation to fix"* and §6 fronts 0
and 4 were **stale text**, and have been rewritten. Kept here rather than deleted so a stale memory
elsewhere cannot re-derive the contradiction.

**The measurement.** A synthetic 4-file corpus was built specifically to force composition —
repeated statement runs, with longer runs *containing* shorter ones, so each dictionary entry is a
prior entry plus one symbol. Mined and rendered in a throwaway directory (`SOURCE=CORPUS=<tmp>`), so
no real mine was spent:

| | |
|---|---|
| generator spans emitted | **20, all recursive** |
| flat-fallback spans | **0** — and see the structural finding below |
| composition depth, **live `.en` path** (`generators.maxDepth`) | **3** — clears R-COMP-7's `≥ 2` |
| composition depth, mined dictionary | 5, across 20 composites / 40 edges |
| byte-identity | **4/4** |

*These are the SYNTHETIC fixture's numbers and are left as they were measured — they answered "which
code path is live", which is what Q-2 asked. The **real corpus** was measured later the same day
(Q-8): live depth **62**, dictionary **63**, 5,731 spans all recursive, 1,037/1,037 byte-identical.
The conclusion held; the magnitude was ~20× larger.*

**Why a synthetic corpus is the right instrument here, and what it does not prove.** Q-2 asks which
*code path* is live — a property of the engine, not of any corpus — and a 4-file fixture answers
that exactly. It does **not** establish depth or coverage numbers for the real corpus; those need a
real mine, which is Amir's call to spend. **What is settled is the mechanism. What is unmeasured is
the magnitude.**

**Two findings the measurement produced, both now fixed:**

1. **R-COMP-6 was not met, and R-COMP-7 could not be evaluated.** The register requires the manifest
   to expose `generators.maxDepth`, `.composites` and `.compositionEdges`. The producer wrote
   `maxCompositionDepth` and neither of the other two — so the gate that makes *"flatness visible as
   a regression"* was comparing `undefined`, which is neither pass nor fail. This is the §8B drift
   shape with the PRD itself as the consumer: the spec named fields the producer never wrote. All
   three are now emitted, and `maxDepth` (deepest span the **live path** emitted) is kept distinct
   from `dictionaryMaxDepth` (how deep the **mined dictionary** goes), because conflating them would
   let a deep dictionary report a composing renderer that never composed.
2. **The "flat-fallback 0 (0% fallback)" metric was a tautology.** `tier` is set to `"recursive"` at
   exactly one place in `enfile.js` and `"flat"` nowhere, so the flat counters are **structurally**
   zero, not measured-zero — precisely the number R-MECH-8 forbids publishing. The counters are
   retained as a **tripwire** for a re-introduced flat producer and are no longer reported as a
   coverage figure. `enfile.js` also carried a comment describing a *"pass 0b FALLBACK ONLY: the FLAT
   generators.json"* that **is not implemented below it**; corrected in place rather than deleted,
   because the comment outlived its code and a reader was entitled to believe it.

**What is still open, and it is narrower than Q-2 was — see Q-8.**

## Q-3 — Archetype mechanics · **DIRECTION SETTLED; four of five unknowns RESOLVED by design** · §5E

**Direction is Amir's, in eight verbatim statements (§5D.0), and is not open.** The design pass this
question asked for is written: **`20-archetype-hybrid-design.md` (§5E)**. Status of the five original
unknowns:

| # | the unknown | status |
|---|---|---|
| 1 | **How a slot binds to a word** | **RESOLVED** (§5E.3.2). Not a word-id reference — a **nonterminal reference spelled grammatically**, bound by **name**, with ordered **alternatives** and grammar repetition for variadics. Forced by statement 3 and by the PaymentPlan case (§5E.4). |
| 2 | **Whether an archetype is itself a dictionary entry** | **RESOLVED: yes** (§5E.3.1). Forced by AT-ARCH-1, not chosen for elegance. |
| 3 | **Who wins a contested span** | **RESOLVED** (§5E.3.3) — it falls out of R-WIDE-8's widest-claim rule; no new arbitration. |
| 4 | **Whether hand-authored grammars survive** | **RESOLVED** (§5E.3.4) — the archetype's own declaration is hand-authored and **seeded**; every fill is mined. |
| 5 | **What replaces per-site productions** | **RESOLVED: nothing** (§5E.3.5). They were never a separate layer — a **name is a nonterminal's spelling, a production is its expansion**. §5C and archetype composition are ONE grammar. Statement 3 requires this. |

**What is still open is mechanics only — five items with recommendations, in §5E.8:** `.en`-first vs
`.ts`-first emission; payload in the `.en` vs a sidecar; AT-ARCH-1 as gate vs report; archetype
proposal by the miner; how far `compileChunk` moves toward full sentence parsing in the first cut.

**Blocked on, and these are real:** R-ARCH-6 (`extractEntity` returns `undefined` for `className`,
`table` and column names), R-PAY-6 (id renumbering), and the **residual** (§5D.4) — the statements no
word accounts for, which is what stands between the dictionary's measured depth 62 and one word per
file.

## Q-4 — Does the legacy `<CORPUS>/catalog/` tree survive? · CLARIFY · Amir

`<CORPUS>/catalog/` (STEP-4: `operation-idioms.json`, `function-archetypes.json`, and the
hand-curated `coined-words.json`) is a different tree from `<CORPUS>/sen/catalog/` (§1B.4, R-ART-3).
It is explicitly out of scope for the `sen/` wipe (R-CFG-10) and is still read by
`engine/operation-idioms.test.js`, which joins the corpus root directly rather than going through
`AC.pathFor` — deliberately, with a comment saying so.

**Undecided:** whether it is retired, migrated under the artifact contract, or kept indefinitely as
a separate hand-curated tree. Until it is decided, **do not merge or conflate the two catalogs.**
`coined-words.json` is hand-curated and not reproducible by any mine, so a wrong answer here loses
work permanently.

## Q-5 — Which gate threshold is normative? The constants table disagrees with the code. · CLARIFY

§8 records the gate corpus-coverage threshold as **≥ 20%** and then notes that *"the `--min` flag
default in code is 80"*. Those are different requirements, and the table states both without saying
which binds. The worst-file threshold is separately recorded as **disabled (null)** with no per-file
floor enforced.

**What closing it requires:** one decision — the PRD value, the code default, or a deliberate
"coverage is not a gate any more" — and then the losing number deleted rather than annotated. A
constant with two values is not a constant.

## Q-6 — Two requirements that are readings of current behaviour, not requirements · CLARIFY

Flagged rather than silently promoted or cut:

- **`MAXWIN` — MEASURED AND CLOSED, 2026-08-31.** Both halves, and they do not point the same way:

  **The bound DOES bind at 64, and the code's own comment is stale.** The corpus's longest fold
  stream is **77 statements** (`src/hydra-api/invoice.ts`), with **5** streams at 64 or longer, so
  `maxDepth 63 = MAXWIN − 1` is pinning exactly as `build-lzw-generators.js:52` says. The comment
  claiming *"64 → maxDepth 57 (NOT pinned — ceiling found), longest stream in the corpus is 60
  statements"* was true when written; **the corpus grew past it.** Measured without a mine, by
  walking the corpus's own `Block`/`SourceFile` statement runs — the same streams the miner feeds.

  **And relaxing it changes nothing that matters.** `MAXWIN=128`: `maxDepth` **76** on both axes
  (= 77 − 1, so at 128 the ceiling really is the corpus), **+171 composites** per axis, 4.2s mine.
  Rendered against that dictionary: **byte-identity 1037/1037, review surface 16,889 from S =
  33,918, 50.2% — identical to 64, to the statement.** The deeper words exist and the render does
  not use them.

  **So "inert" was the right word for the wrong reason,** and both the PRD and the code comment
  should say the real one: 64 is not past the corpus ceiling, it is past the point where extra
  ceiling buys any review surface. **This does not clear R-ARCH-15** (one word per file) — it
  removes `MAXWIN` from the list of things that could be blocking it, which is what §5D.4 already
  suspected when it named THE RESIDUAL rather than the window bound.

  *Method note: the dictionary was backed up, re-mined at 128, rendered dry-run to a temp directory,
  and the original bytes restored — verified by md5. The re-mine at the default also proved the mine
  deterministic in content: only `minedAt` and the seal over it moved, which is the defect recorded
  in the entry below.*

  *This bullet used to ask only whether "inert" was meant permanently; it did not know the artifact
  disagreed with it. Original text follows.*
  ~~The PRD calls 64 "the point past which the parameter is inert".~~ (§4B, §8, R-MINE-2). The PRD calls 64 *"the point past which the parameter is
  inert"*. On disk, `sen/catalog/generators-lzw.json` reports `maxDepth` **63** on **both** axes —
  exactly `MAXWIN − 1`, which `build-lzw-generators.js:52` **itself** names as the signature of the
  bound **PINNING**. The code's own sweep comment records 64 → *"maxDepth 57 (NOT pinned — ceiling
  found)"*, and the artifact now says 63: either the corpus grew past a 60-statement stream, or that
  comment is stale. **Not resolved by reading.** Closing it is one command — `MAXWIN=128 node
  build-lzw-generators.js`, compare `counts.maxDepth` — and the mine is 1–2s. If depth rises past
  63, "inert" is false and every depth number in this document was measured against a ceiling.
  *This bullet used to ask only whether "inert" was meant permanently; it did not know the artifact
  disagreed with it.*

- **A second live `MAXWIN` — RESOLVED 2026-08-31, and it was not "live".** `engine/enfile.js:34`
  defined `MAXWIN = 8`: same name, different value, different module from the miner's 64. Measured
  before writing the sentence §8 was going to get — **the constant is declared once and never read.
  It was dead.** Deleted rather than documented, with a comment at the site recording that it
  existed and what it was mistaken for. A dead constant that contradicts a live one by name is worse
  than no constant, and worse than a paragraph explaining it: the paragraph makes the reader believe
  there are two windows to reason about.
- **`minCount` appears twice with different values** — `MIN_COUNT = 1` for word promotion
  (§4B, §8, R-MINE-1) and `minCount ≥ 2` for middle-tier body candidacy (§5A, §7.3, R-WIDE-3).
  They are two different thresholds in two different modules, and this document has never said so in
  one place. Confirm the reading, so nobody "fixes" one to match the other.

## Q-7 — Implied but never stated: where does the naming worksheet go? · CLARIFY

The register has no requirement for the naming worksheet's location because the document states
none. `name-words-lzw.js` currently writes its worksheet **into the engine tree**, which is a
straight violation of the location rule (**R-ART-1**: engine code + PRD only, no corpus-derived
bytes). Either the worksheet is corpus-derived and belongs under `<corpus>/.cache/spec-derived/`, or
it is not, and the document should say why.

**This is a gap surfaced by reorganizing, not a new requirement — it is not in the register.**

---

## Q-8 — ~~Does composition depth clear the bar on the REAL corpus?~~ **CLOSED 2026-08-31 by measurement. Yes, by a wide margin.**

**It did not cost a fresh mine.** The dictionary had already been mined that afternoon, so only a
render was needed — `write-en-files.js --dry-run --out <tmp>`, no corpus writes. Q-8 had assumed
"tens of minutes, Amir's call"; the answer cost minutes and no decision.

| | real corpus, 2026-08-31 |
|---|---|
| files | **1,037**, byte-identical **1,037/1,037** |
| generator spans | **5,731 — all recursive, 0 flat fallbacks** |
| composition depth, live `.en` path | **62** |
| composition depth, mined dictionary | **63** |
| composites / composition edges | 112,423 / 224,846 |
| English coverage (bytes) | 82% |
| statements collapsed / calls / net reduction | 22,760 / 5,731 / **17,029** |
| `S` (statements the folder can fold: direct children of every `Block`/`SourceFile`) | **33,918** |
| **statement-collapse ratio** | **50.2%** |
| **review surface** | **16,889** things to read (5,731 calls + 11,158 unfolded: 895 restated, 10,263 verbatim) |
| byte compression | **−19%** (`.en` 4,830,829 B vs `.ts` 4,058,328 B) |

**R-COMP-7's `≥ 2` clears by 30×.** And the answer to the question Q-8 was really asking — the gap
between dictionary depth and live-path depth — is **1** (63 vs 62), not the wide gap the fixture
suggested.

**The number that is still interesting, and it is not the headline one:** the depth histogram spreads
to 62 but **3,249 of 5,731 spans are still at depth 1**. Most spans are shallow even though the
dictionary is deep. That is not a failure of the mechanism — it is exactly the residual §5D.4 names,
and it is where one-word-per-file has to make its gains.

**19% more bytes, 50.2% less to read.** Amir's reframe (§5D.0 statement 8) measured rather than
asserted. *(Published first as 63.5%; that used `fnStmtCount` as the denominator, which counts only
function-body statements while the folder also folds top-level and non-function ones. §7.3 carries
the corrected definition and the sum-to-`S` invariant that now throws instead of publishing a
flattering number.)*

## Q-9 — Naming-stage mechanics · CLARIFY · this lane · §5D.2

**Direction settled** by statement 5: naming is an **LLM step, triggered, but a script in the repo**,
and it **applies** names rather than emitting a worksheet (R-LANG-12, R-LANG-13). What is not settled
is the mechanics, and the current code is on the far side of the change:

- `name-words-lzw.js` today is *"deterministic; zero model calls"* and emits a **worksheet only** —
  its header states *"a generated name Amir did not choose is worse than no name at all"* and
  *"the naming itself is Amir's pass."* That stance is superseded (§5D.3 note 3). The file needs an
  apply path and a model call, both gated.
- **Open:** where the model call lives (a `namer` module with the prompt in-repo, versus shelling to
  a CLI), how a proposed name is gated *before* it is written (byte-identity + coverage invariance
  are re-runs; injectivity is new), and whether the worksheet survives as a **dry-run mode** of the
  same script. **Recommendation: yes** — `--dry-run` writes the worksheet, the default applies.
- **Not open, and narrowed further 2026-08-31 (§5D.3A):** stage 1 stays at zero model calls
  (R-MECH-4), and the model's output is **one lexical token per dictionary entry — the spelling of a
  nonterminal — and nothing else** (R-LANG-11, tightened). The grammar shell is code-owned:
  productions are derived from role signatures (`renderProduction`), and a naming run must be
  **structurally inert modulo names** or it is refused (R-LANG-15). The model has no channel through
  which a sentence, a connective or a slot boundary could arrive; `refine-language.js` already works
  this way and is the precedent stage 2 follows.
- **The output form is no longer open either:** §5D.3B is the hand-authored reference specimen
  (`partners.ts`, today's output beside the target, every line attributed to code / model / mine).
  Stage 2 is checked against it the way the archetype grammar is checked against §5D.1's sentence.
- **THE PHRASEBOOK'S KEY IS DECIDED (§5D.3C):** rules are keyed to the target language's **AST node
  kinds**, one rule per kind, cardinality as a parameter of the rule — **not** to mined shapes. Rules
  compose recursively; an unruled kind falls back to today's unfolded output, so the first rule ships
  alone and nothing regresses (R-LANG-16, R-LANG-17). The LLM's role is unchanged: leaf-level name
  slots only. **Measured:** 8 / 19 / 28 rules for 50 / 80 / 90% of node instances, 53 for 99%, and
  the corpus exercises 100 of TypeScript's 400 `SyntaxKind` values — a set that can be finished,
  against 437 mined templates for the same 90% that could not.
- **Why a phrasebook is needed at all, and it is not a naming problem.** The specimen's first draft
  satisfied every constraint in §5D.3A and was still not English. `renderProduction` emits a
  signature line from a role signature and **cannot** produce prose — no amount of naming fixes that.
  Fluent English requires **declared sentence rules**, human-authored the way `entity-sentence.js`'s
  four lines were. §5D.3C settles what those rules are keyed to; that they must exist is not open.
- **ANSWERED — unnamed-but-ruled is NOT sufficient (§5D.3D, Amir, 2026-09-01): "No."** A recurring
  run of similar statements must be recognised as a **pattern** and collapsed under **one named word
  for the whole chunk**, not rendered as N rule-produced sentences. So **naming has two levels** —
  the chunk (the LZW word) and the leaf (the node-kind rule slot) — and the two mechanisms
  **compose**: the mine claims multi-statement runs first (`genSpans` is 0a PRIMARY, `inGen` fences
  the rest), node-kind rules render the residual. R-LANG-18, R-LANG-19.
- **§5D.3D §4 exposes two things that are Amir's to resolve, and they are not cosmetic:**
  (a) `enfile.js:799`'s rule that a span's sentence is *"COMPOSED from its members' names … never
  invented whole"* directly contradicts one-name-per-chunk, and is what produces today's
  *"import 1 name from a module then import 1 name from a module"*; (b) the `(×N)` run-collapse that
  already exists in `namedLabel` **cannot fire**, because `word-names.json` was deleted — which
  makes the deleted-artifact question **load-bearing for the adopted design**: chunk names have
  nowhere to be stored until it is settled.
- **§5D.4A raises the stakes on `word-names.json` a second time.** The one-word-per-file target
  (R-ARCH-15) is **0/943 today**, and the single largest cause is `enlzw.js:121` still refusing
  whole-run words — the superseded R-MINE-7. Switching it off recovers **308 files (32.7%)**,
  byte-identity intact, one line, no test pins it. **It is blocked on the same artifact:** the
  amended R-MINE-7 permits a whole-run word only when **named**, and no names exist. So one decision
  unblocks both chunk naming and a third of the headline target.
- **~~Should depth 1–8 replace `MIN_COUNT` as the naming boundary?~~ CLOSED 2026-09-01 by
  measurement — REJECTED. Depth is NOT adopted as a naming boundary (§5D.3E).** Amir proposed
  naming every word at depth 1–8 regardless of frequency and leaving d≥9 unnamed. Measured against
  the live dictionary and a full render:
  - **coverage 68.3% vs 100%** — 14,559 of 21,323 in-span statements, against 3,237 names covering
    all of them today;
  - **cost per statement gets WORSE, 0.152 → 0.192 names/statement** (3,237 → 2,789 names, a 14%
    saving, for 31.7% less coverage). The 448 unnamed d≥9 words are 6.6% of the words but **32% of
    the content**, because a deep word is a long one;
  - **it does not address the once-only problem: 88.4%** of used d=1–8 words occur exactly once
    against 87% corpus-wide, and the once-only share **rises** with depth — 79% at d=1, 91% at d=3,
    99% at d=7, **99.1% at d≥9**. **Depth is not a frequency filter**, it is very nearly the
    opposite of one.
  - `depth<=8 OR count>=2` adds exactly **four** words — a measured no-op, recorded because the OR
    looks like a free improvement and is not.
  **What it IS good for is the ORDER** — see R-LANG-20/21. So `MIN_COUNT` should stay a *mining*
  parameter: on the naming path, count is a **priority within a depth tier**, not a gate. That
  leaves only a budget question — how far up the tiers to go — which is genuinely Amir's.
- **A real defect this surfaced:** `name-words-lzw.js:89`, the only naming producer, sorts by depth
  **DESCENDING** and enumerates only top-level emitted words. Every composite is prefix + one leaf
  (0 violations across 115,661 / 126,167 entries), so the dependency relation is a **total order**
  and names must be assigned leaves-first. R-LANG-20 is FAILING as written.
- **Still open, still Amir's:** does `MIN_COUNT` move to 2 on the naming path (87% of live words are
  used exactly once, so leaf names barely amortise while rules and chunk names do).
- **THE PASS IS BUILT, and the three remaining mechanics are PROPOSED, not ruled — §5D.3F
  ([27-naming-pass-mechanics.md](27-naming-pass-mechanics.md)), 2026-09-01.** `name-words.js`
  (`plan` + `name --tier N [--apply]`) over `engine/naming-plan.js` (the order), `engine/namer.js`
  (the only place a model is spoken to) and `engine/naming-gate.js` (byte-identity + payload
  identity + coverage invariance, each shown FAILING against an injected renderer). 36 unit
  assertions, zero model calls, `word-names.json` still at 0 names *(as of that entry; re-measured 2026-09-01 it holds **20 leaf names, 20 chunk names, `modelCalls: 2`** — see §5D.3G. The open question below is unaffected: it is about transport, batch size and retry, none of which those names settle)*. **Amir's to overrule:**
  transport = in-repo `namer` module shelling to the `claude` CLI (what `refine-language.js`
  already does); batch = **40 rows per call, never spanning a depth tier** (a tier boundary is
  R-LANG-20, not a tuning knob); retry = **one re-ask carrying the rejection reason, then leave
  the word UNNAMED** — unnamed falls back to `spanProse`, which renders and compiles correctly,
  so giving up on a name costs one word reading as it reads today and the run stays resumable.
  The worksheet survives as the default DRY RUN, as recommended: `--apply` is the flag that writes.
- **R-LANG-22 RESTATED, 2026-09-02 (Amir's ruling): 2,767 + 3,094 = 5,861 against 3,575 used
  words; 5,408/3,237 is superseded (§5D.3F §2).** Measured at `216f928`, where two independent
  producers agree — `plan` swept 4,787 spans and the renderer's own `en-index.json` reports
  `generators.calls: 4,787`. R-LANG-20's invariant was re-verified on the new catalog: 0 violations
  across 115,832 wide / 126,338 narrow entries at maxDepth 76.
  - **The MAXWIN removal is not what moved it — measured either side of `216f928`, the target goes
    5,862 -> 5,861. One name.** The causes remain the conditional LIFT and the file-set denominator
    (943 against `en-index`'s own 1,037).
  - **AND IT MOVED AGAIN THE SAME HOUR — the register now reads 2,052, pinned to `8882830`.** That
    commit (one word per file, 30.6% -> 93.1%) takes the same sweep to **1,135 spans / 1,018 used
    words / 1,414 leaves + 638 shallow = 2,052 names**, cross-checked against the renderer's own
    `generators.calls: 1,135`. Not a loss: a file rendering as one word emits one span instead of
    five, so the unit of naming got bigger and d>=9 absorbs 380 words. **The chain is
    5,408 -> 5,861 -> 2,052 in one day, so R-LANG-22 now REQUIRES the figure to carry its commit.**
    What does NOT move is banked naming work: names are keyed to the content hash of a leaf skeleton,
    which comes from the dictionary, not the render.
- **THE PILOT MEASURED A REGRESSION, and it is the most important result so far (§5D.3F §2d,
  2026-09-02).** 80 leaves named in 2 model calls: 80/80 accepted, 0 rejected, gate PASSED over 152
  files. **And applying them stripped 72% of the concrete identifiers from the corpus's labels —
  27,673 -> 7,644 across 982 files, 975 of which lost identifiers and 0 of which gained any.** The
  cause is structural: a leaf NAME is hole-free, a node-kind RULE is hole-filled, so naming a leaf a
  rule already renders can only discard the specifics the rule reads out of the holes
  (`import ``ITokenData`` from ``./hydra-ui/...``` becomes `import one named export from a module`).
  **The pilot was REVERTED** — `word-names.json` is byte-identical to its pre-pilot state.
  This turns §5D.2's *"build the phrasebook first, name second"* from an argument into a
  measurement and strengthens it: **naming a rule-covered leaf is a REGRESSION, not a lower
  priority.** R-LANG-21 is untouched — d=0 stays in scope; what changes is which leaves are worth
  a name. **Open, and Amir's:** the plan needs a rule-coverage filter so the model is spent only on
  leaves the node-kind rules do not reach. That filter does not exist and is real work, not a flag.
- **What this leaves genuinely open** is therefore narrower than when Q-9 was written: the transport
  (in-repo `namer` module versus shelling to a CLI), the batch size and retry policy when the gate
  rejects a name, and whether the worksheet survives as `--dry-run`. **None of those can widen the
  blast radius**, which is the point of pinning the split first.

---

## Q-10 — ~~When a re-mine can no longer produce a word an `.en` cites, does the `.en` re-render or fail?~~ **CLOSED 2026-09-04. IT FAILS. A cited word is PINNED.**

**The ruling, from the lane holding Amir's delegation:** *"Once an `.en` cites a word, that word is
PINNED. A re-mine may not silently re-render around it."* If a cited word is re-segmented away, the
re-mine **fails loudly on that `.en`**; it does not quietly re-render it. A pinned citation that can
no longer be satisfied is an error a human resolves, not a diff that happens behind him.

**Why.** The write direction only means anything if English a human typed is authoritative;
re-rendering lets a re-mine silently rewrite text he wrote, which converts his authorship into a
suggestion. A loud failure is recoverable. A silent re-render is the defect class that **scores as
success**, which is the worst kind and the one this project keeps paying for.

**It is complementary to R-PAY-6, not a duplicate of it.** R-PAY-6 (content-addressed ids) closes
**renumbering** — the same pattern getting a different id on the next mine. Pinning closes
**re-segmentation** — the pattern ceasing to be coined at all, because a corpus edit dropped its
window below `createGate` (`wordlzw.js:152`) or a longer window superseded it. Neither closes the
other.

### What building it would require — checked against the repo, 2026-09-04

**The citation is already recorded, and needs no new format.** An `.en` cites a word as
`⟪lzw1 <axis><wordId>⟨` (`enlzw.js:181,300`). Measured: **9,724 citations across 1,037 `.en` files,
4,643 distinct word ids.** The ruling says *every* citation is a pin, so no "pinned" flag has to be
added anywhere — there is nothing to distinguish.

**"Fails loudly" already exists at the site it would need to fire from.** `enlzw.js:71-73`:

```js
function expandKey(axis, id) { const w = ...; if (!w) throw new Error("enlzw: unknown word id " + id); ... }
```

and the two live compile paths — `enfile.js:2482` and `enfile.js:2563` — call `compileSpan`
**uncaught**, so the throw propagates out of the compile rather than degrading to verbatim. The two
`catch (_) { return null }` near it (`:2285`, `:2309`) are inside `repairFromSentence`, where a null
means "could not prove I understood the edit" and falls through to the existing loud refusal. **No
live path swallows it.**

**So the whole cost of this ruling is R-PAY-6.** Today word ids are POSITIONAL — `const id =
dict.length` at `wordlzw.js:62` and `:141` — so after a re-mine an id that still exists may denote a
**different** word: `expandKey` finds an entry, never throws, and the `.en` silently compiles to
other code. **Pinning is therefore not implementable on positional ids at all**, not because the
failure path is missing but because the failure is undetectable. Under content-addressed ids a
re-segmented-away word's id is simply **absent**, the existing throw fires, and the ruling holds with
no new mechanism. That is the honest dependency and it matches the ruling's own reasoning.

**What exists today in its place is a blunt instrument, not a weaker version of this.** `loadIndex`
refuses on a CANON MISMATCH (`enfile.js:191-200`), which invalidates **every** `.en` on any canon
change, per-catalog and not per-citation. It cannot express "this one `.en` cites a word that no
longer exists".

**Full record, with the measurements:** `ASSUMPTIONS.md`, "PIN vs RE-RENDER".
