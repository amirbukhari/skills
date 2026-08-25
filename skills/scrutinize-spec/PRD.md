# Spec Scrutinizer — Product Requirements Document

> This PRD describes the tool as currently implemented: a **13-dimension** document rubric plus an **8-dimension** folder rubric, two dependency-free Node scoring scripts, and the skill orchestration in `SKILL.md`. It supersedes the retired 11-dimension version (last distributed as the standalone `PRDScrutinizer` plugin, v2.0.0). Where this document and the shipped code or rubric files disagree, the code and rubric files (`scripts/score.js`, `scripts/score-folder.js`, `references/rubric.md`, `references/folder-rubric.md`) are the source of truth and this PRD is the defect.

## 1. Problem Statement

When a spec is handed to an AI coding agent, gaps in the document don't surface as "I have a question" — they surface as the agent silently guessing, which produces plausible-looking but wrong implementations. Product managers and engineers currently have no way to check, before implementation starts, whether their spec is actually complete enough for an AI to build correctly without hand-holding.

`[RESEARCHED: Industry survey data cited in a systematic mapping study of requirements-quality research consistently ranks inconsistent, under-specified, and incomplete requirements among the top five causes of software project failure. The same body of research shows manual review alone is a weak defense: in controlled experiments, a three-person team spending 4.5 hours reviewing a requirements document caught only 18-25% of the ambiguities it contained using standard checklist/scenario techniques — motivating an automated, checklist-driven approach over ad hoc manual review. — sources: Franch et al., "Requirements Quality Research: A Systematic Mapping Study" (PMC9110500); Kamsties, Berry & Paech, "Detecting Ambiguities in Requirements Documents Using Inspections" (cs.uwaterloo.ca/~dberry)]`

## 2. Goal

Give a spec author (or reviewer) a tool that scores how ready their spec is for AI implementation, tells them specifically what's missing, and helps them close those gaps — until the tool reports a **`finalScore` of 95 or higher with an empty `cappedBy` list** (`isConfident: true` in document mode; `isRegenerable: true` in folder mode — see Section 6). That state is this project's operational definition of "safe to hand off."

`[RESEARCHED: Published guidance on agent-executable specifications independently arrives at the same success criterion: a well-formed agent-executable spec is one that "enables an agent to produce a correct implementation without needing to ask any clarifying questions." This project's operational definition of "safe to hand off" is not an invented bar — it matches how practitioners in this space already define spec readiness. — source: "The Specification as the Lever: Why PRDs Break AI Agents" (shunvel.medium.com, AERO framework)]`

## 3. Users

- Primary: product managers and technical leads writing specs that will be implemented (in whole or in part) by an AI coding agent.
- Secondary: engineers reviewing a spec before starting implementation, who want a quick objective signal on completeness.
- Folder-mode user: a team treating a **spec folder** as the source of truth, with code as regenerated build output, who needs to know whether that folder could actually rebuild the system.

## 4. Success Metric

A spec that the tool scores at `finalScore >= 95` with an empty `cappedBy` should require zero clarifying questions and zero material incorrect assumptions when handed to an AI coding agent for implementation.

This real-world outcome is measured indirectly, through the tool's own `isConfident` / `isRegenerable` signal (Section 6) as a proxy. That proxy is grounded in established requirements-engineering theory (Section 6d) and in this project's own dogfooding (Section 13), but has not yet been empirically validated across a large sample of independent specs and independent AI-implementation attempts. That validation is future work, not a spec gap: nothing in this document requires an implementer to guess in order to build the tool exactly as written here.

## 5. Scope

### In scope

- **Document mode** — score a single spec (PRD, build spec, requirements doc) across **13 weighted dimensions** of implementation readiness (Section 6a), compute a single gated confidence score (`scripts/score.js`), and loop analyze → dashboard → refine → re-score until `isConfident` or the user stops.
- **Folder mode** — score a spec folder that is the source of truth against **8 folder-level dimensions** (Section 6c), after scoring each module spec on the 13 document dimensions, and compute the gated folder score (`scripts/score-folder.js`). Answers the stricter question: if the code were deleted and rebuilt from this folder, would the system come back?
- Enforce **hard gates** in both modes (Section 6b, 6e): certain categories of gap cap the score below 95 regardless of the weighted average, so a high score can't be reached while a known-blocking issue remains. When multiple gates fire, the strictest (lowest) cap applies — caps compose via minimum.
- Support a spec that inherits from a **standards document** via an `inherits` declaration: dimensions the standards document covers are scored against the spec and that document together, and restating an inherited definition is penalized rather than rewarded (Section 6a, dimensions 12–13).
- Three refinement modes the user can pick and switch between mid-session:
  - **Interactive Q&A** — the tool asks one targeted clarifying question at a time (the single highest-leverage unresolved gap), merges the user's answer into the working spec, and re-scores.
  - **Batch critique** — the tool produces one full report of ranked gaps and ambiguous language; the user edits the spec themselves and asks for a re-score.
  - **Automated rewrite** — the tool rewrites the full spec to close every gap, marking every judgment call it had to make inline as `[ASSUMPTION: ...]` the user must confirm or reject before the score can clear the gate.
