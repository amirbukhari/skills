# Engineering Standards

**Status:** Draft — 6 decisions open (§8)
**Applies to:** Hydra, Delonix
**Precedence:** This document is the source of truth for every definition it contains. A feature PRD may reference these definitions but must not restate or redefine them. Where a PRD and this document disagree, this document wins and the PRD is a bug.

---

## 1. Purpose

This is the layer that feature specs inherit so they don't have to re-derive it.

Anything defined here is defined once, permanently, for every repository in scope. A feature PRD that finds itself explaining what a pure function is, or where helpers live, or how an AI evaluator returns its verdict, is duplicating this document — and duplicated definitions drift.

The test for whether something belongs here rather than in a PRD: **would the answer be the same for the next feature?** If yes, it belongs here.

---

## 2. Repository map

Every deterministic rule in the MR gate is a path predicate. This table is the only place those paths are defined.

**These values are not yet filled in — see decision D-1.** They are deliberately left empty rather than guessed, because a wrong path here fails silently: the rule evaluates, matches nothing, and reports `not_applicable` forever.

### 2.1 Hydra

| Role | Path pattern | Used by |
|---|---|---|
| Entities | `<D-1>` | SG-06c, RR-01–RR-05 |
| Migrations | `<D-1>` | SG-06c, RR-01, RR-06 |
| Seeds | `<D-1>` | RR-06 |
| API docs (Markdown) | `<D-1>` | SG-06b |
| API docs (Postman collections) | `<D-1>` | SG-06b |
| Routers / route handlers | `<D-1>` | RR-17, CV-04 |
| Auth middleware | `<D-1>` | RR-11 |
| Front-end components and pages | `<D-1>` | SG-03, RR-09, CV-07 |
| Store actions (exempt from CV-07) | `<D-1>` | CV-07 |
| Helper location | `helpers.ts`, `<D-1: internal package path>` | CV-05 |
| Domain types | `<D-2>` | §3.2 |
| Money library | `<D-1>` | RR-10 |
| Test files | `<D-1>` | SG-01, RR-16 |
| Mocking module | `<D-1>` | SG-01 |

### 2.2 Delonix

| Role | Path pattern | Used by |
|---|---|---|
| Helper location | `packages/shared/**` | CV-05 |
| *(remaining roles as above)* | `<D-1>` | |

### 2.3 Rules for this table

- A role with no path configured for a repository makes its dependent rules evaluate `not_applicable`, never `flag`. A missing configuration must not manufacture findings.
- Adding or changing a row is a change to review-system behavior and is therefore rated R3 (RR-14).

---

## 3. Code classification

These three algorithms are load-bearing: SG-01, RR-07, RR-09, RR-19–21 and CV-07 all depend on them. They are specified as procedures, not definitions, because a definition leaves an implementer with a decision and a procedure does not.

### 3.1 The conservative-resolution rule

**When static analysis cannot resolve something, resolve toward the higher rating.**

This applies to every algorithm below and to every rule in the catalogue. The reason is that the two error directions cost different amounts:

- Misclassifying impure code as **pure** puts untested I/O behind the SG-01 coverage gate. The gate passes and the risk ships.
- Misclassifying pure code as **impure** only removes it from the coverage denominator. Nothing unsafe ships; a little coverage credit is lost.

The costs are asymmetric, so the defaults are asymmetric. Never resolve an ambiguity in the direction that produces a lower rating.

### 3.2 Purity

A function is **impure** if any of the following holds. Otherwise it is pure.

1. Its body references an identifier in `IMPURE_ROOTS` (§3.3).
2. It calls a function that is itself classified impure. Resolution is transitive with no depth limit, memoized by `(blobSha, symbolName)`. A cycle resolves to **impure**.
3. It assigns to any identifier not declared within its own scope.
4. It mutates a parameter, or any property reachable from a parameter.
5. It is declared `async`, or its return type is or includes `Promise`.
6. It references `this`.
7. **Its callee cannot be statically resolved** — dynamic dispatch, a call through a value of type `any`, or an import from a module without type information.

