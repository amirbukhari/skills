## 4A. The live path MUST be the recursive LZW dictionary

*PART II — THE MECHANISM · [index](README.md)*

**What the wrong mechanism looked like** — worth recording, because it is the failure to recognise:
the compiler discovered patterns by anti-unification / clone detection, canonicalizing each
statement or body to a skeleton-with-holes and grouping identical skeletons. That finds **flat
clones** but never builds a recursive dictionary — no entry is defined as "a previous entry plus one
symbol", so nothing references anything else, every hole is verbatim TypeScript, and a generator's
span can end up **larger than the code it replaces**.

**The requirement.** `engine/enfile.js` loads the LZW dictionary as the **ONLY** generator layer,
through `engine/enlzw.js`. Words are LZW dictionary entries (`m[0]`/`m[1]` = a prior entry plus one
symbol), so generators reference generators by construction and `expand` recurses to leaves exactly
as §5B specifies. **The flat path is deleted, not bypassed** — a bypassed alternative producer is the
§8B drift shape waiting to happen.

**`engine/generators.js` is NOT the flat layer** — recorded so nobody deletes it by mistake. It is
the shared AST canonicalization library (`keyOf`, `refill`, `generalStmtParts`, `isFoldable`,
`skelBytes`) that `enlzw.js` and `build-lzw-generators.js` are built on.

**Diagnostic requirement: attribute every un-collapsed body.** `measure-uncollapsed.js` buckets each
one as **MINER**, **GATE**, or **ARBITRATION** per §5A admission. This matters because the three have
different fixes: a MINER gap is a word never mined, a GATE gap is a refill that failed, an
ARBITRATION gap is a span lost to a competing claim. A bare count without that split is not
actionable.

---

## 4B. Mining parameters — settled design decisions

These are decisions, not tuning knobs to be re-litigated.

- **`MIN_COUNT` is 1 — a word need not recur.** A threshold of 2 encodes the assumption that only
  shared structure is worth naming. It is not: a file's own shape is admissible vocabulary, and a
  word used once still buys the reader a sentence in place of a statement. Compression comes from the
  **dictionary's recursion** (§5 step 3), not from a frequency floor.
- **`MAXWIN` is 64, which is the point past which the parameter is inert.** MAXWIN binds only
  `maxDepth`; raising it past the longest node stream in the corpus can do nothing. It is a ceiling,
  not a tuned value.
- **Imports and declarations are foldable.** `isFoldable` once excluded them, which removed the most
  regular structure in the corpus from the dictionary. They are admitted like any other statement and
  gated identically.
- **The canonicalizer rolls back rather than lying.** When a sub-expression cannot be refilled
  byte-exactly, it does **not** fail the whole skeleton: it rolls that sub-expression back to an
  opaque hole and keeps the surrounding structure.
- **THE LIFT — a file is never one *opaque* word.** The renderer **refuses a whole-run word that is
  unnamed or unexpandable**. A whole-run word that carries a name and an `explain` tree is
  **permitted, and is the target** (R-ARCH-15).

  *This bullet said, until 2026-09-03:* **"THE LIFT — a file is never one word.** The renderer
  **refuses any word that covers an entire run**. Without it a file can be tiled by a single
  whole-file span, and the reader sees one opaque reference instead of the file's structure. Every
  file must render as its constituent words.*"* **Superseded by Amir's ruling of 2026-09-03**, which
  resolved a contradiction that had stood since R-MINE-7 was amended on 2026-08-31: the register row
  had carried the amended form for three days while this prose still carried the original, so the
  two halves of the PRD asserted opposite rules and `the-lift.test.js` had to report both counts
  rather than rule. **The prose was the stale half.** The reasoning, in Amir's words: the worry
  behind THE LIFT was *"the reader sees one opaque reference instead of the file's structure"* — and
  a **named, expandable** word is not opaque, the structure is one expansion away. His own approved
  rendering target opens with a short whole-file line that expands. So the amended form is correct
  and the original was over-broad: it refused the destination in order to forbid the failure mode.

  **Consequence, measured:** the 257 files that render as a single top-level chunk are **not**
  violations. Under the original wording they were 257 breaches; under the amended wording the
  number that matters is the **unnamed-or-unexpandable** count, which `engine/the-lift.test.js`
  now asserts directly instead of reporting a strict figure beside an amended one.

**Settled — do not re-open without new measurement:**

- **The unit-boundary rule STAYS.** No span may straddle two or more units: a word means one thing.
  Amir's call, and the readability of every clause downstream depends on it.
- **`MIN_SKEL` is 1** — amended 2026-09-03. **Superseded wording, kept per §9:** *"`MIN_SKEL` stays 8.
  Lowering it buys files by promoting near-trivial two-statement words — a number bought with
  readability."* That bullet was settled against the wrong metric. It defended `netStatementReduction`;
  the deliverable is **review surface**, the count of statements a human must still read as code.
  Measured over the full corpus: **1582 → 1086 top, 20999 → 20214 tree**, byte-identity **1037/1037**,
  and **zero** hand-authored chunk names orphaned. The premise was also wrong on its own terms — the
  skeletons below the floor are not near-trivial. `skelBytes()` strips holes **before** the floor, so
  `return ‹expr›;` measures as `return;` = 7 bytes; the 71 narrow / 118 wide skeletons under the floor
  are 0.06% of the dictionary and they are the **core statement grammar**. It was a length filter doing
  a triviality filter's job, and for statements those anti-correlate. The readability cost is real and
  was accepted on a **sample**, not a full reading.
- **Expression slots (`SDD_EXPR_SLOT`) stay OFF, and this REVERSES a ruling** — 2026-09-03. They were
  ruled on together with `MIN_SKEL=1`, as one package. Measured separately, they are not one package
  and they point opposite ways:

  | config | review surface top | tree | chunk names orphaned |
  |---|---|---|---|
  | before | 1,582 | 20,999 | — |
  | `MIN_SKEL=1` | **1,086** | **20,214** | **0** (19 re-resolve) |
  | `SDD_EXPR_SLOT=1` | 3,457 | 23,820 | 299 |
  | both | 1,086 | 20,214 | 299 |

  Expression slots buy **nothing** on top of `MIN_SKEL=1` — the surface is identical to the digit,
  against catalogs with genuinely different hashes — and alone they make it **worse by 1,875**. They
  are also a **canon change** (`canon-fingerprint.js` moves; `MIN_SKEL` does not, per §10:42), which is
  what the 299 orphans are. The whole gain is `MIN_SKEL`; the whole cost is the slots. Taking the two
  apart was worth the four mines it took to measure.

  *Why they cannot help:* the LZW dictionary composes over **statement sequences**. Expression slots
  vary structure **within** a statement, below the level anything composes at.
- **Holes stay verbatim TypeScript.** See the hole taxonomy in §5C.
- **"Write the `.en` and get the file back" is the STANDING STATE, not a roadmap item.** Byte-identity
  already holds across the corpus. Every criterion in §7 is a question about *how the `.en` reads*,
  never about whether it compiles back.

---
