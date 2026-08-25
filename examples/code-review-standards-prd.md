# PRD — Automated Merge Request Review Gate

**Status:** Draft for review
**Author:** Engineering
**Last updated:** 2026-08-25
**Source:** Refined from raw working-session notes on code review standards.

---

## 1. Overview

### 1.1 Problem

Merge request review is currently the slowest and least predictable stage of delivery. Every MR receives the same undifferentiated human review regardless of whether it changes an authentication middleware or fixes a lint error. Reviewers spend attention on changes that carry no risk, and by the time they reach the changes that do carry risk, that attention is spent. There is no shared definition of what an MR must contain before review can start, so reviewers routinely discover missing tests, missing reproduction steps, or an unexplained scope expansion partway through a review — at which point the review is abandoned and restarted days later.

The volume of AI-authored code makes this worse in two specific ways. AI-authored MRs are larger on average, and they contain artifacts a human author would not produce: narration comments addressed to the developer, work the ticket did not request, and reasoning exposed in comments rather than in code structure.

### 1.2 Goal

Build a system that runs automatically on every merge request, decides how much human attention that MR needs, and refuses to start review at all until the MR carries the evidence a reviewer would otherwise have to ask for.

### 1.3 Target users

| User | Need |
|---|---|
| MR author (human or AI agent) | Know before requesting review whether the MR will be accepted into the review queue, and exactly what is missing if not. |
| Reviewer | Receive only MRs that need their attention, with the risk-bearing changes named explicitly. |
| Engineering lead | Tune the ruleset without redeploying, and see where review time is actually going. |

### 1.4 Definition of done

The project is done when, for both repositories in scope:

1. Every opened MR receives a submission-gate result and an aggregated risk rating within the latency budget in §9.
2. MRs failing a submission gate cannot be approved on the hosting platform.
3. MRs rated R0 merge without human approval; R1 merge on AI-reviewer approval; R2 and R3 require the human approvals defined in §6.3.
4. The full rule catalogue in §6 is implemented, each with the acceptance criteria in §10.

### 1.5 Non-goals for v1

See §11 (Out of scope) for the full list. Most importantly: this system does not rewrite code, does not merge MRs, and does not address the Hydra remediation programme described in §11.3.

---

## 2. Definitions

| Term | Definition |
|---|---|
| **MR** | A merge request on the hosting platform. Used interchangeably with "pull request". |
| **Submission gate** | A pass/fail check that must pass before an MR enters the review queue. Failing a gate blocks review entirely; it does not produce a rating. |
| **Rule** | A single named condition evaluated against an MR diff, producing a verdict and a rating contribution. |
| **Rating** | One of R0/R1/R2/R3, defined in §5. |
| **Verdict** | The result of evaluating one rule against one MR: `pass`, `flag`, or `not_applicable`. |
| **Assessment** | The aggregate of all gate results and rule verdicts for one MR revision, plus the aggregated rating. |
| **Evaluator** | The mechanism that produces a verdict: `deterministic` (code) or `ai` (model call). |
| **Live code path** | A code path reachable from an application entry point (HTTP route, scheduled job, CLI command, or event consumer) as determined by static reachability analysis from the entry-point manifest in §7.6. |
| **Pure function** | A function that is deterministic in its arguments, performs no I/O, and mutates no state outside its own scope. |
| **Requested scope** | The set of changes described by the linked ticket, per §4.2. |
| **Revision** | A single head commit of an MR. Every push creates a new revision and a new assessment. |

---

## 3. System overview

The system is a CI service that reacts to MR events, evaluates the MR against a versioned rule catalogue, and writes its findings back to the MR as a status check and a structured comment.

### 3.1 Pipeline stages

An assessment runs in four ordered stages. A stage runs only if the previous stage completed.

**Stage 1 — Ingest.** Triggered by an MR `opened`, `synchronize`, or `reopened` webhook. Fetches the MR metadata, the diff against the merge base, and the linked ticket. Produces an `Assessment` record in state `running`.

**Stage 2 — Submission gates.** Evaluates the six gates in §4 in parallel. Every gate is evaluated even if an earlier one fails, so the author receives the complete list of what is missing in one pass rather than one item at a time. If any gate fails, the assessment terminates with state `blocked`, stages 3 and 4 do not run, and the platform status check is set to failed.

**Stage 3 — Rule evaluation.** Evaluates every rule in the catalogue whose `appliesWhen` file-pattern matches at least one changed file. Deterministic rules run first and in parallel. AI rules run afterwards, batched into a single model call per rule group as defined in §9.2.

**Stage 4 — Aggregate and publish.** Computes the MR rating per §5.2, writes the assessment comment, sets the status check, and assigns reviewers per §6.3.

### 3.2 Outputs

Every completed assessment produces exactly three outputs on the MR:

