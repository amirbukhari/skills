---
name: guide-builder
description: Author user-facing guide content (an explainer or a step-by-step guided tour) for one real UI surface of the current repo, with every selector resolved against real render code. Use when asked to write, add or update in-app help, onboarding, a walkthrough or a product tour.
---

Writes user-facing guide content — an explainer, or a step-by-step guided tour that
highlights real controls — for one real surface of the app in the current repo.

It assumes nothing about the repo. The guide **format**, where guides are stored and
how they are validated are discovered in step 0; the **method** in steps 1–6 applies
whatever the format turns out to be, and is what keeps guide content from silently
describing things that don't exist.

## Parameters

Resolve these in step 0 and restate them in your report. Never fill one in by guessing.

| Parameter | Meaning | Where to find it |
| --- | --- | --- |
| `GUIDE_FORMAT` | How a guide is expressed: a JSON/YAML file per subject, a config object for a tour library, MDX, … | An existing guide in the repo |
| `GUIDE_DIR` | Where guide content lives | Same |
| `SUBJECT_LIST` | The authoritative list of surfaces a guide can be about: a registry module, the route table, a feature manifest, a nav config | The code that loads guides; the router |
| `VALIDATE_CMD` | The command that compiles or validates guide content | `package.json` scripts, `Makefile`, task runner, CI config |
| `TEST_CMD` | The repo's test command | Same; `README`, `CLAUDE.md` / `AGENTS.md` |
| `RUN_CMD`, `APP_URL` | How to start the app locally and where it serves | `README`, `CLAUDE.md` / `AGENTS.md`, scripts, `.env.example`, dev-server config |

## Why this needs a method at all

Guide content names **real selectors** and describes **real controls**, so it rots
the moment a feature changes — an id renamed, a control moved into a menu, a button
that now does something else. And the rot is **silent**: a tour step whose selector
matches nothing degrades into a blank, un-highlighted card that looks exactly like a
deliberate one, and a guide file that fails validation is typically dropped with a
warning nobody reads. Nothing in the UI announces either. That is why the steps
below are non-negotiable rather than a style preference.

## 0. Discover how this repo does guides

Read before deciding anything:

1. The repo's own instructions: `README`, `CLAUDE.md` / `AGENTS.md`, `CONTRIBUTING`,
   and anything under `docs/` about help, onboarding, tours or guides.
2. Existing guide content. Search for it rather than assuming a path: file and
   directory names like `guide`, `tour`, `walkthrough`, `onboarding`, `help`,
   `explainer`; and dependencies on a tour library in the manifest
   (`package.json` or the stack's equivalent).
3. The code that loads that content — it defines the format, shows what happens to
   an invalid guide, and usually points at `SUBJECT_LIST`.
4. The manifest scripts and CI config, for `VALIDATE_CMD` and `TEST_CMD`.

Then:

- **A format exists** → follow it exactly. Copy the shape of the closest existing
  guide; do not introduce a second format.
- **No format exists** → the format is a product decision, not yours. Propose one
  briefly (one file per subject, validated at build or test time, is a sound
  default) and stop for the user's choice before writing content.
- **A parameter cannot be found** → say which one and ask. If there is no
  `VALIDATE_CMD`, say so in the report; step 5's browser check still applies.

## 1. Resolve the subject against the real list

The subject must be a **real entry in `SUBJECT_LIST`** — never one you inferred from
a label or invented to fit. Print the list from the source you found in step 0 (for
example, grep the registry for its id fields, or list the route table).

If the user named a surface in plain language ("the item list", "the save
button"), match it to the closest entry in that list and confirm it. If nothing
matches, say so and stop — do not guess an id.

## 2. Read the real source for that subject BEFORE writing a word

Open the code that actually renders it. Note every **real** selector you find: an
`id` attribute, a test id, or a class / `aria-label` that is genuinely unique within
that subject's DOM region. Use whichever selector kind the existing guides and the
repo's conventions prefer.

**Never invent a selector.** If nothing stable exists for something you want to
highlight, you have exactly two honest options:

- Skip that step, and say in your report that you skipped it and why; or
- If the missing hook is clearly load-bearing, propose a small, targeted one-line
  addition — **adding an `aria-label` is strongly preferred** over writing a step
  that will silently no-op. It's a smaller diff than a new id, it improves
  accessibility on its own merits, and it gives the tour something real to anchor
  to.

Writing a plausible-looking selector you did not verify is the single worst outcome
here: it produces content that passes review, ships, and quietly does nothing.

## 3. Check the element is unconditionally rendered

Two failure shapes to rule out before using a selector:

- **Built on demand.** If the element lives inside an overlay, modal, drawer, or
  collapsed panel, it does not exist in the DOM until that container is opened. A
  step aimed at one highlights nothing. Either have the step open its container
  first (if the format supports declaring that) or pick a selector that is present
  on load.
- **Conditionally rendered.** If the element only renders behind a feature flag, a
  developer-mode gate, or a permission check, a step pointing at it silently
  degrades for every normal user. Verify it is not wrapped in such a condition.

## 4. Draft the content

Write for someone who has never seen this part of the app. Say what a control
**does**, not what it is — "this is a button" is not content. Cover what the
surface is for, its main controls, and any real prerequisite or gotcha. Match the
voice, length and terminology of the existing guides and of the UI's own labels.

For a tour: open with one centered welcome step and close with one centered
finishing step. Five to eight steps is typical — enough to cover the real controls,
not an exhaustive click-through of every element on screen.

## 5. Validate it

Run `VALIDATE_CMD` and `TEST_CMD`. The bar is: the subject appears in the compiled
or loaded output with **no warning**, and the test suite still passes. Read the
output — a guide dropped with a warning often still exits 0.

Validation that only checks syntax is not enough. Start the app with `RUN_CMD`,
open the surface at `APP_URL`, drive the tour in a real browser (with whatever
browser automation the repo or session provides) and confirm **every step
highlights something**. That is the only check that catches a selector which is
syntactically fine and matches nothing. Use a local or disposable environment
only, never a shared one. If you cannot run the app, say so: the selectors are then
inferred, not verified.

## 6. Report back

State plainly:

- the parameters you resolved in step 0, and any you could not;
- the subject, and whether you wrote an explainer, a tour, or both;
- **every selector you used, and for each, whether you verified it against the live
  DOM or only inferred it from reading render code** — these are different levels
  of confidence and the reader needs to know which they're getting;
- any subject-specific gotcha (e.g. "this step targets the whole card rather than
  one button, because the flow has six mutually exclusive phases with no single
  stable selector");
- **anything you wanted to include and skipped for lack of a stable selector** —
  explicitly, rather than silently omitting it. A quiet omission looks identical to
  a considered scope decision.
