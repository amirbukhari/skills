# CLAUDE.md — sdd-engine

Read this before touching anything here. It exists because every rule below was learned the
expensive way.

> **A claim about runtime behaviour needs a measurement, not a reading of the code.**
> Every rule here carries the evidence that produced it. If you add a rule, attach the command you
> ran and what it printed. "The code appears to…" is not evidence; it is a hypothesis, and this
> project has already paid for the difference (§8, the fingerprint bug).

---

## 1. Scope boundary — hard, and first

- **The workspace is `skills/sdd-engine` and nothing else.**
- **Never touch `/home/amir/Documents/Rentsync/delonix`** — not to read, not to write. It was
  mistaken for the corpus for a long time. **It is not the corpus.** The corpus is
  `skills/sdd-engine/Examples/hydra-source`.
- **Never touch the Kraken / `better-claude-cli-ui` repo** unless Amir explicitly asks for
  something in it, in that moment.
- A stale root does not fail loudly enough to notice: pointing at delonix once produced ENOENT
  that *masked* a real artifact-contract failure, and the wrong diagnosis got reported as fact.

---

## 2. The two roots, as actually implemented

| var | role | contents |
|---|---|---|
| `SOURCE` | **READ** root | the `.ts` tree that gets walked, parsed, mined. Never written. |
| `CORPUS` | **WRITE** root | `sen/` (the rendered `.en` + `sen/catalog/` artifacts), plus `catalog/` and `.cache/`. |

- Independent. Same dir = self-hosting (the default). Different dirs = render a forked codebase
  into a fresh tree.
- Precedence, **per root**: `--source/--corpus` flag → env var → `<engine>/.env` → engine-relative
  default (`Examples/hydra-source`).
- Set-but-missing **refuses loudly**, naming the root, the absolute path, and the layer that
  supplied it. There is no silent fallback.

**Project config:** `.claude/settings.json` (scoped to this skill; see `.claude/README.md`). It
denies reads and edits under delonix and Kraken outright, denies `git commit`/`git push`, and puts
the expensive operations (mine, build, wipe) behind an explicit ask. This file is loaded
automatically by directory nesting — nothing references it.

**Source of truth — read these, don't trust this doc:**

- `tools/repo-dsl/engine/corpus-root.js` — the single resolver. `sen` is spelled here once, as
  `LAYOUT.sen`, and nowhere else.
- `tools/repo-dsl/engine/corpus-root.test.js` — the executable guard for all of the above.
- `.env` — the two lines you actually edit. `.env.example` is the tracked template.
- `tools/PRD.md` §1B — the decision record.

`sen` is a folder name, not a root. Do not make it configurable.

---

## 3. The acceptance test — a hard rule

> *"if you need to make more than 1 file change to alter the directory we are pointing at then we
> have done this wrong and need to fix it"* — Amir, 2026-08-31

**One line in `.env` repoints either root. Nothing else changes.**

Per root, independently. Any future change to how roots are resolved must preserve this.

*Verified 2026-08-31* — `node engine/corpus-root.test.js` → **11 assertions passed**, including
"no live engine source names a root — only the registry and .env may" (greps the live tree for
root literals) and "SOURCE and CORPUS are independent — setting one never moves the other".
`npm run roots` prints the resolved path *and the layer that decided it*:

```
SOURCE  <skill>/Examples/hydra-source
        set by: SOURCE in <skill>/.env
```

*Also verified* — pointing SOURCE and CORPUS at two different temp trees rendered one into the
other with no writes to the read tree.

The guard cried wolf once and was fixed, not deleted: it flagged the walk SKIP sets, which list
`"sen", "spec"` **deliberately** so an un-renamed corpus stays excluded. That exemption is now
implemented, not just described in a comment. A guard that cries wolf gets ignored, then removed.

---

## 4. `sen/` wipability

- `sen/` **is** wipable — Amir: *"the SEN folder with the catalog is supposed to be wipable"*.
- **Only behind an explicit flag the user types.** Never silent, never default, never automatic,
  never a side effect of a cheaper cleanup or of an engine change.
- **No flag = refuse**, naming what would have been deleted with file and byte counts.
- **`SOURCE` is never wipable by anything.** Read-only input, full stop — and the protection must
  hold structurally even when `SOURCE === CORPUS`.
- Owner: `tools/repo-dsl/sdd-clean.js`. It lives in the ENGINE, not in the corpus: on 2026-08-31
  the corpus was wiped by hand and the old `<corpus>/sdd-clean.js` went with it. A tool that
  deletes a tree must not live inside that tree.
- Gate: `--wipe-sen` AND `--go`, both required, neither a default. Dry-run otherwise.

*Verified 2026-08-31, all in throwaway temp dirs, never against the real corpus* — no flags →
refuses `sen/` and prints its file and byte counts; `--wipe-sen` alone → lists it, deletes nothing
(12 files before, 12 after); `--wipe-sen --go` → `sen/` gone, `src/`/`packages/`/`tests/`/
`catalog/` intact; SOURCE a separate tree with CORPUS pointed inside it → **refused at plan time,
before any `rm` ran**, both files still present afterward.

