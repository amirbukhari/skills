# PRD — English-as-Source (the repo-DSL engine)

The PRD, one file per section. Content was **migrated and verified** against the single-file PRD before that file was reduced:
every substantive line accounted for, the only non-carried lines being the old table of contents and
the `# PART` dividers, whose job this table now does. Re-verified independently at collapse time —
zero substantive lines missing.

`../PRD.md` has been **collapsed to a pointer at this file** — the migration is complete and the
duplication is gone. This directory is the PRD. Edit the section file, never the pointer; the pointer
changes only when a section is added, removed or renamed, and then both change in the same commit so
a `§`-citation from the code never dead-ends.

Ordinals are physical reading order. The section label (`§8B`, `R-ART`, `Q-4`) is the citation
authority, because the numbering is deliberately non-sequential — §5 precedes §4, §1B sits in
PART IV — and engine source comments cite it directly.

**Front matter**

| # | section | lines |
|---|---|---|
| 00 | [How to read this document](00-how-to-read.md) | 27 |
| 01 | [Glossary — the eight terms that carry the design](01-glossary.md) | 16 |

**PART I — WHAT THIS IS**

| # | section | lines |
|---|---|---|
| 02 | [1. Problem & goal](02-problem-and-goal.md) | 26 |
| 03 | [2. Non-negotiable principles](03-non-negotiable-principles.md) | 14 |
| 04 | [3. Explicit NON-goals](04-explicit-non-goals.md) | 15 |

**PART II — THE MECHANISM**

| # | section | lines |
|---|---|---|
| 05 | [5. Architecture](05-architecture.md) | 110 |
| 06 | [4. The layers, and how they are measured](06-layers-and-measurement.md) | 62 |
| 07 | [4A. The live path MUST be the recursive LZW dictionary](07-live-path-recursive-lzw.md) | 62 |
| 08 | [5A. The middle-tier generator layer](08-middle-tier-generator-layer.md) | 27 |
| 09 | [5B. The composition layer](09-composition-layer.md) | 20 |
| 10 | [5C. Language and grammar — how a word becomes a sentence](10-language-and-grammar.md) | 96 |

**PART III — THE REQUIREMENTS REGISTER**

| # | section | lines |
|---|---|---|
| 11 | [§R The requirements register](11-requirements-register.md) | 207 |

**PART IV — CONTRACTS, CONFIGURATION AND LAYOUT**

| # | section | lines |
|---|---|---|
| 12 | [8. Constants](12-constants.md) | 41 |
| 13 | [8B. THE ARTIFACT CONTRACT](13-artifact-contract.md) | 139 |
| 14 | [1B. THE TWO ROOTS — SOURCE and CORPUS, and the sen/ folder](14-two-roots.md) | 160 |

**PART V — ACCEPTANCE**

| # | section | lines |
|---|---|---|
| 15 | [7. Success criteria](15-success-criteria.md) | 133 |
| 16 | [10. Test integrity](16-test-integrity.md) | 30 |
| 17 | [9. Load-bearing assumptions](17-load-bearing-assumptions.md) | 23 |

**PART VI — WHAT IS NOT DECIDED**

| # | section | lines |
|---|---|---|
| 18 | [§Q Open questions](18-open-questions.md) | 118 |
| 19 | [6. Open technical fronts](19-open-technical-fronts.md) | 20 |
| 20 | [§5E Archetype/word hybrid — the design](20-archetype-hybrid-design.md) | 414 |
| 21 | [§5D.3B Naming-stage reference specimen — `partners.ts`](21-naming-specimen.md) | 249 |
| 22 | [§5D.3C Node-kind rules — the adopted stage-2 design](22-node-kind-rules.md) | 124 |
| 23 | [§5D.3D Naming has two levels — the chunk and the leaf](23-two-naming-levels.md) | 121 |
| 24 | [§5D.4A One word per file — the mechanism, the measurement, and the implementation](24-one-word-per-file-measured.md) | 238 |
| 25 | [§5D.3E Depth-bounded naming — rejected as a boundary, adopted as an order](25-depth-naming-evaluated.md) | 189 |
| 26 | [§5D.4C The arbitrary ceilings removed — and what actually blocks one word per file](26-ceiling-removed.md) | 159 |
| 26 | [§5D.3F The naming pass — built, and the three Q-9 mechanics proposed](26-naming-pass-mechanics.md) | 156 |
| 27 | [§5D.4E The rule-coverage filter — the leaf tier is 98% already done](27-rule-coverage-filter.md) | 118 |
| 27 | [§5D.4D One word per file, chosen over compression](27-one-word-first.md) | 133 |
| 28 | [§5D.4E Nested rendering: words made of words, to leaves](28-nested-rendering.md) | 108 |
| 29 | [§5D.5 The NDJSON progress stream](29-progress-stream.md) | 72 |
| 30 | [§5F Architecture drift detection: residual is the drift signal](30-archetype-drift-check.md) | 108 |

## How the split was made

Mechanical and re-runnable, not hand-edited:

- **Boundaries** are the PRD's own `##` sections, plus `§4A` and `§8B` promoted out of their
  parents (Amir, 2026-08-31). Both are the most-cited anchors in the engine source — dozens of
  comments say "PRD §8B" — and neither *Constants* nor *The layers* is a findable home for a
  reader sent to read them. `§4B`, `§8A` and `§8C` stay with their parents.
- **Content is byte-identical** to its `PRD.md` slice, with exactly two transformations: heading
  levels are promoted one (`##` → `#`) so each file reads standalone, and a one-line breadcrumb
  sits under the title. Headings inside fenced code blocks are left alone. A verifier reverses
  both and compares to the source; all 20 files round-trip exactly.
- **`## Table of contents` has no file** — this README is that table. Its 44 lines are replaced,
  not migrated, so there is only one index to keep in sync.
- **`§R` (13 `R-*` groups) and `§Q` (7 questions) stay whole.** Both are registers cited by item
  id; splitting them would scatter a lookup table.

Known wart: **`§6 Open technical fronts` sits after `PART VI`**, outside any part — it is filed last,
in physical order. *(This used to say "in `PRD.md`"; `PRD.md` is now a pointer file and the wart is
in this index.)* It most likely belongs inside PART VI, but that is a content call.
