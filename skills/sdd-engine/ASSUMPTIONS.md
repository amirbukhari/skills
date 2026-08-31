# ASSUMPTIONS.md

Every judgment call or assumption made under the autonomy mandate, logged as it is made.

One entry per call: **what was decided**, **why**, **which commit**, **date**. An entry is a
record of a decision that could reasonably have gone the other way — not a changelog. If a call
is still open, it is logged as **OPEN** with what is blocking it, so a later session does not
silently resolve it by inference.

Convention borrowed from `CLAUDE.md`: state plainly whether a claim was **verified by running
it** or **inferred from reading the code**. Those are different confidence levels.

---

## 2026-08-31 — `lib/skeleton.js` and `engine/skeleton.js` keep their colliding basename

**Decided:** documented the collision, did not rename either file.

**Why:** they are genuinely different modules — `lib/skeleton.js` is the flat structural
skeletonizer (canonical shape string with typed slots), `engine/skeleton.js` is the skeleton
*tier* (a body's control-flow shape as a sequence of statement kinds). Same basename, different
jobs, both live. A rename touches 5 live requires across `pattern-census.js`,
`resolve-imports.js`, `finer-granularity-sweep.js` and `engine/pipeline.js` — which reaches
back out to `../lib/`. That is a code change inside a documentation pass, and the flat layout
was the actual complaint, not the filename. Made navigable instead: `tools/repo-dsl/README.md`
now calls the collision out explicitly in the subdirectory table.

**Verified by running it:** the 5 requires were found by grep across the live tree.
**Confirmed by Amir** in the same session: "leave it, you're right that renaming touches too
many live requires for a documentation pass; document is the correct call, don't rename."

**Commit:** `cbe4e73`

---

## 2026-08-31 — `package-delonix.js` flagged do-not-run, NOT moved to `archive/`

**Decided:** left the file exactly where it is; added a `do not run` marker to its row in the
`tools/repo-dsl/README.md` file table.

**Why:** it packages a corpus at a path `CLAUDE.md` §1 puts out of bounds and
`.claude/settings.json` denies reads to. That makes it *look* like an obvious archive
candidate, which is precisely why it should not be swept into a doc pass — moving or deleting
something that touches an out-of-bounds path deserves an explicit look, not a side effect of
tidying. `CLAUDE.md` §7 also requires Amir's word for deletions and directed moves.

**Confirmed by Amir** in the same session: "leave your do-not-run flag in the README, don't
move it to archive/... exactly the kind of thing that should wait for an explicit look, not get
swept into a doc pass."

**Commit:** `cbe4e73`

---

## 2026-08-31 — the naming worksheet stays in the engine tree; it is not a §8B violation

**Decided:** left `name-words-lzw.js` writing `name-words-lzw-worksheet.json` into
`tools/repo-dsl/`. Documented why. Did **not** relocate it to `<CORPUS>/.cache/spec-derived/`.

**Why:** it was put to me as a known §8B location violation. It is not one, and the assumption
that it was would have caused the damage. Three pieces of evidence:

- `git check-ignore -v` resolves the file to `.gitignore:25`, inside a section headed
  *"Wipable-derived per §8A (.calc IR, coverage/index reports, worksheets)"* which lists three
  engine-tree worksheets by fully-qualified path. It cannot reach the public remote.
- `engine/artifact-location.test.js` enforces §8B over (a) the `ARTIFACTS` registry and (c) a
  `DERIVED` filename set. The worksheet is in neither, so it is exempt **by construction**, not
  by an oversight in the guard.
- the only reader is the human filling it in; the apply step is separate and never automatic.

**The counterfactual is the point:** `.cache/spec-derived/` is defined as regenerable and
wipable. A part-filled worksheet is hand-authored content. Moving it there would put
hand-authored names in a wipable tree — the exact failure `word-names.json`'s SOURCE-PROTECTED
status exists to prevent, and one this project has already suffered once. Which side of that
line a half-filled worksheet sits on is Amir's call.

**Verified by running it:** `git check-ignore -v`, and reading the `DERIVED` set at
`engine/artifact-location.test.js:41-45`.

**Also corrected here:** this was attributed to me as something I had flagged earlier. I had
not — what I flagged was `author-names.js` crashing on a missing census file (`CLAUDE.md` §9).

**Commit:** `3ce75aa`

---

## 2026-08-31 — `b20aae3` corrected with a `git note`, not a history rewrite

**Decided:** attached an explanatory `git note` to `b20aae3` recording what it actually
contains. Did **not** amend, rebase or force-push.

**Why:** `git add README.md && git commit` commits the **whole index**, and the index already
held another lane's staged work. The commit is titled for the README but carries four
changesets: the README, the removal of four skill folders (mcp-builder,
subagent-driven-development, systematic-debugging, verification-before-completion), the
`tools/repo-dsl/PRD.md → tools/PRD.md` relocation, and 10 `archive/` moves plus edits to
`archive/README.md` and `engine/SDD.md`.

The suggested fix was `git commit --amend`. That only reaches HEAD, and `b20aae3` was six
commits back with three of the intervening commits belonging to lanes that were still live.
Checking further: **`b20aae3` was already on `origin/spec-driven-dev`** — another lane had
pushed the branch. So a rebase would have been a force-push over published history belonging
to two active lanes, to fix a commit message. A note carries the same information and changes
no SHA.

**Verified by running it:** `git branch -r --contains b20aae3` → `origin/spec-driven-dev`;
`git show --name-status b20aae3` for the four changesets.

**Also corrected here:** I first reported this commit as carrying only the 9 mcp-builder
deletions. That was wrong and understated — I had accounted for the `D` entries in my initial
snapshot and missed the staged `R`/`M` renames. The full list is above.

**Commit:** the note is on `refs/notes/commits`, attached to object `b20aae3`. Read it with
`git log --notes b20aae3`. Pushed as a separate refspec — a plain `git push` does not carry
notes, so a fresh clone will not see it without `git fetch origin refs/notes/commits:refs/notes/commits`.

---

## 2026-08-31 — the two design proposals renamed on move

**Decided:** `git mv` both into `tools/repo-dsl/proposals/` **and** dropped the `-proposal`
suffix from each filename (`PROSE-en-sentences-proposal.md` → `proposals/PROSE-en-sentences.md`,
same for `SEG-segmentation`).

**Why:** the folder now carries the status, so the suffix was redundant. This is a rename Amir
did not specifically direct, so it is logged rather than assumed. `CLAUDE.md` §7 permits moves
and renames with a clear revert path; `git mv` preserves every byte and both files are
detected as `R100`. Nothing references either file — verified by grep across `*.md`, `*.js`
and `*.json`.

**Commit:** `b6a49bb`

---

## OPEN — the deleted agent-file batch. Held, awaiting Amir.

**Not decided. Blocking on Amir and deliberately not resolved by inference.**

`.github/agents/rentsync-agent-builder.agent.md` is deleted on disk (unstaged, not by me,
present at session start) but still tracked at HEAD. Its whole `Required Skills` section names
the four removed skills, plus two constraints reference them. There is nothing on disk to edit.

The task was to fix those references. The obstacle is that the deletion sits in a batch of six
unaccounted deletions that read as one coherent in-progress cleanup by another lane:

```
 D .github/agents/playwright-browser-control.agent.md
 D .github/agents/rentsync-agent-builder.agent.md
 D examples/code-review-standards-prd.md
 D examples/engineering-standards.md
 D hooks/security.json
 D mcp/servers.json
```

`CLAUDE.md` §7: *"Never stage a deletion you cannot account for. If `git status` shows a file
gone that you did not remove, leave it unstaged and ask."* Committing one file out of that
batch splits someone's changeset; committing all six commits deletions that are not mine.
Restoring the file to edit it undoes another lane's work, and would need replacement targets
for all four skills — which do not exist and must not be guessed.

Four options were put to Amir. **No answer yet; still holding.** Log the choice here when it
lands.