1. **A status check** named `mr-gate`, with state `success` (rating R0 or R1 and all gates passed), `failure` (any gate failed), or `neutral` (rating R2 or R3 — passes the gate, awaits humans).
2. **One assessment comment**, updated in place on each new revision rather than appended, containing: the rating with the rule that drove it, the failed gates with the specific missing evidence, every `flag` verdict grouped by rating, and the catalogue version used.
3. **Reviewer assignment** per §6.3.

---

## 4. Submission gates

A gate failure blocks review. Each gate is deterministic unless marked otherwise.

### SG-01 — Unit test coverage on pure functions

Line coverage of functions classified as pure (per §7.5) across all files added or modified by the MR must be at least 90%, measured on the MR revision.

Coverage is measured on the changed-file set only, not the whole repository. Files with zero pure functions are excluded from the denominator. If the changed-file set contains no pure functions at all, the gate passes as `not_applicable`.

Tests satisfying this gate must not use mocks, stubs, or fakes; a test file importing the project's mocking utilities does not count toward the coverage numerator. [ASSUMPTION: the mock-free requirement is enforced by detecting imports of the test framework's mocking module, and there is no allowlist of legitimate exceptions.]

### SG-02 — Evidence of testing for non-pure code

Every changed file containing at least one non-pure exported function must be covered by at least one artifact from this enumerated list, attached to or linked from the MR description:

- An automated test (integration, end-to-end, or contract) that exercises the changed code and runs in CI.
- A recorded HTTP session (Postman collection run export, or HAR file) covering the changed endpoint.
- A seeded reproduction script committed under the repository's script directory.

The artifact must be re-runnable by the reviewer without access to the author's local environment. A screenshot alone does not satisfy SG-02; screenshots satisfy SG-03.

### SG-03 — Visual evidence

If the MR changes any file under a front-end component or page directory, the MR description must contain at least one image or video attachment. Videos are required rather than images when the change affects an interaction across more than one screen or state transition.

### SG-04 — Reproduction steps

The MR description must contain a section headed `## Reproduction` containing numbered steps.

For an MR linked to a ticket of type `bug`, that section must additionally contain a `Before` and an `After` subsection, each with an observable, stated outcome, such that a reviewer following the `Before` steps on the base branch observes the bug and following the `After` steps on the MR head does not.

### SG-05 — Scope conformance (AI evaluator)

An AI evaluator compares the MR diff against the requested scope (§4.2) and returns, per changed hunk, one of `in_scope`, `out_of_scope`, or `incidental`.

The gate fails if any hunk is classified `out_of_scope` with model confidence at or above 0.8. `incidental` covers changes that are mechanically required by an in-scope change — an import update, a call-site signature update, a lockfile regeneration, a generated file — and never fails the gate.

The gate fails as `unverifiable` if the MR has no linked ticket, because requested scope cannot be established without one.

### SG-06 — Documentation minimums

Three deterministic sub-checks, all of which must pass:

- **SG-06a — JSDoc.** Every exported function added or modified by the MR has a JSDoc block containing a description and an `@param` tag for each parameter. Type annotations are not required in JSDoc, as they are carried by TypeScript. `@returns` is required when the return type is not `void`.
- **SG-06b — API documentation.** If the MR adds, removes, or changes the path, method, request schema, or response schema of any HTTP route, then the MR must also change at least one file in the API documentation set: the Markdown files under the docs directory, and the Postman collection files. [ASSUMPTION: the API documentation set is exactly these two locations, identified by the file-pattern configuration in §7.1, and no other documentation surface needs updating.]
- **SG-06c — Migration parity.** If the MR changes any file in an entities directory, it must also add at least one file in the corresponding migrations directory. This is the deterministic half of RC01; the semantic half is rule RR-01.

### 4.2 Establishing requested scope

Requested scope is derived from the ticket linked in the MR description, resolved in this order:

1. A ticket reference in the MR description matching the configured ticket-key pattern.
2. A ticket reference in the MR source branch name.
3. None found — SG-05 fails as `unverifiable`.

Requested scope is the ticket's title, description, and acceptance-criteria fields, concatenated. [ASSUMPTION: the ticket system exposes these three fields via API and they are populated on the tickets that reach MR stage; tickets with an empty description are treated as unverifiable rather than as unbounded scope.]

---

## 5. Ratings

### 5.1 Rating scale

| Rating | Name | Meaning | Human approval required |
|---|---|---|---|
| **R0** | Trivial | Deterministically verified as safe. | None. Auto-approved. |
| **R1** | Normal | An AI reviewer may approve, or elevate to R2. | None, unless the AI reviewer elevates. |
| **R2** | High | Requires a human reviewer. | 1 engineer on the owning team. |
| **R3** | Expert | Requires a senior or domain expert. | 1 reviewer from the domain-owner group for the triggering rule. |

### 5.2 Aggregation