Clause 7 is the conservative-resolution rule applied. Throwing does **not** make a function impure; a function that validates its input and throws on invalid input is pure.

### 3.3 `IMPURE_ROOTS`

The default set, applied to both repositories:

`Date` (constructor and `Date.now`) · `Math.random` · `performance.now` · `crypto.randomUUID` · `crypto.getRandomValues` · `fetch` · `XMLHttpRequest` · `process` · `globalThis` · `window` · `document` · `localStorage` · `sessionStorage` · `console` · `setTimeout` · `setInterval` · `queueMicrotask` · any import from `fs`, `net`, `http`, `https`, `child_process`, `os`, `dns` · any import from the ORM or database client module · any import from the logging module.

`path`, `url`, `querystring`, and `util` are **pure** and deliberately excluded.

Repository-specific additions are decision D-3.

### 3.4 Business logic

The source PRD defined this as "pure, and contains a conditional or arithmetic operation on domain values," which flags every component ever written — `if (isLoading)` is a conditional and `index + 1` is arithmetic.

The discriminator is **the type of the operand, not the shape of the operation.**

A function `isBusinessLogic` when it is pure **and** at least one of:

1. It accepts a parameter, or returns a value, whose type is declared in the domain-types location (D-2).
2. It performs arithmetic or comparison on a value whose type is declared in the domain-types location.
3. It branches on a value whose type is an enum declared in the domain-types location.

Explicitly **not** business logic, regardless of operation shape:

- Branching on view state: loading, error, empty, disabled, focus, hover, open/closed.
- Array index or length arithmetic.
- String formatting for display, including date and number formatting for presentation only.
- Branching on a prop whose type is a primitive not aliased to a domain type.

This makes the boundary mechanical: if the value came from the domain-types module, reasoning about it is business logic and belongs on the back end.

### 3.5 Live code path

A symbol is **reachable** if a path exists to it through the static import graph from any `EntryPoint` record.

- Traversal is over resolved static imports only.
- Cycles are visited once.
- A `require()` or dynamic `import()` with a non-literal specifier makes **every** export of the containing module reachable.

That last clause is conservative resolution again, in the opposite direction from purity: a false "unreachable" would let a live symbol be deleted at R0 (RR-19), which is the expensive error here.

---

## 4. Rule schema

Every rule in the MR gate catalogue conforms to this schema. **A rule that cannot be expressed in these fields is not implementable and must not be added.**

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable, e.g. `RR-11` |
| `title` | yes | |
| `rating` | yes | R0–R3 |
| `evaluator` | yes | `deterministic` \| `ai` |
| `appliesWhen` | yes | Literal glob patterns resolved from §2. Never a role name in prose |
| `predicate` | yes | For `deterministic`: the analysis procedure, in terms defined in §3. For `ai`: the prompt file path |
| `outputSchema` | ai only | JSON Schema for the model's response |
| `confidenceThreshold` | ai only | Default 0.80 (D-4) |
| `constants` | yes | Every threshold and exemption pattern, with a value. Empty object if none |
| `domainOwnerGroup` | R3 only | |
| `onEvaluatorError` | yes | Always `force_r2` unless stated otherwise |
| `fixtures` | yes | **Minimum 3**: one positive, one negative, one boundary or not-applicable |
| `rolloutState` | yes | §6 |

### 4.1 The enablement gate

A rule may not enter `enforcing` unless every required field is non-null and it has at least three fixtures. This is a deterministic check in CI over the catalogue file.

This gate is why there is no separate rule-scrutiny scoring pass: **an underspecified rule cannot be committed in the first place.** The schema does the work that a review would otherwise do.

---

## 5. AI evaluator contract

Applies to all 8 model-driven checks (SG-05, RR-01, RR-09, RR-12, CV-06, RC-01, RC-03, RC-04).

### 5.1 Invocation

