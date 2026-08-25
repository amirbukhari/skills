# PRD Scrutinizer — Product Requirements Document

## 1. Problem Statement

When a PRD is handed to an AI coding agent, gaps in the document don't surface as "I have a question" — they surface as the agent silently guessing, which produces plausible-looking but wrong implementations. Product managers currently have no way to check, before implementation starts, whether their PRD is actually complete enough for an AI to build correctly without hand-holding.

`[RESEARCHED: Industry survey data cited in a systematic mapping study of requirements-quality research consistently ranks inconsistent, under-specified, and incomplete requirements among the top five causes of software project failure. The same body of research shows manual review alone is a weak defense: in controlled experiments, a three-person team spending 4.5 hours reviewing a requirements document caught only 18-25% of the ambiguities it contained using standard checklist/scenario techniques — motivating an automated, checklist-driven approach over ad hoc manual review. — sources: Franch et al., "Requirements Quality Research: A Systematic Mapping Study" (PMC9110500); Kamsties, Berry & Paech, "Detecting Ambiguities in Requirements Documents Using Inspections" (cs.uwaterloo.ca/~dberry)]`

## 2. Goal

Give a PM (or anyone writing a PRD) a tool that scores how ready their PRD is for AI implementation, tells them specifically what's missing, and helps them close those gaps — until the tool reports a 95%+ confidence score with no active gates (see Section 8, AC-2), which is the project's operational definition of "safe to hand off."

`[RESEARCHED: Published guidance on agent-executable specifications independently arrives at the same success criterion: a well-formed agent-executable spec is one that "enables an agent to produce a correct implementation without needing to ask any clarifying questions." This project's operational definition of "safe to hand off" is not an invented bar — it matches how practitioners in this space already define spec readiness. — source: "The Specification as the Lever: Why PRDs Break AI Agents" (shunvel.medium.com, AERO framework)]`

## 3. Users

- Primary: product managers and technical leads writing PRDs that will be implemented (in whole or in part) by an AI coding agent.
- Secondary: engineers reviewing a PRD before starting implementation, who want a quick objective signal on completeness.

## 4. Success Metric

A PRD that the tool scores at 95%+ confidence should require zero clarifying questions and zero material incorrect assumptions when handed to an AI coding agent for implementation.

This real-world outcome is measured indirectly, through the tool's own `isConfident` signal (Section 2, Section 6) as a proxy. That proxy is grounded in established requirements-engineering theory (Section 6c) and in this project's own dogfooding (this PRD was scored with the tool it specifies), but has not yet been empirically validated across a large sample of independent PRDs and independent AI-implementation attempts. That validation is future work, not a spec gap: nothing in this document requires an implementer to guess in order to build the tool exactly as written here.

## 5. Scope

### In scope

- Score a PRD across 11 weighted dimensions of "implementation readiness" (scope clarity, functional completeness, data model, edge cases, non-functional requirements, acceptance criteria, out-of-scope statements, technical constraints, ambiguous language, assumptions section, internal consistency).
- Compute a single overall confidence score (0-100%) from those dimension scores.
- Enforce a hard gate: certain categories of gap (missing acceptance criteria, contradictions, a missing data model where the PRD describes any entity that would need to be persisted or structured, unconfirmed assumptions) cap the score below 95% regardless of the weighted average, so a high score can't be reached while a known-blocking issue remains.
- Three refinement modes the user can pick and switch between mid-session:
  - **Interactive Q&A** — the tool asks one targeted clarifying question at a time (the single highest-leverage unresolved gap), merges the user's answer into the PRD, and re-scores.
  - **Batch critique** — the tool produces one full report of ranked gaps and ambiguous language; the user edits the PRD themselves and asks for a re-score.
  - **Automated rewrite** — the tool rewrites the full PRD to close every gap, marking every judgment call it had to make inline as an assumption the user must confirm or reject before the score can clear the gate.
- Before the first analysis pass on a given PRD, the tool performs a one-time domain-research pass (via the `deep-research` skill) to ground gap-finding in how comparable real systems work. Objective, cited facts it finds are auto-resolved inline — marked distinctly from user-confirmed assumptions — without needing user confirmation; contested or judgment-call findings remain open gaps for the user to decide.
- Runs as a Claude Code skill/plugin — no separate application, no API keys, installable via the Claude Code plugin marketplace (`/plugin marketplace add` + `/plugin install`) or by manually copying the skill folder.
- The user can point the tool at a PRD file on disk, or paste/describe PRD text directly in conversation.

