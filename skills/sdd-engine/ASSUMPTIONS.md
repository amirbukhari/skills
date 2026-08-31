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

---

## 2026-08-31 — R-CFG-6 was fixed in `engine/sdd.js`, reversing an earlier call in this log

**Decided:** wired `CR.LAYOUT.sen` into `engine/sdd.js:58,62`, which had spelled `"sen"` as a path
literal. **This supersedes the entry above titled "`sdd.js`'s hardcoded `"sen"` literal was left in
place."**

**Why the earlier call changed:** it was made on a cost argument — "wiring the resolver in to fix a
string is a larger change than the defect" — and mechanizing R-CFG-6 changed the cost. The defect is
no longer a note in a log; it is a permanently red check that every future run has to explain away,
and a check that everyone learns to ignore is worse than no check. The fix turned out to be one
`require` plus two call sites, and `sdd.js` takes `projectDir` as a parameter and resolves no root,
so requiring the resolver costs nothing at import time — `LAYOUT.sen` is a frozen constant.

**Verified by running it:** `node engine/sdd.test.js` → 24 passed, 0 failed;
`node engine/corpus-root.test.js` → 11 assertions passed; R-CFG-6 now HOLDS.

**Commit:** `c2a0a4b`

---

## 2026-08-31 — two §R rows are validated against the real artifact, not against prose

**Decided:** R-MECH-2 and R-MECH-3 read the actual 42 MB `generators-lzw.json` rather than
inspecting the miner's source, and the dictionary is loaded lazily so no other row pays for it.

**Why:** these two are the core mechanism. Asserting "the code looks like it builds a DAG" is the
exact move CLAUDE.md's opening rule forbids; the artifact either is a DAG or it is not, and that is
answerable. Acyclicity is proven by depth strictly decreasing along `m[0]` — a cycle cannot satisfy
it — which is both cheaper and stronger than walking every chain.

**Verified by running it, with two independent cross-checks I did not construct:** 232,906 non-leaf
entries hold the (existing entry + one symbol) property, and the 8,922 skipped leaves decompose as
5,684 narrow + 3,238 wide — exactly the leaf counts `npm run mine` prints separately. `maxDepth 63`
likewise matches the mine's own output. Two numbers agreeing from different directions is worth more
than either alone.

**Commit:** `c2a0a4b`

---

## 2026-08-31 — R-ART-4 was mechanized as the landmine, and its runtime half split off

**Decided:** checked R-ART-4 as "no live file outside `artifact-contract.js` authors a header key",
and split what static analysis cannot see into a separate `R-ART-4-runtime` row marked MANUAL.

**Why:** the requirement as written ("AC.stamp is the only publisher") is not statically decidable —
a file can call `writeFileSync` on a path it computed three variables ago. Two weaker formulations
were tried and rejected for crying wolf: "a file that mentions a kind and calls writeFileSync must
stamp it" flags every *reader* (`enfile.js`, `measure-uncollapsed.js`, `refine-language.js` all read
a kind and write something else). What IS decidable is the failure that actually happened: a
hand-built header is how `generators-lzw.json` was born without a `fingerprint` and failed 5 tests.
Splitting the row is honest; stretching one check to cover both would have made it unreliable.

**The MANUAL half is a known real gap, not a formality:** pipeline B publishes `mined-library` and
`corpus-coverage` unstamped and relies on a later `stamp-artifacts.js` run.

**Commit:** `c2a0a4b`

---

## 2026-08-31 — the verifier cried wolf a second time; the fix was again to read, not to loosen

**Decided:** of four new FAILS, fixed three checks and one engine file. No check was weakened to
make a failure disappear.