- Before the first analysis pass on a given spec, an **optional one-time domain-research pass** (via the `deep-research` skill) to ground gap-finding in how comparable real systems work. Objective, cited facts it finds are auto-resolved inline as `[RESEARCHED: ...]` markers — distinct from user-confirmed assumptions — without needing user confirmation; contested or judgment-call findings remain open gaps for the user to decide.
- Runs as a Claude Code skill — no separate application, no API keys. The deterministic scoring runs as two dependency-free Node scripts (`scripts/score.js`, `scripts/score-folder.js`).
- The user can point the tool at a file on disk, at a folder, or paste/describe spec text directly in conversation.

### Out of scope

- Any UI beyond the Claude Code conversational interface (no separate web app, no dashboard).
- Persisting spec history, session state, or scores anywhere outside the spec file(s)/folder the user is working with. There is no database and no login.
- Scoring or reviewing anything other than specs/requirements documents (this is not a general code-review or design-review tool).
- Automatically committing or opening pull requests for a refined spec.
- Parsing non-text formats (Word, PDF, Notion/Google Docs exports, images). The tool only reads plain text/Markdown files or pasted text; converting other formats is the user's responsibility.
- Judging the business or market merit of the spec's proposed feature. The tool scores whether the document is specified completely enough to build, not whether the underlying idea is good.
- Localization/internationalization. The rubric, prompts, and output are English-only.
- Conflict resolution for concurrent multi-session edits to the same spec file — see FR-16.
- **Verifying that regeneration actually reproduces the system in folder mode.** The folder score measures whether the folder is *structured* so a rebuild attempt is worth making; only running the generator and the fixtures proves the rebuild works. The tool must state this when it reports a passing folder score — see FR-17.

## 6. Data Model

The tool's analysis and scoring are structured objects, not free text. This section is the authoritative schema for both modes; both the model producing the analysis and the deterministic scoring scripts consume it.

### 6a. Document mode — dimensions and weights

`scripts/score.js` computes `rawWeightedScore = Σ(dimensionScore × weight) / 100` over exactly these 13 dimension IDs. Weights sum to 100.

| # | Dimension ID | Weight |
|---|---|---|
| 1 | `scopeGoalClarity` | 8 |
| 2 | `functionalCompleteness` | 13 |
| 3 | `dataModelDefinition` | 8 |
| 4 | `edgeCaseErrorHandling` | 9 |
| 5 | `nonFunctionalRequirements` | 6 |
| 6 | `acceptanceCriteria` | 14 |
| 7 | `outOfScope` | 5 |
| 8 | `technicalConstraints` | 6 |
| 9 | `ambiguousLanguage` | 4 |
| 10 | `assumptionsSection` | 4 |
| 11 | `consistency` | 5 |
| 12 | `definitionExecutability` | 10 |
| 13 | `constantsEnumerated` | 8 |

The full "what complete looks like" anchors for each dimension live in `references/rubric.md` and are inherited by this PRD (dimensions 1–13), not restated here. Two dimensions carry the project's most distinctive checks:

- **`definitionExecutability`** (weight 10) — every **load-bearing term** (a term appearing in the condition of three or more requirements) must be defined as a procedure with a stated resolution for every case, including the unresolvable one, not as precise-sounding prose. Terms failing this go in `undefinedLoadBearingTerms`.
- **`constantsEnumerated`** (weight 8) — every threshold, glob, path, timeout, group name, model ID, or configuration value the implementation needs and cannot derive must have a literal value in the spec or an inherited document. A named-but-unvalued field (including one called "configurable") is unpopulated; the total goes in `unpopulatedConstantCount`.

**Analysis object** (produced per document-mode scoring pass, written to a temp file, consumed by `scripts/score.js`):

