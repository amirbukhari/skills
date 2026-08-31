# §Q Open questions — none of these may be resolved by inference

*PART VI — WHAT IS NOT DECIDED · [index](README.md)*

**Read this part before making any design decision.** Everything here is genuinely undecided.
Guessing at one of them and building on the guess is the most expensive mistake available in this
project, and it has happened. Each entry says who can close it and what closing it requires.

**Severity.** **BLOCKING** — work that depends on it must stop and ask. **DESIGN** — needs a written
design pass, then confirmation. **CLARIFY** — a contradiction or gap in this document that someone
must settle so the register stops being ambiguous.

---

## Q-1 — ~~Direction of truth: does English ever become authoritative?~~ **ANSWERED 2026-08-31 by Amir. YES — the sentence is authoritative.**

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
- **`compileChunk` must derive the payload from the sentence** rather than only reading it (§5E.5,
  open mechanic 5).
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

- **`MAXWIN` "inert" is CONTRADICTED BY THE ARTIFACT — this is now a measurement, not a
  confirmation** (§4B, §8, R-MINE-2). The PRD calls 64 *"the point past which the parameter is
  inert"*. On disk, `sen/catalog/generators-lzw.json` reports `maxDepth` **63** on **both** axes —
  exactly `MAXWIN − 1`, which `build-lzw-generators.js:52` **itself** names as the signature of the
  bound **PINNING**. The code's own sweep comment records 64 → *"maxDepth 57 (NOT pinned — ceiling
  found)"*, and the artifact now says 63: either the corpus grew past a 60-statement stream, or that
  comment is stale. **Not resolved by reading.** Closing it is one command — `MAXWIN=128 node
  build-lzw-generators.js`, compare `counts.maxDepth` — and the mine is 1–2s. If depth rises past
  63, "inert" is false and every depth number in this document was measured against a ceiling.
  *This bullet used to ask only whether "inert" was meant permanently; it did not know the artifact
  disagreed with it.*

- **A second live `MAXWIN`.** `engine/enfile.js:34` defines `MAXWIN = 8` — same name, different
  value, different module from the miner's 64, and undocumented. Not a contradiction (they bound
  different windows) but a name collision that will mislead someone. Needs one sentence in §8 saying
  which is which.
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
| `S` (body statements, `fnStmtCount` over the same walk) | **26,824** across 8,794 bodies |
| **statement-collapse ratio** | **63.5%** |
| **review surface** | **9,795** things to read (5,731 calls + 4,064 unfolded) |
| byte compression | **−19%** (`.en` 4,830,829 B vs `.ts` 4,058,328 B) |

**R-COMP-7's `≥ 2` clears by 30×.** And the answer to the question Q-8 was really asking — the gap
between dictionary depth and live-path depth — is **1** (63 vs 62), not the wide gap the fixture
suggested.

**The number that is still interesting, and it is not the headline one:** the depth histogram spreads
to 62 but **3,249 of 5,731 spans are still at depth 1**. Most spans are shallow even though the
dictionary is deep. That is not a failure of the mechanism — it is exactly the residual §5D.4 names,
and it is where one-word-per-file has to make its gains.

**19% more bytes, 63.5% less to read.** Amir's reframe (§5D.0 statement 8) measured rather than
asserted.

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
- **Not open:** that stage 1 stays at zero model calls, and that the LLM touches names and grammar
  surface only (R-MECH-4, R-LANG-11).
