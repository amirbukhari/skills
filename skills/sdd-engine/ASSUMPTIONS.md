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