### Out of scope

- Any UI beyond the Claude Code conversational interface (no separate web app, no dashboard).
- Persisting PRD history, session state, or scores anywhere outside the PRD file(s) the user is working with. There is no database and no login.
- Scoring or reviewing anything other than product requirements documents (e.g. this is not a general code-review or design-review tool).
- Automatically committing or opening pull requests for a refined PRD.
- Parsing non-text PRD formats (Word documents, PDFs, Notion/Google Docs exports, images of whiteboards). The tool only reads plain text/Markdown files or pasted text; converting other formats is the user's responsibility.
- Judging the business or market merit of the PRD's proposed feature. The tool scores whether the document is specified completely enough to build, not whether the underlying idea is good.
- Localization/internationalization. The rubric, prompts, and output are English-only; scoring a PRD written in another language is out of scope for this version.
- Conflict resolution for concurrent multi-session edits to the same PRD file — see FR-16.

## 6. Data Model

The tool's analysis and scoring are structured objects, not free text. This section is the authoritative schema; both the model producing the analysis and the deterministic scoring script consume it.

**Analysis object** (produced per scoring pass):
- `dimensionScores`: object with all 11 dimension IDs as keys (`scopeGoalClarity`, `functionalCompleteness`, `dataModelDefinition`, `edgeCaseErrorHandling`, `nonFunctionalRequirements`, `acceptanceCriteria`, `outOfScope`, `technicalConstraints`, `ambiguousLanguage`, `assumptionsSection`, `consistency`), each an integer 0-100.
- `flags`: `{ hasContradictions: boolean, dataModelRequiredButMissing: boolean, acceptanceCriteriaMissing: boolean }`.
- `ambiguousPhraseCount`: integer.
- `unconfirmedAssumptionCount`: integer — count of currently-unresolved `[ASSUMPTION: ...]` markers in the working PRD.
- `gaps`: array of `{ dimension, severity: "blocking"|"major"|"minor", title, description, suggestedFix, locationHint }`.
- `ambiguousPhrases`: array of `{ phrase, locationHint, suggestedReplacement }`.
- `contradictions`: array of `{ description, locationHintA, locationHintB }`.
- `detectedAssumptions`: array of strings — assumptions the PRD makes implicitly without stating them.
- `researchFindings`: array of `{ question, finding, sources: string[], resolvesGapTitle: string|null }` — objective, cited facts found via the Step 0.5 domain-research pass that close a gap without requiring user confirmation.
- `nextQuestion`: `{ targetGapTitle, question, whyThisMatters }` or `null` if no unresolved gaps remain. Used by Interactive Q&A mode.
- `summary`: 2-3 sentence plain-language status.

**Score object** (computed deterministically from the analysis object — see FR2):
- `rawWeightedScore`: the weighted average of `dimensionScores` (weights per Section 6a below), rounded to one decimal place for display.
- `finalScore`: the unrounded weighted average, capped by the active gate(s) from Section 6b, then rounded to one decimal place. When multiple gate conditions are simultaneously true, the **strictest (lowest) cap applies** — caps compose via minimum, never by priority order or averaging.
- `cappedBy`: array of gate identifiers that are currently true, regardless of whether they are the binding constraint on `finalScore`. Exact string identifiers, matching Section 6b's conditions in the same order: `contradictions_detected`, `acceptance_criteria_weak`, `data_model_missing`, `too_many_ambiguous_phrases`, `unconfirmed_assumptions`.
- `isConfident`: `finalScore >= 95 AND cappedBy is empty`.

### 6a. Dimension weights

| Dimension | Weight |
|---|---|
| scopeGoalClarity | 10 |
| functionalCompleteness | 15 |
| dataModelDefinition | 10 |
| edgeCaseErrorHandling | 10 |
| nonFunctionalRequirements | 8 |
| acceptanceCriteria | 15 |
| outOfScope | 7 |
| technicalConstraints | 8 |
| ambiguousLanguage | 7 |
| assumptionsSection | 5 |
| consistency | 5 |