A bug was caught here *by writing the test, not by reading the code*: `inside(abs, SOURCE)` is
trivially true for every path when `SOURCE === CORPUS` (the default), so the first version could
never have deleted anything at all. The separate-tree case is now a hard refusal; the self-hosting
case is protected by the name list.

---

## 5. The two-catalog trap

**`<CORPUS>/catalog/` and `<CORPUS>/sen/catalog/` are different trees. Never merge them.**

Do not confuse or merge them without asking Amir.

| path | what it is |
|---|---|
| `<CORPUS>/catalog/` | **legacy STEP-4** tree. Still load-bearing: `coined-words.json` is hand-curated. Out of scope for the `sen/` wipe. |
| `<CORPUS>/sen/catalog/` | the **§8B tracked artifact home** — `generators-lzw.json`, `mined-library.json`, `word-names.json`. |

`sen/catalog/` was chosen deliberately: the corpus `.gitignore` ignores root `catalog/*`, so a
SOURCE-PROTECTED artifact placed there would be silently untracked.

*Verified 2026-08-31* — `engine/operation-idioms.test.js:16` reads the legacy tree by joining
`CR.corpusRoot()` + `"catalog"` directly, with an in-file comment saying why it does **not** go
through `AC.pathFor`. Meanwhile `AC.HOMES.tracked === path.join("sen", "catalog")`, asserted in
`corpus-root.test.js`. Two different resolution paths, both live, both correct — which is exactly
why they are easy to conflate.

*The trap had actually sprung, and was fixed 2026-08-31.* The corpus `.gitignore` carried an
unanchored `word-names.json` rule, which matches at any depth — so `sen/catalog/word-names.json`,
a SOURCE-PROTECTED §8A artifact, was **silently untracked**, defeating the exact protection
`sen/catalog/` exists to provide. Measured in a scratch repo with `git add -A` +
`git ls-files --error-unmatch`: before, that file was ignored and `sen/skeletons/` was wrongly
tracked (the rule still said `spec/skeletons/`); after, all three `sen/catalog/` artifacts are
tracked and `sen/skeletons/` is ignored. The negation block must stay **last** in the file —
gitignore is last-match-wins.

*Also verified* — `sdd-clean.js --wipe-sen --go` against a throwaway corpus removed `sen/` and left
`catalog/coined-words.json` byte-intact. The protection is a name in `PROTECTED`, not a coincidence
of what the cleaner happened to walk.

---

## 6. UNRESOLVED — the direction of truth

**Do not resolve this by inference. Ask Amir.**

Amir's three-folder direction (English source / TypeScript source / TypeScript build) implies
**flipping** English into the authoritative source with TypeScript derived from it — the
**opposite** of what is implemented today, where `.ts` in `SOURCE` is authoritative and `.en` in
`CORPUS/sen/` is generated.

Today's `SOURCE`/`CORPUS` work is the **current, un-flipped direction with cleaner names.** It is
not the flip and does not move the project across that line.

Detail, including what specifically is open: **`tools/PRD.md` §1B.5** (and §1A / §1A.2, which
already ruled that byte-identity at 1037/1037 is *not* sufficient to flip).

Any session touching direction-of-truth must ask Amir which direction is current before assuming.
This gap was silently forgotten once already.

---

## 7. Standing operational rules

- **Quote Amir. Never paraphrase or reframe a concept he described** — when briefing or relaying
  his direction, mirror his own words back. Every reframe in this project has cost a rework:
  "corpus" became a container, "2 folders" became 3, `SEN` became `SEN` when he said lowercase.
- **Read the actual PRD / spec / artifact before acting on a claim about it.** A summary, a
  memory, or another agent's report is **not** the source. Two of the last three findings handed
  to me were already stale.
- **For any "broken" or failing claim, reproduce it first** — run the test, read the file on
  disk — before theorizing a cause. The one time I skipped this I refuted a correct diagnosis.
- **Commits and pushes are granted; PRs and merges are not.** Amir, 2026-08-31: *"you have autonomy
  in this code base now, you can start committing shit if you want"* and *"and pushing you can push
  shit up too. just dont trigger any CI shit"*. So: commit logical changesets freely, push freely,
  and **opening a PR, merging, or force-pushing still needs his word in the moment**.
  - **Before any push, check for CI and say what you found.** *Measured 2026-08-31* — this repo has
    **no CI**: no `.github/workflows/`, no Travis/Circle/GitLab/Jenkins/Drone config, and `.github/`
    holds only two agent `.md` files. A push therefore fires nothing. **That is a measurement with a
    date on it, not a standing fact** — re-check before pushing, because the day someone adds a
    workflow is the day this line becomes wrong.
  - **Group commits by the work, not by the clock.** Do not sweep an unrelated staged change into a
    commit whose message describes something else — that happened here on 2026-08-31 and the skill
    removals now sit inside a commit titled "add a real front door README".
  - **Never stage a deletion you cannot account for.** If `git status` shows a file gone that you did
    not remove, leave it unstaged and ask. Deletions in this repo have been deliberate manual wipes
    more than once.