The MR rating is the **maximum** rating across all rules with a `flag` verdict. Rules with `pass` or `not_applicable` verdicts contribute nothing.

An MR where every applicable rule passes and at least one rule was applicable is rated **R0**. An MR where no rule was applicable is rated **R1**, not R0 — an unrecognised change shape is not evidence of safety.

There is no averaging, no score, and no count-based escalation: one R3 flag makes the MR R3 regardless of how many R0 flags accompany it.

### 5.3 AI reviewer elevation

For an MR rated R1, the AI reviewer produces one of:

- `approve` — the MR merges without human approval.
- `elevate` — the MR is re-rated R2 and assigned a human reviewer. The elevation reason is written into the assessment comment.

The AI reviewer may never de-escalate a rating produced by a deterministic rule. It may only approve at the current rating or elevate.

---

## 6. Rule catalogue

Rules are grouped by intent. Every rule has an ID, a rating, an evaluator, and a condition. The complete catalogue is versioned and stored per §7.1.

### 6.1 Risk rules

| ID | Rating | Evaluator | Condition |
|---|---|---|---|
| RR-01 | R1 | ai | An entities file changed and a migration was added (SG-06c passed), and the migration's column, type, and constraint operations correspond to the entity's field changes. Flags when they do not correspond. |
| RR-02 | R1 | deterministic | An entity change is purely additive: new nullable columns or new entities only, no modification or removal of existing fields. |
| RR-03 | R1 | deterministic | An entity field changes nullability in the widening direction (non-nullable to nullable). |
| RR-04 | R2 | deterministic | An entity field changes nullability in the narrowing direction (nullable to non-nullable), changes type, or is removed. |
| RR-05 | R2 | deterministic | An entity enum member list changes in any direction. |
| RR-06 | R2 | deterministic | A migration file was added and no file in the seed directory changed. |
| RR-07 | R0 | deterministic | Every function added by the MR is pure, has exactly one return type (optionally a union with `null`), has no optional or overloaded parameters, and has at least one passing test asserting a success case and at least one asserting a failure or boundary case. Flagging is inverted here: this rule contributes R0 when satisfied, and R1 when a new pure function fails any of these conditions. |
| RR-08 | R0 | deterministic | Every changed file is a type-guard or type-declaration file. |
| RR-09 | R1 | ai | Every changed front-end file is a component or page containing no business logic, and imports no module that contains business logic (evaluated transitively across the import graph). Flags at R2 if business logic is found. |
| RR-10 | R2 | deterministic | The diff contains a call to `.toFixed(` or `parseFloat(`. Suppressed to R0 when the enclosing file matches the monetary-exemption pattern list in §7.1. |
| RR-11 | R3 | deterministic | Any file in the authentication or authorisation middleware directory changed, or any route's middleware chain gained or lost an auth middleware. |
| RR-12 | R1 | ai | An exported function's body changed, its JSDoc did not, and the linked ticket type is not `bug`. |
| RR-13 | R2 | deterministic | An exported function's signature changed: parameter added, removed, reordered, retyped, or return type changed. |
| RR-14 | R3 | deterministic | Any file changed that itself defines the review system's behaviour: the rule catalogue, the evaluator prompts, the rating configuration, or the pattern configuration in §7.1. |
| RR-15 | R2 | deterministic | Any CI configuration file changed. |
| RR-16 | R2 | deterministic | An existing test file changed in a way that removes or weakens an assertion. Adding assertions or adding test cases does not flag. |
| RR-17 | R2 | deterministic | A route file's router applies a middleware to at least 70% but fewer than 100% of its routes. [ASSUMPTION: 70% is the threshold at which partial middleware application indicates an omission rather than an intentional split; this is a starting value to be tuned per §12.] |
| RR-18 | R0 | deterministic | Every change in the MR is confined to formatting or lint-rule compliance, verified by the diff being empty after running the repository formatter and lint autofix on the base revision. |

### 6.2 Dead-code removal rules

These rules apply when the MR removes an exported symbol.

| ID | Rating | Evaluator | Condition |
|---|---|---|---|
| RR-19 | R0 | deterministic | The removed symbol has zero references anywhere in the repository at the base revision. |
| RR-20 | R1 | deterministic | The removed symbol has references, all of which are also removed by this MR, and none of the removed references were reachable from a live code path (§2). |
| RR-21 | R2 | deterministic | The removed symbol, or any of its transitively removed consumers, was reachable from a live code path. |

### 6.3 Convention rules

