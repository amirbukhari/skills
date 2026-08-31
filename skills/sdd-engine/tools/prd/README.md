# PRD — English-as-Source (the repo-DSL engine)

The PRD, split one file per section. **Scaffold only:** every file below is a stub — the real
content still lives in `../PRD.md`, which another session is actively editing. Content is migrated
section by section as each one stabilises, and `../PRD.md` stays the source of truth until it is
reduced to a pointer at this file.

Structure follows the PRD's own `PART I–VI` divisions. Ordinals are physical reading order; the
`§` label is the citation authority, because the PRD's numbering is deliberately non-sequential
(§5 precedes §4, §1B sits in PART IV) and engine source comments cite `§N` directly.


**Front matter**

| # | § | section | lines | sub-§ |
|---|---|---|---|---|
| 00 | — | [How to read this document](00-how-to-read.md) | 26 | — |
| 01 | — | [Glossary — the eight terms that carry the design](01-glossary.md) | 17 | — |

**PART I — WHAT THIS IS**

| # | § | section | lines | sub-§ |
|---|---|---|---|---|
| 02 | §1 | [1. Problem & goal](02-problem-and-goal.md) | 25 | — |
| 03 | §2 | [2. Non-negotiable principles](03-non-negotiable-principles.md) | 13 | — |
| 04 | §3 | [3. Explicit NON-goals](04-explicit-non-goals.md) | 15 | — |

**PART II — THE MECHANISM**

| # | § | section | lines | sub-§ |
|---|---|---|---|---|
| 05 | §5 | [5. Architecture](05-architecture.md) | 109 | 1 |
| 06 | §4 | [4. The layers, and how they are measured](06-layers-and-measurement.md) | 61 | 5 |
| 07 | §4A | [4A. The live path MUST be the recursive LZW dictionary](07-live-path-recursive-lzw.md) | 61 | 1 |
| 08 | §5A | [5A. The middle-tier generator layer — specified as a flow](08-middle-tier-generator-layer.md) | 26 | — |
| 09 | §5B | [5B. The composition layer — specified as a requirement](09-composition-layer.md) | 19 | — |
| 10 | §5C | [5C. Language and grammar — how a word becomes a sentence](10-language-and-grammar.md) | 97 | 7 |

**PART III — THE REQUIREMENTS REGISTER**

| # | § | section | lines | sub-§ |
|---|---|---|---|---|
| 11 | §R | [§R The requirements register](11-requirements-register.md) | 207 | 13 |

**PART IV — CONTRACTS, CONFIGURATION AND LAYOUT**

| # | § | section | lines | sub-§ |
|---|---|---|---|---|
| 12 | §8 | [8. Constants](12-constants.md) | 40 | 1 |
| 13 | §8B | [8B. THE ARTIFACT CONTRACT — location, header, and enforcement (2026-08-31)](13-artifact-contract.md) | 138 | 1 |
| 14 | §1B | [1B. THE TWO ROOTS — `SOURCE` and `CORPUS`, and the `sen/` folder](14-two-roots.md) | 160 | 6 |

**PART V — ACCEPTANCE**

| # | § | section | lines | sub-§ |
|---|---|---|---|---|
| 15 | §7 | [7. Success criteria](15-success-criteria.md) | 132 | 5 |
| 16 | §10 | [10. Test integrity — what a test is allowed to assert against](16-test-integrity.md) | 29 | — |
| 17 | §9 | [9. Load-bearing assumptions](17-load-bearing-assumptions.md) | 24 | — |

**PART VI — WHAT IS NOT DECIDED**

| # | § | section | lines | sub-§ |
|---|---|---|---|---|
| 18 | §Q | [§Q Open questions — none of these may be resolved by inference](18-open-questions.md) | 117 | 7 |
| 19 | §6 | [6. Open technical fronts](19-open-technical-fronts.md) | 19 | — |

**20 files, 1335 lines** to migrate (`PRD.md` is 1387 lines; the balance is the `# PRD` title
block and the `# PART` divider lines, which live in this README's structure instead).

## Structural decisions

- **`§4A` and `§8B` are promoted out of their parents** (Amir, 2026-08-31). Both are the most-cited
  anchors in the engine source — dozens of comments say "PRD §8B" — and neither *Constants* nor
  *The layers* is a findable home for a reader told to go read them. `§4B`, `§8A` and `§8C` stay
  with their parents.
- **`## Table of contents` gets no file.** This README is that table; a second one would be a
  second thing to keep in sync. Its content is not migrated — it is replaced.
- **`§R` (register, 13 `R-*` groups) and `§Q` (7 questions) stay one file each.** Both are
  registers cited by item id (`R-ART`, `Q-4`), so splitting them would scatter a lookup table.
- **`§6 Open technical fronts` currently sits after `PART VI`** in `PRD.md`, outside any part. It is
  scaffolded in physical order (last) and flagged — it most likely belongs in PART VI, but that is a
  content call for whoever finishes the restructure.
