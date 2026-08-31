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
- **THE LIFT — a file is never one word.** The renderer **refuses any word that covers an entire
  run**. Without it a file can be tiled by a single whole-file span, and the reader sees one opaque
  reference instead of the file's structure. Every file must render as its constituent words.

**Settled — do not re-open without new measurement:**

- **The unit-boundary rule STAYS.** No span may straddle two or more units: a word means one thing.
  Amir's call, and the readability of every clause downstream depends on it.
- **`MIN_SKEL` stays 8.** Lowering it buys files by promoting near-trivial two-statement words — a
  number bought with readability.
- **Holes stay verbatim TypeScript.** See the hole taxonomy in §5C.
- **"Write the `.en` and get the file back" is the STANDING STATE, not a roadmap item.** Byte-identity
  already holds across the corpus. Every criterion in §7 is a question about *how the `.en` reads*,
  never about whether it compiles back.

---