| ID | Rating | Evaluator | Condition |
|---|---|---|---|
| CV-01 | R2 | deterministic | A function in the billing repository declares a parameter of type `KoaContext`. |
| CV-02 | R0 | deterministic | The diff uses the `unknown` type. Never flags; recorded for reporting only. |
| CV-03 | R2 | deterministic | The diff contains the `any` type, or an `as` type assertion. `as const` is exempt and contributes R0. |
| CV-04 | R1 | deterministic | A file containing Koa route handlers also defines non-route helper functions. |
| CV-05 | R1 | deterministic | A helper function is defined outside the repository's designated helper location: `helpers.ts` or the internal package directory in the Hydra repository, `packages/shared` in the Delonix repository. |
| CV-06 | R1 | ai | The diff adds a comment matching any of the three narration categories in §6.5. |
| CV-07 | R2 | deterministic | Business logic — defined per §7.5 as a pure function containing a conditional or arithmetic operation on domain values — is added to a front-end component file. Store actions are exempt. |

### 6.4 Review checklist rules

These evaluate the MR as a whole rather than a specific change shape.

| ID | Rating | Evaluator | Condition |
|---|---|---|---|
| RC-01 | R1 | ai | Semantic entity/migration correspondence. Identical to RR-01; RC-01 is retained as the checklist-facing alias and evaluates once, not twice. |
| RC-02 | R1 | deterministic | Any changed file is more than 50% comment lines, counting comment lines and code lines and excluding blank lines and the file's own JSDoc blocks required by SG-06a. |
| RC-03 | R1 | ai | A single comment exceeds 5 lines, or restates what the adjacent code already expresses. |
| RC-04 | R1 | ai | A comment explains a decision, a trade-off, or a rationale that belongs in the MR description rather than in the code. |

### 6.5 Narration comment categories (CV-06)

A comment flags under CV-06 if it falls into any of these three categories:

1. **Pending-action narration** — states that work remains to be done, has not been performed yet, or must happen before merge. Example: "This migration has not been performed yet."
2. **Decision narration** — explains why the author chose an approach, addressed to a reader of the change rather than a reader of the code. Example: "I used a map here instead of a loop because it reads better."
3. **Conversational narration** — addresses the developer directly, or narrates the authoring process step by step. Example: "Now let's handle the error case."

A comment explaining *why the code must be this way* — a workaround for an external bug, a non-obvious constraint, a link to a specification — is not narration and does not flag.

---

## 7. Data model

Persisted in a relational database. All identifiers are UUIDs unless stated.

### 7.1 `Rule`

The versioned rule catalogue. Stored as records so leads can tune ratings without a deploy.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable rule ID, e.g. `RR-11`. Primary key. |
| `catalogVersion` | integer | Increments on any catalogue change. Composite primary key with `id`. |
| `title` | string | |
| `description` | text | |
| `rating` | enum | `R0` \| `R1` \| `R2` \| `R3` |
| `evaluator` | enum | `deterministic` \| `ai` |
| `appliesWhen` | string[] | Glob patterns. The rule is evaluated only if a changed file matches one. |
| `exemptionPatterns` | string[] | Glob patterns suppressing the rule, e.g. RR-10's monetary exemptions. |
| `domainOwnerGroup` | string \| null | Required when `rating` is `R3`; names the reviewer group. |
| `enabled` | boolean | |
| `repositoryScope` | string[] | Repository names the rule applies to. |

### 7.2 `Assessment`

One per MR revision.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `repository` | string | |
| `mrNumber` | integer | |
| `headSha` | string | The revision assessed. Unique with `repository` and `mrNumber`. |
| `baseSha` | string | Merge base at assessment time. |
| `catalogVersion` | integer | FK to `Rule.catalogVersion`. |
| `state` | enum | `running` \| `blocked` \| `complete` \| `errored` |
| `rating` | enum \| null | Null while `running` or when `blocked`. |
| `drivingRuleId` | string \| null | The rule whose rating became the MR rating. |
| `ticketKey` | string \| null | |
| `startedAt` | timestamp | |
| `completedAt` | timestamp \| null | |
| `errorReason` | text \| null | Populated when `state` is `errored`. |

### 7.3 `GateResult`

One per gate per assessment. Six rows per assessment.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `assessmentId` | uuid | FK to `Assessment`. |
| `gateId` | string | `SG-01` … `SG-06`. Unique with `assessmentId`. |
| `outcome` | enum | `pass` \| `fail` \| `not_applicable` \| `unverifiable` \| `error` |
| `detail` | text | Author-facing explanation of what is missing. |
| `measuredValue` | decimal \| null | e.g. the coverage percentage for SG-01. |

### 7.4 `RuleEvaluation`

One per applicable rule per assessment.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `assessmentId` | uuid | FK to `Assessment`. |
| `ruleId` | string | FK to `Rule.id`. Unique with `assessmentId`. |
| `verdict` | enum | `pass` \| `flag` \| `not_applicable` \| `error` |
| `contributedRating` | enum \| null | The rule's rating when `verdict` is `flag`. |
| `confidence` | decimal \| null | 0.00–1.00. Populated only when `evaluator` is `ai`. |
| `evidence` | jsonb | Array of `{ filePath, startLine, endLine, excerpt }`. |
| `explanation` | text | |

