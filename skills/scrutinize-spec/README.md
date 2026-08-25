# Spec Scrutinizer

Scrutinizes a spec and iteratively refines it until a **deterministic confidence score** clears 95% — the bar for handing it to an AI coding agent and having it one-shot the implementation without clarifying questions or risky assumptions.

Previously distributed as the standalone `PRDScrutinizer` plugin (last release v2.0.0). Moved here and consolidated; this folder is now the only home.

No API keys and no separate app — it runs inside a Claude Code session using Claude's own reasoning for the analysis, plus two dependency-free Node scripts that compute the actual gated scores in plain code. That gate is the point: the tool cannot claim "95% confident" because a model felt like saying so. A blocking gap caps the score no matter what the weighted average says.

## Two modes

**Document mode** — one PRD, build spec, or requirements doc. Asks: *could someone build this without asking questions?*

**Folder mode** — a spec folder that is the source of truth, with code as regenerated build output. Asks the stricter question: *if the code were deleted and rebuilt from this folder, would the system come back?*

## Document mode — 13 dimensions

Scope/goal clarity, functional completeness, data model definition, edge case and error handling, non-functional requirements, acceptance criteria, out-of-scope statements, technical constraints, absence of ambiguous language, an assumptions section, internal consistency, **definition executability**, and **constants enumerated**.

The last two are the ones a polished document usually fails. `definitionExecutability` asks whether each load-bearing term is a procedure with a stated answer for every case, or prose that merely sounds precise. `constantsEnumerated` asks whether every path, glob, threshold and group name has a literal value rather than being referenced by role. Both carry hard caps: a term used across five requirements and never defined is five silent guesses, not a wording nitpick.

A spec layered on a standards document declares that in `inherits`, so it is scored on both together — and penalised for restating what it inherits, since duplicated definitions drift.

Full rubric and anchors: `references/rubric.md`.

## Folder mode — 8 dimensions

Partition integrity, contract completeness, fixture executability, declared-unspecified, regeneration contract, stateful artifact handling, provenance coverage, cross-module consistency.

Each module spec is scored on the 13 document dimensions first; the tree is then capped by its weakest module, because any module that cannot be rebuilt from its own spec breaks the source-of-truth claim however well the rest scores.

Two things carry unusual weight here:

- **Orphan code caps the folder at 59** — source that no module spec claims, which regeneration silently drops. It is the harshest gate in either mode, because every other failure is visible at build time and this one is not.
- **Fixture executability is the heaviest single dimension (20)** — the generator is not deterministic, so committed input/expected-output pairs are what substitutes for compiler determinism. A regeneration is valid if and only if the fixtures pass. Prose acceptance criteria cannot do that job.

Contract cycles are computed in plain code from the declared dependency edges rather than reported by the model, since pure graph work should not be arguable.

Full rubric and canonical folder layout: `references/folder-rubric.md`.

## Refinement modes

- **Interactive Q&A** — one targeted clarifying question at a time, each answer merged in, re-scored after each merge.
- **Batch critique** — a single full report (gaps ranked by severity, ambiguous phrases); you edit and ask for a re-score.
- **Automated rewrite** — the tool rewrites the spec, closing every gap and marking every guess inline as `[ASSUMPTION: ...]`, with a confirm/reject step before the score can clear 95%.

Modes can be switched mid-session; the working text and score carry over.

## Install

Copy the skill folder into your skills directory:

```
cp -r skills/scrutinize-spec ~/.claude/skills/scrutinize-spec
```

## Use

Invoke it directly — `/scrutinize-spec docs/my-feature-spec.md`, or point it at a tree with `/scrutinize-spec spec/` — or just describe the task ("scrutinize this spec: ./docs/my-feature-spec.md"). It walks analyze → dashboard → refine → re-score, looping until confidence hits 95% or you stop.

## The scripts

`scripts/score.js` and `scripts/score-folder.js` are plain Node, no dependencies, run with `node`. They take the analysis JSON and return the gated score. **The model never computes the score itself** — that separation is what keeps the number meaning something.

```
node scripts/score.js /tmp/spec-analysis.json
node scripts/score-folder.js /tmp/spec-folder-analysis.json
```

## Spec-driven-dev mode (experimental)

Folder mode asks whether a spec folder *could* rebuild the system. Spec-driven-dev mode acts on a yes: the scrutinized `spec/` tree is the real source, generated code is a compiled build artifact, and the scrutinize gate is the **precondition for generation** — you cannot compile a spec that hasn't earned it. See the "Spec-driven-dev mode" section of `SKILL.md`, the staged design in `ROADMAP.md`, and the complete runnable example below.

## Examples

- **`examples/money-cart/`** — a full spec-driven-dev slice: a `money`+`cart` spec folder with a deterministic generator, a fixture verifier, drift detection, and a gated build (`scrutinize → gate → generate → verify`). Its `README.md` walks the whole loop. This is the worked reference for the vision above.
- `examples/` at the repository root holds output from a real scrutiny run: raw working-session notes refined into a full PRD, plus the standards document extracted from it.
