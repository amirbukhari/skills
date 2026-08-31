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

---

## 2026-08-31 — `operation-idioms.test.js`'s `catalog/` path is NOT a rename-sweep miss

**Decided:** left `engine/operation-idioms.test.js:16` pointing at `<CORPUS>/catalog/`. I had
reported it as a stale `spec/`→`sen/` miss and was explicitly cleared to fix it. I did not, and
reversed my own label instead.

**Why:** its comment at `:13-14` says it uses the legacy STEP-4 root deliberately rather than
`AC.pathFor`, and its producer `archive/build-operation-idioms.js:173-174` writes to
`<corpus>/catalog/` to match. Repointing it at `sen/catalog/` would have broken it against its own
producer and merged the two catalog trees `CLAUDE.md` §5 says never to merge. Its `ENOENT` is
missing **data**, not a wrong path — the legacy tree went in the hand-wipe.

**Verified by running it:** the ENOENT names `<corpus>/catalog/operation-idioms.json`; grep found
exactly one producer, in `archive/`.

**Commit:** `41daefe`, as a stated non-change with the reasoning in the message.

---

## 2026-08-31 — the legacy `catalog/` tree was not regenerated

**Decided:** did not run `archive/build-operation-idioms.js` to rebuild `operation-idioms.json`
and `function-archetypes.json`.

**Why:** `archive/build-operation-idioms.js:26` hardcodes
`/home/amir/Documents/Rentsync/delonix/hydra-source` — the root `CLAUDE.md` §1 forbids touching,
and which no longer exists. Regenerating needs the producer repointed at `CR.corpusRoot()` first,
plus a decision on whether the legacy tree should come back at all. Design call, not a patch.

**Verified by reading it:** the literal is on one line and is not resolver-derived. The script was
not executed.

**Commit:** no code change. Escalated instead.

---

## 2026-08-31 — every tier flag became `--tier=<name>`, not only the colliding `--corpus`

**Decided:** renamed all four tier selectors in `run-tests.js` (`--unit/--corpus/--slow/--all` →
`--tier=unit|corpus|slow|all`), though only `--corpus` actually collided.

**Why:** the collision was structural, not specific. `run-tests.js` resolves roots in its **own**
process (`corpusReady`, now `corpusState`), so its argv is parsed by `corpus-root.js` — and *any*
bare tier flag sharing a name with a present or future root flag re-creates the bug. Fixing only
`--corpus` leaves three loaded guns and an inconsistent surface. A bare tier flag is now refused by
name with the reason rather than silently reinterpreted as a root. npm script names are unchanged,
so `README.md`'s documented surface still holds.

**Verified by running it:** `node run-tests.js --corpus` → `REFUSED … is not a tier flag`, exit 2;
`--tier=bogus` → `REFUSED: unknown tier`, exit 2. Before the fix, `npm run test:corpus` reported
`0 passed, 0 failed, 6 skipped` with `the corpus at null is not mined` — a measurement of the flag
presented as a measurement of the corpus.

**Commit:** `41daefe`

---

## 2026-08-31 — the corpus gate is per-test, and each test's needs are read off the code

**Decided:** replaced the all-or-nothing `corpusReady()` (one gate over
`["generators-lzw","word-names"]`) with per-test `needs` / `files` declarations in `CORPUS_TIER`.
Every skip now names its own absent prerequisite.

**Why:** one absent artifact skipped all six tests, and four of them do not read `word-names` at
all — they were reported as "needs a mined corpus" while the corpus they needed was fully mined.
A skip that names the wrong cause is worse than no skip. Requirements were derived per test rather
than guessed: `artifact-location` iterates `AC.kindsOf()` so it needs `"*"`; `unit-boundary` calls
`AC.pathFor("generators-lzw")` at `:25`; `word-names` needs the dictionary *and* the names that
name its leaves; `operation-idioms` needs two non-§8B legacy files, hence a separate `files`
channel; `sdd.js` names no root and reads no artifact, so `sdd.test.js` needs nothing.

**Verified by running it:** `20 passed, 0 failed, 6 skipped` → `22 passed, 1 failed, 3 skipped`.

**Commit:** `c02a7f1`

---

## 2026-08-31 — `sdd.test.js` and `enfile-label-sanitize.test.js` stay in the CORPUS tier

**Decided:** both now declare zero corpus prerequisites, which by the runner's own definition makes
them unit tests. I left their tier declaration alone and said so in a comment.

**Why:** re-tiering is a declaration about what a test *is*, and `run-tests.js`'s header says a new
test is unit "until someone says otherwise". A zero-need test always runs, so nothing is hidden by
leaving it where it is — the cost of the wrong call here is zero and the fix is one line for
whoever owns tiering.

**Inferred from reading the code**, then confirmed by the run: both executed, neither skipped.

**Commit:** `c02a7f1`

---

## 2026-08-31 — `enfile-label-sanitize.test.js`'s fake root became a real empty dir

**Decided:** changed `EN.loadIndex("/definitely/no/corpus/here")` to a real `mkdtempSync` dir.
This was outside the three fixes I was asked for.