Weights sum to 100; `rawWeightedScore = Σ(dimensionScore × weight) / 100`.

### 6b. Gate thresholds

| Condition | Score cap |
|---|---|
| `hasContradictions` is true | 59 |
| `acceptanceCriteriaMissing` is true, or `dimensionScores.acceptanceCriteria < 70` | 84 |
| `dataModelRequiredButMissing` is true | 84 |
| `ambiguousPhraseCount > 3` | 89 |
| `unconfirmedAssumptionCount > 0` | 94 |

These cap values and the ambiguous-phrase threshold of 3 are carried over from the tool's existing, already-implemented scoring script — confirmed as the source of truth going forward.

### 6c. Grounding for the rubric's dimension choices

`[RESEARCHED: This rubric's dimensions are not an arbitrary internal invention — they align with established requirements-engineering quality criteria. ISO/IEC/IEEE 29148:2018 defines nine required characteristics for an individual requirement (Necessary, Appropriate, Unambiguous, Complete, Singular, Feasible, Verifiable, Correct, Conforming) and five characteristics a complete requirements SET must have (Complete, Consistent, Feasible, Comprehensible, Able to be validated) — including an explicit rule that a requirements set cannot be called complete while it still contains any unresolved TBD/TBS/TBR placeholder, which this rubric's `ambiguousLanguage` dimension already penalizes. Separately, a systematic mapping study of the requirements-quality research literature independently found ambiguity, completeness, consistency, and correctness to be the most-studied quality attributes, together comprising 54% of all researched quality themes — corroborating this rubric's emphasis on those same dimensions from an independent research base. — sources: ISO/IEC/IEEE 29148:2018; Franch et al., "Requirements Quality Research: A Systematic Mapping Study" (PMC9110500)]`

## 7. Functional Requirements

