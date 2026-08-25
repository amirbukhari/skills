---
name: scrutinize-spec
description: Scrutinizes and iteratively refines a spec until a deterministic confidence score clears 95% — the bar for handing it to an AI coding agent and having it one-shot the implementation without clarifying questions or risky assumptions. Works on a single document (PRD, build spec, requirements doc) or on a spec folder acting as source of truth, where the code is regenerated build output. Use when the user asks to scrutinize, refine, tighten up, stress-test, or check the readiness of a spec/PRD/requirements doc or a spec folder for AI implementation.
---

# Scrutinize Spec

You are running an iterative spec-tightening loop. The goal is not to "review" the PRD once — it's to keep looping (analyze → refine → re-analyze) until the PRD is genuinely implementable with no guessing, or the user decides to stop.

This skill runs in one of two modes, decided in Step 0.

**Document mode** — one PRD, build spec, or requirements doc. Asks: could someone build this without asking questions?

**Folder mode** — a spec folder that is the source of truth, with code as regenerated build output. Asks a stricter question: if the code were deleted and rebuilt from this folder, would the system come back? Everything in document mode still applies, per module, plus eight folder-level dimensions and a set of gates that no single document can fail.

This skill's own directory contains:
- `references/rubric.md` — the 13-dimension scoring rubric for a single document, the anchors, and the exact JSON shape your analysis must produce.
- `references/folder-rubric.md` — the folder-mode rubric: the canonical layout, the eight folder dimensions, and the gates. Read this only in folder mode.
- `scripts/score.js` — a plain Node script with **no dependencies** that computes the actual gated confidence score from your analysis JSON. Run it with plain `node`. **Never compute or state the confidence score yourself** — always get it from this script. This is what keeps "95%" meaning something concrete instead of being whatever number sounds right.

## Step 0 — Resolve the target and pick a mode

First decide which mode you are in. If the user pointed at a directory, or described a spec tree, or said the folder is the source of truth and the code is generated from it, you are in **folder mode** — go to Step 0-F. Otherwise you are in document mode and continue here.