- `dimensionScores`: object with all 13 dimension IDs above as keys, each an integer 0–100. The script fails if any key is missing, non-numeric, or out of range.
- `flags`: `{ hasContradictions: boolean, dataModelRequiredButMissing: boolean, acceptanceCriteriaMissing: boolean }`.
- `ambiguousPhraseCount`: integer.
- `unconfirmedAssumptionCount`: integer — count of currently-unresolved `[ASSUMPTION: ...]` markers in the working spec.
- `unpopulatedConstantCount`: integer — see dimension 13.
- `duplicatedDefinitionCount`: integer — definitions the spec restates from a document named in `inherits`.
- `undefinedLoadBearingTerms`: array of `{ term, usedInRequirements: string[], undecidableCase }` — see dimension 12.
- `inherits`: array of `{ document, dimensionsSatisfied: string[] }`. Each name in `dimensionsSatisfied` must be one of the 13 dimension IDs, or the script fails. A dimension named here is scored against the spec and that document together; `dataModelRequiredButMissing` is suppressed for an inherited `dataModelDefinition`.
- `gaps`: array of `{ dimension, severity: "blocking"|"major"|"minor", title, description, suggestedFix, locationHint }`.
- `ambiguousPhrases`: array of `{ phrase, locationHint, suggestedReplacement }`.
- `contradictions`: array of `{ description, locationHintA, locationHintB }`.
- `detectedAssumptions`: array of strings — assumptions the spec makes implicitly without stating them.
- `researchFindings`: array of `{ question, finding, sources: string[], resolvesGapTitle: string|null }` — cited facts from the Step 0.5 research pass that close a gap without user confirmation.
- `rationale`: object of per-dimension evidence-backed reasoning (used for display).
- `nextQuestion`: `{ targetGapTitle, question, whyThisMatters }` or `null` if no unresolved gaps remain. Used by Interactive Q&A mode.
- `summary`: 2–3 sentence plain-language status.

**Score object** (computed deterministically by `scripts/score.js`, never stated by the model — see NFR-1):

- `rawWeightedScore`: the weighted average of `dimensionScores`, rounded to one decimal place for display.
- `finalScore`: the weighted average capped by the active gate(s) from Section 6b, then rounded to one decimal place. When multiple gate conditions are simultaneously true, the **strictest (lowest) cap applies** — `finalScore = min(rawWeightedScore, min(active caps))`.
- `cappedBy`: array of gate identifiers currently true, in the order the script evaluates them (Section 6b): `contradictions_detected`, `acceptance_criteria_weak`, `data_model_missing`, `undefined_load_bearing_term`, `too_many_ambiguous_phrases`, `constants_unpopulated`, `definitions_duplicated`, `unconfirmed_assumptions`.
- `inheritedDimensions`: array of dimension IDs the script recognized as inherited.
- `isConfident`: `finalScore >= 95 AND cappedBy is empty`.

### 6b. Document mode — gate thresholds

Each gate caps `finalScore` at the stated value when its condition is true. These values are carried verbatim from `scripts/score.js`, which is the source of truth.

| cappedBy identifier | Score cap | Fires when |
|---|---|---|
| `contradictions_detected` | 59 | `flags.hasContradictions` is true |
| `acceptance_criteria_weak` | 84 | `flags.acceptanceCriteriaMissing` is true, **or** `dimensionScores.acceptanceCriteria < 70` |
| `data_model_missing` | 84 | `flags.dataModelRequiredButMissing` is true **and** `dataModelDefinition` is not inherited |
| `undefined_load_bearing_term` | 84 | `undefinedLoadBearingTerms` is non-empty, **or** `dimensionScores.definitionExecutability < 60` |
| `too_many_ambiguous_phrases` | 89 | `ambiguousPhraseCount > 3` |
| `constants_unpopulated` | 89 | `unpopulatedConstantCount > 0` |
| `definitions_duplicated` | 92 | `duplicatedDefinitionCount > 0` |
| `unconfirmed_assumptions` | 94 | `unconfirmedAssumptionCount > 0` |

### 6c. Folder mode — dimensions and weights

`scripts/score-folder.js` computes `rawWeightedScore` over exactly these 8 folder dimension IDs. Weights sum to 100. Anchors live in `references/folder-rubric.md`.

| # | Folder dimension ID | Weight |
|---|---|---|
| 1 | `partitionIntegrity` | 15 |
| 2 | `contractCompleteness` | 15 |
| 3 | `fixtureExecutability` | 20 |
| 4 | `unspecifiedDeclared` | 10 |
| 5 | `regenerationContract` | 10 |
| 6 | `statefulArtifactHandling` | 10 |
| 7 | `provenanceCoverage` | 10 |
| 8 | `crossModuleConsistency` | 10 |

**Folder analysis object** (consumed by `scripts/score-folder.js`):