### 7.5 `SymbolClassification`

Cached per file revision, so purity and business-logic classification is computed once per blob rather than once per assessment.

| Field | Type | Notes |
|---|---|---|
| `blobSha` | string | Primary key with `symbolName`. |
| `filePath` | string | |
| `symbolName` | string | |
| `kind` | enum | `function` \| `component` \| `type_guard` \| `entity` \| `route_handler` \| `other` |
| `isPure` | boolean | No I/O, no external mutation, deterministic in arguments. |
| `isBusinessLogic` | boolean | Pure, and contains a conditional or arithmetic operation on domain values. |
| `returnTypeCount` | integer | Union members, counting `T \| null` as 1. |
| `isExported` | boolean | |

### 7.6 `EntryPoint`

The manifest that defines live code paths (§2). Seeded per repository and updated by RR-14-rated MRs.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `repository` | string | |
| `kind` | enum | `http_route` \| `scheduled_job` \| `cli_command` \| `event_consumer` |
| `filePath` | string | |
| `symbolName` | string | |

### 7.7 `EvidenceArtifact`

Artifacts found on the MR description, satisfying SG-02 and SG-03.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `assessmentId` | uuid | FK to `Assessment`. |
| `type` | enum | `automated_test` \| `http_session` \| `repro_script` \| `screenshot` \| `video` |
| `locator` | string | URL or repository-relative path. |
| `satisfiesGateId` | string | `SG-02` or `SG-03`. |

### 7.8 `Override`

An explicit, attributed bypass of a gate or rule.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `assessmentId` | uuid | FK to `Assessment`. |
| `targetId` | string | A gate ID or rule ID. |
| `actorHandle` | string | The platform user who applied the override. |
| `justification` | text | Required, minimum 20 characters. |
| `createdAt` | timestamp | |

---

## 8. Edge cases and error handling

### 8.1 Evaluator failures

| Situation | Behaviour |
|---|---|
| An AI evaluator times out or returns a transport error | Retry twice with exponential backoff (2s, 4s). On the third failure, the rule's verdict is `error`. |
| An AI evaluator returns output that does not parse against the expected schema | Treated as a transport error and retried on the same schedule. After exhausting retries, verdict is `error`. |
| Any rule verdict is `error` | The MR rating is forced to R2 and the assessment comment names the failed rule. A broken evaluator never produces a lower rating than a working one would. |
| An AI gate (SG-05) errors after retries | The gate outcome is `error`, which does **not** block review; the MR rating is forced to R2 instead. A model outage must not halt all delivery. |
| A deterministic rule throws | Verdict is `error`, same R2 forcing. The exception is logged with the assessment ID. |
| The AI provider is unavailable for more than 15 consecutive minutes | The system enters degraded mode: AI rules are skipped with verdict `not_applicable`, all MRs that would have been R0 or R1 are rated R2, and the assessment comment states that degraded mode is active. |

### 8.2 MR and repository states

| Situation | Behaviour |
|---|---|
| A new revision is pushed while an assessment is running | The running assessment is cancelled and marked `errored` with reason `superseded`. A new assessment starts for the new head SHA. |
| The MR has an empty diff against its merge base | All gates pass as `not_applicable`, rating is R0. |
| The MR is a merge of the base branch into the head with no other changes | Excluded from assessment entirely; the status check is set to `success` with detail `merge-only revision`. |
| The MR targets a branch other than the repository's default branch | Assessed identically. Target branch does not affect gates or ratings. |
| No rule's `appliesWhen` matches any changed file | Rating is R1 per §5.2. |
| The MR is opened as a draft | Assessment runs, but the status check is set to `neutral` and reviewers are not assigned until the draft state is cleared. |
| The linked ticket cannot be fetched | SG-05 outcome is `unverifiable` (blocking). The author resolves it by linking a reachable ticket. |
| The diff exceeds 5,000 changed lines | Deterministic rules run normally. AI rules are evaluated on the 5,000 highest-risk lines, ranked by whether their file matched an R2 or R3 rule; the assessment comment states truncation occurred and the rating is forced to at least R2. |
| A repository has no seed directory configured | RR-06 evaluates as `not_applicable` rather than flagging. |

### 8.3 Disagreement and override

| Situation | Behaviour |
|---|---|
| An author disputes a `flag` verdict | The author replies to the assessment comment with the override command and a justification of at least 20 characters. An `Override` record is written. Overrides of R0 and R1 rules take effect immediately; overrides of R2 and R3 rules require a second platform user to react to the override comment before taking effect. |
| A gate is overridden | Same mechanism. Overriding SG-01 or SG-05 always requires the second approver, regardless of rating. |
| An override is applied and a new revision is pushed | Overrides are scoped to the `Assessment`, not the MR, and therefore do not carry forward. The author reapplies, or fixes the finding. |
| The rating is R3 and no member of the `domainOwnerGroup` is available | The assessment holds at R3. There is no automatic downgrade after a timeout; a lead reassigns the group membership, which is an RR-14-rated change. |