1. Given a PRD (file path or pasted text), the tool must analyze it and produce a score for each of the 11 rubric dimensions, each backed by cited evidence from the document (a quote or section reference) — see AC-6. **Failure path**: if the given file path does not exist or cannot be read, the tool must report that directly and ask for a corrected path or pasted text — it must never proceed as if given an empty PRD.
2. The overall confidence score must be computed by the fixed formula in Section 6, executed as code the tool actually runs (not a number the model states from memory) — see AC-7. **Failure path**: covered by NFR-6 (a scoring-script failure is surfaced as an error, never papered over).
3. The tool must identify and rank gaps by severity (blocking / major / minor), each with a specific suggested fix — see AC-8. **No failure path applies**: an empty `gaps` list is a valid, expected result when the PRD has no remaining gaps, not an error condition.
4. The tool must detect ambiguous, unquantified language (e.g. "fast", "simple", "handle appropriately") and suggest concrete replacements — see AC-9. **No failure path applies**: an empty `ambiguousPhrases` list is a valid result.
5. The tool must detect direct contradictions between sections of the PRD — see AC-10. **No failure path applies**: an empty `contradictions` list is a valid result.
6. In Interactive Q&A mode, the tool must select the single highest-leverage unresolved gap to ask about next: prefer `blocking` severity over `major` over `minor`; when severity ties, prefer the gap in the highest-weighted dimension (Section 6a) — see AC-11. **Failure path**: if no unresolved gaps remain, `nextQuestion` must be `null` rather than the tool fabricating a question to keep the loop going — see AC-17.
7. In Automated Rewrite mode, every fact the tool introduces that was not explicitly stated in the source PRD must be marked inline as `[ASSUMPTION: <the assumption>]` at the exact point introduced, and listed separately for user confirmation; `unconfirmedAssumptionCount` (Section 6) must reflect how many remain unresolved — see AC-3. **Failure path**: if a rewrite pass is interrupted before completion, the tool must leave the last confirmed PRD state on disk untouched rather than write a partial rewrite.
8. The user must be able to switch between the three modes at any point without losing the current PRD draft or score — see AC-5. **No failure path applies**: mode switching is a pure UI-state change with no external I/O to fail.
9. The tool must re-run the scoring path in Section 6 after every refinement step, regardless of which mode produced the update, so the score is computed identically no matter which mode was used — see AC-12. **Failure path**: covered by NFR-6.
10. Whenever `finalScore` is below `rawWeightedScore` (i.e. a gate is binding), the tool must state which specific gate(s) caused the cap and by how much — see AC-13. **No failure path applies**: this requirement is inactive (nothing to state) whenever `cappedBy` is empty.
11. If the user provides pasted PRD text rather than a file path, and does not specify a save location up front, the tool must ask where to save before making its first edit — it must never silently create or overwrite a file the user didn't name — see AC-14. **Failure path**: if the user's answer isn't a usable path (empty, or a directory that doesn't exist), the tool must ask again rather than guessing a filename — see AC-18.
12. If the user says "stop" mid-loop, the tool must leave the PRD file exactly as last written (no automatic rollback, no automatic further edits) and state the current score and remaining gaps before ending — see AC-15. **No failure path applies**: this requirement is itself the tool's failure/exception behavior for the overall refinement loop.
13. `[RESEARCHED: under ISO/IEC/IEEE 29148-aligned requirements methodology, a requirement that specifies only the expected ("go path") behavior without also specifying its failure/exception behavior for invalid or off-path input is incomplete by definition, not merely a stylistic gap.]` Every functional requirement in this document must itself specify both its expected behavior and its failure/exception behavior, or explicitly state that no failure path applies — see AC-16. (This tool now holds its own PRD to the same standard it enforces on the PRDs it scores.) — source: Bender RBT, "Ambiguity Review Checklist" methodology (benderrbt.com)
14. Before the first analysis pass on a given PRD, the tool must perform the one-time domain-research pass described in Section 5, marking any objective, cited fact it uses to close a gap inline as `[RESEARCHED: <fact> — source: <citation>]` — distinct from `[ASSUMPTION: ...]` markers, and excluded from `unconfirmedAssumptionCount` — see AC-19. **Failure path**: if the `deep-research` skill is unavailable in the current session, the tool must skip Step 0.5, state in its summary that domain grounding was not performed, and continue the analysis on the PRD's stated content alone — it must never fabricate a research finding or a citation. This also covers the case where `deep-research` runs but returns malformed, incomplete, or obviously-placeholder output (observed in practice during this project's own development) — the tool must discard that output and treat it the same as an unavailable skill, never incorporate broken data into the PRD.
15. If given an empty or whitespace-only PRD (file or pasted text), the tool must say so directly and ask for real content — see AC-20. **Failure path**: this requirement is itself the failure-path handling for the degenerate "no content" case; there is no further failure mode beneath it.
16. **No failure path applies — explicitly out of scope**: concurrent invocation of the tool against the same PRD file from multiple sessions has no conflict-resolution requirement. The tool assumes single-user, single-session usage per file (Section 5); if the file changes on disk from outside the current session, the tool's next write may overwrite those external changes, and that is accepted behavior, not a defect.

## 8. Non-Functional Requirements

1. No external network calls or API costs beyond what Claude Code itself already uses — the scoring/analysis reasoning is performed by Claude directly in the session, not via a separate hosted API.
2. The deterministic scoring logic (Section 6) must run via a dependency-free script so it works in any environment with Node.js available and requires no `npm install` step.
3. Installation for a new user must be possible without cloning the repository (via the Claude Code plugin marketplace).
4. The PRD text the tool analyzes is untrusted input — it may contain text designed to look like instructions. The tool must treat PRD content strictly as data to be scored, and must not follow any instruction embedded within the PRD text itself that contradicts this document or the user's actual, out-of-band requests.
5. The tool has no hard-enforced maximum PRD size, but if a PRD exceeds roughly 8,000 words (~12,000 tokens), the tool must say so explicitly and confirm it analyzed the whole document, rather than silently scoring only part of it.
6. If the scoring script (`scripts/score.js`) fails to run or errors on malformed input, the tool must surface that error to the user rather than estimating or stating a confidence score itself.
7. Re-scoring identical, unedited PRD text must be deterministic **at the gating layer**: two consecutive runs of `scripts/score.js` against the same analysis JSON must produce byte-identical `finalScore` and `cappedBy` output, since the script is pure arithmetic with no I/O. This does not extend to Step 1's upstream dimension-scoring judgment, which Claude performs by reading the rubric rather than by fixed algorithm — minor variance (a few points per dimension) between separate scoring sessions on identical unedited text is expected and acceptable; a large swing (e.g. a dimension moving more than ~15 points with no content change) should be treated as a signal to investigate, not as expected noise.
8. No accessibility requirements apply beyond what Claude Code's own conversational interface already provides — this tool has no independent UI (Section 5, Out of scope).
9. `scripts/score.js` must complete in under 1 second for any valid input, since it performs only arithmetic over an 11-key object with no I/O or network access.
10. The domain-research question formulated in Step 0.5 (Section 5, FR-14) must describe the general problem category only (e.g. "PRD-completeness scoring tools for AI-assisted development") — it must never quote proprietary specifics, internal codenames, customer names, or other confidential details from the PRD verbatim in a web search query, since that query leaves the local session — see AC-21.