Resolve the PRD text: if the user gave a file path, read it. If they pasted text or described it inline, work with that directly (and ask where to save refinements before you start editing, if it's not already a file; if the user's answer isn't a usable path, ask again rather than guessing a filename).

If the file path doesn't exist or can't be read, say so directly and ask for a corrected path or pasted text — don't proceed as if given an empty PRD. If the resolved PRD text is empty or whitespace-only, say so directly and ask for real content — don't score a blank document.

If the PRD is roughly 8,000 words (~12,000 tokens) or longer, tell the user you're analyzing the full document and confirm you actually did (e.g. note the approximate word count) — don't silently score only part of a long PRD.

If the user has not already specified a refinement mode, ask which one (or offer to run interactive Q&A by default, since it needs the least setup):

1. **Interactive Q&A** — you ask one targeted question at a time; each answer gets merged into a working draft; re-score after each merge; repeat until confident.
2. **Batch critique** — you produce one full critique report (ranked gaps, ambiguous phrases); the user edits the PRD themselves; they ask you to re-score when ready.
3. **Automated rewrite** — you rewrite the full PRD yourself, closing every gap, marking every guess inline as `[ASSUMPTION: ...]`, plus a list of assumptions to confirm; you re-score after the user confirms/edits assumptions.

The user can switch modes at any point in the loop — the working PRD text and score carry over regardless of which mode produced them.

## Step 0-F — Folder mode

Read `references/folder-rubric.md` before doing anything else in this mode.

**Map the tree first.** List the folder and identify which role each path fills: standards, contracts, module specs, fixtures, `unspecified.md`, `provenance.md`, `regenerate.md`. Score the roles, not the filenames — a folder using different names but filling the same roles is fine. Report any role you cannot find; a missing role is usually a gate, not a detail.

**Then check for orphan code, before scoring anything.** This is the gate analysts skip most often, because it means looking outside the spec folder:

1. Read `provenance.md` for the claimed path patterns.
2. List the actual source tree.
3. Every source path matching no claim and not listed as a hand-written exemption is an orphan.

Report real paths in `orphanPaths`, never a count alone. If you cannot reach the codebase to check, say so plainly and set `orphanCodeDetected` to `true` — an unverifiable claim of full coverage is not evidence of full coverage. Orphans cap the folder at 59, because regeneration drops them silently and nobody finds out until the code is gone.

**Score each module, then the folder.** For every `modules/<name>/`, run the document-mode analysis (Step 1) against that module's spec, declaring `standards/` in `inherits`. Write each module's analysis to its own temp file, run `scripts/score.js` on it, and keep the `finalScore`. Then assemble the folder analysis in the shape `folder-rubric.md` documents, including a `dependsOn` list per module, and run:

```
node <this-skill-dir>/scripts/score-folder.js /tmp/spec-folder-analysis.json
```

That prints `{ rawWeightedScore, finalScore, cappedBy, weakestModule, contractCycles, isRegenerable }`. `isRegenerable` is folder mode's equivalent of `isConfident`. Contract cycles are computed in code from the declared edges — if the script reports one, it is real, and the fix is to break the cycle by moving the shared behaviour into a third module or into `contracts/`.

**Present the folder dashboard** with the per-module scores as a table, the weakest module called out by name (it is capping the whole tree), any orphan paths listed individually, any contract cycles, and the folder-level gaps ranked by severity.

**Refine in the same three modes as document mode**, scoped to the folder: interactive Q&A targeting the single highest-leverage gap, batch critique across the tree, or automated rewrite of the specific module specs and contracts that are failing. Prefer fixing the weakest module first — it is the binding constraint, and improving anything else while it stands cannot raise the folder score.

Then loop back through this step until `isRegenerable` is true or the user stops.

### What folder mode cannot tell you

It does not verify that regeneration actually reproduces the system — only running the generator and the fixtures does that. A high score means the folder is structured so the attempt is worth making. Say this plainly when you report a passing score, so nobody reads `isRegenerable: true` as "the rebuild will work".


## Step 0.5 — Ground the analysis in domain research (conditional, once per PRD)

Run this pass **only when the PRD depends on facts you cannot confirm locally** — an external standard, a regulatory requirement, a third-party API's limits, a library version, an industry-standard practice the design assumes. Skip it when the PRD's gaps are internal: undefined terms, missing paths, unpopulated constants, absent acceptance criteria. Research does not close those, and running it anyway costs a slow pass that resolves nothing.

If you skip it, say so in the Step 2 dashboard rather than staying silent, so the user knows the analysis is document-internal.

When it does apply, do it before the *first* analysis pass, so your scoring and suggested fixes are anchored in how comparable real systems actually work.

- Identify the problem domain / product category the PRD describes (e.g. "checkout flow for e-commerce", "internal admin dashboard for support tickets", "a PRD-completeness scoring tool" — whatever fits).
- Invoke the `deep-research` skill with a specific, well-scoped question derived from that domain — e.g. "What do existing tools/approaches for [X] typically require, and what technical standards or constraints commonly apply?" Don't hand it the raw PRD or an underspecified prompt — narrow the question yourself first, the way you'd want a vague research request narrowed. **The question must describe the general problem category only — never quote proprietary specifics, internal codenames, customer names, or other confidential details from the PRD verbatim**, since that question leaves the local session as a web search.
- From the research report, extract only **objective, well-established, uncontroversial facts** that directly close a gap in the PRD (a typical rate limit, a current library/API version, a regulatory requirement, an industry-standard practice). Insert each one into the working PRD inline as `[RESEARCHED: <fact> — source: <citation>]`, at the point it resolves the gap. These do **not** count toward `unconfirmedAssumptionCount` and do **not** need user confirmation before the score can improve — they're cited facts, not guesses.
- Anything the research surfaces that's contested, context-dependent, or a genuine product judgment call (not a settled fact) stays an open gap — handle it through the normal Q&A/batch/rewrite flow in Step 3. Never let a research finding substitute for a product decision only the user can make.
- If `deep-research` is unavailable, or returns malformed/incomplete/obviously-placeholder output, discard it and proceed as if research were skipped — note in your summary that domain grounding wasn't performed. Never incorporate broken data into the PRD or fabricate a citation.
- Track every finding in a `researchFindings` array (question asked, finding, sources) — separate from `gaps` and `detectedAssumptions` in the analysis JSON — and surface it in the Step 2 dashboard.
- Do this once per PRD, not on every re-analyze loop. Skip it on subsequent passes through Step 1 unless the PRD's subject/domain changed materially or the user explicitly asks you to re-research.

## Step 1 — Analyze

Read `references/rubric.md` if you haven't already this session. Score the current PRD text against all 13 dimensions, producing the JSON shape documented there. Be a harsh, literal grader — give the AI-implementer's-eye view: "would I have to ask a question or guess here?" If yes, that's a gap, not a nitpick.

Two of the thirteen dimensions are the ones a well-written PRD most often fails, because they are invisible to a reader and only bite an implementer:

- **`definitionExecutability`** — find every term used in the condition of three or more requirements, and try to construct one input it cannot classify. A term that fails goes in `undefinedLoadBearingTerms` and caps the score at 84. Prose definitions that sound precise ("a pure function has no side effects") belong in the 21-50 band, not the 80s.
- **`constantsEnumerated`** — count every value the implementation needs and cannot derive: paths, globs, thresholds, timeouts, group names, model IDs. A field named without a value is unpopulated, including when the PRD calls it configurable. Set `unpopulatedConstantCount`; any count above zero caps at 89.

If the PRD sits on top of a standards or conventions document, read that document and declare what it covers in `inherits`. A PRD that correctly declines to restate an inherited definition must not be marked down for the omission — and one that restates it should be, via `duplicatedDefinitionCount`. Never populate `inherits` from the PRD's own claim that something is defined elsewhere; open the document and check.

Account for any `[RESEARCHED: ...]` markers already in the working PRD from Step 0.5: the dimensions they resolve should score accordingly, and they must not appear in `gaps` or be counted in `unconfirmedAssumptionCount` — only `[ASSUMPTION: ...]` markers count there.

If you're re-analyzing PRD text that hasn't changed since your last scoring pass earlier in this session, don't raise a dimension score unless the increase is justified by new `[RESEARCHED: ...]` content or something else that actually changed. Unexplained upward drift between passes on unchanged text is a bug, not encouragement.

Write the analysis JSON to a temp file (e.g. `/tmp/prd-analysis.json`), including `unconfirmedAssumptionCount` set to however many `[ASSUMPTION: ...]` markers are currently unconfirmed in the working PRD (0 outside of automated-rewrite mode, or once the user has confirmed/removed them all).

Run:
```
node <this-skill-dir>/scripts/score.js /tmp/prd-analysis.json
```

That prints `{ rawWeightedScore, finalScore, cappedBy, isConfident }`. This is the authoritative score — report `finalScore` to the user, not your own impression, and if `cappedBy` is non-empty, tell the user explicitly which hard gate is holding the score down (e.g. "capped at 84 because acceptance criteria are missing or weak — the weighted average was actually 91").

## Step 2 — Present the dashboard

Show the user, concisely:
- Overall confidence: `finalScore`% (and note if `isConfident` is true — that's the "ready to hand to an AI" signal)
- Per-dimension scores (a compact table is fine)
- Any `cappedBy` reasons, called out clearly — these are what's actually blocking 95%+
- Research findings used to ground the analysis, if any (question → finding → source) — distinct from gaps and assumptions, since these are cited facts, not guesses; if Step 0.5 was skipped, say so and why
- Undefined load-bearing terms, each with the undecidable case that proves it — these are the highest-leverage fixes in the report, since one undefined term used in five requirements is five silent guesses
- Unpopulated constants, listed specifically rather than counted
- Dimensions scored as inherited, and from which document
- Gaps ranked by severity (blocking first), each with its suggested fix
- Ambiguous phrases found, with suggested replacements
- Any contradictions found

If `isConfident` is true: say so plainly, offer to save the final PRD, and stop looping unless the user wants to keep going anyway.

## Step 3 — Refine, per mode

**Interactive Q&A:**
- Ask `nextQuestion` from the analysis — just that one question, with `whyThisMatters` as one sentence of context. Wait for the user's answer.
- Merge the answer into the working PRD yourself (edit the file, or produce the updated text if working from pasted text). Tell the user what section changed.
- Go back to Step 1 and re-analyze the updated PRD. Repeat.

**Batch critique:**
- After presenting the dashboard, stop and hand control back to the user: tell them to edit the PRD (themselves, or ask you to make specific edits) and then say "re-score" when ready.
- When asked to re-score, go back to Step 1 on the current state of the PRD file.

**Automated rewrite:**
- Rewrite the *entire* PRD, closing every gap from the analysis. Where you have to make a judgment call the PRD didn't specify, insert `[ASSUMPTION: <the assumption you made>]` inline at the exact point you made it — never silently invent an unstated fact.
- `[RESEARCHED: ...]` markers from Step 0.5 are different from `[ASSUMPTION: ...]` markers: they're cited facts, not guesses, so they don't need the confirm/reject step below and don't block the score. Mention them in the change log as FYI, but don't add them to the "Assumptions to confirm" list.
- Also produce a short "Assumptions to confirm" list (one line each, referencing the inline markers) and a change log (what changed, per section, and why).
- Show the user a diff-style summary (before → after) for the sections that changed materially, not just the raw rewritten text if it's long.
- Ask the user to confirm, edit, or reject each assumption. Once they respond, update `unconfirmedAssumptionCount` accordingly (it should hit 0 once every assumption is confirmed or resolved) and go back to Step 1 to re-score. Remind them: the score cannot clear 95% while assumptions remain unconfirmed — that's an intentional gate, not a bug.

## Loop until done

In folder mode, loop through Step 0-F instead; the rest of this section applies to both.

Keep looping through Step 1 → Step 2 → Step 3 until either:
- `isConfident` is true, or
- the user explicitly says to stop.

Step 0.5 (research) runs once per PRD, not on every loop iteration — don't re-invoke `deep-research` on every re-analyze pass.

Don't declare victory based on a raw weighted average alone — always defer to `finalScore` and `cappedBy` from the script. If the user seems to be circling without progress (e.g. the same gap keeps failing to resolve), say so directly rather than continuing to loop silently.
