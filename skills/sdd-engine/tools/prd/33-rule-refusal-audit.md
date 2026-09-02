# §5D.6 — The silent rule mismatch detector: refusals, named

*Amir, 2026-09-01: "when a node-kind rule's catalog entry stops matching current source, the
byte-gate just silently declines to apply (file falls back to raw code) — nothing counts or names
these refusals. That's fail-safe but not detection." Build a check that counts and names every
rule-refusal so drift is visible instead of just silently degrading collapse.*

The shape was already named in the PRD: *"a catalog with no consumer on the byte-exact path is not a
layer; it is drift waiting for an audience"* (`05-architecture.md`). This is the audience.

## 1. What was built

`engine/refusals.js` — a recorder with a **closed six-reason vocabulary**, off by default, that
names **which rule**, **which file and span**, and **why** for every refusal on the byte-exact path.
`audit-rules.js` — the consumer: renders the whole corpus with the sink installed, re-checks
byte-identity first, and prints (or streams as `sdd-progress/v1` NDJSON) the refusals by reason, by
rule with named span samples, and by file.

The recording sites are the places a rule actually declines: `enlzw.js runWord` (all four dictionary
reasons), `enfile.js chunkGloss` (one per refusing clause), and `enfile.js spanActions`' chunk-rule
pre-pass. **Not one decision changed** — the render path with no sink installed is a null check, and
the corpus numbers after the change are identical: byte-identity 1037/1037, review surface 1,610 /
29,260, 19,102 atomic + 9,612 structural chunks, max nest depth 14.

## 2. Measured, on the corpus, 2026-09-01

    refused spans   295   (from 295 gate consultations)

    142  no-word    dictionary:ExpressionStatement           [78 files]
    135  no-word    dictionary:FirstStatement                [88 files]
     12  no-symbol  generalStmtParts:FirstStatement          [2 files]
      6  no-symbol  generalStmtParts:InterfaceDeclaration    [1 file]

153 files carry at least one; the worst is `src/hydra-api/massCredits/index.ts` at 17. Every row
carries named samples (`src/csvUtils.ts:1729-1921  run of 2 starting ExpressionStatement`), because
"which file/span" was the deliverable, not a count.

`rule-declined` and `gloss-refused` are **0 on the live path** — not because those gates always
pass, but because the nested renderer does not consult them: `chunkGloss` is the flat renderer's
`wholeRunOk` hook (`enfile.js:1454`), reached only under `NEST=0`. Both are shown firing in
`rule-refusals.test.js`, each with a control proving the gate does not refuse everything.

## 3. The finding: the obvious drift gate is a tautology

The design that suggests itself is to count the refusals that mean *"the catalog no longer matches
these bytes"* — `parts-inexact` (the skeleton would not refill) and `byte-gate` (it refilled to
different bytes) — and demand zero. Both are zero. Both are **unreachable by construction**:

- `runWord` establishes that *every* statement in the run canonicalizes before it calls
  `windowParts`, and `windowParts` returns null only when one does not. `parts-inexact` cannot fire.
- Every part list is self-verified `fillOf === exact source slice` inside `stmtPartsExact` /
  `genericExact` (`generators.js:95`, `:154`), and inter-statement gaps carry literal source trivia.
  The refill cannot differ from the slice. `byte-gate` cannot fire.

Publishing that zero as a passing guard is exactly what R-MECH-8 forbids and what §10.3 calls
not-a-guard. So it is published as **UNREACHABLE, with the argument**, and `rule-refusals.test.js`
asserts both that the count is 0 **and** that `reachable === false` — so the day someone reorders
`runWord`, the claim fails a test instead of quietly becoming false.

The deeper fact those dead branches teach: **the LZW dictionary is keyed on canonical symbols and
never supplies bytes.** The fill always comes from live source. A stale catalog entry therefore
cannot produce a wrong file — it can only stop matching, and that surfaces as an ordinary `no-word`,
indistinguishable in a single run from a shape that was never mined.

## 4. So drift is measured as a CHANGE

Drift in this layer is not observable in one run. It is observable differentially:

    node audit-rules.js --write-baseline     # record per-rule refusal counts
    node audit-rules.js                      # fail if any rule refuses MORE than at baseline

A rule whose count **rose** used to match this corpus and stopped — the silent degradation, now
loud, named, and exit-code-bearing. A rule whose count **fell** is collapse improving: reported,
never failed. With no baseline on disk the audit reports and passes, and says which flag records
one. The baseline lives at `<corpus>/.cache/spec-derived/rule-refusals.baseline.json` — gitignored,
regenerable, and deliberately **not** dressed as a registered artifact, since hand-stamping a schema
header onto an unregistered kind is the landmine CLAUDE.md §8 warns about.

Proved end-to-end in `rule-refusals.test.js` case 6, the way drift actually happens — source moving
under a fixed catalog: a real corpus file is copied into a throwaway tree, `SOURCE` points at the
copy, an `interface` the dictionary was never mined on is appended, and the audit exits 1 with

    0 -> 1  (+1)  dictionary:InterfaceDeclaration no-word
    0 -> 1  (+1)  dictionary:ImportDeclaration no-word

The corpus itself is never written to. The control — unchanged source against its own baseline —
exits 0, so the gate is shown not to be a blanket failure.

## 5. Requirements

R-DRIFT-1 (every refusal recordable, naming rule / file+span / why), R-DRIFT-2 (drift gated
differentially, never on a counter that cannot fire), R-DRIFT-3 (an unreachable reason published as
unreachable, with its argument). Checks: `engine/rule-refusals.test.js` (27 assertions),
`verify-register.js` rows R-DRIFT-1 and R-DRIFT-2 — the latter fails if anyone reinstates a `drift`
sum over the dead counters.

## 6. What this does not cover

This is the **mined-word** layer. `§5F` (`32-archetype-drift-check.md`) is the archetype layer's own
drift signal — residual statements a file's archetype has no slot for. They are complementary: one
reports a word that stopped matching, the other a shape that never fit. Neither subsumes the other,
and no single number should be built over both without saying which question it answers.