- `folderDimensionScores`: object with all 8 folder dimension IDs above as keys, each an integer 0–100. The script fails if any is missing, non-numeric, or out of range.
- `modules`: non-empty array of `{ name: string, finalScore: number, dependsOn: string[], analysisPath: string }`. Each module's `finalScore` is the document-mode `finalScore` from running `scripts/score.js` on that module's own spec. The script fails if `modules` is empty or any module lacks a string `name` or numeric `finalScore`.
- `flags`: `{ orphanCodeDetected, fixturesNotExecutable, unspecifiedNotDeclared, regenerationContractMissing, statefulArtifactsUnhandled }` (all boolean).
- `orphanPaths`: array of real source paths that no module spec claims.
- `rationale`, `gaps`, `summary`: as in document mode, scoped to the folder.

**Folder score object** (computed by `scripts/score-folder.js`):

- `rawWeightedScore`, `finalScore`: as in document mode, over the 8 folder dimensions.
- `cappedBy`: array of active folder gate identifiers (Section 6e).
- `weakestModule`: `{ name, finalScore }` — the module with the lowest `finalScore`.
- `contractCycles`: array of cycles (each an ordered list of module names), computed in code from the declared `dependsOn` edges — not reported by the model.
- `isRegenerable`: `finalScore >= 95 AND cappedBy is empty`.

### 6d. Grounding for the rubric's dimension choices

`[RESEARCHED: This rubric's dimensions are not an arbitrary internal invention — they align with established requirements-engineering quality criteria. ISO/IEC/IEEE 29148:2018 defines nine required characteristics for an individual requirement (Necessary, Appropriate, Unambiguous, Complete, Singular, Feasible, Verifiable, Correct, Conforming) and five characteristics a complete requirements SET must have (Complete, Consistent, Feasible, Comprehensible, Able to be validated) — including an explicit rule that a requirements set cannot be called complete while it still contains any unresolved TBD/TBS/TBR placeholder, which this rubric's `ambiguousLanguage` dimension already penalizes. Separately, a systematic mapping study of the requirements-quality research literature independently found ambiguity, completeness, consistency, and correctness to be the most-studied quality attributes, together comprising 54% of all researched quality themes — corroborating this rubric's emphasis on those same dimensions from an independent research base. — sources: ISO/IEC/IEEE 29148:2018; Franch et al., "Requirements Quality Research: A Systematic Mapping Study" (PMC9110500)]`

### 6e. Folder mode — gate thresholds

| cappedBy identifier | Score cap | Fires when |
|---|---|---|
| `weakest_module:<name>` | that module's `finalScore` | Always applied numerically; added to `cappedBy` only when the weakest module's `finalScore < 95` |
| `orphan_code_detected` | 59 | `flags.orphanCodeDetected` is true, **or** `orphanPaths` is non-empty |
| `contract_cycle` | 74 | `contractCycles` is non-empty (computed from `dependsOn` edges) |
| `fixtures_not_executable` | 84 | `flags.fixturesNotExecutable` is true, **or** `folderDimensionScores.fixtureExecutability < 70` |
| `regeneration_contract_missing` | 84 | `flags.regenerationContractMissing` is true |
| `stateful_artifacts_unhandled` | 84 | `flags.statefulArtifactsUnhandled` is true |
| `unspecified_not_declared` | 89 | `flags.unspecifiedNotDeclared` is true |

## 7. Functional Requirements

Every functional requirement below specifies both its expected ("go path") behavior and its failure/exception behavior, or explicitly states that no failure path applies (FR-13).