### 8.4 Data and idempotency

| Situation | Behaviour |
|---|---|
| The same webhook is delivered more than once | Assessments are keyed on `(repository, mrNumber, headSha)`. A duplicate delivery returns the existing assessment rather than creating a second one. |
| The rule catalogue changes mid-assessment | The assessment completes against the `catalogVersion` it started with. The version is recorded on the assessment and shown in the comment. |
| A cached `SymbolClassification` exists for a blob SHA | Reused without recomputation. Blob SHAs are content-addressed, so a stale cache is not possible. |

---

## 9. Non-functional requirements

### 9.1 Performance

- **NFR-1.** Stage 2 (submission gates, excluding SG-05) completes within 60 seconds at p95, measured from webhook receipt.
- **NFR-2.** A full assessment completes within 5 minutes at p95 and 10 minutes at p99, for MRs under 5,000 changed lines.
- **NFR-3.** The system handles 200 assessments per hour without queue depth exceeding 20.

### 9.2 Cost

- **NFR-4.** Mean AI evaluation cost per assessment does not exceed USD 0.50. [ASSUMPTION: USD 0.50 per MR is an acceptable ceiling; this is derived from the target of keeping monthly spend under USD 1,000 at the volume in NFR-3, not from a stated budget.]
- **NFR-5.** AI rules sharing an evaluator are batched into a single model call per assessment, so that the number of model calls per assessment does not exceed 4 regardless of catalogue size.

### 9.3 Availability and reliability

- **NFR-6.** The service maintains 99.5% monthly availability, measured as the percentage of webhooks that produce a terminal assessment state within the NFR-2 budget.
- **NFR-7.** No assessment is lost on service restart: webhook payloads are enqueued durably before acknowledgement, and an assessment interrupted mid-run is restarted from Stage 1.
- **NFR-8.** All evaluations are reproducible: re-running an assessment on the same `headSha` and `catalogVersion` produces identical deterministic verdicts. AI verdicts are not required to be identical, but the rating they contribute must be stable across three consecutive runs for at least 95% of assessments.

### 9.4 Security

- **NFR-9.** Repository contents sent to the AI provider are limited to the diff and the files the diff touches. Environment files, files matching the repository's secret-scanning ignore patterns, and any file over 256 KB are excluded.
- **NFR-10.** The service holds read-only repository scope plus the write scopes required for status checks, comments, and reviewer assignment. It holds no merge permission.
- **NFR-11.** Override records are immutable and retained for 24 months.

### 9.5 Observability

- **NFR-12.** Every assessment emits a structured log line containing the assessment ID, rating, driving rule, duration, and model cost.
- **NFR-13.** A dashboard reports, per repository per week: rating distribution, gate failure counts by gate, override counts by target, and the elevation rate of the AI reviewer.

---

## 10. Acceptance criteria

Each criterion is objectively pass/fail. AC IDs map to the requirement they verify.

### Submission gates

- **AC-01.** Given an MR adding a pure function with 8 of 10 lines covered by mock-free tests, SG-01 fails with `measuredValue` 80.0. Given the same MR with 9 of 10 lines covered, SG-01 passes.
- **AC-02.** Given an MR whose only test imports the mocking module, SG-01 fails with the numerator excluding that test's coverage.
- **AC-03.** Given an MR changing a file with a non-pure exported function and an MR description containing no artifact from the SG-02 list, SG-02 fails; adding a linked Postman collection run export makes it pass.
- **AC-04.** Given an MR changing a component file and a description containing no image or video, SG-03 fails.
- **AC-05.** Given a bug-ticket MR whose description has a `## Reproduction` section without `Before`/`After` subsections, SG-04 fails. Given the same MR with both subsections populated, it passes.
- **AC-06.** Given an MR with no linked ticket, SG-05 outcome is `unverifiable` and the assessment state is `blocked`.
- **AC-07.** Given an MR whose ticket requests a bug fix in one module and whose diff also renames variables in an unrelated module, SG-05 fails and the assessment comment names the out-of-scope file paths.
- **AC-08.** Given an MR whose diff changes a function signature and also updates its call sites, those call-site hunks are classified `incidental` and SG-05 passes.
- **AC-09.** Given an MR adding an exported function without a JSDoc `@param` for one of its two parameters, SG-06a fails naming that function.
- **AC-10.** Given an MR changing an HTTP route's response schema without touching the docs directory or a Postman collection, SG-06b fails.
- **AC-11.** Given an MR changing an entities file with no new migration file, SG-06c fails.
- **AC-12.** Given an MR failing SG-01, SG-03, and SG-04 simultaneously, exactly one assessment comment is written listing all three failures.

