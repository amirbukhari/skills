---
name: video-guide
description: Write, record and publish a feature's narrated video guide against the locally running app of the current repo, with every caption spoken and every step checked against the real screens. Use when asked for a demo video, narrated walkthrough or screen recording of a feature, or when a feature's screens changed enough that its video no longer shows them.
---

Writes a feature's video guide — a scripted walk through the real UI, one narrated line
per step — records it into a narrated video against the local app, and publishes the
video. Run it as `/video-guide <feature>` for a new feature, when the repo's guide
coverage check fails, or when a feature's screens change enough that its video no longer
shows them.

It assumes nothing about the repo. How guides are written, recorded and published here
is discovered in step 0; steps 1–6 are the method and apply to any tooling.

## Parameters

Resolve these in step 0 and restate them in your report. Never fill one in by guessing.

| Parameter | Meaning | Where to find it |
| --- | --- | --- |
| `FEATURE_LIST` | The authoritative list of features a guide can cover: feature manifests, the route table, a nav config | The router; the guide tooling's docs |
| `GUIDE_DIR`, `GUIDE_FORMAT` | Where guide scripts live and how one is written | An existing guide; the recorder's source |
| `SHARED_MOVES` | Reusable helpers for common moves (sign in, open a nav link, fill a form) | Beside the recorder; the end-to-end test helpers |
| `CHECK_CMD` | Runs a guide fast — headless, unpaced, no video — to prove every step passes | The recorder's docs or `--help`; manifest scripts |
| `RECORD_CMD` | Records the narrated video, and what it needs (output folder, narration voice, env vars) | Same |
| `RUN_CMD`, `APP_URL` | How to start the app locally and where it serves | `README`, `CLAUDE.md` / `AGENTS.md`, scripts, `.env.example`, dev-server config |
| `DATA_RESET` | How local or scratch data is reset, and who is allowed to do it | Same |
| `PUBLISH_TARGET` | Where finished videos go: Git LFS path, release asset, object storage, docs site | The guide docs; `.gitattributes`; existing guide links |
| `GUIDE_INDEX`, `COVERAGE_CHECK` | The table listing guides, and any test that requires each feature to have one | The guide docs; the test suite |
| `TEST_CMD`, `LINT_CMD` | The repo's test and lint commands | Manifest scripts, `Makefile`, CI config |

## Why this needs a method at all

A video guide shows real screens and says things about them, so it goes wrong in ways no reviewer
sees in the diff: a caption that describes a screen the viewer is no longer looking at, a line cut
off by the next action, a setup step left in, a step that failed halfway with the video carrying on
regardless. Every one of those happens when guides are made by hand. A good recorder makes most of
them impossible — the line is the caption, a step holds for as long as its line takes to say, a
failed step produces no video — and the steps below cover the rest.

## 0. Discover how this repo does video guides

Read before deciding anything:

1. The repo's own instructions: `README`, `CLAUDE.md` / `AGENTS.md`, `CONTRIBUTING`, and anything
   under `docs/` about demos, videos or guides. Note every rule about which environments and
   data you may touch.