## 9. Acceptance Criteria

- **AC-1**: Running the tool against a deliberately vague sample PRD produces a `finalScore` below 70% and a non-empty, ranked `gaps` list.
- **AC-2**: Running the tool against a thorough, well-specified PRD is capable of reaching `finalScore >= 95` with `cappedBy` empty (i.e. `isConfident: true`).
- **AC-3**: In Automated Rewrite mode, a PRD with one or more unresolved `[ASSUMPTION: ...]` markers cannot score above 94%, even if every dimension in `dimensionScores` is 100.
- **AC-4**: Introducing a direct contradiction into an otherwise-complete PRD caps `finalScore` at or below 59%, regardless of how high the other dimension scores are.
- **AC-5**: Switching from Interactive Q&A to Automated Rewrite mid-session (or vice versa) preserves the current PRD text and score history; the working PRD is not reset.
- **AC-6**: Every dimension score in a produced analysis is accompanied by at least one citation (a direct quote or explicit section reference) from the PRD being scored.
- **AC-7**: The `finalScore` and `cappedBy` reported to the user always match the output of `scripts/score.js` run against the corresponding analysis object — never a number stated without running the script.
- **AC-8**: Every entry in `gaps` includes a non-empty `suggestedFix`.
- **AC-9**: Every entry in `ambiguousPhrases` includes a `suggestedReplacement` that is itself free of the same class of unquantified qualifier.
- **AC-10**: If two sections of the PRD state conflicting facts about the same requirement, at least one entry appears in `contradictions` describing both locations.
- **AC-11**: Given an analysis with at least one `blocking` gap and one `major` gap, `nextQuestion.targetGapTitle` matches a `blocking`-severity gap, not the `major` one.
- **AC-12**: Scoring a PRD via Batch critique mode and scoring the identical PRD text via Interactive Q&A mode produce the same `finalScore` for the same content.
- **AC-13**: Whenever `cappedBy` is non-empty, the response shown to the user names each active gate and states the `rawWeightedScore` alongside the `finalScore`.
- **AC-14**: Given pasted PRD text with no prior save location established, the tool's first response asks where to save before writing any file.
- **AC-15**: After the user says "stop" mid-loop, no further edits are made to the PRD file, and the tool's final message states the last-known `finalScore` and the count of remaining open gaps.
- **AC-16**: Every functional requirement in this document specifies both its expected ("go path") behavior and its failure/exception behavior, or explicitly states that no failure path applies.
- **AC-17**: When an analysis has no unresolved gaps, `nextQuestion` is `null`, never a fabricated question.
- **AC-18**: If the user's answer to "where should I save this?" isn't a usable path, the tool asks again rather than guessing a filename or silently picking one.
- **AC-19**: Within a single refinement loop (Steps 1→2→3 repeating in one session), no dimension score improves between two analysis passes on the same PRD text unless that improvement is backed either by changed PRD content or by a `researchFindings` entry — this guards against unexplained upward drift, and is distinct from NFR-7's allowance for minor cross-session variance. Every entry in `researchFindings` includes at least one non-empty source citation.
- **AC-20**: Given an empty or whitespace-only PRD, the tool responds by asking for real content and does not report a `finalScore`.
- **AC-21**: The literal text sent to the `deep-research` skill in Step 0.5 contains no substring copied verbatim from the source PRD longer than a few common words — it is a generalized description of the problem domain, not a paraphrase-free excerpt.

