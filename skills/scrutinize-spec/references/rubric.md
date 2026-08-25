# PRD Scrutiny Rubric

Score the PRD on each of the 13 dimensions below, 0-100, using these anchors:

- **0-20 (absent)** — not addressed at all.
- **21-50 (vague)** — mentioned, but too vague or high-level to implement from.
- **51-80 (present with gaps)** — mostly specified, but has holes, edge cases, or ambiguity that would force an implementer to guess.
- **81-100 (complete)** — specified precisely enough that an implementer would not need to ask a clarifying question or make an unstated assumption.

For every dimension, cite the specific evidence (quote or section reference) behind the score. If the dimension is absent, say so explicitly rather than guessing charitably.

## How to grade

You are not grading how the document reads. You are grading how many decisions an AI agent would have to make on the author's behalf while building from it. A PRD can be well-organised, internally consistent, and pleasant to read while still forcing dozens of silent guesses — that document is not an 90, it is a 60.

Three rules that override charitable instinct:

1. **A path, file, directory, group, or identifier referenced by role rather than by literal value is a gap, not a detail.** "The entities directory", "the seed folder", "the domain owner group" are unpopulated constants. Every one of them is a decision the agent makes alone.
2. **A definition that admits an undecidable case scores below 50, regardless of how well it is written.** If you can construct one input where a careful implementer would have to stop and choose, the definition is not executable.
3. **When you catch yourself scoring a dimension high because the section exists and is articulate, re-read it as the agent.** Ask what you would type if you had to write the code this afternoon and could not ask a question. If the answer involves inventing a value, lower the score.

| # | id | Weight | What "complete" looks like |
|---|---|---|---|
| 1 | `scopeGoalClarity` | 8 | The problem, the target user, and what "done" means for the project as a whole are stated explicitly. A reader could describe the goal in one sentence without inferring it. |
| 2 | `functionalCompleteness` | 13 | Every user-facing flow is specified end-to-end: inputs, outputs, states, and transitions. No flow is implied by a feature name alone (e.g. "supports login" without specifying the login flow). |
| 3 | `dataModelDefinition` | 8 | If the PRD involves structured or persisted data, every entity, field, type, and relationship is named. (Score N/A as 100 only if the PRD genuinely involves no structured data — otherwise a missing data model when data is clearly implied is a severe gap, see `dataModelRequiredButMissing` below.) |
| 4 | `edgeCaseErrorHandling` | 9 | Failure modes, empty states, invalid input, concurrency/race conditions, and error messaging are addressed — not just the happy path. |
| 5 | `nonFunctionalRequirements` | 6 | Performance, scale, security, accessibility, and reliability requirements are stated with concrete, testable numbers or standards — not adjectives like "fast" or "secure" alone. |
| 6 | `acceptanceCriteria` | 14 | Every functional requirement has at least one criterion that is objectively testable (pass/fail), not a vague quality bar. Prose criteria score at most 80; criteria paired with a committed input fixture and expected output score above that. |
| 7 | `outOfScope` | 5 | The PRD explicitly states what is *not* being built, preventing scope creep or wrong-guess additions. |
| 8 | `technicalConstraints` | 6 | Required stack, versions, existing systems to integrate with, and hard technical constraints are named explicitly. |
| 9 | `ambiguousLanguage` | 4 | Absence of unquantified qualifiers: "fast", "simple", "intuitive", "robust", "handle appropriately", "etc.", "and so on", "TBD" without a plan to resolve it. Each instance found should be logged in `ambiguousPhrases`. |
| 10 | `assumptionsSection` | 4 | The PRD has an explicit assumptions/open-questions section, so anything not yet decided is visible rather than silently implied. |
| 11 | `consistency` | 5 | No section contradicts another (e.g. two different definitions of the same term, conflicting numbers, a flow described one way in one section and differently in another). |
| 12 | `definitionExecutability` | 10 | Every load-bearing term is defined as a **procedure** — a sequence of checks with a stated resolution for every case, including the unresolvable one — not as prose. See below. |
| 13 | `constantsEnumerated` | 8 | Every threshold, glob pattern, file path, timeout, group name, and configuration value referenced anywhere in the PRD has a literal value somewhere in the PRD or in a document it inherits from. |

## Dimension 12 — `definitionExecutability`

A **load-bearing term** is one that appears in the condition of three or more requirements. If it is wrong or interpreted differently than the author intended, several requirements are wrong at once.

For each load-bearing term, ask: could two competent engineers, working independently from this document, classify the same input differently? If yes, the term is not executable.

| Score | What it means |
|---|---|
| 81-100 | Every load-bearing term is a procedure with an explicit tie-breaker for unresolvable inputs. |
| 51-80 | Terms are defined, but at least one admits an edge case with no stated resolution. |
| 21-50 | Terms are defined in prose that sounds precise and isn't. "A pure function is one with no side effects" belongs here — it does not say whether `Date.now()`, an unresolved callee, or a logger call counts. |
| 0-20 | Load-bearing terms are used without definition at all. |

List every term failing this bar in `undefinedLoadBearingTerms`. **Any entry in that array caps the final score at 84** — and the same 84 cap fires whenever `dimensionScores.definitionExecutability < 60`, even if you did not enumerate a specific term, since a sub-60 score already means at least one load-bearing term is non-executable. Both triggers are on the same principle as missing acceptance criteria: one undefined term used in five requirements is five guesses, not a wording nitpick.

## Dimension 13 — `constantsEnumerated`

Count every constant the implementation will need and cannot derive. Thresholds, retry counts, timeouts, confidence cutoffs, glob patterns, directory paths, group and team names, model identifiers, feature-flag keys.