**Why:** the fixture wants an empty index and got one only while a set-but-missing root fell back
silently. §8B made that a hard refusal, so the test threw at load and its final assertion had
never once executed. A real empty dir yields the same empty index without depending on the failure
mode the contract exists to remove. The per-test gate above made this unavoidable: an honest
`needs: []` stops a skip from hiding it.

**Verified by running it:** before, `RootError` at `loadIndex`; after, assertions 1–9 pass and the
tenth executes for the first time.

**Commit:** `c02a7f1`

---

## 2026-08-31 — a real byte-identity bug was reported, not fixed

**Decided:** left `engine/enfile.js` alone and let `enfile-label-sanitize.test.js` fail red rather
than suppress it.

**Why:** with the fixture fixed, the round-trip assertion ran for the first time and **failed**.
Source carrying `«` or `»` verbatim is eaten by the compile-side span scanner:
`"bad « » ⟪ ⟫ ▶ input"` compiles back as `"bad  ⟪ ⟫ ▶ input"`. `sanitizeLabel` protects the
*label*; nothing protects sentinels in *verbatim code*. That is the byte-identity floor, so it is a
real defect. A fix means escaping and unescaping sentinels in the `.en` encoding, which changes
existing `.en` bytes — a format decision, not a sweep miss. Reverting the fixture to re-hide it was
rejected: that trades a visible real failure for an invisible one.

**Verified by running it:** reproduced standalone with the exact before/after bytes. Exposure
measured at **zero** — `grep -rl` for each of `« » ⟪ ⟫ ▶` across all 1037 corpus `.ts` files
returns 0 files, which is why byte-identity has held at 100%.

**Commit:** no code change. Test left failing on purpose.

---

## 2026-08-31 — PRD split: one file per `§N`, order preserved by numeric prefix

**Decided:** a mechanical 1:1 `§N`→file mapping, numbered `00`–`19`, named from the real section
titles rather than invented groupings.

**Why:** any regrouping is an editorial judgment about a document I did not write, and it makes the
split unverifiable. 1:1 is checkable by line count, which is how it was checked.

**Verified by running it:** the scaffold was regenerated from scratch against the live headings
after the structure changed underneath it, rather than patched.

**Commit:** `712c8fa` (stubs), `19210b4` (content)

---

## 2026-08-31 — PRD migration used mechanical transforms only, accounted line for line

**Decided:** promoted every heading one level (`##`→`#`), added a one-line breadcrumb under each
title, **replaced** rather than migrated `## Table of contents`, and excluded the six `# PART N`
divider lines from the section files — `prd/README.md` carries that grouping instead.

**Why:** a divider line belongs to no section; absorbing it puts a `PART` banner inside whichever
file happened to follow it. Heading promotion also had to skip fenced code blocks, since headings
inside fences are content.

**Verified by running it:** both bugs were caught by writing the accounting, not by reading the
output — 1387/1387 lines placed, and a re-runnable verifier reported 20/20 sections byte-exact
against the original.

**Commit:** `19210b4`

---

## 2026-08-31 — `prd/README.md` is the TOC; `tools/PRD.md` was left untouched

**Decided:** made `prd/README.md` the entry point, did not edit `tools/PRD.md`, and flagged the
resulting duplication rather than resolving it.

**Why:** `PRD.md` was being actively rewritten in another lane; editing it would have raced.

**Verified by running it:** the duplication was closed later by `8c4135f`, which collapsed
`PRD.md` to a pointer.

**Commit:** `712c8fa`

---

## 2026-08-31 — `name-words-lzw.js` was pulled from the archive list at the last moment

**Decided:** archived 10 files, not the 11 proposed.

**Why:** the require-graph closure was re-run immediately before moving rather than trusted from
the earlier proposal, and in the interval `name-words-lzw.js` had become `npm run name` — and part
of `npm run build`. A moved-but-still-reachable file is a regression, not a cleanup.

**Verified by running it:** the closure, re-run against the new npm-script entry points, showed a
caller that had not existed when the proposal was written.