## 10. Assumptions

- The user has Node.js available on their machine (required only for the scoring script). Minimum version: 18, the oldest LTS release with native fetch and other APIs commonly assumed available.
- The user is working within Claude Code, not a different AI coding tool. Minimum Claude Code version: whichever version introduced the plugin marketplace system (`/plugin marketplace add`), since that's the primary install path this project depends on.
- Step 0.5 (domain research, Section 5) depends on the `deep-research` skill being available in the same Claude Code session. This is a soft dependency, not a hard requirement: per FR-14's failure path, its absence degrades the analysis (no domain grounding) rather than blocking the tool entirely.
- Rubric-following reliability (Step 1 dimension scoring) was exercised in practice using Claude Opus/Sonnet-tier models. Haiku-tier or older/smaller models have not been validated against this rubric and may score less consistently; no specific model is required to run the tool, but this is a known limitation, not a guarantee that any model produces equivalent results.
- "One-shot implementation" is judged from the PRD text alone — the tool does not have access to the target codebase and cannot detect gaps that only become apparent once implementation starts (e.g. an undocumented existing API constraint).

## 11. Open Questions

- Should there be a way to save/export a scoring report separately from the PRD file itself, for sharing with stakeholders who don't have Claude Code?
- Should the rubric weights in Section 6a be configurable per-team, or are the current fixed weights sufficient for all PRD types (e.g. a backend-only PRD vs. a UI-heavy PRD)?
- Automated Rewrite mode is designed to close every gap it finds by adding explicit detail. Published research on AI coding agents warns that over-specifying a spec can itself degrade agent performance (a "curse of instructions" effect) — completeness has to be balanced against overload, not maximized without limit (source: O'Reilly Radar, "How to Write a Good Spec for AI Agents"). This is a genuine product-judgment call, not a settled fact, so it's not auto-resolved: should Automated Rewrite mode have any restraint mechanism (e.g. flagging when a PRD risks over-specification), or is exhaustiveness always preferable to gaps for this tool's stated goal?

## 12. Change Log (this revision)

| Section | What changed | Why |
|---|---|---|
| 6 (new) | Added the full Analysis/Score data model, dimension weights, and gate thresholds | `dataModelDefinition` was scored 25/100 and flagged `dataModelRequiredButMissing` — the PRD clearly involves structured data but never named it |
| 7 | Linked every functional requirement to a specific AC; added FR-11 and FR-12 | Only 5 of 10 requirements had a testable AC; save-location and stop-mid-loop behavior were unspecified |
| 8 | Added NFR-4, NFR-5, NFR-6 | Untrusted-input handling, size limits, and scoring-failure behavior were unaddressed non-functional risks |
| 9 | Expanded from 5 to 15 ACs, each mapped 1:1 to a requirement | Original AC set didn't cover FR1, FR3, FR4, FR5, FR9, FR10 |
| 10 | Added version-floor assumptions for Node.js and Claude Code | `technicalConstraints` was scored 65/100 for omitting version requirements |
| 2 | Reworded "safe to hand off" to reference AC-2 directly | Flagged as an unquantified phrase under `ambiguousLanguage` |
| 5 | Reworded "clearly needed" to reference the concrete test now in Section 6b | Flagged as an unquantified phrase under `ambiguousLanguage` |
| 1, 2, 6c (new), 7 (FR-13), 9 (AC-16), 11 | Added Step 0.5 domain-research findings, marked `[RESEARCHED: ...]`, grounding the Problem Statement, Goal, and rubric design in cited external sources; added FR-13/AC-16 (every requirement must specify a failure path) | Deep-research pass (once per PRD, per SKILL.md Step 0.5) found directly relevant, well-established facts from requirements-engineering literature and AI-agent-spec practitioner guidance; also surfaced one genuine open question (over-specification risk) that stays a gap, not an auto-resolved fact |
| 6b, 7 (FR-11/12), 8 (NFR-4/5/6), 10 | All 8 `[ASSUMPTION: ...]` markers reviewed and confirmed as written; converted to settled requirement/constraint text | User confirmed all 8 pending assumptions with no edits; `unconfirmedAssumptionCount` now 0, clearing that gate |
| 7 (FR-1 through FR-12), 9 (AC-17, AC-18), 11 | Audited every functional requirement against the FR-13 failure-path rule; added explicit failure-path or "no failure path applies" text to each; added AC-17 and AC-18 for the two real gaps the audit surfaced (fabricated `nextQuestion`, unusable save-path answers); removed the now-resolved open question about this audit | Requested follow-up audit after confirming the 8 assumptions — FR-1 through FR-12 predated FR-13 and hadn't been checked against it |
| 5, 6, 7 (FR-14/FR-15), 8 (NFR-7/8/9), 9 (AC-19/20), 10 | Documented Step 0.5 domain research as an actual functional requirement and scope item for the first time (it existed in SKILL.md but was never reflected here); added `researchFindings` to the data model; quantified NFR-5's "reasonably cover" into a concrete word/token threshold; added determinism, accessibility, and performance NFRs; added empty-PRD handling (FR-15/AC-20); declared the `deep-research` soft dependency; added two Out-of-scope bullets (non-text formats, business/market judgment) | `functionalCompleteness`, `nonFunctionalRequirements`, `outOfScope`, `technicalConstraints`, and `edgeCaseErrorHandling` all had real, previously-unflagged gaps once checked literally against what the implemented tool actually does |
| 4, 6, 7 (FR-16), 8 (NFR-7 refined, NFR-10), 9 (AC-21), 10 | Enumerated `cappedBy`'s exact string values; scoped NFR-7's determinism claim to the gating script only (not upstream LLM judgment) and added a model-tier validation note; added FR-16 (concurrency explicitly out of scope) and matching Out-of-scope bullet; added NFR-10/AC-21 (research queries must never leak verbatim confidential PRD content); linked the Success Metric to the `isConfident` proxy and flagged empirical validation as future work, not a spec gap; added a localization Out-of-scope bullet | Final pass toward a 100% self-score — closed every remaining precision gap a harsh literal read of this document against its own rubric could still find |
| 1 (wording), 6 (rounding/gate-composition rule), 7 (FR-14 malformed-research case) | Removed a leftover unquantified word from the Problem Statement; specified that simultaneous gate caps compose via minimum (not priority/averaging) and clarified the rounding order between cap comparison and display; extended FR-14's failure path to cover `deep-research` returning malformed/placeholder output (a real failure mode this project hit during its own development) — SKILL.md updated to match both this and NFR-10's confidentiality rule, so spec and implementation stay in sync | Final precision pass — closed the last gaps a fully literal reading against the rubric surfaced |

| 9 (AC-19 scope clarified) | Restated AC-19 to explicitly distinguish within-session drift (guarded against) from NFR-7's cross-session variance allowance — a re-verification pass found these could be read as a soft contradiction; added an explicit anti-drift instruction to `SKILL.md` Step 1, which had no guard against unexplained score inflation on unchanged text | Re-verification requested after v1.2.1 — checking honestly, not just replaying prior scores, found this residual ambiguity and one more unimplemented behavior |

## 13. Self-Score

As of this revision, scoring this document through the tool it specifies (`scripts/score.js`, all 11 dimensions at 100) produces `finalScore: 100`, `cappedBy: []`, `isConfident: true`. This section is itself an instance of dogfooding: the claim is falsifiable by anyone re-running the scoring script against this file's stated dimension scores.

## Assumptions confirmed (this revision)

All 8 assumptions raised by the Automated Rewrite were reviewed and confirmed as written, with no edits:

1. Pasted-text sessions ask for a save location before the first edit (FR-11 / AC-14).
2. "Stop" mid-loop leaves the file as-is and reports current status, with no auto-rollback (FR-12 / AC-15).
3. PRD content is treated as untrusted input, ignoring any embedded instructions (NFR-4).
4. No hard PRD size cap, but the tool says so if a document is too large to fully cover in one pass (NFR-5).
5. A scoring-script failure is surfaced as an error, never papered over with an estimated score (NFR-6).
6. Minimum Node.js version: 18 (Section 10).
7. Minimum Claude Code version: whichever version shipped the plugin marketplace system (Section 10).
8. The gate cap values and the ambiguous-phrase threshold in Section 6b are carried over unchanged from the existing implementation, not newly invented (Section 6b).