### Ratings and aggregation

- **AC-13.** Given an MR triggering RR-11 (R3) and RR-18 (R0), the MR rating is R3 and `drivingRuleId` is `RR-11`.
- **AC-14.** Given an MR where every applicable rule passes and at least one was applicable, the rating is R0 and the status check is `success`.
- **AC-15.** Given an MR where no rule's `appliesWhen` matched, the rating is R1.
- **AC-16.** Given an R1 MR where the AI reviewer returns `elevate`, the stored rating is R2, a human reviewer is assigned, and the elevation reason appears in the comment.
- **AC-17.** Given an R2 MR, the AI reviewer cannot lower the stored rating below R2 under any returned output.

### Individual rules

- **AC-18.** Given an entities change adding a nullable column and a migration adding that column, RR-01 passes and RR-02 flags at R1.
- **AC-19.** Given an entities change making a column non-nullable, RR-04 flags at R2.
- **AC-20.** Given an entities change adding an enum member, RR-05 flags at R2.
- **AC-21.** Given a migration added with no seed-directory change, RR-06 flags at R2. Given the same MR in a repository with no configured seed directory, RR-06 is `not_applicable`.
- **AC-22.** Given a new pure function with one return type, unambiguous parameters, and both a success-case and a failure-case test, RR-07 contributes R0. Removing the failure-case test makes it contribute R1.
- **AC-23.** Given a diff containing `value.toFixed(2)` in a non-exempt file, RR-10 flags at R2. Given the same call in a file matching an exemption pattern, it contributes R0.
- **AC-24.** Given a diff that removes an auth middleware from one route's chain, RR-11 flags at R3 and the assigned reviewer is drawn from that rule's `domainOwnerGroup`.
- **AC-25.** Given a diff changing an exported function body without changing its JSDoc, on a non-bug ticket, RR-12 flags at R1. On a ticket of type `bug`, RR-12 does not flag.
- **AC-26.** Given a router where 8 of 10 routes carry an auth middleware, RR-17 flags at R2. Given 10 of 10 or 5 of 10, it does not flag.
- **AC-27.** Given an MR whose diff is empty after running the formatter and lint autofix on the base revision, RR-18 contributes R0.
- **AC-28.** Given the removal of an exported function with zero references at base, RR-19 contributes R0. Given a removal whose only consumer is also removed and was unreachable from any `EntryPoint`, RR-20 contributes R1. Given a removal whose consumer was reachable from an `EntryPoint`, RR-21 flags at R2.
- **AC-29.** Given a diff introducing `as unknown as Foo`, CV-03 flags at R2. Given `as const`, it contributes R0.
- **AC-30.** Given a file where comment lines exceed code lines, excluding blank lines and required JSDoc, RC-02 flags at R1.
- **AC-31.** Given a diff adding the comment "This migration has not been performed yet", CV-06 flags at R1. Given a comment linking to an upstream bug that explains a workaround, CV-06 does not flag.
- **AC-32.** Given a billing-repository function declaring a `KoaContext` parameter, CV-01 flags at R2.

### Error handling and non-functional

- **AC-33.** Given an AI evaluator that fails three times, the rule verdict is `error` and the MR rating is R2.
- **AC-34.** Given the AI provider unavailable for 16 minutes, the next assessment runs in degraded mode: AI rules are `not_applicable`, rating is at least R2, and the comment states degraded mode.
- **AC-35.** Given a push during a running assessment, the first assessment ends `errored` with reason `superseded` and exactly one assessment exists in a terminal non-superseded state for the new head SHA.
- **AC-36.** Given the same webhook delivered twice, exactly one `Assessment` row exists for that `(repository, mrNumber, headSha)`.
- **AC-37.** Given an assessment re-run on an unchanged `headSha` and `catalogVersion`, every deterministic `RuleEvaluation.verdict` is identical to the first run.
- **AC-38.** Given a repository containing a file matching the secret-scanning ignore patterns within the diff, that file's contents do not appear in any outbound request to the AI provider, verified by request logging.
- **AC-39.** Given 200 assessments enqueued within one hour, p95 end-to-end duration is under 5 minutes and maximum queue depth stays at or below 20.
- **AC-40.** Given an author override of an R2 rule with a 25-character justification and no second approver, the rule remains flagged and the rating is unchanged. Given a second platform user reacting to the override comment, the flag is suppressed.

---

## 11. Out of scope

### 11.1 Out of scope for v1, planned for later

- Automatic remediation: the system reports findings and never edits code, force-pushes, or opens follow-up MRs.
- Merging: the system sets status checks and assigns reviewers; the platform's own merge rules decide when an MR merges.
- Per-team rule customisation: the catalogue is per repository, not per team or directory.
- Repositories other than the two named in §12.1.
- Historical backfill: the system assesses MRs opened after deployment only.