1. Given a spec (file path or pasted text), in document mode the tool must analyze it and produce a score for each of the 13 rubric dimensions (Section 6a), each backed by cited evidence from the document (a quote or section reference) — see AC-6. **Failure path**: if the given file path does not exist or cannot be read, the tool must report that directly and ask for a corrected path or pasted text — it must never proceed as if given an empty spec.
2. The overall confidence score must be computed by the fixed formula in Section 6, executed as code the tool actually runs (`scripts/score.js` in document mode, `scripts/score-folder.js` in folder mode), not a number the model states from memory — see AC-7. **Failure path**: covered by NFR-6 (a scoring-script failure is surfaced as an error, never papered over).
3. The tool must identify and rank gaps by severity (blocking / major / minor), each with a specific suggested fix — see AC-8. **No failure path applies**: an empty `gaps` list is a valid, expected result when the spec has no remaining gaps, not an error condition.
4. The tool must detect ambiguous, unquantified language (e.g. "fast", "simple", "handle appropriately") and suggest concrete replacements — see AC-9. **No failure path applies**: an empty `ambiguousPhrases` list is a valid result.
5. The tool must detect direct contradictions between sections of the spec — see AC-10. **No failure path applies**: an empty `contradictions` list is a valid result.
6. In Interactive Q&A mode, the tool must select the single highest-leverage unresolved gap to ask about next: prefer `blocking` over `major` over `minor`; when severity ties, prefer the gap in the highest-weighted dimension (Section 6a) — see AC-11. **Failure path**: if no unresolved gaps remain, `nextQuestion` must be `null` rather than the tool fabricating a question — see AC-17.
7. In Automated Rewrite mode, every fact the tool introduces that was not explicitly stated in the source spec must be marked inline as `[ASSUMPTION: <the assumption>]` at the exact point introduced, and listed separately for user confirmation; `unconfirmedAssumptionCount` must reflect how many remain unresolved — see AC-3. **Failure path**: if a rewrite pass is interrupted before completion, the tool must leave the last confirmed spec state on disk untouched rather than write a partial rewrite.
8. The user must be able to switch between the three refinement modes at any point without losing the current spec draft or score — see AC-5. **No failure path applies**: mode switching is a pure session-state change with no external I/O to fail.
9. The tool must re-run the scoring script after every refinement step, regardless of which mode produced the update, so the score is computed identically no matter which mode was used — see AC-12. **Failure path**: covered by NFR-6.
10. Whenever `finalScore` is below `rawWeightedScore` (i.e. a gate is binding), the tool must state which specific gate(s) in `cappedBy` caused the cap and by how much — see AC-13. **No failure path applies**: this requirement is inactive whenever `cappedBy` is empty.
11. If the user provides pasted spec text rather than a file path, and does not specify a save location up front, the tool must ask where to save before making its first edit — it must never silently create or overwrite a file the user didn't name — see AC-14. **Failure path**: if the user's answer isn't a usable path (empty, or a directory that doesn't exist), the tool must ask again rather than guessing a filename — see AC-18.
12. If the user says "stop" mid-loop, the tool must leave the spec file exactly as last written (no automatic rollback, no automatic further edits) and state the current score and remaining gaps before ending — see AC-15. **No failure path applies**: this requirement is itself the tool's failure/exception behavior for the overall refinement loop.
13. Every functional requirement in this document must itself specify both its expected behavior and its failure/exception behavior, or explicitly state that no failure path applies — see AC-16. `[RESEARCHED: under ISO/IEC/IEEE 29148-aligned requirements methodology, a requirement that specifies only the expected ("go path") behavior without also specifying its failure/exception behavior for invalid or off-path input is incomplete by definition, not merely a stylistic gap. — source: Bender RBT, "Ambiguity Review Checklist" methodology (benderrbt.com)]` (This tool holds its own PRD to the same standard it enforces.)
14. Before the first analysis pass on a given spec, the tool must perform the one-time domain-research pass described in Section 5 **only when the spec depends on facts that cannot be confirmed locally** (an external standard, a third-party API limit, a library version, an industry-standard practice); it must skip research when the spec's gaps are internal (undefined terms, missing paths, unpopulated constants, absent acceptance criteria). Any objective, cited fact it uses to close a gap is marked inline as `[RESEARCHED: <fact> — source: <citation>]` — distinct from `[ASSUMPTION: ...]`, and excluded from `unconfirmedAssumptionCount` — see AC-19. **Failure path**: if the `deep-research` skill is unavailable, or runs but returns malformed/incomplete/obviously-placeholder output, the tool must discard that output, state in its summary that domain grounding was not performed, and continue on the spec's stated content alone — it must never fabricate a research finding or a citation.
15. If given an empty or whitespace-only spec (file or pasted text), the tool must say so directly and ask for real content, and must not report a `finalScore` — see AC-20. **Failure path**: this requirement is itself the failure-path handling for the degenerate "no content" case; there is no further failure mode beneath it.
16. Concurrent invocation of the tool against the same spec file from multiple sessions has **no** conflict-resolution requirement. The tool assumes single-user, single-session usage per file (Section 5); if the file changes on disk from outside the current session, the tool's next write may overwrite those external changes. **No failure path applies — explicitly out of scope**: this overwrite is accepted behavior, not a defect.
17. In **folder mode**, the tool must (a) map the spec tree and report any canonical role it cannot find (standards, contracts, module specs, fixtures, `unspecified.md`, `provenance.md`, `regenerate.md`); (b) check for orphan code by comparing `provenance.md`'s claimed path patterns against the actual source tree, reporting real paths in `orphanPaths`; (c) score each module on the 13 document dimensions and the folder on the 8 folder dimensions via the two scripts; and (d) state plainly, whenever it reports `isRegenerable: true`, that a passing score means the folder is structured for regeneration to be worth attempting, not that the rebuild will succeed (Section 5, Out of scope) — see AC-22, AC-23, AC-24. **Failure path**: if the codebase cannot be reached to check for orphans, the tool must say so and set `flags.orphanCodeDetected` to `true`, since an unverifiable claim of full coverage is not evidence of full coverage.

