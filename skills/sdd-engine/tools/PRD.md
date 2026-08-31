# PRD — English-as-Source (the repo-DSL engine)

> **This file is a pointer. The PRD lives in [`prd/`](prd/README.md), one file per section.**
>
> Start at **[`prd/README.md`](prd/README.md)** — it is the table of contents and the reading order.

**If you are an agent picking this up cold and building:** read
[`prd/00-how-to-read.md`](prd/00-how-to-read.md) first, then
[`prd/11-requirements-register.md`](prd/11-requirements-register.md), which is the normative build
list — 113 requirements as `R-<AREA>-<n>`, each a testable sentence with the check that decides it.
Read [`prd/18-open-questions.md`](prd/18-open-questions.md) before making any design decision: it is
what is *not* decided, and guessing at one of those is the most expensive mistake available here.

## Why this file is only a breadcrumb

It held the whole PRD until the content was migrated into `prd/` and byte-verified. Two copies of a
specification is worse than either arrangement — the second one goes stale silently, and a reader has
no way to tell which is current. So this one was collapsed rather than kept in sync.

Nothing was lost in the collapse. Every substantive line was verified present in `prd/` before this
file was reduced; the only lines that did not carry over are the old table of contents and part
dividers, whose job `prd/README.md` now does.

## Resolving a `§`-citation from the code

Engine source comments cite section labels directly — `artifact-contract.js` alone cites `§8B`, `§8A`,
`§10.3` and `§1`. **The labels did not change.** Look the label up here:

| cited as | lives in |
|---|---|
| `§1` problem & goal | [`02-problem-and-goal.md`](prd/02-problem-and-goal.md) |
| `§2` non-negotiable principles (P1–P4) | [`03-non-negotiable-principles.md`](prd/03-non-negotiable-principles.md) |
| `§3` non-goals | [`04-explicit-non-goals.md`](prd/04-explicit-non-goals.md) |
| `§5`, `§5D` architecture, the tiers, the fold, the archetype hybrid | [`05-architecture.md`](prd/05-architecture.md) |
| `§4` the layers and the denominator rule | [`06-layers-and-measurement.md`](prd/06-layers-and-measurement.md) |
| `§4A`, `§4B` the live LZW path, mining parameters | [`07-live-path-recursive-lzw.md`](prd/07-live-path-recursive-lzw.md) |
| `§5A` the middle-tier generator layer | [`08-middle-tier-generator-layer.md`](prd/08-middle-tier-generator-layer.md) |
| `§5B` the composition layer | [`09-composition-layer.md`](prd/09-composition-layer.md) |
| `§5C` language and grammar | [`10-language-and-grammar.md`](prd/10-language-and-grammar.md) |
| `§R`, `R-MECH`…`R-TEST` the requirements register | [`11-requirements-register.md`](prd/11-requirements-register.md) |
| `§8` constants, `§8A` SOURCE-PROTECTED artifacts | [`12-constants.md`](prd/12-constants.md) |
| `§8B` the artifact contract, `§8C` corpus pinning | [`13-artifact-contract.md`](prd/13-artifact-contract.md) |
| `§1B` the two roots, `sen/`, wipability, the one-file rule | [`14-two-roots.md`](prd/14-two-roots.md) |
| `§7`, `§7A` success criteria, payload encoding | [`15-success-criteria.md`](prd/15-success-criteria.md) |
| `§10`, `§10.3` test integrity | [`16-test-integrity.md`](prd/16-test-integrity.md) |
| `§9` load-bearing assumptions | [`17-load-bearing-assumptions.md`](prd/17-load-bearing-assumptions.md) |
| `§Q`, `Q-1`…`Q-7` open questions | [`18-open-questions.md`](prd/18-open-questions.md) |
| `§6` open technical fronts | [`19-open-technical-fronts.md`](prd/19-open-technical-fronts.md) |

**`§1A` resolves to nothing, on purpose.** The three-root proposal (`EN_ROOT` / `TS_ROOT` /
`BUILD_ROOT`) was **cut**, not moved — Amir, 2026-08-31: *"The PRD still has a TON of stale data in
it. like the 3 folders shit."* The engine has two roots; see
[`14-two-roots.md`](prd/14-two-roots.md). What remains open about the direction of truth is `§1B.5`
there, and `Q-1`.

## Editing rule

Edit the section file, never this one. This file changes only when a section is added, removed or
renamed — in which case update the table above and `prd/README.md` in the same commit, so a
`§`-citation from the code never dead-ends.