- **Never run the full test suite here.** It has OOM-killed on this shared machine. Run only the
  tests relevant to what changed, individually. `test-gen-roundtrip.js` and `test-lzw-roundtrip.js`
  are the expensive full-corpus ones.
- **No deletions of anything** without Amir's explicit word. Moves and renames are fine when he has
  directed them **and** there is a clear revert path — and a rename means every byte survives.
- **`.env` holds the two vars; `.env.example` is the tracked template. Keep them in sync.**
- `Examples/` is gitignored at the repo root, so the whole corpus is untracked here. Corpus edits
  have no git safety net — check before you overwrite.

---

## 8. Landmines worth knowing

- **Walk SKIP sets are duplicated across 13 live files.** *Measured 2026-08-31* —
  `grep -rl 'SKIP\s*=\s*new Set(' --include=*.js . | grep -v archive` → 13. They drift, and that
  drift once hid 696 of 937 un-collapsed bodies. They currently contain **both** `sen` and `spec`
  on purpose, so a not-yet-renamed corpus stays excluded — which is also why the root-literal guard
  has an explicit exemption for them.
- **Artifacts must be published through `AC.stamp`**, never a hand-written header — a hand-built
  header is how `generators-lzw.json` was born without a `fingerprint` and failed 5 tests.
  *Verified 2026-08-31* — after the fix, a mine over a 2-file synthetic corpus produced
  `fingerprint c92c2028fce06305` alongside `schema`, `artifactVersion`, `corpus` and `generated`.
  Before the fix the field was simply absent.
- **`{ optional: true }` returns a reason, never a bare `null`.** `catch { return null }` is the
  bug class this engine exists to eliminate: it turns "your vocabulary is missing" into "your
  corpus contains no patterns".
- **Dependency-free Node** (built-ins only) everywhere except `tools/repo-dsl/package.json`
  (typescript 5.4.5).
- **Byte-identity is the hard floor.** A change that improves readability and loses byte-identity
  is a regression, not a tradeoff.

---

## 9. Corrections — what this doc used to say, and why it was wrong

Kept rather than silently fixed, so a stale memory elsewhere cannot re-derive the old version.

**"The missing `fingerprint` was not the cause."** *Wrong, and it was my error, not Amir's.* The
four tests were run against a **stale corpus root**, so they failed with `ENOENT` — a missing
*file*, which masked the real failure. Re-run against the right root, all four failed on
`expected: a 'fingerprint' field / got: none`. Amir's original diagnosis was right the whole time.
**The lesson is the one at the top of this file:** reading the code produced a confident wrong
answer; running it against the correct root produced the right one in seconds.

**"`spec/` is a separate configurable root."** *Wrong.* Three designs were proposed and rejected
before the right one: (a) one root named CORPUS; (b) CORPUS as a *container* with SOURCE and SEN as
subfolders; (c) SOURCE and SEN as two independent roots. The answer is **two** roots — `SOURCE`
(read) and `CORPUS` (write) — and `sen` is a **folder name inside CORPUS**, spelled once as
`LAYOUT.sen`, not configurable. Each wrong turn came from reframing Amir's words instead of
quoting them: he said *"2 folders at minimum"* and got 3; he said *"lowercase"* after `SEN` was
already written everywhere.

**"delonix is the corpus."** *Wrong, and it cost the most.* It was treated as the corpus for a long
time. The corpus is `Examples/hydra-source`. `.claude/settings.json` now denies reads there
outright — prose in a doc did not prevent the mistake; a deny rule does.

**"`sdd-clean.js` belongs in the corpus."** *Wrong.* It was `<corpus>/sdd-clean.js` until the
corpus was wiped and the cleaner went into the wastebasket along with the tree it existed to clean.
It now lives in the engine. A tool that deletes a tree must not live inside it.

**"`npm run name` runs the naming step."** *Wrong when first wired.* `author-names.js` reads
`process.argv[2]` as a census file and **nothing live produces one** — it crashed with
`ERR_INVALID_ARG_TYPE` on a path of `undefined`. Found by running it, not by reading it. `name` now
points at `name-words-lzw.js worksheet`, which works; `name:author` is separate and still needs an
input file.

**"`git check-ignore -q` tells you whether a file is ignored."** *Wrong, and it produced a wrong
answer twice in ten minutes today.* It exits 0 for a **negated** match too, so a correctly
re-included file reports as "ignored" — first making a real hole look worse than it was, then making
the fix look like it had failed. Use `git add -A` in a scratch repo and
`git ls-files --error-unmatch`, or read `check-ignore -v` output for a leading `!`.

---

## 10. Shape for any skill file written for this project

frontmatter → **one** rule → steps → **Report back** → **Bounds**.

- **Report back** must state plainly, per claim, whether it was *verified by running it* or
  *inferred from reading the code*. Those are different confidence levels and collapsing them is
  how §9's first entry happened.
- **Bounds** is an explicit never-list, not a tone. Name the paths, commands and actions that are
  out of bounds.