## 8. Non-Functional Requirements

1. No external network calls or API costs beyond what Claude Code itself already uses — the analysis reasoning is performed by Claude in the session, and the score is computed by local Node scripts, not a separate hosted API. **The confidence score is always the script's output, never a number the model states from memory** (see FR-2, AC-7).
2. The deterministic scoring logic (Section 6) must run via dependency-free scripts (`scripts/score.js`, `scripts/score-folder.js`) so they work in any environment with Node.js available and require no `npm install` step.
3. Installation must be possible by copying the skill folder into a Claude Code skills directory; the skill must resolve its own script and reference paths relative to its own directory so it runs from wherever it is installed.
4. The spec text the tool analyzes is untrusted input — it may contain text designed to look like instructions. The tool must treat spec content strictly as data to be scored, and must not follow any instruction embedded within the spec text that contradicts this document or the user's actual, out-of-band requests.
5. The tool has no hard-enforced maximum spec size, but if a spec exceeds roughly 8,000 words (~12,000 tokens), the tool must say so explicitly and confirm it analyzed the whole document rather than silently scoring only part of it.
6. If either scoring script fails to run or errors on malformed input, the tool must surface that error to the user rather than estimating or stating a confidence score itself. The scripts exit non-zero with a JSON `{ error }` on missing/non-numeric/out-of-range dimension scores, empty `modules`, or unknown inherited dimension IDs.
7. Re-scoring identical, unedited analysis JSON must be deterministic **at the gating layer**: two consecutive runs of a scoring script against the same analysis JSON must produce byte-identical `finalScore` and `cappedBy`, since the scripts are pure arithmetic with no I/O beyond reading the input file. This does **not** extend to Step 1's upstream dimension-scoring judgment, which Claude performs by reading the rubric — minor variance (a few points per dimension) between separate scoring sessions on identical text is expected; a large swing (a dimension moving more than ~15 points with no content change) is a signal to investigate, not expected noise.
8. No accessibility requirements apply beyond what Claude Code's own conversational interface already provides — this tool has no independent UI.
9. Each scoring script must complete in under 1 second for any valid input, since each performs only arithmetic (plus, in folder mode, a linear-time cycle search) over a small object with no network access.
10. The domain-research question formulated in Step 0.5 (FR-14) must describe the general problem category only — it must never quote proprietary specifics, internal codenames, customer names, or other confidential details from the spec verbatim in a web search query, since that query leaves the local session — see AC-21.

## 9. Acceptance Criteria

