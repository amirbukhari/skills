# 7. Success criteria

*PART V — ACCEPTANCE · [index](README.md)*

**This section states GATES, not readings.** A PRD says what must be true; it does not carry a
scoreboard. Every number that was a point-in-time measurement has been removed — run the tools for
current values (`npm run measure`, `npm run measure:uncollapsed`, `npm test`). What remains is the
definition of each measure and the bar it must clear, because a definition is a requirement and a
reading is not.

## 7.0 The four gates

| # | Gate | Computed by | Requirement |
|---|---|---|---|
| 1 | **Byte-identity** | `en-index.json → gate.byteIdentical` | **Every file in the corpus, always.** This is the floor and it never regresses. A change that improves readability and loses one byte of identity is a regression, not a trade. |
| 2 | **Vacuous clauses** | `measure-english.js` (i), classifier frozen in `engine/clause-quality.js` | **Zero** — or a floor stated with sampled evidence for why it cannot be zero. |
| 3 | **English-completeness** | `measure-english.js` (ii) | **100%, held.** No clause may carry TypeScript syntax outside quoted verbatim regions. |
| 4 | **Rename queue** | `results/name-queue.json` | **Reported, never minimised.** The number is information, not a target to drive down. |

**Gate 2 — the frozen vacuous classifier.** A fixed list of placeholder clauses (`run a step`,
`compute a value`, `return the result`, `branch on a condition`, …) — the phrases that say only that
*something* happened. It is a frozen array plus a private lookup `Set`; note that `Object.freeze` on
a `Set` does not prevent `.add()`. **The list may be added to; an entry may NEVER be removed to make
the number fall.** That rule is the whole point of freezing it.

**Gate 3 — the English-completeness scanner.** Strip every quoted verbatim region (`` `ids` `` and
`"literals"`) and every parenthetical idiom from a clause; if TypeScript syntax survives in the
residue, the clause is code wearing a sentence's clothes and it fails. This is the mechanical form of
the per-site predicate in §5C, and it is trusted over the author's eye.

## 7.1 The byte-level ceiling is not a gap to close

There are two ceilings and they behave differently.

- **Sentence-level: ~100%.** Every clause the renderer emits can be made to read as English. This is
  gate 3, and it is a real target.
- **Byte-level: bounded well below 100%, and that is correct.** A large share of corpus bytes are
  **code-bearing hole interiors** — expressions with their own syntax. That is **code by nature, not
  a gap**. Rendering it as prose would be a lie the gate-3 scanner exists to catch.

**Requirement: do not chase the byte-level English percentage.** A rise in it achieved by
paraphrasing unique code is a regression in disguise (§3). Report it; do not optimise it.

## 7.2 Panel-quality reading

**"Panel-quality" is the name of an engine metric, not a dependency on any UI.** `measure-english.js`
computes and prints it per archetype. Read it as *"reads well enough to show a human unedited."*

**Definition:** the share of an archetype's bytes inside spans whose every clause is both
English-complete and non-vacuous.

**What it must be measured on.** Panel-quality counts only bytes on the **round-tripping path** —
mined words plus the §5C per-site productions. A number produced by a grammar that does not compile
back byte-exactly does not qualify, whatever it reads like. The comparison that matters is not the
percentage but the **totality**: a hand-authored grammar renders the archetypes someone wrote a
grammar for; this path must render *every* file and compile every one of them back byte-exactly.

## 7.3 Frozen definitions and the remaining gates

**Measurement discipline (a requirement, not a convention).** Every metric is computed by one
committed command reading one field of a committed artifact. `write-en-files.js` regenerates
`en-index.json` into the gitignored cache (`--dry-run --out <dir>` measures without writing to the
corpus); `measure-uncollapsed.js` implements the frozen classifier below and buckets each gap as
MINER / GATE / ARBITRATION per §5A. **No metric is computed by eye**, and "done" must be a number a
second engineer can reproduce, not a judgement.

**Frozen definitions.**

- **Total statements `S`** — the sum of function/method body statements over the enfile-layer walk
  (§4), as counted by `fnStmtCount` in `operations.js`. The fixed denominator.
- **Statement-collapse ratio** = `netStatementReduction ÷ S`, where
  `netStatementReduction = statementsCollapsed − calls`. It is the fraction of body statements
  removed from the reader's view by being folded into a generator call. **Measured 2026-08-31:
  17,029 ÷ 26,824 = 63.5%.**
- **REVIEW SURFACE** = `calls + (S − statementsCollapsed)` = `S − netStatementReduction`. **This is
  the one definition; §5D.4's per-file residual is a component of it, not a rival.** Both are emitted
  by one producer (`en-index.json → reviewSurface`, and `perFile[].reviewSurface` per file), so there
  is exactly one number and one place it comes from.

  **Why a generator call costs ONE and not ZERO.** Reading a word's sentence is cheaper than reading
  the statements it folds, but it is not free — a 10-statement fold removes **nine** units of review,
  not ten. An earlier draft of the per-file counter treated a call as free; it reported 7.7% residual
  on a fixture where this definition reports a 53.8% collapse ratio. The flattering number was the
  wrong one.

  **What is NOT credited:** a statement rendered as its own one-to-one English clause. It is English,
  but it is still one review unit, and §4 names line-by-line restatement *"a failure mode, not the
  goal"*. Credited, the metric would improve by paraphrasing bespoke code. It is reported as
  `restatedStatements` and counted in the surface, not out of it.