- Temperature 0, structured output enforced against the rule's `outputSchema`.
- Prompts live in versioned files, one per rule. A prompt change is rated R3 (RR-14).
- Rules sharing an evaluator group are batched into one call. The four groups are: **scope** (SG-05), **schema correspondence** (RR-01/RC-01), **comment quality** (CV-06, RC-03, RC-04), **code placement** (RR-09, RR-12).

### 5.2 Response

Every response includes, per finding: `verdict`, `confidence` (0.00–1.00), `evidence` as `{filePath, startLine, endLine}` spans, and `explanation`.

- A finding below `confidenceThreshold` is recorded but does not flag.
- A finding with no evidence span is discarded regardless of confidence. A rule that cannot point at a line has not found anything.

### 5.3 Determinism

NFR-8 requires 95% rating stability across three runs. It is verified, not assumed: CI runs every AI rule against its fixtures three times on each prompt change, and a rule whose rating contribution varies across those runs cannot enter `enforcing`.

### 5.4 Failure

Schema violation is treated as a transport error: two retries at 2s and 4s, then verdict `error`, then `force_r2` per §4. A model that cannot produce valid output does not get to lower a rating.

---

## 6. Rollout states

`Rule.enabled` as a boolean is insufficient — it conflates "not running" with "running but not trusted yet." Three states:

| State | Evaluates | Appears in comment | Gates the MR |
|---|---|---|---|
| `off` | no | no | no |
| `shadow` | yes | yes, marked shadow | **no** |
| `enforcing` | yes | yes | yes |

**Every new rule enters at `shadow`.** Promotion to `enforcing` requires: at least 20 recorded evaluations, and an override rate under 10% across them.

This is what prevents the day-one problem — 32 rules switching on at once against a codebase that has never been held to them. The override rate is the evidence that a threshold is right, and it cannot be gathered before the rule runs.

---

## 7. Conventions

Inherited by every feature, not only by the gate system. Each maps to the rule that enforces it.

| Convention | Rule |
|---|---|
| Business logic lives on the back end, or in store actions at the UI edge. Never in a component | CV-07 |
| Business logic lives in pure functions; I/O functions wrap calls to them, and contain no branching of their own | §3.4 |
| No `any`, no `as` type assertions. `as const` is fine. `unknown` is encouraged | CV-03 |
| Functions in billing take domain arguments, never `KoaContext` | CV-01 |
| Koa route files contain route handling only; helpers are imported | CV-04 |
| Helpers live in the location named in §2 for their repository | CV-05 |
| Comments explain why the code must be this way. Never what it does, never what remains to be done, never why the author chose an approach | CV-06, RC-02–04 |
| Money math uses the money library, never `toFixed` or `parseFloat` | RR-10 |
| Entity changes ship with their migration | SG-06c, RR-01 |
| Exported functions carry JSDoc with a description and `@param` per parameter. Types come from TypeScript | SG-06a |

---

## 8. Open decisions

These need you, once. Everything downstream of them is mechanical.

| # | Decision | Why it can't be defaulted | Effort |
|---|---|---|---|
| **D-1** | The §2 repository map values | Guessing a path fails silently — the rule matches nothing and reports `not_applicable` forever | ~1 hour with the repos open |
| **D-2** | Domain-types location per repo | It is the entire discriminator for §3.4. Without it, business logic is undefined | One path per repo |
| **D-3** | Additions to `IMPURE_ROOTS` beyond §3.3 | The standard set is universal; your I/O modules are not | A short list |
| **D-4** | Confirm 0.80 as the default confidence threshold | Proposed from SG-05's stated value; applying it to seven more rules is an extrapolation, not a fact | Confirm or override |
| **D-5** | RR-10 monetary exemption patterns | Requires knowing which files legitimately format numbers for display | A short list |
| **D-6** | `domainOwnerGroup` for RR-11 (auth) | Names real people | One group |

D-4 and D-6 are single values. D-1 is the only one that takes real time, and it is the one that removes the most invented decisions — roughly 60 glob patterns the agent would otherwise invent.