- **AC-1**: Running the tool against a deliberately vague sample spec produces a `finalScore` below 70 and a non-empty, ranked `gaps` list.
- **AC-2**: Running the tool against a thorough, well-specified spec is capable of reaching `finalScore >= 95` with `cappedBy` empty (`isConfident: true`).
- **AC-3**: In Automated Rewrite mode, a spec with one or more unresolved `[ASSUMPTION: ...]` markers cannot score above 94, even if every dimension in `dimensionScores` is 100 (the `unconfirmed_assumptions` gate).
- **AC-4**: Introducing a direct contradiction into an otherwise-complete spec caps `finalScore` at or below 59, regardless of the other dimension scores (the `contradictions_detected` gate).
- **AC-5**: Switching from Interactive Q&A to Automated Rewrite mid-session (or vice versa) preserves the current spec text and score; the working spec is not reset.
- **AC-6**: Every dimension score in a produced analysis is accompanied by at least one citation (a direct quote or explicit section reference) from the spec being scored.
- **AC-7**: The `finalScore` and `cappedBy` reported to the user always match the output of the relevant scoring script run against the corresponding analysis object — never a number stated without running the script.
- **AC-8**: Every entry in `gaps` includes a non-empty `suggestedFix`.
- **AC-9**: Every entry in `ambiguousPhrases` includes a `suggestedReplacement` that is itself free of the same class of unquantified qualifier.
- **AC-10**: If two sections of the spec state conflicting facts about the same requirement, at least one entry appears in `contradictions` describing both locations.
- **AC-11**: Given an analysis with at least one `blocking` gap and one `major` gap, `nextQuestion.targetGapTitle` matches a `blocking`-severity gap, not the `major` one.
- **AC-12**: Scoring a spec via Batch critique mode and scoring the identical spec text via Interactive Q&A mode produce the same `finalScore` for the same content and same analysis JSON.
- **AC-13**: Whenever `cappedBy` is non-empty, the response shown to the user names each active gate and states the `rawWeightedScore` alongside the `finalScore`.
- **AC-14**: Given pasted spec text with no prior save location established, the tool's first response asks where to save before writing any file.
- **AC-15**: After the user says "stop" mid-loop, no further edits are made to the spec file, and the tool's final message states the last-known `finalScore` and the count of remaining open gaps.
- **AC-16**: Every functional requirement in this document specifies both its expected behavior and its failure/exception behavior, or explicitly states that no failure path applies.
- **AC-17**: When an analysis has no unresolved gaps, `nextQuestion` is `null`, never a fabricated question.
- **AC-18**: If the user's answer to "where should I save this?" isn't a usable path, the tool asks again rather than guessing a filename or silently picking one.
- **AC-19**: Within a single refinement loop in one session, no dimension score improves between two analysis passes on the same spec text unless that improvement is backed by changed spec content or by a `researchFindings` entry. Every entry in `researchFindings` includes at least one non-empty source citation.
- **AC-20**: Given an empty or whitespace-only spec, the tool responds by asking for real content and does not report a `finalScore`.
- **AC-21**: The literal text sent to the `deep-research` skill in Step 0.5 contains no substring copied verbatim from the source spec longer than a few common words — it is a generalized description of the problem domain.
- **AC-22**: In folder mode, `scripts/score-folder.js` run against a folder analysis whose `modules` declare a dependency cycle reports that cycle in `contractCycles` and includes `contract_cycle` in `cappedBy`, without the model having to detect the cycle.
- **AC-23**: In folder mode, a folder analysis with a non-empty `orphanPaths` (or `flags.orphanCodeDetected: true`) caps `finalScore` at or below 59 and lists the orphan paths individually rather than as a count.
- **AC-24**: In folder mode, the folder `finalScore` is never higher than the weakest module's `finalScore`, and when that weakest module scores below 95 the response names it as `weakest_module:<name>` in `cappedBy`.

## 10. Assumptions

- The user has Node.js available (required only for the scoring scripts). Minimum version: 18, the oldest LTS release with native `fetch` and other commonly-assumed APIs.
- The user is working within Claude Code, not a different AI coding tool.
- Step 0.5 (domain research) depends on the `deep-research` skill being available in the same session. This is a soft dependency: per FR-14's failure path, its absence degrades the analysis rather than blocking the tool.
- Rubric-following reliability (Step 1 dimension scoring) was exercised using Claude Opus/Sonnet-tier models. Haiku-tier or older/smaller models have not been validated against this rubric and may score less consistently; no specific model is required to run the tool, but this is a known limitation.
- "One-shot implementation" is judged from the spec text alone — the tool does not have access to the target codebase and cannot detect gaps that only become apparent once implementation starts (e.g. an undocumented existing API constraint). Folder mode partially narrows this by checking for orphan code, but still does not run the generator (Section 5, FR-17).

## 11. Open Questions