- **Un-collapsed repeated structure** — decidable, frozen to one classifier. A function/method body
  qualifies iff **(a)** its WIDE-axis canonical key recurs across the corpus with frequency
  ≥ `minCount` (2); **(a2)** its key has **placeholder density below ½** — of the *N* per-statement
  parts of the key, the number equal to the hole symbol `·` must satisfy **`holes / N < 0.5`**, a
  strict comparison, since exactly one half is not enough; **(b)** it is not covered by a generator
  span in that file's `.en`; and **(c)** it is not claimed by an archetype slot. The metric is the
  **count of files containing ≥ 1 such body**. Membership is a pure function of the two canonical
  keys and the `.en`, so two engineers get the same answer.

  *(a2) is load-bearing and must not be dropped.* Without it, a body whose every statement fails to
  generalize keys as all-placeholders, so every such body collides with every other and each scores
  `freq ≥ 2` — functions sharing no content are counted as repeated structure. Frozen in
  `engine/uncollapsed-density.js`, guarded and mutation-checked by `engine/uncollapsed-density.test.js`.

**The remaining gates.**

| Measure | Requirement |
|---|---|
| **Files with un-collapsed repeated structure** | **→ 0**: every recurring-up-to-renaming body is promoted, or provably non-refillable. |
| **Composition depth on the live `.en` path** (`generators.maxDepth`) | **≥ 2 and rising** — the live compile must expand generators that call generators (§5B). Depth 1 means the flat degenerate path (§2.4). |
| **REVIEW SURFACE** = `calls + (S − statementsCollapsed)` — the things a reader must still read | **→ falling, toward the vocabulary size.** The **headline** metric. **Measured 2026-08-31: 9,795, from S = 26,824 — 63.5% left the reader's view.** Per-file view: `perFile[].reviewSurface`. |
| **Real lossless compression** (`1 − .en ÷ .ts` over the enfile-layer walk) | **NOT A GATE. Reported only.** *This row used to read "Must turn positive and rise" and then "should turn positive and rise"; both are retired — a rise here with review surface flat is **not progress** (see below).* **Measured 2026-08-31: −19%** (`.en` 4,830,829 B vs `.ts` 4,058,328 B) **while 63.5% of statements left the reader's view.** More bytes, far less to read. |
| **Statement-collapse** | Rising, with byte-identity held. |

**Explicitly not a metric: English-%.** It is a by-product; a rise from paraphrasing unique code is a
regression in disguise.

### Review surface is the metric — SETTLED, 2026-08-31

**Amir, 2026-08-31, verbatim:**

> *"its not about compression, its about less of a review surface. I need to be able to review less
> code because im reviewing deterministic code generators which are made of preexisting patterns from
> my code base."*

**This reorders the table above, and it corrects this section.** It used to say *"Byte size IS a
metric… real lossless compression through recursive word reuse is a goal"*. Compression is the
**mechanism**; the **goal** is that a human reviews less. The two come apart, and when they do the
review-surface number wins:

- A change that improves `1 − .en ÷ .ts` while leaving the same number of statements to be read as
  code is **not progress**.
- A change that leaves compression flat but factors 40 residual statements into an existing word
  **is** progress — that is 40 lines a human no longer reads.
- Prose that makes a word's sentence longer but lets a reviewer skip its body is a **win**, even
  though it costs bytes. This is why the byte-size framing had to go: it scored that as a loss.

**Why less review is safe, in Amir's own reasoning:** what he reviews is *"deterministic code
generators which are made of preexisting patterns from my code base."* The generator is
deterministic, so reading it once settles every site it produces; and it is built from patterns
already reviewed in production, so its parts carry their own history. Review effort therefore scales
with the **vocabulary**, not with the corpus — which is the whole return on the mechanism.

**How it is measured:** per §5D.4 move 3, **unclaimed statements per file** — the statements no word
accounts for. Those are exactly the lines still read as code. Reported per file and as a corpus
total, beside byte-identity, never in place of it.

---

## 7A. Payload encoding — requirements

The `.en` payload carries each span's hole fills. Its encoding is a **readability requirement**, not
an implementation detail, because the `.en` is the canonical human artifact (§1).

1. **Payloads MUST be plain readable UTF-8 text, never an opaque blob.** Hole text is the code's own
   identifiers and literals; encoding it opaquely turns the artifact a human is meant to read and
   edit into something they cannot. The `lzw1` encoding (`engine/payload.js`) is the live form:
   `lzw1 <axis><wordId>⟨hole⟨hole…`, holes introduced by `⟨` and running to the next `⟨` or the
   payload end, with no closing bracket.
2. **The failure mode this rule exists to prevent:** an opaque payload scales with success — each
   newly mined word appends more blob, so **improving the miner actively degrades the artifact**.
   Any future encoding must be checked against that property.
3. **Sentinel safety MUST be structural, not incidental.** The `.en` scanner locates spans by
   searching for its sentinels, which is sound only if no payload can contain one. Escaping provides
   that **by construction**, so an encoded payload provably contains none of `« » ⟪ ⟫ ▶ ⟨`. This must
   not rest on an assumption about what source happens to contain — that no sentinel appears in a
   given corpus today is luck, and luck is a hazard, not a guarantee.
4. **`decode()` MUST be fail-closed.** Wrong tag, bad axis, missing id, or unknown escape all throw.
   A stale payload in a superseded encoding is named specifically, so the fix is obvious.
5. **Readability beats further compression.** Hole dedup via a shared fill table, and parameter
   hoisting, both compress further and both replace visible source text with an indirection a reader
   must resolve by hand. Per §3, and Amir's standing instruction that compression is the strategy and
   not the point, they are **rejected**. Residual negative compression from gloss prose and span
   structure — which the `.ts` does not carry — is honest and acceptable.

Guarded by `engine/dialect-guard.test.js`, mutation-checked per §10.3.

---