**Why:** R-MECH-2 called leaves violations (ids 0,1,2 have no `m` and `d === 0` — they carry `sym`
and are base symbols, 5,684 of them per the mine's own count). R-PAY-3 reported all six sentinels
missing from a table containing all eight, because `ESCAPES` is an array **of pairs** and a
non-greedy `]`-terminated match stopped inside `[ESC, "0"]`. R-MEAS-3 read `MAX_HOLE_FRAC = 0`
because `constValue`'s `([0-9]+)` matched the `0` out of `0.5`. R-CFG-6 was real.

**The pattern is now twice-observed and worth stating as a rule:** a new mechanized check's first
run should be treated as testing the *check*, not the tree. Both times, the majority of first-run
failures were the checker's bugs — and both times the minority was a real defect that would have
been lost if the whole batch had been dismissed as noise. Read every hit on disk before exempting
or fixing anything.

**Verified by running it:** 4 fails → 0 fails, 22 hold / 0 fail / 5 manual of 27 rows, with every
row still reporting the evidence it decided on.

**Commit:** `c2a0a4b`

## en-index and name-queue registered as artifact kinds rather than left hand-stamped

**Decided:** added both to the §8B registry, routed both producers through `AC.pathFor` + `AC.stamp`,
and made each read its own output back through `AC.load` immediately after writing.
**Why:** `en-index.json` publishes three gates (byte-identity, R-COMP-6's counts, R-ARCH-16's review
surface) and carried **no header at all** — the incident-5 shape, a producer publishing numbers with
nothing for a consumer to verify. `name-queue.json` hand-wrote its schema string with no fingerprint
and its kind was absent from the registry, so `validate` could never have been called on it.
**Judgment call — `requires` lists what consumers read TODAY** (`gate`, `generators`, `reviewSurface`
for en-index; `queue`, `queueLength`, `orphans` for name-queue), not every key present. A `requires`
that lists everything catches nothing, because any shape change trips it and the signal is lost.
**Both guards proven, not assumed:** a hand-edit to `reviewSurface.reviewSurface` is REFUSED on
fingerprint; deleting the `reviewSurface` block is REFUSED as "same schema string, different shape".
**Pre-existing red:** `artifact-location.test.js` still fails on `word-names` missing — Amir's wipe,
red by decision (s12's entry A), not caused by this change; the four assertions covering the two new
kinds pass.

---

## 2026-08-31 — the pipeline could not report failure, so the wrapper's promise was false

**Decided:** gave four scripts real exit codes — `write-en-files.js` and `measure-english.js` exit
**1** when byte-identity is breached, `build-lzw-generators.js` exits **1** when it parsed no files
or promoted an empty vocabulary, and `sdd-clean.js` exits **3** when it refuses to touch `sen/`.
Before this, all four contained **zero** `process.exit` calls and always exited 0.

**Why:** measured first — there are no interactive or blocking prompts anywhere in the live tree
(no `readline`, `createInterface`, `process.stdin`), so the UI risk was never blocking input. The
real defect was that failure was invisible. `write-en-files.js` computed `gate.allByteIdentical`,
printed `FAILURES: N`, and exited 0 — so PRD R-REND-1, the floor the whole project sells, could not
fail a caller.

That became load-bearing when `sdd-run.js` landed. Its contract is *"EXIT CODE = the child's exit
code, unchanged … exitCode === 0, so a UI never has to interpret prose to know whether a step
succeeded."* A child that cannot exit non-zero makes that promise false: `sdd-run render` would
report `ok:true` on a byte-identity regression. **This is the missing half of that wrapper, not a
competing mechanism** — the earlier "a wrapper, not `--json` on eleven scripts" decision stands.

**Why `sdd-clean.js` exits 3 and not the 2 that was asked for:** `sdd-run.js` reserves 2 for "the
wrapper itself refused" and passes a child's code through unchanged, so a 2 from the cleaner would
be indistinguishable from the wrapper refusing. 0 = did what was asked · 1 = error (the hard
refusals throw) · 3 = declined, nothing deleted. A dry run is *not* a refusal — it is what was
asked for, so it stays 0.

**Verified by running it, and mutation-checked per §10.3:**
- `sdd-clean.js` no flags → **3**; `--wipe-sen` dry run → **0**.
- `build-lzw-generators.js` with `SOURCE=<empty dir>` → **1**, naming the walked-zero-files reason
  and both roots. This is PRD §8B failure mode 2 (miner and renderer walking different file sets,
  which once hid 696 of 937 un-collapsed bodies) made loud instead of silent.
- `write-en-files.js` unmutated → **0** (1037/1037). Mutated to force the gate false → **1** with
  the promised message. No test hook was shipped; the mutation ran from a throwaway copy.
- `measure-english.js` unmutated → **0**. Mutated to force `bad` → **1**.

## 2026-08-31 — the scoreboard shipped the answer it was supposed to compute

**Decided:** removed the frozen readings from `measure-english.js` — the header named `33.8%`,
`40.2%`, `8.4%`, `4.5%`, `20.9%` and `39.7%` as "the ceiling", and the last printed line compared
the live number against `ceiling 33.8% (optimistic … / 40.2%)`. The line now prints the live split
only. The removed numbers are still named in the header comment, as a record of what was cut.

**Why:** point-in-time measurements of one corpus, baked into the tool that measures it — the exact
defect PRD §7 removed from the document (*"every number that was a point-in-time measurement has
been removed — run the tools for current values"*). A tool carrying its own expected answer cannot
report a regression, and on any other corpus it is simply wrong.

**Verified by running it:** live output is now `reads as English 33.7% (optimistic … 40.2%)`. The
frozen ceiling said 33.8%, so it was **already 0.1pp stale** against the corpus it was pinned to.

## 2026-08-31 — did NOT register an `english` artifact kind, though it was asked for

**Decided:** did not add `english.json` as a §8B artifact for gates 2 and 3, and did not add a
`--json` stdout mode to `measure-english.js`.

**Why, and this is a blocker someone should look at:** `engine/artifact-location.test.js`
assertion (e) loops `AC.kindsOf()` and asserts `fs.existsSync(p)` for **every registered kind**.
Registering a new kind therefore turns that guard red until someone runs the producer. Two already-
registered kinds — `word-names` and `gate` — have no file on disk right now, so the guard is
already failing on both. **The registry cannot take a new member until that guard distinguishes
"registered" from "must currently exist."** Writing the artifact unregistered was the other option
and it is the `name-queue.json` bug class (hand-written header, no fingerprint), which is precisely
what this session flagged.

**Consequence left open:** §7.0 gates 2 and 3 still have no committed artifact, so **R-MEAS-1**
("one committed command reading one field of one committed artifact") is unsatisfied for them.
`sdd-run.js` does not close this — it wraps prose in an envelope, it does not produce fields.

**Flagged, not fixed:** a peer (`sdd-engine-e2`) measured that `measure-english.js` never reads
`.en` from disk — it walks `<SOURCE>/**/*.ts` and renders/compiles in memory. So its `1037/1037`
byte-identity is a statement about `compileFileEn(renderFileEn(src))`, which is exactly what
R-REND-1 asks, but it is **not** evidence about the `.en` tree on disk. `<CORPUS>/sen/files/` does
not exist at all today. Any register row reading the scoreboard as evidence about emitted `.en`
files is measuring something else.

---

## 2026-08-31 — the render was run against the real corpus, writing 1037 `.en` into it

**Decided:** ran `npm run render` over the real corpus rather than leaving R-REND-5 and R-COMP-7
permanently MANUAL. This wrote 1037 `.en` under `<CORPUS>/sen/files/` plus
`.cache/spec-derived/en-index.json`.

**Why:** both rows were unanswerable without it, and R-COMP-7 was the open question §Q-8 —
"unmeasured on the real corpus". A register row that can never be evaluated is indistinguishable
from one nobody has looked at. The write is to the designated WRITE root, is the normal output of a
documented pipeline step, and `sen/` is explicitly wipable (`sdd-clean.js --wipe-sen --go`), so it
is reversible in one command. `SOURCE` was not touched.

**Verified by running it — this is the §Q-8 measurement:** live-path `maxDepth` **62** (bar is 2),
2482 spans deeper than depth 1 against 3249 at depth 1, `flatFallback` 0, composites 112,423,
compositionEdges 224,846, `dictionaryMaxDepth` 63 distinct from `maxDepth`, and
`gate.byteIdentical` 1037/1037 on the **emitted** tree. R-COMP-7 had previously cleared its bar only
on a synthetic fixture at depth 3.

**A judgement inside the check:** R-COMP-7 reports the depth **histogram**, not only the maximum,
because one deep span clears a "≥ 2" bar by itself while still describing a flat renderer. 2482
spans spread over depths 2–62 cannot. The number alone would have been a weaker claim wearing the
same verdict.

**Not done, deliberately:** §Q-8 and R-COMP-7's Check text in `tools/prd/` still read "unmeasured on
the real corpus", which is now false. `tools/prd/**` is another lane's, so the measurement was
relayed rather than written. `npm run register --id R-COMP-6,R-COMP-7` reproduces it on demand,
which is better than freezing a number into prose.

**Commit:** `328300a`

---

## 2026-08-31 — an in-memory round-trip score was ruled out as evidence for an on-disk row

**Decided:** mechanized R-REND-5 to distinguish "render has not been run" (MANUAL, a **state**) from
"`.en` exist somewhere other than `sen/files/`" (FAILS, a **violation**), and wrote the warning
inline into R-REND-1's note.

**Why:** another lane found that `npm run measure` reports byte-identity 1037/1037 against a corpus
holding **zero** `.en`. Verified independently: `measure-english.js:59-62` walks `<SOURCE>/**/*.ts`
and round-trips in memory. Worse, its own header line 3 calls itself "Two frozen metrics over **the
emitted `.en`**" — the file's documentation asserts the thing that is not true, which is why the
wrong mental model is the natural one.

The distinction that resolves it: R-REND-1 **is** an in-memory identity
(`compileFileEn(renderFileEn(src)) === src`), so that 1037/1037 is the *correct* evidence for it.
R-REND-5 is a claim about bytes on disk, and the same number is worthless for it. Leaving a
1037/1037 sitting next to a row about the `.en` tree invites the error, so the note names it.

**Verified by running it:** before the render, R-REND-5 reported MANUAL with 0 `.en` and did not
FAIL — absent is a state. After, it HOLDS with 1037, all under `sen/files/`.

**Not fixed:** the false header line in `measure-english.js`. That file belongs to the lane
currently fixing exit codes in the `measure-*` scripts, so it was flagged, not edited.

**Commit:** `328300a`

---

## 2026-08-31 — advised keeping an overridden mining constant a warning, not a refusal

**Decided:** when asked whether a run with `MIN_COUNT`/`MIN_SKEL`/`MAXWIN` overridden should be
refused outright, recommended keeping it a warning. The decision and the code are another lane's;
this records the reasoning given.

**Why:** a refusal makes a legitimate parameter sweep impossible from a UI, and that sweep is how
the values were settled in the first place — `build-lzw-generators.js:51` records byte-identity
1037/1037 at every swept value. And §R binds the **default**: an overridden run is not a violation,
it is a run the register does not describe. Suggested one addition instead — carry
`constantsOverridden` into the artifact envelope, since a stamped artifact from a non-default mine
is the case where a silent override actually costs something later.

**Inferred from reading the code and the register**, not measured. The other lane verified the
override path itself (`MIN_COUNT=2` → `overridden:true, effective:2`).

**Commit:** no code change in this lane.

## R-ARCH-6 was a misreading; the real defect was elsewhere and worse

**Decided:** rewrote R-ARCH-6 rather than "fixing" `extractEntity`. Run against the §5D.1 reference
case it returns `conforms: true`, `byteIdentical: true`, `className: "PaymentPlan"`,
`table: "payment_plans"`, 5 columns, 2 relations — exactly the panel's own *"entity PaymentPlan,
5 cols, 2 rels"*. The requirement described a **reader using top-level keys** instead of
`result.slots`, which its own Check line admitted (*"read the stored keys, not the returned ones"*).
Same class as R-COMP-4: a requirement written from a misread, then cited as a blocker.

**The judgment call:** I did NOT restructure the extractor's return shape to match the requirement.
`result.slots` is what `generate.js`, `sdd.test.js` and the whole test suite read, and it is the
shape §5E.3.2's named binding wants. Changing a field two consumers read to satisfy a stale note is
the drift shape §8B exists to stop.

**What the run actually found — and byte-identity could not see it.** A relation slot carried only
the FIRST relation decorator, so `@JoinColumn({ name: "account_id" })` sitting under
`@ManyToOne(() => BillingAccount)` was **dropped entirely**. The reference sentence is *"It belongs
to a BillingAccount (join account_id)"*, so re-mining a compiled entity could not reproduce its own
sentence — the fill did not exist. Byte-identity stayed green the whole time because the member's
bytes are re-emitted verbatim from the span: **the loss is in the slots, not in the text.**

**This is AT-ARCH-1's first real catch, before AT-ARCH-1 exists.** Exactly the failure class §5E.2
argued idempotence-under-re-mine would find and byte-identity would not. Fixed by
`parseRelationArgs` (named `kind`/`target`/`inverse`/`join`, reading every decorator on the member;
a bare `@JoinTable()` yields `join === true` so "implied name" is distinguishable from "no join"),
pinned by a regression block with **one assertion per clause of the reference sentence**. Additive
only — `decorator` and `args` are untouched because two consumers read them. 56 assertions pass in
`archetypes.test.js`; `generate.test.js` 35 and `sdd.test.js` 24 still pass.

---

## 2026-08-31 — CORRECTION: `git commit -o` does NOT protect a shared file. Supersedes the entry above.

**This supersedes "commits name their files; never a bare `git commit`", which stated something
false.** That entry said `-o` protects you from sweeping *unstaged* work. It does not.

**What is actually true:** `git commit -o -- <path>` commits that path's **working-tree** content,
staged or not. So `-o` protects you from sweeping **other paths** — and gives you **no protection at
all inside a path two lanes are both editing**. Every claim in this file about `-o` being sufficient
should be read with that limit.

**How it was measured, not reasoned:** `25a5ac8` was committed with an explicit `-o` pathspec on
`ASSUMPTIONS.md` alone, with a message describing three entries. `git show --stat` reported **155
insertions** where roughly 90 had been written, and `git show HEAD -- <file> | grep '^+## '` showed
six headings: three mine, three another lane's unstaged append inside the same file. Nothing was
lost; a note on `25a5ac8` names which three are not its message's.

**The procedure that actually works**, for any file several lanes append to tonight:

1. `git status` is **not** sufficient. It tells you the file changed, not by whose hand.
2. Immediately **before** committing, diff the file and confirm the added hunks are only yours —
   for this file's format, `git diff -- <file> | grep '^+## '` is enough.
3. Immediately **after** committing, `git show --stat`. An insertion count larger than what you
   wrote is the tell, and it is the only reason all three of today's sweeps were recoverable.
4. When you find you swept someone's work: **note it, never rewrite pushed history.** Three
   occurrences today (`b20aae3`, `37af0ed`, `25a5ac8`), three git notes, no rebases.

**Why this entry exists rather than an edit to the wrong one:** same rule as `CLAUDE.md` §9 — a
stale copy of the old claim elsewhere must not be able to re-derive it silently. The wrong sentence
stays visible, with this correction attached.

**Commit:** notes on `b20aae3`, `37af0ed`, `25a5ac8`; this entry in the commit below.

---

## 2026-08-31 — centralized the walk SKIP set; exposure was zero and I said so

**Decided:** extracted `engine/walk-skip.js` as the one frozen corpus walk-skip set and migrated
11 walkers to require it.

**Why:** `CLAUDE.md` §8 names the duplication as a standing landmine — it drifted once and hid 696
of 937 un-collapsed bodies. Re-measured: grown from the 13 files recorded there to **18**, in
three divergent shapes. The MINIMAL shape (`node_modules .git demo coined-demo`) did **not**
exclude `sen`, `spec`, `catalog`, `.cache`, `dist`, `build` or `coverage`, so those walkers were
free to count generated files as source.

**The honest part: exposure was ZERO.** Measured twice — before, and again after another lane
rendered 1037 `.en` into the corpus — because those trees hold `.json`/`.en` and every walker
filters `.ts`. **No published number was wrong.** The defect was latent, and this is recorded as
a latent defect rather than dressed up as a live one. Fixing it was still worth doing because the
same class has already cost this project once, but the commit message says "latent", not "bug".

**Verified by running it, against baselines captured before the change:** `measure-operations`,
`measure-callgraph`, `measure-logic-english`, `measure-bespoke-composites` and `measure-english`
all produce **byte-identical** output; byte-identity holds at 1037/1037; `test:unit` 20/20.

**Commit:** `0b392fe`

---

## 2026-08-31 — took the guard fix that makes the guard STRONGER, not the one that quiets it

**Decided:** exempted `engine/walk-skip.js` from the root-literal guard **by file name**, and
deleted the old exemption that waved through any line matching `SKIP = new Set(`.

**Why:** centralizing tripped `corpus-root.test.js`, which sdd-engine-5f diagnosed exactly — the
exemption was LINE-scoped, and the centralized set spans several lines, so the names landed on a
line with no `SKIP = new Set(` on it to match. Two fixes were available: make the exemption
block-aware, or name the file. They recommended the file, and they were right for a reason worth
recording: the old exemption blessed a **shape**, which exempted all 13 copies at once. Naming the
file is what the centralization earned — `"sen"`/`"spec"` may now appear in exactly one place, and
a new inline SKIP set anywhere else fires.

**Verified, not assumed:** I reproduced the failure first (`engine/walk-skip.js:39`), then after
the fix **planted a rogue inline SKIP set** in a throwaway file and confirmed the guard caught it.
A guard that stops crying wolf by lowering its standards is worse than the wolf.

The dangerous wrong move here, which sdd-engine-5f also flagged: "fixing" this by deleting the
`"spec"` entry from the set. That would silently stop excluding a not-yet-renamed corpus. The
guard was wrong; the entry was right.

**Commit:** `0b392fe`

---

## 2026-08-31 — left two files out of my own commit rather than sweep a lane's work

**Decided:** `test-gen-roundtrip.js` and `test-lzw-roundtrip.js` are migrated **on disk** but
excluded from `0b392fe`. `corpus-walk.test.js` names them as pending in a comment.

**Why:** the pre-commit diff showed 14+/1- and 24+/8- on those two against my one-line change —
sdd-engine-5a had uncommitted exit-code work in the same files. `git commit -o` commits a path's
**working-tree** content, so committing them would have taken that work into a commit whose message
describes a SKIP refactor. That is the fourth near-miss of this kind today and the first one caught
*before* the commit rather than after.

**How it was caught, and this is the transferable part:** `git diff --numstat` on every path
immediately before committing, checking each is the size I expect. `git status` says a file
changed; it does not say by whose hand. A one-line refactor showing 24 insertions is the tell.

**Rejected:** a bidirectional test asserting "the pending files are still pending". It reads the
**working tree**, where they are already migrated, so it cannot distinguish disk state from commit
state and failed immediately. Replaced with a plain comment. A brittle test that encodes a
transient two-lane race is worse than a sentence.

**Commit:** `0b392fe`

---

## 2026-08-31 — `test-lzw-roundtrip.js` had never run since 16:03, and nothing noticed

**Found by running it, not by reading it.** The file died at module load with
`ReferenceError: Cannot access 'CR' before initialization` — line 11 called `CR.sourceRoot()`
while `const CR = require("./engine/corpus-root")` sat at line 18. `node --check` passes; it is a
TDZ failure, not a parse error, so every static check was green. `git blame` puts both lines in
**66ddae3 "feat(sdd-engine): two roots — SOURCE to read, CORPUS to write"**, today at 16:03.

**Why nobody noticed:** the file is cited as a gate in four places — `README.md:197`, `SKILL.md`,
`run-tests.js` `SLOW_TIER`, and `verify-register.js:459`, which points a §R row at
`npm run test:slow (test-lzw-roundtrip.js, minutes)`. A register row's evidence was a script that
could not start.

**Decided:** hoisted the `require` and renamed the variable `CORPUS` → `SRC`. It holds
`sourceRoot()`, the READ tree — it was carrying the *write* root's name. That is the §9
"delonix is the corpus" bug class, and it is what made the ordering error easy to write.

**Verified by running it:** 1037 files, **1037 byte-identical, 0 failures**, in 22.3s / 839MB peak.
Max emitted composition depth **62**, histogram spread to 62 with 3,249 of 5,731 spans at depth 1 —
which independently reproduces the §Q-8 numbers I had measured by ad-hoc render, now from the
dedicated test.

## 2026-08-31 — two more scripts that computed a verdict and exited 0

**Decided:** gated `test-gen-roundtrip.js`, `test-lzw-roundtrip.js` (exit **1** on any
byte-identity failure) and `coin-word.js` (exit **1** if either demo round-trip is not byte-exact).
All three had **zero** `process.exit` calls and printed their verdict as prose.

The two round-trip files are named `test-*`, listed in `run-tests.js` `SLOW_TIER`, cited by
`README.md` and `SKILL.md` as *the* byte-identity gate, and pointed at by `verify-register.js`.
They counted `bad`, printed `FAILURES: N`, and exited 0. PRD R-REND-1 calls byte-identity *"the
floor and it never regresses"*; a floor that reports 0 while broken is not a floor. Same defect and
same fix as commit 391bb25.

**Mutation-checked per §10.3** — each forced red, each exited **1** with the message it promises,
each restored green. `coin-word.js` is a demo, not a §7.0 gate; it was gated anyway because the
failure mode is identical.

**One false green caught and redone:** the first mutation run executed the mutant from the
scratchpad directory, which broke its `./engine/...` requires — so exit 1 came from the module
loader, not from the gate. Re-run in place, both fired correctly. A mutation check that passes for
the wrong reason is worse than none.

## 2026-08-31 — the two round-trip gates are NOT two independent measurements

**Flagged, not changed.** `test-gen-roundtrip.js` and `test-lzw-roundtrip.js` print **identical**
generator statistics — 958 files, 5,731 calls, 22,760 collapsed, 17,029 net. That is not
corroboration. `engine/enfile.js:839` is the reason:

```js
const recSpans = index._lzw ? EL.genSpans(sf, source, index._lzw) : [];
```

`EL` is `enlzw`. It is the **only** source of `genSpans` in the file renderer, so
`stats.genSpans` / `genStmtsCollapsed` are enlzw's numbers verbatim. The two tests do exercise
**different compile paths** — `compileFileEn` versus the test's own span scan plus `compileSpan` —
so as *byte-identity* gates they are genuinely independent. As *collapse* measurements they are one
number printed twice.

**What needs to happen:** anyone citing the review-surface figure (17,029 net / 63.5%) should know
it rests on a single implementation, not on two agreeing ones. Whether that matters is a §R call,
not mine to make.

## 2026-08-31 — "Minutes each" was wrong by an order of magnitude

**Decided:** corrected `tools/repo-dsl/README.md:196,197,234` from "Minutes" to the measured
**~24s each, ~850MB peak**, dated. Measured with `/usr/bin/time -v`: gen 23.8s / 850,340kB, lzw
22.3s / 839,168kB.

**Left alone deliberately:** `CLAUDE.md:199` ("never run the full test suite here — it has
OOM-killed") and its description of these two as "the expensive full-corpus ones". Running them
**one at a time** costs 24s and 0.85GB; running the whole suite concurrently is a different
question and this measurement says nothing about it. Weakening a safety rule on evidence that does
not address it is how the rule stops being obeyed.

## 2026-08-31 — the headline review-surface figure is stated as a failing row, not fixed

**Decided:** R-MEAS-2 is mechanized to FAIL on the live manifest (`collapsedStatements 22760 >
bodyStatements 17852`) and the defect is left in place, with `write-en-files.js:143,148` named in the
row and the commit message. I did not edit `write-en-files.js`.

**Why:** two reasons, and the second is the one that decided it. First, that file was claimed by
another lane tonight (sdd-engine-5a, exit codes, commit 391bb25), and the standing constraint is not
to reach into it. Second, and independent of ownership: fixing this MOVES A HEADLINE METRIC. The
corpus residual would go from 0 to something positive and `reviewSurface` would stop equalling
`calls`, which changes the number the PRD calls the one the whole engine exists to move. That is not
a change to make silently at the edge of someone else's work at night. A failing row with the two
line numbers in it loses nothing and forces the decision into daylight.

**Verified by running it:** `node verify-register.js --id R-MEAS-2` → FAILS, exit 1. The core of it
needs no run at all: `sum(collapsed) 22760 > sum(body) 17852` proves at least one file reports more
statements collapsed than it contains, from the two published sums alone.

**Also caught, and corrected before commit:** my first draft of the failure message asserted "397
files with residual > 0", derived as `totalFiles - filesFullyCovered`. That is an overclaim —
`filesFullyCovered` excludes files with `bodyStatements === 0`, so the 397 is not all residual. The
row now cites the manifest's own `worstFiles` per-file residuals (135, 142, 101) instead, which prove
the same point directly from a published field.

**Commit:** 30d2297

## 2026-08-31 — reproducible is not independent; recorded in R-MEAS-1 rather than as a new row

**Decided:** R-MEAS-1 is mechanized (18 metrics must each resolve to a numeric field of the stamped
manifest; the two derived figures are recomputed). The finding that the two round-trip gates are ONE
collapse measurement is recorded in that row's comment, and NOT given a row id of its own.

**Why:** no existing §R row governs gate independence — R-MEAS-8 is candidates-vs-collapse, R-MEAS-2
is denominators, R-PIN-7/R-CFG-2 are about roots. Inventing an id, or attaching the check to a row
that does not say it, is exactly the cite rot I spent this evening removing from four "SETTLED" rows.
So it goes in the comment of the nearest governing row and is flagged for s7, who owns `tools/prd/**`.

**Verified by running it:** `grep -n genSpans` across the three files. `enlzw.js:176` exports the sole
`genSpans`; `test-lzw-roundtrip.js:32` calls `EN.genSpans` directly; `enfile.js:839` calls the same
`EL.genSpans`, and `test-gen-roundtrip.js:27` reports it via `stats.genSpans`. Raised by sdd-engine-5a
and confirmed here at the call sites rather than taken on report.

**The distinction that matters:** as BYTE-IDENTITY gates the two are genuinely independent — different
compile paths, `compileFileEn` vs the test's own span scan + `compileSpan` — so R-REND-1 leans on that
legitimately. As COLLAPSE measurements they are one implementation printed twice. Both halves are in
the comment, because "the gates aren't independent" would be the wrong lesson and would discard real
evidence.

**Commit:** 30d2297

## 2026-08-31 — reproduced both of 5a's findings before acting on either

**Decided:** re-derived the TDZ failure and the single-`genSpans` claim myself instead of accepting a
peer's report.

**Why:** CLAUDE.md §7 — "for any 'broken' or failing claim, reproduce it first". Two of the last three
findings handed to this project were stale, and one of my own §R rows cited `npm run test:slow` as
"the stronger check" for R-REND-1, so whether that script could start was load-bearing for a row I
had already committed.

**Verified by running it:** checked out `522adf8^`, ran it — dies at line 11, `const CORPUS =
CR.sourceRoot()` above its own `require` at line 18. Both of 5a's findings confirmed exactly as
stated. R-REND-1's citation is sound now but was naming a dead script when I wrote it; the row's own
wording already made the manifest gate the primary evidence and test:slow the secondary, which is why
the row was not wrong, only luckier than it deserved.

**Commit:** 30d2297 (no code change from this; recorded because it changes how much weight R-REND-1's
secondary citation carries)

---

## 2026-08-31 — `repo-dsl.js` imported the artifact contract and then hand-wrote around it

**Found by grep, proved by running it.** `repo-dsl.js:39` is `const AC = require("./engine/artifact-contract")`
and `grep -n "AC\." repo-dsl.js` returned **nothing**. The main CLI imported the contract and never
called it, publishing three registered §8B kinds through hand-written headers instead.

**Proved against a throwaway corpus, never the real one** — `node repo-dsl.js mine <tmp>` wrote
`mined-library.json` and `corpus-coverage.json` with `schema` and `corpus` present and
**`artifactVersion`, `generated` and `fingerprint` absent**. Feeding those to a consumer:

```
REFUSED mined-library    expected: a `fingerprint` field
                         got:      none — re-stamp with `node stamp-artifacts.js`
REFUSED corpus-coverage  (same)
```

So `repo-dsl.js mine` was a **second, contract-breaking producer** for two kinds that a different
producer already publishes correctly. Run against the real corpus it would have overwritten two
valid stamped artifacts with ones every consumer refuses — CLAUDE.md §8's landmine (*"a hand-built
header is how `generators-lzw.json` was born without a `fingerprint` and failed 5 tests"*),
reproduced in the CLI that fronts the whole pipeline.

**Decided:** routed all three through the contract — `AC.stamp("mined-library"/"corpus-coverage"/"gate")`
and `AC.pathFor` in place of the hand-joined `COVERAGE_JSON` / `LIBRARY_JSON` / `path.join(RESULTS,
"gate.json")`. `cmdGate` had also typed its `schema` string by hand.

**Verified by running it:** after the change, mine + gate against the throwaway corpus produce three
artifacts that all load — `mined-library 04edea37f1652412`, `corpus-coverage 05a50544cd3d0735`,
`gate c03165b80dffd672`. The gate's own verdict still works both ways: `--min 1` → exit 0 "GATE:
PASS", `--min 200` → exit 1. `engine/corpus-root.test.js` → 11 assertions passed. The real corpus
was never mined or gated during any of this; its four artifact fingerprints and mtimes are
unchanged (20:36 and 21:09, both before this work).

**Left alone deliberately, and each for a reason:**

- **`publishLibrary`'s `catalog/mined-library.v{N}.json`.** It writes into the **legacy STEP-4
  `<CORPUS>/catalog/` tree** with its own versioning (`schema .../vN`, `version`, `generatedAt` —
  different key names than the contract's `generated`). CLAUDE.md §5: the two catalogs are
  different trees and must never be merged without asking Amir. Not a §8B kind, not touched.
- **`verify-expand-<module>.json`.** Unregistered, and its filename varies per module, so
  registering it needs a registry design decision about parameterised kinds — not a mechanical fix.
- **`word-names`.** `engine/artifact-location.test.js` assertion (e) is still red on it, and that
  is now the ONLY thing between that test and green for the tracked kinds. The honest fix is to
  deregister it: Amir's call was *"get rid of that words file its old we dont need it anymore."*
  **I did not do it.** The blast radius is real — `run-tests.js` CORPUS_TIER, `sdd-run.js` `needs`,
  and `enfile.js`'s NAMES loader all name the kind — and the standing instruction is that these
  failures *"stay failing/blocked until the requirement itself is revisited."* The requirement has
  not been revisited. This needs Amir, not me.

## Derive-and-check: detect the hand-edit, do not yet honour it

**Decided:** `compileChunk` re-derives a generator span's gloss from its payload and **throws** on
disagreement, rather than either (a) continuing to ignore the prose or (b) making the prose
authoritative for real. **Why not (a):** R-REND-6 now says the sentence is authoritative, and the old
behaviour compiled the *un-edited* code while looking like the edit worked — worse than refusing.
**Why not (b) yet:** honouring an edit needs the §5E.3.2 grammar parser; substituting hole fills from
backticked tokens would have been a guess.

**The judgment call I nearly got wrong.** My first design was the cheap check — *every backticked
token in the gloss must be one of the payload's hole fills*. **Measured before building on it: 32/40
spans pass**, and all 8 failures are one benign shape, a gloss saying `` `this.rows` `` where the
hole holds `rows` and `this.` came from the template. A check that fires on 20% of correct spans is
worse than no check. Deriving the gloss instead has **no false positives by construction** — the
renderer wrote it with the same two functions the check re-derives it with. **Measuring the cheap
idea first is what stopped it.**

**Default OFF outside tests** (`SDD_DERIVE_CHECK=1` / `{deriveCheck:true}`), because it costs one
parse per generator span on the round-trip hot path; **ON** in `enfile.test.js`, where a drifted
gloss would otherwise slip through. If the cost turns out not to matter on a real timing run, it
should become unconditional — logged so that is a decision someone makes, not an oversight.

**Narrowing found on the way:** the **per-statement CNL path already reads its own prose** — editing
`` `x` `` in ``«Let `x` be …»`` changes the output today. The silent no-op was specific to generator
spans. R-REND-6's defect was narrower than its wording implied, and the PRD now says so.

**Proven both directions (§10.3):** real corpus with the check on, **1,037/1,037 byte-identical,
zero false positives**; with the check off a gloss hand-edit compiles the un-edited code (asserted,
so the defect cannot be quietly reintroduced); with it on the same edit throws and prints written vs
derived.

## 2026-08-31 — sdd-run's own register warning had gone stale; disputed metrics now labelled at the manifest

**Decided:** corrected `sdd-run.js`'s `register` step `coverageWarning`, which claimed "13 rows of a
~100-row register — 9 hold, 0 fail, 4 manual". The real numbers today are **35 mechanized of 119 —
31 hold, 1 FAILS, 3 manual**. Added `exitCodeNote` (the register exits 1 while a row fails, which is
it working, not breaking) and `knownRed` naming R-MEAS-2. Added `disputedOutput` to the `measure`
step.

**Why:** the warning existed precisely to stop a UI rendering the register as "all green", and it had
itself rotted into a wrong number — the exact cite-rot class this project keeps paying for. Rather
than re-freeze a new count that will rot the same way, the string now says the counts are a dated
measurement and points at the runner's own printed summary / `--json` `summary` as authoritative.

**Verified by running it, not by reading it:** `node verify-register.js --json` → `{holds:31, fails:1,
manual:3, total:35, mechanizedRows:35}`, real exit code **1** (captured directly, not through a pipe —
`| tail` had reported 0, which is `tail`'s status, not the runner's). Register row count
`grep -cE '^\|\s*`?R-' tools/prd/11-requirements-register.md` → **119**. `--list` re-parsed as JSON
after the edit; `git diff --numstat` → 4/1, as expected for 3 added lines plus 1 replaced.

**On the disputed metrics — the narrow claim, checked before writing it:** sdd-run does **NOT** parse
or republish `reviewSurface` / `collapseRatioPct` / `residualStatements`. It relays the child's stderr
verbatim and its stdout carries only its own JSON, so no sdd-run field is contaminated by R-MEAS-2.
But `measure` is the step that *prints* those three, and a UI author reading the manifest had no way
to know they are currently wrong and flattering. So the caveat is attached to the step that emits
them, stating they WILL move when R-MEAS-2 is fixed.

**Not fixed here, deliberately:** the R-MEAS-2 defect itself lives in `write-en-files.js:143,148` and
is owned by another lane (sdd-engine-5a), with the substantive reason being that the fix moves a
headline number and needs Amir's name on it. This entry documents the metric as disputed; it does not
touch the computation.

**Commit:** see below.

---

## 2026-08-31 — why `collapsed > body`: two populations, not two nesting depths. MEASURED, NOT FIXED.

s7/5f found the arithmetic (`collapsedStatements` 22,760 > `bodyStatements` 17,852, R-MEAS-2 now
fails on it) and handed the consequence to me, since `write-en-files.js:143,148` compute the corpus
residual as a **clamped difference of sums**. Confirmed, and then measured the cause.

**The guess on the table was double-counted nested statements. That is not it.**
`engine/enfile.js countBodyStatements` counts only statements that are **direct children of a
function-like body**. The generator layer folds statements **anywhere in the file, including
top-level**. The clearest single case: `packages/hydra-internal/src/index.ts` has **0** statements
inside any function body and reports **9** collapsed. Numerator and denominator range over
different populations.

Counting deeper is not sufficient either — under "every statement at any depth *inside a function
body*" (33,100), **583 of 1,037 files still have collapsed > body**. Only "every statement at any
depth, in or out of a function" makes it coherent:

| denominator | S | files with collapsed > S | residual | reviewSurface | ratio |
|---|---|---|---|---|---|
| shipped (fn-body direct children) | 17,852 | **809** | 0 *(clamped)* | 5,731 | 95.4% |
| all stmts in fn bodies, any depth | 33,100 | **583** | — | — | — |
| every statement, any depth | 33,918 | **0** | 11,158 | 16,889 | **50.2%** |

The narrower fix alone — `SUM(per-file residual)` instead of `max(0, SUM − SUM)` — gives residual
1,932 and reviewSurface 7,663, but leaves the ratio dividing 22,760 by 17,852.

**Not fixed, and deliberately so.** §7.3 calls this definition FROZEN and the PRD calls it the
number the whole engine exists to move; the honest fix takes the headline from 95.4% to 50.2%.
That is Amir's call, not a late-night edit at the edge of my file. Put to the user with all three
numbers; stopped pending an answer. R-MEAS-2 failing is the correct interim state.

`verbatimStatements` at `write-en-files.js:142` has the same clamped-difference-of-sums shape and
is presumably wrong in the same direction — it reads 0 today, which is not credible next to 895
restated. It moves with whichever denominator is chosen, so it was left alone too.

**Measured with a read-only probe** over all 1,037 files (`renderFileEn` + a second AST pass per
file), run from the scratchpad, writing nothing. The engine tree was not modified.

## 2026-08-31 — the UI contract had no test; wrote one, and proved it can fail

**Decided:** added `tools/repo-dsl/engine/sdd-run.test.js` (UNIT tier, 10 assertions). It pins the
stdout contract, the per-step field shape, the two refusals, and the three CROSS-REFERENCES that can
rot silently: every `cmd` script exists on disk, every `npm` name exists in `package.json`, every
`needs` kind is registered in the artifact contract.

**Why this and not something else tonight:** `sdd-run.js` is the one interface built to be consumed
by a machine, Amir is wiring it into a UI next week, and **nothing guarded it**. Every other file
here is checked by the thing downstream of it — a bad dictionary fails the round-trip, a bad header
fails `stamp:check`. The manifest has no consumer yet, so a script renamed out from under a step
would surface as a person clicking a button and getting an error, which is the most expensive place
to find it.

**What it deliberately does NOT pin:** the step list, the timings, the prose. Those change
legitimately, and a test that froze them would be noise that gets ignored and then deleted. Adding a
step must not fail this test; renaming a script out from under one must.

**Verified by running it — including that it can FAIL.** A guard that passes on first write is not
evidence, so I mutated the wrapper five ways in a restorable copy and confirmed each fired the right
assertion and only that one: script renamed → "every script a step runs exists on disk"; npm name
dropped → the package.json row; `needs` typo → the artifact-kind row; `destructive: true` flipped to
`false` → the refusal row; and the coverage count restored to the exact stale text that shipped twice
today → the rot guard. `sdd-run.js` restored and confirmed clean via `git diff --numstat` afterwards.
`run-tests.js --tier=unit` → **21 passed, 0 failed, 0 skipped** (was 20).

**The rot guard is the pointed one.** The register coverage paragraph rotted in TWO files today, both
times asserting zero failures on a day a row fails. The test now rejects an undated "mechanizes N
rows" claim in the manifest, so the fix (defer to `verify-register.js --json summary`) cannot be
quietly undone by someone helpfully writing today's number back in.

**Also fixed:** the same stale sentence in `tools/repo-dsl/README.md` — "13 rows of a ~100-row
register". Replaced with an explicit instruction not to read a coverage count out of that file,
naming what it said and what was true, plus the `tail`-swallows-the-exit-code trap.

**Commit:** see below.

---

## 2026-08-31 — six walkers had NO skip set at all, which the duplication sweep could not see

**Decided:** migrated `resolve-imports.js`, `pattern-census.js`, `coin-word.js`,
`finer-granularity-sweep.js`, `engine/coin.test.js` and `guard-idiom.js` to
`engine/walk-skip.js`, the canonical set another lane (`sdd-engine-e2`) created earlier tonight.

**Why they were missed, and it is nobody's error:** that sweep enumerated the landmine by grepping
`SKIP = new Set(` and fixed 18 files in three shapes. These six define **no skip set at all**, so
that grep could not see them. Found from the other direction — every file containing
`function walk(` that does not mention `SKIP`. The two categories are complementary, and neither
grep alone finds the whole set.

**Measured before changing anything:** an unguarded walk of the corpus returns **1038** `.ts`
files against the canonical walk's **1037** — one extra, from `coined-demo/`. So the exposure today
is one file, and **no published number was materially wrong**. The defect is latent: it becomes
active the moment the corpus gains a `node_modules`, `dist`, `build` or `.cache` containing `.ts`,
or SOURCE is pointed at a real repo. Fixed so it cannot become active silently — the same reasoning
`walk-skip.js` gives for its own existence.

**Two of them had hand-rolled partial skips** — `coin-word.js:24` and `engine/coin.test.js:92` both
filter `!f.includes("/demo/")` inline. Those are left in place: they are narrower than the canonical
set and removing them would change what those two scripts count, which is not what this change is
for.

**Not touched, and each for a reason:** `explain.js` and `lib/skeleton.js` matched the "walk with no
SKIP" grep but their `walk` is an **AST** walk, not a filesystem walk — the guard does not apply.
`verify-register.js` keeps its own set because it walks the **ENGINE** tree, which `walk-skip.js`
explicitly scopes itself out of. `engine/corpus-root.test.js` and `engine/corpus-walk.test.js` keep
theirs because the root-literal guard's exemption keys on the literal text `SKIP = new Set(`.

**Verified by running all six**, not by reading them: every one exits 0 and still produces its
output, and `pattern-census.js` now reports `corpus: 1037 files` where the unguarded walk gave 1038.
The require was also checked to precede the first `walk()` call in each file — a `const` used above
its own `require` is exactly the TDZ failure that killed `test-lzw-roundtrip.js`, and `node --check`
does not catch it.

## 2026-08-31 — verbatim sentinels are escaped structurally, not detected by a stricter scanner

**Decided:** fix the sentinel byte-identity failure by ESCAPING sentinels in verbatim regions on
render and unescaping on compile, rather than by teaching `compileFileEn`'s scanner to recognise
which `«` are "really" span openers.

**Why:** the stricter-scanner fix would have to infer intent from position — a `«` at the start of a
line modulo indentation is an opener, one inside a string literal is not — which is an assumption
about what the text looks like. `payload.js` already rejected exactly that reasoning for hole text,
and its header says why in terms that turned out to be prophetic: no sentinel appears in the corpus
today, *"but that is luck, and luck is what the dialect work just finished removing"*. The same
argument applies verbatim (literally) to the other text in a `.en`. Matching the existing mechanism
also means one escape character in the dialect, not two.

**Scoped to three characters, not the payload's eight.** Verbatim text lies OUTSIDE every chunk, so
the only characters that can change how it parses are `OPEN`, `CLOSE` and the escape marker. `⟪ ⟫ ▶`
are chunk-internal and mean nothing out there. Escaping them would be cargo-cult symmetry that made
the artifact Amir is supposed to read worse for no gain.

**Verified by running it:** cost on the corpus is zero — all 1037 SOURCE `.ts` scanned for
`« » ⟪ ⟫ ▶ ⟨ ⟩ ⟡`, none contains any, so no `.en` byte and no fingerprint moves. The floor holds:
`test-gen-roundtrip` 1037/1037 byte-identical, 0 failures; `test:unit` 20/20; full suite 24 passed,
0 failed, 3 skipped. Both halves mutation-checked red-then-green per §10.3 — neutering
`escapeVerbatim` fails the round-trip, and so does neutering `unescapeVerbatim`.

**The test now guards the mechanism, not the outcome.** The pre-existing assertion passed for a long
time purely because no `.ts` held a sentinel, which is precisely how this stayed dark. So the new
assertions check the property that makes it hold by construction: escaped text provably contains no
raw `«`/`»`, the codec round-trips input adversarial about the escape marker itself, sentinel-free
text is returned unchanged, and a stray escape is refused.

**Commit:** 356adf8

## 2026-08-31 — how to commit your own change to a file another lane is editing, without -o

**Decided:** when `enfile.js` turned out to carry another lane's uncommitted `countBodyStatements`
work at commit time, I did NOT use `git commit -o`, and did not ask them to commit first and wait.
I constructed the blob — HEAD's version of the file plus only my four edits — `git hash-object -w`'d
it, staged it with `git update-index --cacheinfo`, asserted their hunk was absent from the staged
diff, and committed from the index without touching the working tree.

**Why:** `-o` would have swept their work, for the exact reason logged earlier today — it commits
WORKING TREE content for the paths you name. Two lanes editing the same FILE cannot be separated by
path, so the path-based defence has no purchase here. This is the case the earlier correction did not
cover, and by now it is the fifth or sixth sweep-shaped hazard of the day.

**Verified by running it:** staged diff went from 70/9 (mine + theirs) to 56/5 (mine alone) with
`grep -c fnStmtCount` on the staged diff returning 0; after the commit, `grep -c` on the working tree
still returns 1, so their change survived and is still theirs to commit. The constructed blob was
`node --check`ed before staging, and a `assert "fnStmtCount" not in s` guard sat in the construction
script so a silent inclusion would have thrown rather than shipped.

**How it was caught, which is the transferable part:** `git diff --numstat` immediately before
committing showed `enfile.js` at 70 insertions when I had written about 56. That gap is the entire
signal. I then read every `-` line in the diff, which is what identified four deletions as not mine.
A one-line refactor reporting 24 insertions is the documented tell; this is the same tell at a
different magnitude, and reading the minus lines is what turns the tell into a diagnosis.

**Commit:** 356adf8

---

## 2026-08-31 — a live test whose only producer is archived and points at the forbidden root

**Found by running the unit tier one test at a time** (27 files, individually — never the suite,
CLAUDE.md §7). Result: **25 PASS, 2 known-blocked** (`artifact-location`, `word-names` — both the
expected word-names consequence), **1 unexplained**: `engine/operation-idioms.test.js` died with a
raw `ENOENT` stack at module load.

**The chain, each link measured:**

1. It reads `<CORPUS>/catalog/operation-idioms.json` and `function-archetypes.json`. Neither
   exists. The legacy STEP-4 tree holds only `coined-words.json` (hand-curated, protected) and
   `mined-library.v1.json`.
2. `grep` for a producer: the **only** one is `archive/build-operation-idioms.js`.
3. That file, line 26: `const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";` —
   the root **CLAUDE.md §1 forbids touching** and `.claude/settings.json` denies outright.
4. Run against a throwaway corpus, it fails to load at all (module not found).

So the test cannot be satisfied from the live tree by anybody, and `run-tests.js` — which correctly
lists both files as its prerequisites — will report it SKIPPED forever against a prerequisite
nobody can produce. The PRD still lists `build-operation-idioms.js` as a live tier-2 component
(`05-architecture.md:15`, "partially built").

**Swept the whole tree for that literal while I was there:** 11 files hold
`/home/amir/Documents/Rentsync/delonix`, and **every one is under `archive/`**. Zero live `.js`
files name it. Confined, but 11 loaded guns — reviving any archived script points the engine at the
forbidden root. Worth knowing before anyone "just runs the archived producer".

**Decided — made the failure honest, and nothing more.** Replaced the bare `readFileSync` pair with
a `required()` helper that names the absent file, the tree it looked in (and that it is the LEGACY
tree, not `sen/catalog/`), the archived producer, and why that producer cannot be used. Exit **2**:
nothing was tested and nothing failed — distinct from 0 (pass) and 1 (assertion failure). This is
the `{ optional: true }` rule from CLAUDE.md §8 — *a reason, never a bare null* — applied to a test
that was violating it.

**Verified both directions:** with the files absent → exit 2 and the full explanation. With two stub
files present in a throwaway corpus → the guard passes straight through into the real assertions,
which then fail on the stub shape (exit 1). So the guard does not block a corpus that has them.

**Explicitly NOT done:** I did not revive the producer (it points at a denied root), did not
generate the catalogs by hand, and did not retire the test. Reviving versus retiring is a decision
for Amir, not a fix.

## 2026-08-31 — the front door promised a command the root could not run, and mis-stated a cost 10x

**Decided:** three corrections to the skill-root `README.md` and `package.json`, all found by RUNNING
every command the front door promises rather than re-reading it.

1. **`npm run test:slow` said "minutes each".** Measured by another lane the same evening at **~24s
   each, ~850MB peak** — wrong by an order of magnitude, in the first file a new person reads. Now
   dated and stated as measured. I did **NOT** re-measure it myself: four lanes are active on this
   shared machine and CLAUDE.md §7 bans running the full suite here after an OOM kill. So this figure
   is *cited from that lane's `/usr/bin/time -v` run*, not independently reproduced — recorded as
   such rather than presented as mine.
2. **`npm run clean` and `clean:sen` exit 3 by design** (`sdd-clean.js:163`, refusing to delete
   without a flag) and the table said nothing. Same trap as the register's exit 1. The README now
   carries one paragraph covering all three: non-zero here means "refused", not "crashed".
3. **`npm run register` did not exist at the skill root.** `package.json` delegated 18 scripts and
   missed five: `register`, `register:json`, `reconcile`, `measure:uncollapsed`, `name:author`. All
   four of the first are now delegated. **The reason this mattered more than a missing alias:** npm
   exits **1** for an unknown script, and the register exits **1** when a row fails — so at the root
   the two were *indistinguishable*, and a UI or a person would read "missing script" as "the
   register found a failure" or vice versa.

**Verified by running it:** each of `roots`, `steps`, `status`, `stamp:check`, `clean` from the skill
root (`exit 0,0,0,0,3`), and each newly delegated script resolves. `npm run register` at the root
before the fix → exit 1 with no output; after → the real runner.

**Commit:** see below.

## 2026-08-31 — `reconcile` was a one-click step in the manifest that could never run

**Decided:** `sdd-run.js` now REFUSES a step whose script needs a caller-supplied positional,
emitting `missing-argv` with the argument's name, why it is required, and the exact command to
supply it — instead of spawning a child that dies at load.

**The defect, measured:** `node reconcile-names.js` with no argument → `ERR_INVALID_ARG_TYPE` at
`reconcile-names.js:40`, because line 25 reads `process.argv[2]` as a mandatory census file with no
default. **Nothing in the live pipeline writes a census** — `narrate-census.js` reads one, it does not
produce one. This is the same bug class CLAUDE.md §9 already records for `author-names.js`. My
manifest listed `reconcile` as pipeline step order 2 with no warning, so a UI would have rendered a
button that always crashes, and the crash would read as "the tool broke" rather than "supply a
census".

**A design call, and I changed my first answer:** I first placed the refusal AFTER the artifact
readiness check. Running it showed `reconcile` reporting `not-ready` (word-names is absent), so the
new guard never fired. Moved it ahead of readiness — an argument the caller never passed is the
caller's error and is true regardless of what is mined. Otherwise a UI author fixes "not-ready"
first and only then discovers the step could never run.

**Guarded as a CLASS, not an instance:** the test asserts that any step whose script reads
`const X = process.argv[N];` with no `||` default must declare `requiresArgv`. The probe currently
finds exactly one such script and asserts it still finds ≥ 1, so a rotted regex fails loudly instead
of passing vacuously.

**Verified it can fail:** undeclaring `requiresArgv` fires both new assertions; disabling the guard's
condition fires the ordering assertion.

**And a harness bug this exposed, which is the one worth keeping.** My first ordering mutation broke
`sdd-run` outright — and the test file printed *nothing at all*, because it parses the manifest at
module scope and threw at load. Zero assertions ran, and a grep for `FAIL` saw a clean sweep. That is
the exact shape 5a reported for `test-lzw-roundtrip.js` (a TDZ error at load, every static check
green, dead for hours). The parse is now guarded: a crashing wrapper FAILS an assertion and aborts
with a reason. Proven by injecting a throw at the top of `sdd-run.js` — before, silence; after,
`FAIL --list is parseable at all` and exit 1.

**Commit:** see below.