- Should there be a way to save/export a scoring report separately from the spec file, for sharing with stakeholders who don't have Claude Code?
- Should the rubric weights in Section 6a/6c be configurable per-team, or are the current fixed weights sufficient for all spec types?
- Automated Rewrite mode closes every gap by adding explicit detail. Published research warns that over-specifying a spec can itself degrade agent performance (a "curse of instructions" effect) — completeness has to be balanced against overload (source: O'Reilly Radar, "How to Write a Good Spec for AI Agents"). This is a genuine product-judgment call, not a settled fact: should Automated Rewrite have a restraint mechanism (e.g. flagging over-specification risk), or is exhaustiveness always preferable for this tool's stated goal?
- Should folder mode ship with an example spec tree and fixtures as a regression test for `scripts/score-folder.js`? (Currently there is none.)

## 12. Change Log (this revision)

| Section | What changed | Why |
|---|---|---|
| Whole document | Rewrote from the retired 11-dimension rubric to the current **13-dimension** implementation; added folder mode throughout | `PRD.md` had drifted out of sync with `scripts/score.js`, `references/rubric.md`, and the folder-mode implementation — the spec-scrutinizer's own spec no longer matched its own tool |
| 6a | Replaced the 11-dimension weight table with the real 13 dimensions and weights from `scripts/score.js`; documented `definitionExecutability` and `constantsEnumerated` | These two dimensions and their weights existed in code but were entirely absent from the PRD |
| 6b | Replaced the 5-gate table with the real 8 document gates, including `undefined_load_bearing_term` (fires on a non-empty term list **or** `definitionExecutability < 60`), `constants_unpopulated`, and `definitions_duplicated`; listed the exact `cappedBy` identifiers in script-evaluation order | The old gate table omitted three gates and used stale identifiers |
| 6c, 6e | Added folder-mode dimensions, weights, data model, and gate table from `scripts/score-folder.js` | Folder mode was implemented and documented in `SKILL.md`/`folder-rubric.md` but never reflected in the PRD |
| 5, 7 | Added folder mode to scope and added FR-17 (tree mapping, orphan check, two-layer scoring, the "structured for regeneration ≠ will rebuild" caveat); scoped FR-14 research to the conditional trigger `SKILL.md` actually uses | Scope and requirements described only document mode; FR-14 overstated research as unconditional |
| 9 | Added AC-22/23/24 for folder-mode cycle detection, orphan capping, and weakest-module capping | The new folder-mode requirements needed testable criteria |
| 13 | Re-ran the self-score against the 13-dimension rubric | The old §13 dogfooded against the retired 11-dimension rubric and claimed a stale 100 |
| `references/rubric.md` | (companion fix) Documented that the `undefined_load_bearing_term` gate also fires on `definitionExecutability < 60`, matching `score.js` | Doc gap between the rubric prose and the shipped gate condition |

## 13. Self-Score

Scored against the 13-dimension document rubric it now describes, this PRD declares `inherits` on `references/rubric.md` for the two definition-heavy dimensions it deliberately does not restate (`definitionExecutability`, `constantsEnumerated`), since those anchors live in the rubric and duplicating them would trip the `definitions_duplicated` gate. The authoritative result is whatever `scripts/score.js` prints for this revision's analysis JSON; this section is falsifiable by re-running the script.

**As of this revision the tool scores this document at `finalScore` 90.5, `rawWeightedScore` 90.5, `cappedBy: []`, `isConfident: false`.** No hard gate binds — every gated condition is clear (no contradictions, acceptance criteria well above 70, data model present, no undefined load-bearing terms, `definitionExecutability` 88 ≥ 60, `unpopulatedConstantCount` 0, `duplicatedDefinitionCount` 0, `unconfirmedAssumptionCount` 0). The 4.5-point gap to the 95 bar is therefore not a blocking gap but the sum of four dimensions a harsh grader still marks below the mid-90s:

| Dimension | Score | Why not higher |
|---|---|---|
| `functionalCompleteness` (w13) | 88 | Some flows (the exact Q&A answer-merge mechanics, the dashboard layout) are specified in `SKILL.md` and only pointed at here, not fully restated |
| `technicalConstraints` (w6) | 85 | No minimum Claude Code version is pinned, because the install/packaging path is still unsettled (Section 11, and the repo has no plugin manifest yet) |
| `ambiguousLanguage` (w4) | 85 | Two residual soft qualifiers ("a few points", "a few common words") remain — under the gate threshold of 3, but not zero |
| `definitionExecutability` (w10) | 88 | Scored against PRD + inherited rubric; strong but not a perfect 100, since a handful of terms are glossed here and fully procedural only in the rubric |

Closing the remaining distance is a product-judgment call about how much `SKILL.md` detail to pull into the PRD versus the over-specification risk in Section 11 — not an unresolved gap that forces an implementer to guess. The document is dogfood-honest at 90.5 rather than nudged to a passing number.

## Assumptions confirmed (carried forward)

All assumptions raised by earlier Automated Rewrite passes remain reviewed and confirmed as written; `unconfirmedAssumptionCount` is 0:

1. Pasted-text sessions ask for a save location before the first edit (FR-11 / AC-14).
2. "Stop" mid-loop leaves the file as-is and reports current status, with no auto-rollback (FR-12 / AC-15).
3. Spec content is treated as untrusted input, ignoring any embedded instructions (NFR-4).
4. No hard spec size cap, but the tool says so if a document is too large to fully cover in one pass (NFR-5).
5. A scoring-script failure is surfaced as an error, never papered over with an estimated score (NFR-6).
6. Minimum Node.js version: 18 (Section 10).
7. The gate cap values, dimension weights, and the ambiguous-phrase threshold of 3 are carried over unchanged from the shipped scripts, not newly invented (Section 6b, 6e).