2. Existing guides and the recorder. Search rather than assume a path: names like `guide`,
   `demo`, `walkthrough`, `video`, `record`; browser-automation and text-to-speech dependencies
   in the manifest (`package.json` or the stack's equivalent); `.gitattributes` for video
   patterns.
3. The recorder's source and docs, for `GUIDE_FORMAT`, `CHECK_CMD`, `RECORD_CMD` and what a
   failed step does.
4. Manifest scripts and CI config, for `RUN_CMD`, `TEST_CMD`, `LINT_CMD` and `COVERAGE_CHECK`.

Then:

- **Tooling exists** → use it as it is. Do not add a second recorder or a second format.
- **No tooling exists** → building a recorder is a separate piece of work, not a side effect of
  this skill. Say so, propose the smallest one that keeps the guarantees above (a
  browser-automation script that records video, one narrated line per step, each step held for
  its line's spoken length, no video from a run with a failed step, an unpaced check mode) using
  the browser-automation tool the repo already has, and stop for the user's decision.
- **A parameter cannot be found** → say which one and ask.

If CI cannot run the app, its data and the narration voice, CI does not record guides; at most it
checks that each feature has one. If CI does have a disposable stack, `CHECK_CMD` is the step to
run there.

## 1. Resolve the feature against the real list

The feature must be a **real entry in `FEATURE_LIST`**. List it from the source you found in
step 0.

If the user named a feature in plain language, match it to an entry and confirm it. If nothing
matches, say so and stop. If a guide for the feature already exists in `GUIDE_DIR`, this is a
re-record: read it, and change only what the screens now contradict.

## 2. Read the real pages before writing a step

Read the feature's definition (manifest, routes), the pages and components that render it —
generated and hand-written — and `SHARED_MOVES`. Every locator a step uses must be one you found
there: a role and accessible name, a label, or visible text. **Never invent a locator.** Use a
shared move before writing your own.

If the walk needs a control with no stable name, propose a one-line `aria-label` and stop for
approval rather than reaching for a CSS path.

## 3. Write the guide

Copy the shape of the closest existing guide: a read-only one if yours only looks, one that
creates records if yours does. Follow `GUIDE_FORMAT` exactly. Whatever the format, these rules
hold; where the recorder cannot express one, say so in your report:

- **One guide per feature**, named for its entry in `FEATURE_LIST`.
- **After the first page load, move only by clicking**, as a person giving the demo would.
- **Each line is shown and spoken after its step's work**, so write it about what the screen
  now shows. One or two short sentences, written to be heard: no abbreviations a voice would
  mispronounce, numbers as words when they are amounts ("sixty dollars").
- **Set-up the viewer does not need to watch is cut from the video.** It runs, and is removed.
  A cut step has no line.
- **Every step asserts what it shows.** A step that cannot find what it expects must throw, never
  carry on: a recorder should refuse to make a video from a run with a failure in it, which is
  the point.
- **Say in the guide's header what data state it needs.** A guide that creates records needs
  freshly reset data and leaves it changed.

Add the guide's row to `GUIDE_INDEX`, and update `COVERAGE_CHECK` if it keeps a list of features
still without a guide.

## 4. Record it

Only against the local app on local or scratch data, never a shared environment — follow the
repo's own rules from step 0. If the guide creates records, the data must be freshly reset — and
running `DATA_RESET` is the user's call, not yours: ask.

Start the app with `RUN_CMD` and confirm it answers at `APP_URL`. First, a fast check that every
step passes, headless and unpaced: run `CHECK_CMD` for the feature.

A check creates records just as a recording does, so a guide that creates records needs another
reset before recording. Then run `RECORD_CMD` for the feature.

Send the output to a folder **outside the repo** (the system temp folder is a good default), so
raw recordings can never be committed by accident. A sound run speaks every line first, records
each step held for its line, and assembles the video plus one still per line. If any step fails,
there is no video: fix the guide or the app, and record again. If the recorder produces no
stills, extract one frame per line yourself (for example with `ffmpeg`, about a second into each
line).

## 5. Validate it and land it

Validation that the run exited 0 is not enough. Look at every still and confirm the screen shows
what the line says. Then watch or scrub the video once, end to end, for anything a still cannot
show: a cut that jumps, a caption that flickers, a line that sounds wrong. A line that sounds
wrong is fixed in the guide's text, never by editing the audio.

Then land it at `PUBLISH_TARGET`. **Ask before publishing; it is outward-facing.**

- If `.gitattributes` tracks the video path with Git LFS, copy the video there and link it
  relatively from `GUIDE_INDEX`.
- Otherwise publish it where the repo's other guide videos live (a release asset, object
  storage, a docs site), named for the commit it was recorded from —
  `<feature>-$(git rev-parse --short HEAD).<ext>` — using the forge's own CLI (`gh`, `glab`, …),
  and put the link and the commit in the guide's row. If publishing has to create a release or a
  tag on the remote, ask first.

Never plain-commit a video into a repo that does not use LFS for it. Run `TEST_CMD` and
`LINT_CMD` and report their actual verdict.

## 6. Report back

State plainly:

- the parameters you resolved in step 0, and any you could not;
- the feature, and whether this was a new guide or a re-record;
- the video's length, its step count, and which steps were cut;
- **every line and the still you checked it against**, and any line whose still did not match and
  what you changed;
- the data state the run needed, and that you did not reset it yourself;
- where the video landed (link or path), or that publishing is waiting on approval;
- **anything you wanted to show and could not, for lack of a stable locator or because the app
  failed** — explicitly, rather than silently leaving it out. A quiet omission looks identical to a
  considered scope decision.