A constant is **populated** if a literal value appears in the PRD or in a document named in `inherits`. A constant is **unpopulated** if the PRD names the field but not the value — including when it is described as "configurable", since configurable still requires a default.

Set `unpopulatedConstantCount` to the total. **Any count above zero caps the final score at 89.** Report the specific constants in `gaps`, not just the number.

## Inheritance

A PRD that sits on top of a standards document should not be penalised for declining to restate it — and should be penalised for restating it, because duplicated definitions drift apart and the reader cannot tell which copy is authoritative.

Declare inherited coverage in `inherits`:

```json
"inherits": [
  {
    "document": "engineering-standards.md",
    "dimensionsSatisfied": ["dataModelDefinition", "technicalConstraints", "definitionExecutability"]
  }
]
```

Rules:

- Score a dimension named in `dimensionsSatisfied` against **the PRD and the inherited document together**. If the standards document defines the data model completely, `dataModelDefinition` scores high even though the PRD contains no data model section.
- Only name a dimension as inherited if you have actually read the inherited document. Never take the PRD's word that something is covered elsewhere.
- `dataModelRequiredButMissing` is suppressed for an inherited `dataModelDefinition`.
- Count definitions the PRD restates from an inherited document in `duplicatedDefinitionCount`. **Any count above zero caps the final score at 92**, and each instance should appear in `gaps` with a fix of "delete and reference the standards document".

## Required output shape

Produce a JSON object (this is what gets written to the analysis file passed to `scripts/score.js`, plus the extra fields the skill uses for display and the Q&A/rewrite loops):

```json
{
  "dimensionScores": {
    "scopeGoalClarity": 0,
    "functionalCompleteness": 0,
    "dataModelDefinition": 0,
    "edgeCaseErrorHandling": 0,
    "nonFunctionalRequirements": 0,
    "acceptanceCriteria": 0,
    "outOfScope": 0,
    "technicalConstraints": 0,
    "ambiguousLanguage": 0,
    "assumptionsSection": 0,
    "consistency": 0,
    "definitionExecutability": 0,
    "constantsEnumerated": 0
  },
  "flags": {
    "hasContradictions": false,
    "dataModelRequiredButMissing": false,
    "acceptanceCriteriaMissing": false
  },
  "ambiguousPhraseCount": 0,
  "unconfirmedAssumptionCount": 0,
  "unpopulatedConstantCount": 0,
  "duplicatedDefinitionCount": 0,
  "undefinedLoadBearingTerms": [
    { "term": "pure function", "usedInRequirements": ["SG-01", "RR-07", "CV-07"], "undecidableCase": "a function calling Date.now()" }
  ],
  "inherits": [
    { "document": "path or title", "dimensionsSatisfied": ["dataModelDefinition"] }
  ],
  "rationale": {
    "scopeGoalClarity": "one or two sentences of evidence-backed reasoning per dimension",
    "...": "..."
  },
  "gaps": [
    {
      "dimension": "acceptanceCriteria",
      "severity": "blocking | major | minor",
      "title": "short title",
      "description": "what's missing and why it matters",
      "suggestedFix": "concrete instruction on what to add",
      "locationHint": "section heading or quoted line, or null"
    }
  ],
  "ambiguousPhrases": [
    { "phrase": "fast", "locationHint": "Performance section", "suggestedReplacement": "responds within 200ms at p95" }
  ],
  "contradictions": [
    { "description": "...", "locationHintA": "...", "locationHintB": "..." }
  ],
  "detectedAssumptions": ["assumption the PRD makes implicitly without stating it"],
  "researchFindings": [
    {
      "question": "the specific research question asked in Step 0.5",
      "finding": "the objective, well-established fact found",
      "sources": ["citation or URL"],
      "resolvesGapTitle": "title of a gap this finding closes, or null if purely informational"
    }
  ],
  "nextQuestion": {
    "targetGapTitle": "the single highest-leverage unresolved gap's title",
    "question": "one specific, answerable clarifying question",
    "whyThisMatters": "one sentence on what this unblocks"
  },
  "summary": "2-3 sentence plain-language summary of where the PRD stands"
}
```

`nextQuestion` should target whichever unresolved gap most limits the score: prefer `blocking` severity over `major` over `minor`, and prefer higher-weight dimensions when severity ties. Set it to `null` only when there are no unresolved gaps at all.

Set `dimensionScores.acceptanceCriteria < 70` or `flags.acceptanceCriteriaMissing: true` whenever meaningful functional requirements lack a testable criterion — this directly caps the final score regardless of other dimensions (see the scoring gate in `scripts/score.js`).

## Research findings vs. gaps vs. assumptions

These three lists serve different purposes and must not be conflated:

- **`gaps`** — things the PRD doesn't specify and still needs a human decision or input to resolve. Drive the Q&A/batch/rewrite loop.
- **`detectedAssumptions`** — things the PRD implicitly relies on without stating them, surfaced so the user can see them (not necessarily wrong, just invisible).
- **`researchFindings`** — objective, cited facts pulled in from outside the PRD (via the `deep-research` skill in Step 0.5) that close a gap without requiring a guess or a user decision. A finding with a non-null `resolvesGapTitle` means that gap should **not** also appear in `gaps` — it's resolved, not open.

A `[RESEARCHED: ...]` marker in the working PRD text is never counted in `unconfirmedAssumptionCount` — only `[ASSUMPTION: ...]` markers are. Research findings raise dimension scores by legitimately closing gaps; they don't need user confirmation the way assumptions do, because they're backed by a citation rather than a guess.