**Commit:** `b20aae3` (swept into another lane's commit)

---

## 2026-08-31 — archived files mirror their original path under `archive/engine/`

**Decided:** put the five engine files at `archive/engine/…` rather than flat in `archive/`, and
narrowed the archive README's blanket claim that "everything below still runs" to "nothing below is
part of the live pipeline".

**Why:** retired code keeps its relative requires (`./operations`, `../lib/skeleton.js`), which
resolved from the original location. Stating the limitation beat rewriting retired code so it could
run from a place nothing calls it from.

**Verified by running it:** `node archive/engine/mine-statement-idioms.test.js` →
`Cannot find module './fanout.js'`, so the old claim was measurably false. Also corrected my own
wrong README row: `archive/compose-expand.js:16` and `archive/build-compositions.js:19` **do**
require `./engine/compose`, and the move made those previously-dangling requires resolve again.

**Commit:** `b20aae3`

---

## 2026-08-31 — commits name their files; never a bare `git commit`

**Decided:** every commit uses explicit pathspecs (`git commit -o -- <paths>`).

**Why:** several sessions share this working tree *and* index. A bare `git commit` swept another
lane's staged work into `b20aae3`, whose message describes only one of the things it contains.
Explicit pathspecs make that class of accident impossible.

**Verified by running it:** `git show --stat` on both of my commits shows exactly the intended
files and nothing else.

**Commit:** `41daefe`, `c02a7f1`

---

## 2026-08-31 — `sdd.js`'s hardcoded `"sen"` literal was left in place

**Decided:** fixed the `sdd.test.js` fixture path to `sen/` but did not centralise
`engine/sdd.js:58,62`'s literal `"sen"` onto `CR.LAYOUT.sen`.

**Why:** `CLAUDE.md` §2 says `sen` is spelled once, as `LAYOUT.sen`, which makes these two lines a
real if minor violation. But `sdd.js` takes `projectDir` as a parameter and requires `corpus-root`
nowhere; wiring the resolver in to fix a string is a larger change than the defect.

**Verified by running it:** `node engine/corpus-root.test.js` → 11 assertions pass, so the
root-literal guard is not silently drifting. Flagged, deliberately not swept up.

**Commit:** `41daefe`, as a non-change

---

## 2026-08-31 — `word-names.json` was not fabricated to turn the tier green

**Decided:** did not synthesise a census or hand-write `word-names.json`, and did not weaken the
tests that need it.

**Why:** it is §8A SOURCE-PROTECTED precisely because a re-mine cannot rebuild it, and
`author-names.js:33` reads a census file that nothing live produces — PRD §Q-7 verbatim. Inventing
names would make `word-names.test.js` pass while proving nothing, which is the exact failure mode
`{ optional: true }` exists to prevent.

**Verified by running it:** `npm run mine` reproduces `generators-lzw` and `mined-library` (the
latter to fingerprint `62b5505498647afd`, byte-identical to the pre-wipe body) and produces no
`word-names.json`. No live script writes one.

**Commit:** no code change. Escalated instead.

---

## OPEN — retiring the `word-names` artifact kind. Held, awaiting Amir.

**What is blocking it:** Amir, 2026-08-31, relayed after he left for the day: *"get rid of that
words file its old we dont need it anymore."* The **file** is already gone (the hand-wipe), so the
instruction only bites on what remains: the `word-names` kind in the §8B registry, `AC`'s
`word-names` home, `engine/word-names.js`, `engine/word-names.test.js`, the `needs` entry added
above, `npm run name` / `name:author`, and the §8A / §Q-7 / `R-PAY-6` text that treats it as
SOURCE-PROTECTED and unregenerable.

**Why it is not being resolved by inference:** that is a change to the artifact contract and to the
PRD's protected-artifact story, not a file deletion. `CLAUDE.md` §7 requires his explicit word for
deletions, and §6 warns that this project has already paid for reframing his words instead of
quoting them. The relay also said explicitly not to chase the three blocked tests tonight. So:
nothing removed, nothing renumbered, the three tests stay red/skipped and now say exactly why.

**Ask Amir:** retire the kind outright, or keep it registered and mark it optional?

---

# Lane: PRD / archetype design (session a04aa2e5) — 2026-08-31

## Q-2 closed by measurement on a SYNTHETIC corpus, not the real one

**Decided:** declared the LZW live path proven and struck §2-P1's "Deviation to fix" and §6 fronts
0 and 4 as stale. **Why:** built a 4-file corpus engineered so longer statement runs contain shorter
ones, mined and rendered it: 20/20 spans recursive, 0 flat, live-path `maxDepth` 3, dictionary depth
5, 40 composition edges, byte-identity 4/4. **The judgment call:** a synthetic corpus proves the
*mechanism* is live, not that the *real* corpus collapses well. I did not conflate the two — the
real-corpus question was split out as **Q-8** and left open, needing one full mine, which is Amir's
spend to authorize. **Commit:** `1bc1bc4`.

## Wrote R-COMP-6/7 gate inputs into the manifest rather than relaxing the gate

**Decided:** the manifest now emits `composites`, `compositionEdges`, `maxDepth`, `dictEntries`.
**Why:** R-COMP-6 read as unmet and R-COMP-7 as unevaluable, but the cause was the manifest writing
`maxCompositionDepth` and neither count — the gate was comparing `undefined`. Fixing the producer
was correct; lowering the threshold would have hidden it. Also removed a "flat-fallback 0 (0%)"
line as a **tautology** (`tier:"flat"` is never produced), which R-MECH-8 forbids publishing.
**Commit:** `1bc1bc4`.

## PRD restructure — split into 20 files, legacy `§` labels kept

**Decided:** one file per section under `tools/prd/`, `tools/PRD.md` collapsed to a pointer; legacy
section numbers (`§5C`, `§8B`) preserved verbatim as file *content* anchors even though filenames
are sequential. **Why:** engine source comments cite `PRD §8B` by name in dozens of places;
renumbering would silently break every one. **Judgment call:** `§4A` and `§8B` were promoted out of
their parent sections into their own files (most-cited anchors); `§4B`, `§8A`, `§8C` were not.
**Commits:** `19210b4`, `87d4159`, `8c4135f`.

## Reported five PRD edits as landed when they had not

**What happened:** the restructure assembled Part II from a snapshot written *before* the
stats-strip edits were applied, silently dropping both §5 CONTESTED markers, a table header fix, one
phrase, and two path corrections. I had reported them done. **Why it slipped:** I diffed the rebuilt
document against its source, which catches lost *content* but not a lost *edit* — the unedited line
is present in both. **The check that would have caught it:** assert each intended edit's *old* text
is **absent** from the output. Re-applied in `1bc1bc4`.

## Archetype/§5E design — four of Q-3's five unknowns resolved by argument, not by ruling

**Decided:** wrote `prd/20-archetype-hybrid-design.md` resolving unknowns 1–5 (slot binding, whether
an archetype is a dictionary entry, arbitration, hand-authored grammars, per-site productions).
**Why each is defensible without Amir:** each is *forced* by a constraint he already set —
AT-ARCH-1 (idempotence under re-mine) forces the archetype to be a dictionary entry; the PaymentPlan
example forces alternatives on a variadic slot; R-WIDE-8's widest-claim rule already decides
arbitration. **The judgment call:** I resolved these rather than parking them, on the reading that
mechanics forced by settled direction are not new decisions. Five genuinely-open mechanics were left
open with recommendations (§5E.8) rather than picked silently.

## R-REND-6 rewritten — the sentence is authoritative, not the payload

**Decided:** cut *"names are cosmetic by construction"* and inverted it: a hand-edit to a clause's
English must change the compiled TypeScript; the payload becomes a derived index. **Why:** it
directly contradicts Amir's statement 4 (hand-edit the `.en`, it goes back into the codebase). If
`compileChunk` never reads the label region, hand-editing does nothing. **This is the largest single
reversal in the pass** and it invalidates a guarantee the PRD had celebrated as structural. Old text
kept verbatim in §10 and in the §5D.3 ledger. **Risk:** `compileChunk` does not do this yet — the
requirement is now ahead of the code, deliberately, and §5E.8 item 5 recommends derive-and-check as
the first cut rather than a rewrite.

## R-MINE-7 (THE LIFT) amended rather than deleted

**Decided:** *"a file is never one word"* → refuse an **opaque** whole-run word; require a
compositional, editable one. **Why:** Amir's statements 6 and 7 override the prohibition explicitly
(*"dont tell me that you cant do this"*), but the rule's stated *purpose* — no opaque reference in
place of structure — is satisfied by statement 7 rather than discarded. **Judgment call:** I
preserved the purpose clause instead of dropping the requirement, on the reading that he overturned
the ban, not the reasoning.

## R-LANG-7's "never applied automatically" narrowed, not cut

**Decided:** naming now *applies* (R-LANG-13), but **orphan re-adoption** stays a proposal.
**Why:** statement 5 is about the naming step. Re-adoption is a different act — a name silently
re-attaching to a skeleton it merely *resembles* — and no gate catches it, because the output is
byte-identical either way. **This is the one place I did not fully apply "cut what disagrees",** so
it is logged loudly. If Amir wants re-adoption automated too, say so and it goes.

## Wrote the review-surface metric into §7 without waiting on s12

**Decided:** wrote Amir's *"its not about compression, its about less of a review surface"* into
`15-success-criteria.md` and `02-problem-and-goal.md`, rewriting the old *"Byte size IS a metric"*
text. **Why:** checked `git log` first — no lane had written it, and the instruction was that it
must land somewhere authoritative even if not this lane's file. **Possible collision:** if s12 also
writes §7, this will conflict; mine is additive under a dated heading to make a merge obvious.

## Flagged, NOT resolved: `word-names.json` vs "get rid of that words file"

**The tension:** §5D.2 (Amir's statement 5) makes naming a first-class pipeline stage whose output
is names, and I described that output as `word-names.json` because that is what the code writes.
Another lane has logged Amir saying *"get rid of that words file its old we dont need it anymore."*
**I did not reconcile these.** The naming *stage* is settled by statement 5; which *artifact* holds
its output is not, and picking one by inference would change the §8B contract. Added to that lane's
open ask rather than answered here.

---

## 2026-08-31 — a wrapper, not `--json` on eleven scripts

**Decided:** added `tools/repo-dsl/sdd-run.js`, a machine-callable front end that runs the
pipeline scripts as subprocesses and emits a structured envelope. Did **not** add an output mode
to the eleven existing scripts.

**Why:** Amir wants the steps wired into a UI next week. Measured first, rather than assuming the
scripts needed de-interactivising: there are **zero** interactive or blocking prompts in the live
tree — no `readline`, `createInterface`, `process.stdin` or `readFileSync(0)`. The real gap was
output shape. Only `measure-uncollapsed.js` speaks JSON; the other ten print prose, so a UI would
have to screen-scrape.

Adding `--json` to each means editing every one of them, including `write-en-files.js` and the
byte-identity path, where a change is a regression risk for no functional gain. The wrapper adds
the machine interface with **zero blast radius** — delete `sdd-run.js` and nothing else changes
behaviour. That reversibility is the whole argument.

**The contract it fixes:** stdout is exactly one JSON document, child prose relays to stderr,
exit code is the child's unchanged, `2` means the wrapper refused. A UI parses stdout without a
heuristic.

**Verified by running it:** `--list`, `--status` and a real step all parse as JSON from stdout;
exit codes checked directly (`bogus`→2, `clean:sen`→2, `roots`→0); `npm run steps` / `npm run
status` work from both the skill root and the engine. `test:unit` 20 passed, 0 failed.

**Commit:** `ac55d48`

---

## 2026-08-31 — per-step prerequisites, after reimplementing a bug that was already fixed

**Decided:** each step declares `needs` — the §8B artifact kinds it actually loads — and a step
that cannot run reports `not-ready` naming the missing kind. Replaced the first version, which
gated every corpus step on one shared `["generators-lzw", "word-names"]` check.

**Why this is logged as a mistake and not a design:** the first version was wrong, and
`run-tests.js` already contained the reason in a comment I had read earlier in the same session:
an all-or-nothing gate over exactly those two artifacts meant one absent artifact skipped all six
corpus tests, and four were reported as needing a mined corpus *when the corpus they needed was
fully mined*. I reproduced that defect verbatim in new code.

It surfaced immediately on a real run: `sdd-run.js measure` reported "needs a mined corpus and
the artifacts are absent" while `generators-lzw` was present and contract-valid — it was
`word-names` that was absent, which `measure` does not read. After the fix, `measure` runs (`ok`,
exit 0) and `reconcile` blocks naming `word-names` specifically.

**The general lesson, which is the point of the entry:** the prohibition on inventing a second
resolver applies to *policy* as well as paths. "Is the corpus ready?" already had an answer in
this tree, arrived at by fixing this exact bug. A new component should adopt the existing answer,
not re-derive one.

Each step's `needs` is derived from what the script actually loads — grepped for `AC.pathFor` /
`AC.load` / `EN.loadIndex` per script — not guessed from the filename.

**Commit:** `ac55d48`

---

## 2026-08-31 — two manifest facts taken from a peer's measurement, not from the docs

**Decided:** the `mine` step is described as **~3.6s over 1037 files**, not "tens of minutes",
and is no longer flagged `expensive`. The `test` step carries a `knownRed` field.

**Why:** I had written "Tens of minutes on a real corpus" from `CLAUDE.md` and
`.claude/settings.json`, where the mine sits behind an explicit ask because it *was* expensive.
Session `sdd-engine-5f` ran both mines tonight and measured pipeline A at 3.6s and pipeline B at
1.17s. A UI that warns "this takes tens of minutes" before a 3.6-second job is teaching its user
something false, so the measurement wins over the doc.

`knownRed` records that `npm test` currently exits 1 for one real reason — a byte-identity
finding in `engine/enfile-label-sanitize.test.js`, where source carrying `«` or `»` verbatim is
eaten by the compile-side span scanner. Corpus exposure measured at 0 files, so byte-identity
still holds. It is in the manifest so a red `test` is not mistaken for the wrapper misbehaving,
and explicitly so nobody silences it.

**Verified by:** a peer session's direct measurement, relayed with the numbers. I did not re-run
the mine myself — it is behind an explicit ask and Amir is unreachable. Logged as second-hand
rather than presented as my own measurement.

**Commit:** `ac55d48`

---

## 2026-08-31 — `npm run name` left exactly as it is

**Decided:** `sdd-run.js` exposes `name` as `name-words-lzw.js worksheet`, matching
`package.json` today. Changed nothing about the naming steps.

**Why:** session `sdd-engine-5f` has an OPEN question on whether the `word-names` **kind** should
be retired from the §8B registry, following Amir's relayed "get rid of that words file its old we
dont need it anymore". That touches the artifact registry, `engine/word-names.js`, its test, both
`name` scripts and the §8A protected-artifact story. It asked to be consulted before anything in
my pass changed `npm run name`.

Two open questions pointing at the same scripts is a good reason for a callability pass to stay
descriptive. `sdd-run.js` reflects what the scripts do today; if the kind is retired, the manifest
entry and the `reconcile` step's `needs` are a one-line change each.

**Commit:** `ac55d48` (no change to naming behaviour)

---

## 2026-08-31 — the §R register was made partly executable rather than fully audited

**Decided:** built `verify-register.js` covering **13 of ~100** rows and shipped it at that
coverage, instead of auditing all 100 by hand or waiting until every row was mechanized.

**Why:** §R defines a Check as "how a second engineer decides whether it holds", and nothing ran
them, so the register could rot while reading as authoritative — and had. 13 mechanized rows that
re-run on demand beat 100 hand-verified rows that are stale the next day. The coverage number is
printed on every run precisely so partial coverage cannot be mistaken for full coverage, and a row
absent from the runner is stated to be one nobody has mechanized — not one that holds.

**The harder call inside it:** rows needing a mine, a round-trip or judgement report `MANUAL` with
the command that would decide them, and `MANUAL` is loudly **not a pass**. The tempting alternative
— counting un-evaluable rows as holding — is the `catch { return null }` bug class this engine
exists to eliminate, in a new costume.

**Verified by running it:** 9 hold, 0 fail, 4 manual. Exit 0/1/2 and the `--json`, `--id` and
refusal paths all exercised. The FAIL path is proven by its own first run, not by a contrived test.

**Commit:** `37af0ed` (swept, see its git note), described by `aae0d96`

---

## 2026-08-31 — four rotted §R check cites were corrected, and the values left alone

**Decided:** rewrote the **Check** column for R-MINE-1..4 in `prd/11` and the matching rows in
`prd/12`, and changed **no constant**. Marked R-MINE-4 RETIRED rather than deleting the row.

**Why:** the values (1, 8, 64) were right; the pointers had rotted, which is worse. A wrong value
fails loudly; a wrong pointer sends the next reader to a retired file that answers a different
question confidently. R-MINE-1 cited `engine/compose.js`, retired to `archive/engine/compose.js`
where `MIN_COUNT = 2` — so verifying that row at the cited location reads 2 and wrongly fails a
requirement that holds. Deleting R-MINE-4 outright was rejected: a freed id gets silently reused.

**Also recorded, and not resolved:** all three are `process.env`-overridable, so "MUST be 1" binds
the **default**. A run with `MIN_COUNT=2` in the environment satisfies the code and violates the
requirement silently. Whether that override should exist is left open rather than answered here.

**Verified by running it:** `grep -rn` over the live tree and `archive/` for each constant. The
values were read off `build-lzw-generators.js:59`, not inferred from the prose they contradicted.

**Commit:** `37af0ed` (swept, see its git note), described by `aae0d96`

---

## 2026-08-31 — the register verifier's own false positives were exempted, not tolerated

**Decided:** added exactly two exemptions to its grep — comment lines, and the verifier's own file
— and resolved `HASH_LEN` instead of pattern-matching the digit `16`.

**Why:** its first run reported four FAILS and **all four were false**: `guard-idiom.js:2` is a
comment reading "analyze the fetch(G1) / assert(G2) guard idiom"; `artifact-contract.js:50` is a
comment documenting the root precedence chain; two rows matched the verifier's own regex literals;
and R-LANG-2 wanted a literal `16` where `word-names.js:33` truncates with `.slice(0, HASH_LEN)`.
The comment exemption is the same rule `engine/corpus-root.test.js:142` already applies, for the
reason it gives — and `:168` there says plainly that exempting is "what keeps this guard from crying
wolf". A guard that cries wolf gets ignored, then removed.

**Each of the four was read on disk before being exempted.** That is the whole difference between an
exemption and a suppression, and it is why the rule in the file says to widen them only with a
measurement.

**Verified by running it:** 4 fails → 0 fails, with no check weakened; every row still reports the
evidence it decided on.

**Commit:** `37af0ed` (swept, see its git note), described by `aae0d96`

---

## 2026-08-31 — two commits documented with `git notes` instead of being rewritten

**Decided:** left `37af0ed` and `aae0d96` exactly as they are and attached notes explaining that
the first carries three files its message does not mention, and the second describes five files
while containing two.

**Why:** the shared index swept this lane's staged `verify-register.js` and two `prd/` edits into
another lane's commit, in the window between their `git add` and their commit — which `-o` cannot
close for paths already staged. Nothing was lost; only the attribution was wrong. A rewrite of
pushed history to fix a message is a bad trade, and this repo already set the convention when
`b20aae3` was corrected the same way.

**Worth knowing for anyone working here:** both lanes were already using `git commit -o -- <paths>`
and it still happened. `-o` protects you from sweeping *unstaged* work and from *your own* `git add`
being too broad; it does not protect you from a path another session staged before you committed.
The only real defence is to check `git status` immediately before committing and to read
`git show --stat` immediately after — which is how this was caught.

**Verified by running it:** `git show HEAD:...verify-register.js | wc -l` → 281, and the corrected
cites are present in `HEAD`, so the content is on origin and needs no re-applying.

**Commit:** notes on `37af0ed` and `aae0d96`, pushed as `refs/notes/commits`

## Review surface: did NOT credit one-to-one English restatement as collapsed

**Decided:** `residualStatements = bodyStatements − collapsedIntoWords`. A statement rendered as its
**own** English clause counts as `restatedStatements` and is **reported but not credited**. **Why:**
the first cut credited it, which made the metric improvable by paraphrasing bespoke code — exactly
what §4 calls *"a failure mode, not the goal"*. Crediting it also made the number look good for the
wrong reason: on a corpus with no dictionary loaded it would have read near-0% residual.
**Judgment call:** "body statement" is defined as a direct child of a function-like block —
top-level declarations and class members are structure, not review units. That definition lives in
**one** place (`engine/enfile.js countBodyStatements`) rather than in a separate measure script,
because a second definition of "statement" is the §8B drift shape with the metric as the consumer.
**Non-vacuity proven both ways:** no dictionary → 100% residual; the synthetic corpus with its mined
dictionary → 7.7% (4 of 52), byte-identity 4/4.

---

## 2026-08-31 — the sdd-run manifest was wrong in four places; measured, not asserted

**Decided:** ran every cheap step end to end and corrected the manifest against what the scripts
actually do, rather than shipping the descriptions I had written from their headers.

**Why this matters more than an ordinary doc fix:** the manifest is what a UI renders **as the
pipeline**. A wrong `reads` there does not stay a wrong string — it becomes a wrong arrow in a
diagram Amir wires next week.

**The one that matters:**

> `measure` does **not** read `.en` files from disk.

It walks `<SOURCE>/**/*.ts` and renders/compiles in memory. I had it reading
`<CORPUS>/sen/files/**/*.en`. Caught by running it: it reported byte-identity **1037/1037** on a
corpus with **zero** `.en` files on disk. The consequence is structural — `measure` does **not**
depend on `render` having run, so a UI must not draw it downstream of `render`. That is recorded
as a `note` on the step rather than silently corrected, because the wrong mental model is the
natural one.

The other three: `measure:uncollapsed` writes nothing unless handed `-- --json <path>` (claimed
an unconditional write); `render` also writes `.cache/spec-derived/en-index.json`; `name` also
walks `<SOURCE>/**/*.ts`.

**Timings are now measurements.** I had flagged `name` and `measure` cheap. Measured: 22.4s and
45.6s. Both now `expensive`, and each step actually run carries `measuredMs` with the date and
corpus size. `mine` keeps sdd-engine-5f's 3.6s, attributed to them rather than restated as mine.

**Verified by running it:** roots 693ms, stamp:check 720ms, register 720ms, clean 24ms, name
22430ms, measure 45622ms — every one `kind: "run"`, `ok: true`, exit 0. `test:unit` 20/20.

**Commit:** `240eda9`

---

## 2026-08-31 — the `register` step carries a coverage warning, not just an exit code

**Decided:** wrapped `verify-register.js` as a step, and attached a `coverageWarning` field
stating that MANUAL is not a pass and that a row absent from the runner is not a row that holds.

**Why:** the exit code is honest about what it checks and silent about what it does not. The
runner mechanizes **13 rows of a ~100-row register** — currently 9 hold, 0 fail, 4 manual. A UI
that renders "0 fail" as a green pipeline badge would be making a claim about the register that
nobody has verified. The coverage fraction has to travel with the exit code or the exit code
misleads.

Adopted verbatim from sdd-engine-5f, who wrote the runner and flagged the trap when handing the
step over. Recorded as their caveat, not a conclusion I reached.

**Not decided by me:** whether those ~87 unmechanized rows should be mechanized, and in what
order. That is register work in another lane.

**Commit:** `240eda9`

---

## 2026-08-31 — `-o` is not enough on a shared working tree

**Decided:** every commit now goes `git status` immediately before, `git commit -o -- <paths>`,
and `git show --stat` immediately after.

**Why:** three separate sweeps happened today across two sessions. `git add` + `git commit` swept
another lane's staged work into `b20aae3`. Then `-o` alone was still not enough — sdd-engine-5f's
`37af0ed` swept my kind of mistake in the opposite direction, because `-o` protects against your
own `git add` being too broad and against unstaged work, but **not** against a path another
session stages in the window between your check and your commit. I hit the same window: peer
`prd/` files appeared staged between my `git diff --cached` and my `git add`.

`-o` narrowed it; only the after-check catches it. `git show --stat` is how the remaining case
gets found, and it is cheap.

**Verified by running it:** `240eda9` shows exactly the two intended files; the peer's staged
paths were still staged and uncommitted afterwards.

**Commit:** this practice, not a code change.
# Prepared ASSUMPTIONS.md entries (NOT yet merged — ASSUMPTIONS.md does not exist; s7 is creating it)

## A. word-names.json — NOT restored, confirmed obsolete
Amir, 2026-08-31, verbatim: *"get rid of that words file its old we dont need it anymore."*
I never touched Trash. The file remains absent from `<corpus>/sen/catalog/`; the Trash copy
(`~/.local/share/Trash/files/sen/catalog/word-names.json`, 48 names, 0 orphans, fingerprint
cb739d77685eb2af) is untouched and left where it is.
**Consequences deliberately NOT chased, per instruction:** `word-names.test.js` and the word-names
assertion in `artifact-location.test.js` stay red — expected, not a bug.
**Consequence that DOES need a decision and is not mine to make:** this contradicts §8A
(SOURCE-PROTECTED, "not reproducible by a re-mine"), R-LANG-5 ("MUST NEVER be deleted"), and the
`word-names` entry in the artifact registry (`engine/artifact-contract.js:84`). If the words file is
obsolete then the whole skeleton-NAMES half of §5C — R-LANG-1..8 and §7.0 gate 4's rename queue —
is retired with it, which is a much larger call than deleting one file. Flagged, not acted on.

## B. Compression → review surface (supersedes my earlier fix plan for contradiction #1)
Amir, 2026-08-31: *"its not about compression, its about less of a review surface..."*
My earlier plan ("report 1 − .en/.ts, don't optimise") is superseded. Judgment call made: the
review-surface metric **already exists in the PRD** and did not need inventing — §7.3's
statement-collapse ratio `netStatementReduction ÷ S`, defined there as "the fraction of body
statements removed from the reader's view by being folded into a generator call." I promoted that
existing definition rather than authoring a new one, because a second definition of the same
quantity is how this project has drifted before.
MEASURED 2026-08-31 on the real 1,037-file corpus: S = 26,824 body statements (8,794 bodies);
22,760 folded (84.8%); 5,731 generator calls; net 17,029 removed = **63.5%**; review surface
26,824 → 9,795 statements. Byte compression on the same run: **−19%** (.en 4,830,829 B vs .ts
4,058,328 B). More bytes, far less to review — the reframe in one measurement.
NOTE: s7 independently defines review surface as "unclaimed statements per file → 0" (§5D.4 move 3).
Two different metrics for one goal. Unreconciled — see the collision report.

## C. Flat-path attribution refuted (#2)
§3/§4 blamed the .en being larger than the .ts on the flat anti-unification path. Measured false:
flat path gone (5,731 spans, all recursive, 0 flat fallbacks, live depth 62) and .en still +19%.
Rewrote the attribution to gloss prose + span structure per §7A.5. Applied to 04 and 06.

## D. MAXWIN "inert" — flagged in place, not resolved
§4B/§8/R-MINE-2 call MAXWIN 64 inert. The dictionary on disk reports maxDepth 63 on both axes =
MAXWIN − 1, which build-lzw-generators.js:52 calls the signature of the bound BINDING. I recorded
the conflict in the constants table and pointed at §Q-6 rather than resolving it, because resolving
it needs a sweep run (MAXWIN=128) that nobody has authorised.

## E. MIN_WORD_CHARS retired rather than deleted
No live module defines it; it existed only in the archived engine/compose.js. Struck through in the
constants table and R-MINE-4 marked retired, rather than deleted outright, following this document's
own habit (§9 corrections, Q-2 kept struck-through) so a stale memory cannot re-add it.

## REVERSED my own review-surface definition in favour of s12's

**What happened:** I defined review surface in §5D.4 as *"unclaimed statements per file → 0"* and
built a producer for it. §7.3 already had a different definition — `netStatementReduction ÷ S` — with
a committed producer and a measured value (63.5%). **Two definitions of one goal in one document is
exactly the contradiction the whole sweep existed to kill,** and mine was the one with no
measurement. **Decided:** §7.3's wins. `reviewSurface = calls + (S − statementsCollapsed)`; my
per-file residual is now published as the `S − statementsCollapsed` **term** of that formula, per
file, so the worst file is visible instead of averaged away. One producer, one formula, two
granularities.

**The substantive reason mine was worse, not just later:** mine counted a generator call as **free**.
It is not — reading a word's sentence is cheaper than reading its statements but it still costs one
unit, so a 10-statement fold removes **nine**. On the synthetic fixture my formula reported 7.7%
residual where the corrected one reports a 53.8% collapse ratio. **I had built the flattering
number**, and did not notice until s12's definition forced the comparison. Producer corrected in
`engine/enfile.js` and `write-en-files.js`; §5D.4 and §7.3 now state the single definition and say
explicitly which draft lost.

## R-COMP-4 was stale; the test won

**Decided:** R-COMP-4 mandated `members[]` and `hierarchyDepth`; `wordlzw-enlzw-fields.test.js` (825
live assertions) pins `["id","len","freq","m","d"]` and **explicitly forbids** those two spellings as
pre-reconciliation legacy. The register was rewritten to name `m`/`d` (and `memberLeafIds` in
mined-library). **Why the test wins:** the rename was deliberate and size-motivated, the test is
enforced on disk, and the requirement was **unimplementable as written** — a requirement no producer
can satisfy is not a standard, it is a stale note. **Judgment call:** I kept the *substance* (ordered
member ids + depth to leaf, leaf = 0) and changed only the spellings, rather than deleting the row.

---

## 2026-08-31 — the mining constants are reported on every run, and parsed rather than copied

**Decided:** `sdd-run.js` records `MIN_COUNT`, `MIN_SKEL` and `MAXWIN` in every envelope and in
`--status`, warns on stderr when one is overridden, and **parses the defaults out of
`build-lzw-generators.js` instead of restating them**.

**Why the reporting:** sdd-engine-5f flagged that these are env-overridable and that §R binds the
**defaults**, so a run with `MIN_COUNT=2` exported satisfies the code and violates the register
silently. Their finding, their lane for the §R prose — but the place a UI would observe it is the
run record, which is mine. A mine attributed to a constant nobody chose is exactly the class of
thing this project keeps paying for.

**Why parsed and not copied — this is the load-bearing half.** Restating `1, 8, 64` in
`sdd-run.js` would create a second copy of a constant whose first copy had *already rotted*: three
§R cites pointed at `engine/compose.js` (retired to `archive/`, and it says **2**) and
`engine/enlzw.js` (defines neither). Anyone verifying MIN_COUNT against the cited file read 2 and
would have "found" a violation that does not exist. Adding a fourth location was not an option.

If the declaration changes shape, the parse returns `unknown` rather than a stale number — absent
beats confidently wrong, the same asymmetry as `{ optional: true }` returning a reason instead of
a bare `null`.

**Verified by running it:** the real file parses to 1 / 8 / 64, matching the declaration at
`build-lzw-generators.js:59`; a reshaped `Number(process.env.X ?? 1)` yields `defaultKnown: false`
rather than `1`; a missing file the same. With `MIN_COUNT=2` exported: `overridden: true`,
`effective: 2`, the stderr warning fires, and `constantsOverridden` appears in the envelope.
`test:unit` 20/20.

**Not decided by me:** whether §R should bind the *effective* value rather than the default, i.e.
whether an overridden run should be a hard refusal instead of a warning. sdd-run warns and still
runs, because refusing would make a legitimate experiment impossible from the UI. That is a
register question, logged as open by sdd-engine-5f.

**Commit:** `12fa07e`