### 11.2 Explicitly not being built

- A replacement for the existing linter, formatter, or type checker. The system consumes their output; it does not duplicate their rules.
- A code-quality score, grade, or leaderboard. The rating expresses required review attention, not code quality, and is never aggregated per author.
- A test generator.

### 11.3 Separate programme — Hydra remediation

The following were raised in the same working session and are **not** part of this PRD. They belong to a separate initiative that this system supports but does not contain:

- The automated dead-code removal tool and its scheduled run. This system's RR-19 through RR-21 rate the *review* of such removals; it does not perform them.
- The pre-teardown audit for business logic in components and in the Redux feature modules.
- The decoupling refactor and the Ledger singleton unbinding.
- The two proofs-of-concept: safe removal of one junk module, and one net-new module built in the existing system versus the rebuild.

The one dependency between the programmes: business logic that the audit determines must remain on the front end is to be identified in the rebuild's own PRD, not in this one.

---

## 12. Technical constraints

### 12.1 Repositories in scope

| Repository | Stack | Helper location (CV-05) |
|---|---|---|
| Hydra | TypeScript, Koa, TypeORM-style entities and migrations | `helpers.ts`, internal package directory |
| Delonix | TypeScript | `packages/shared` |

The billing repository is referenced by CV-01 only; it is not itself assessed in v1. [ASSUMPTION: billing is a package or directory within one of the two repositories above rather than a third repository requiring its own onboarding.]

### 12.2 Platform and toolchain

- **Hosting platform:** [ASSUMPTION: GitLab, given the notes' consistent use of "MR" and "MR description". If the platform is GitHub, the webhook events, status-check API, and reviewer-assignment API in §3 change, but no requirement or rating does.]
- **CI:** the platform's native CI. The service runs as a long-lived webhook consumer rather than a per-MR CI job, so that assessments survive CI runner restarts (NFR-7).
- **Language:** TypeScript on Node.js 22 LTS, matching the assessed repositories.
- **Database:** PostgreSQL 16.
- **Coverage tool:** the repositories' existing coverage tooling, consumed via its LCOV output. [ASSUMPTION: both repositories emit LCOV today; if not, SG-01 requires a coverage-tooling change in those repositories first, which is a prerequisite outside this PRD.]
- **AI provider:** a single provider, accessed server-side with a service credential. Model selection is a configuration value, not a code constant, so it can change without a catalogue version bump.

### 12.3 Static analysis

Purity classification, signature-change detection, import-graph traversal, and reachability from `EntryPoint` records are all computed from the TypeScript compiler API against the MR head revision. No third-party analysis service is introduced.

---

## 13. Assumptions to confirm

Each corresponds to an inline `[ASSUMPTION: ...]` marker above. **The confidence score cannot clear 95% while any of these is unconfirmed** — that is an intentional gate.

| # | Section | Assumption |
|---|---|---|
| A-1 | §4 SG-01 | Mock-free enforcement works by detecting mocking-module imports, with no allowlist of legitimate exceptions. |
| A-2 | §4 SG-06b | The API documentation set is exactly the docs Markdown directory plus the Postman collections, and no other documentation surface needs updating. |
| A-3 | §4.2 | The ticket system exposes title, description, and acceptance criteria via API; an empty description makes scope unverifiable rather than unbounded. |
| A-4 | §6.1 RR-17 | 70% is the right partial-middleware threshold, as a tunable starting value. |
| A-5 | §9.2 NFR-4 | USD 0.50 per assessment is an acceptable cost ceiling, derived from a USD 1,000 monthly target rather than a stated budget. |
| A-6 | §12.1 | The billing repository is a package or directory within Hydra or Delonix, not a third repository. |
| A-7 | §12.2 | The hosting platform is GitLab. |
| A-8 | §12.2 | Both repositories emit LCOV coverage output today. |

---

## 14. Open questions

Tracked separately from assumptions: these need a decision, not a confirmation, and each needs an owner before implementation of the affected rule begins.

| # | Question | Blocks |
|---|---|---|
| Q-1 | Can migration/seed appropriateness (RR-06) be evaluated deterministically rather than by checking only that a seed file changed? If yes, RR-06 moves to a semantic AI rule at R1. | RR-06 rating |
| Q-2 | Should RR-16 (weakened test assertions) distinguish an intentional test rewrite accompanying a deliberate behaviour change from a silent weakening? The notes flagged this as needing observation over time. | RR-16 precision |
| Q-3 | Are there legitimate uses of `.toFixed()` outside monetary calculation that warrant a broader exemption list than file patterns — for example, display-only formatting helpers? | RR-10 exemptions |
| Q-4 | What is the review cadence for tuning ratings in the catalogue, and who owns it? The catalogue is designed to be tunable; nothing yet says who tunes it or how often. | Operational ownership |
