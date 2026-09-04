# RUNBOOK — every command, in order

Every command below was **run on 2026-09-03** and is marked with the exit code it actually returned.
Where something failed, needed an argument I didn't expect, or contradicted its own documentation,
that is stated rather than tidied away.

> **EVERY NUMBER IN THIS FILE HAS A TIMESTAMP, AND THAT IS NOT DECORATION.** The corpus, the
> dictionary and the name ledger are live shared files with no commit history of their own
> (`Examples/` is gitignored). A re-mine or a render moves them in seconds, and every figure below
> describes the moment it was measured. **Before quoting any number from this file, re-read the
> artifact and check its mtime:**
>
> ```sh
> cd skills/sdd-engine
> stat -c '%y  %n' Examples/hydra-source/sen/catalog/generators-lzw.json >                  Examples/hydra-source/sen/catalog/word-names.json
> find Examples/hydra-source/sen/files -name '*.en' -printf '%T+ %p\n' | sort -r | head -1
> ```
>
> The figures below were measured against **dictionary `2026-09-03 21:16:20`**, **corpus
> `2026-09-03 21:16:53`**, **`word-names.json` `2026-09-02 23:51:29`**. If those have moved, re-run
> before you quote. A number without its mtime is a claim about the past presented as the present —
> `tools/prd/16-test-integrity.md` calls that the stale-subject alarm.

All paths are from the **repo root** (the directory containing `skills/`). Every command runs from:

```sh
cd skills/sdd-engine/tools/repo-dsl
```

`npm run <x>` shorthands exist for most of these and are noted; the bare `node` form is what
actually runs, and is what to use if the npm script is ever out of date.

---

## 0. What the engine is doing, in one paragraph

`.ts` is mined into a **word dictionary** (`generators-lzw.json`). Each `.ts` file is **rendered**
into a `.en` file — English prose with encoded payload spans. Each `.en` **compiles back** to its
`.ts`, byte for byte. `.en` is the source of truth; `.ts` is derived. The gate that makes any of it
real is **1037/1037 byte-identical**, and the goal is that **no TypeScript survives on the rendered
page** — currently **106,261 constructs** still do.

---

## 1. Preflight / setup

### What must exist first

Both roots are set by **one file**: `skills/sdd-engine/.env`, holding `SOURCE=` and `CORPUS=`.
There is no `SDD_CORPUS`/`SDD_SOURCE` env var — resolution order is CLI flag → env var named
`SOURCE`/`CORPUS` → that `.env`. To repoint the engine at a different tree, **edit one line**.

```sh
node roots.js                      # exit 0 ✅  — prints both roots, who set them, and which artifacts exist
```

Both currently resolve to `skills/sdd-engine/Examples/hydra-source`, set by `.env` (13 entries).
`SOURCE` is the READ root and is never written. `CORPUS` is the WRITE root and holds `sen/`.

### Preflight

```sh
node preflight.js                  # exit 2 ✅  — the table (2 = something is absent/stale; a STATE, not a failure)
node preflight.js --strict         # exit 1 ✅  — hard gate for a caller
node preflight.js --soft           # exit 0 ✅  — always 0, still prints the table (this is what `npm run build` ends with)
node preflight.js --json           # exit 2 ✅  — machine-readable; this is what a UI panel should call
node preflight.js --help           # exit 0 ✅
node preflight.js --bogus          # exit 2 ✅  — "unknown flag: --bogus  (see --help)"
```

**Statuses — there are six, not four.** All are real values the table prints:

| status | meaning | fix |
|---|---|---|
| `PRESENT` | on disk | none |
| `MISSING` | a live producer exists and has not been run | run the command the table names |
| `BLOCKED` | the producer **runs** but cannot publish — an artifact-contract violation | re-running cannot fix it; fix the contract |
| `NO PRODUCER` | archived, or hardcoded to a forbidden root | Amir's call whether to revive or retire; **never** reported as a failure |
| `LOST` | hand-authored and gone — nothing regenerates it | restore from backup |
| `STALE` | present, but **older than something it derives from** | re-run its producer |

**Exit codes:** `0` all present · `2` something actionable (the default, and a *state*) · `1` either
preflight itself could not run **or** `--strict` found something actionable.

> ⚠️ **Two gotchas, both measured today.**
> 1. **Exit 1 is overloaded.** The header says 1 means "preflight itself could not run", but
>    `--strict` also returns 1 when it finds something. A caller cannot tell "preflight crashed" from
>    "`--strict` found a stale artifact" by exit code alone — check stderr for `PREFLIGHT COULD NOT RUN`.
> 2. **The header undercounts what `--strict` fails on.** It says "`--strict` makes a MISSING/BLOCKED
>    artifact exit 1", but the code is `actionable = missing + blocked + lost + stale`
>    (`preflight.js:342`). Today there are **0 MISSING and 0 BLOCKED**, and `--strict` still exits 1 —
>    because of two STALE rows.

**`STALE` cannot see a canon change.** It compares mtimes along declared derivation edges. If the
*code* that computes a lookup key changes while the artifact holding those keys does not, the
artifact is stale and every mtime is innocent. That class is covered separately by
`engine/canon-fingerprint.js` (§6 below), not here.

### Current state as of 2026-09-03 — 17/19 present, 2 STALE

```
[STALE] .cache/spec-derived/naming-plan.json   fix: npm run name:plan
[STALE] files-index.json                       fix: npm run files-index
```

Neither blocks rendering or the tests. Both are rollups that describe an earlier corpus.

---

## 2. Mine / catalog

```sh
node build-lzw-generators.js       # npm run mine     ⚠️ NOT RUN — see §8
node build-lzw-generators.js --json                 # NDJSON progress on stdout, prose on stderr
```

Produces `Examples/hydra-source/sen/catalog/generators-lzw.json` (**36 MB**). Reads the corpus,
writes only the catalog. Deterministic, zero model calls.

**Mining parameters** (all read at module load, `build-lzw-generators.js:107`):

| var | default | effect |
|---|---|---|
| `MIN_COUNT` | `1` | how many times a window must recur before it can become a word |
| `MIN_SKEL` | `1` | minimum skeleton bytes per statement before a word may be promoted |
| `MAXWIN` | `100000` | longest window enumerated, in statements — effectively unbounded |

**None of these are canon.** Names key on the content hash of the canonical skeleton, never on the
word id (`tools/prd/10-language-and-grammar.md:42`), so retuning them cannot orphan a name. That
property is asserted behaviourally in `engine/canon-fingerprint.test.js` (all three probed, all three
leave the fingerprint unchanged). Changing them changes *which* words get promoted, never what a
statement canonicalizes *to*.

> ⚠️ **A stale comment in that file.** Its header says the catalog "is written into the SKILLS REPO
> (`catalog/generators-lzw.json`), NOT under hydra-source". That is **false today** — the live path
> is `Examples/hydra-source/sen/catalog/generators-lzw.json`, confirmed by
> `AC.pathFor("generators-lzw")`. Trust the artifact-contract path, not the comment.

Naming passes, in order, after a mine:

```sh
node name-words-lzw.js worksheet                    # npm run name
node --max-old-space-size=3072 name-words.js plan   # npm run name:plan   (fixes the STALE row above)
node build-files-index.js                           # npm run files-index (fixes the other STALE row)
```

The `--max-old-space-size=3072` is not optional decoration — the naming plan OOMs without it.

---

## 3. Render

```sh
node write-en-files.js                     # npm run render   ⚠️ REWRITES ALL 1,037 .en — see §8
node write-en-files.js --no-write          # exit 0 ✅ 12.2s — full render + verify + report, ZERO writes
node write-en-files.js --dry-run           # alias of --no-write
node write-en-files.js --no-write --out <dir>   # dry run, but emit en-index into <dir>
node write-en-files.js --json              # NDJSON progress stream on stdout
```

Verified dry-run output:

```
=== STEP 7 — ENGLISH SOURCE OF TRUTH ===  (DRY RUN — no corpus writes)
  .en -> .ts BYTE-IDENTICAL ..... 1037/1037   (ALL PASS)
  REVIEW SURFACE (R-ARCH-16) .... 1086 at the TOP level, from S=33918 statements
  ONE WORD PER FILE (R-ARCH-15) . 1030/1037 files collapse to a single top-level word (99.3%)
```

I confirmed `--no-write` really writes nothing: at the time of that run the newest `.en` mtime
stayed at `03:38:49`, seventeen hours earlier — unmoved by the dry run.

> **That mtime is historical and no longer current.** The corpus was legitimately re-mined and
> re-rendered at **21:16** the same evening, so every `.en` now carries a `21:16:53` mtime. The
> verification still stands — a dry run does not move mtimes — but check the *current* newest mtime
> before and after if you want to reproduce the check, rather than looking for `03:38:49`.

**Exit code is load-bearing:** `write-en-files.js` exits **1** if any file is not byte-identical, so
it can fail a caller. Exit 0 means all 1,037 round-tripped.

### It renders `.ts` and NOT `.tsx`

`write-en-files.js:45` walks for `p.endsWith(".ts") && !p.endsWith(".d.ts")`. Measured under SOURCE:

| | count | rendered? |
|---|---|---|
| `.ts` (excluding `.d.ts`) | 1,038 | yes — 1,037 render (1 is skipped by the walker's SKIP set) |
| `.tsx` | **332** | **no** |
| `.d.ts` | 0 | n/a |

Those **332 `.tsx` are exactly** the "332 source files are outside this metric" that `the-goal.test.js`
reports. The goal number is a claim about the `.ts` corpus only. **Rendering `.tsx` is not a
capability that exists and is held pending Amir's decision** — it is not a flag you can flip.

---

## 4. Compile back (`.en` → `.ts`)

**There is no CLI for this.** It is a library call, `engine/enfile.js:compileFileEn`. For one file:

```sh
node -e '
const fs=require("fs"), path=require("path");
const CR=require("./engine/corpus-root"), EN=require("./engine/enfile");
const rel = process.argv[1];                        // e.g. src/routers/links.ts
const idx = EN.loadIndex(CR.corpusRoot());
const en  = fs.readFileSync(path.join(CR.senDir(),"files",rel+".en"),"utf8");
const ts  = EN.compileFileEn(en, idx, {file:rel});
const src = fs.readFileSync(path.join(CR.sourceRoot(),rel),"utf8");
console.log(rel+"  ->  "+ts.length+" bytes, byte-identical: "+(ts===src));
' src/routers/links.ts
```

Verified: `src/routers/links.ts  ->  2599 bytes, byte-identical: true`, exit 0 ✅.

**For the whole corpus, do not write your own loop — a test already does it:**

```sh
node engine/enfile.test.js         # exit 0 ✅  — "(corpus: 1037 persisted .en all compile byte-identical)"
```

> ⚠️ **The gotcha that has bitten us repeatedly.** `.en` files live at
> `<CORPUS>/sen/files/<rel>.ts.en` — note **`/files/`**. Using `senDir()` without it silently finds
> nothing, and a comparison over an empty set reports "0 wrong bytes", which reads like success.
> Always print the **denominator**: `1037/1037`, never `0 wrong`.
>
> Also: `EN.loadIndex()` takes a **corpus root directory**, but `EL.loadLzw()` takes a **catalog file
> path** (`AC.pathFor("generators-lzw")`). Passing a directory to the latter throws `EISDIR`.

---

## 5. The tests, in the order you'd want them

**Run them individually.** `npm test` / `run-tests.js` runs the full suite and has OOM-killed this
machine before.

The critical column is **which file it opens** — that is what determines what a green result actually
proves, and it is the single easiest thing to get wrong about this suite.

| # | command | exit | what it opens | the question it answers |
|---|---|---|---|---|
| 1 | `node engine/the-goal.test.js` | **1** ⚠️ | persisted `.en` from `<CORPUS>/sen/files` | **How much TypeScript still survives on the reading surface?** `106,261`. Fails **by design** until the goal is met — exit 1 is the normal state, not a break. |
| 2 | `node engine/en-idempotence.test.js` | 0 ✅ | **both** — persisted `.en` **and** a fresh render of the `.ts` | **Is the corpus on disk what the current code would produce?** Compares fresh render against the persisted file. This is the test that catches *"someone changed the renderer and never re-rendered."* |
| 3 | `node engine/round-trip-fixpoint.test.js` | 0 ✅ | **only `.ts` from SOURCE** — renders in memory, **never opens a persisted `.en`** | **Does render→compile→render reach a fixpoint?** A pure renderer property. ⚠️ **This test can be fully green with a corpus on disk that is months out of date.** Its `corpusRoot()` reference is only for loading the dictionary. |
| 4 | `node engine/enfile.test.js` | 0 ✅ | persisted `.en` from disk, **compiled back** and compared to `.ts` | **Does the corpus as it actually sits on disk still produce its source?** 1037/1037. This is the disk-compile check, and it is the one that means "the artifact is sound", as opposed to "the code is sound". |
| 5 | `node engine/goal-ceiling.test.js` | 0 ✅ | persisted `.en` | **How much of the goal number is even reachable?** Partitions it: **61,028 reachable**, **45,233 residue** that no hole-type rule can touch. Prints `strip fingerprint 9bf5e7699261`. |
| 6 | `node engine/hole-type-order.test.js` | 0 ✅ | persisted `.en` | **Are the hole TYPES right?** `refill` splices holes *positionally*, so byte-identity is structurally blind to a mislabelled type. Re-derives every payload's key from its own source bytes: 9,723/9,724 agree, 1 known-invalid file. |
| 7 | `node engine/interior-production.test.js` | 0 ✅ | nothing — pure unit | Does the interior-production dispatch refuse correctly? (Landed and deliberately **unused**.) |
| 8 | `node engine/interior-wiring.test.js` | 0 ✅ | persisted `.en` | Is that dispatch genuinely unwired — nothing routed through it? |
| 9 | `node engine/data-english.test.js` | 0 ✅ | nothing — pure unit | Do the data/object/array/call rules round-trip, and **refuse** rather than guess when they can't? |
| 10 | `node engine/canon-fingerprint.test.js` | 0 ✅ | nothing — spawns subprocesses | **Would two builds key the dictionary differently?** Proves the fingerprint **fires** on every canon dial and **stays silent** on `MIN_SKEL`/`MIN_COUNT`/`MAXWIN`. |
| 11 | `node engine/review-surface-ratchet.test.js` | 0 ✅ | persisted `.en` + a fresh render | Has review surface regressed? A ratchet, pinned exactly rather than with slack. |
| 12 | `node verify-register.js` | **1** ⚠️ | the requirements register | Which register rows are mechanized and hold? **73 hold, 9 fail (4 red on purpose, 5 unexplained), 4 manual of 86.** `npm run register`, `--json` for machine output. "MANUAL is not a pass." |
| 13 | `node stamp-artifacts.js --check` | 0 ✅ | every stamped artifact | Do all artifacts carry a valid contract stamp? |

**Two tests exit non-zero on a healthy tree** — `the-goal` (1) and `verify-register` (1). Both are
reporting a known state, not a break. Everything else must be 0.

---

## 6. Environment variables

| var | default | what changing it does |
|---|---|---|
| `SDD_DERIVE_CHECK` | **on** (`!== "0"`) | The guard that catches a **hand-edited `.en`** whose prose no longer agrees with its encoded payload. `=0` disables it — compilation then trusts the payload and silently ignores edited prose. **Currently frozen; leave it alone.** (`engine/enfile.js:2156`, `engine/en-scales.js:523`) |
| `SDD_BODY_SLOT` | **on** (`!== "0"`) | **CANON.** Changes what a statement canonicalizes to. Shipping this default-on once invalidated every catalog on disk and nothing noticed for a day — byte-identity read 1037/1037 throughout, because a missed lookup falls through to verbatim, which is correct by construction. (`engine/generators.js:119`) |
| `SDD_EXPR_SLOT` | **off** (`=== "1"`) | **CANON.** Adds an expression slot. Turning it on against a catalog mined without it is a canon mismatch. (`engine/operations.js:84`) |
| `SDD_CANON_CHECK` | — | gates the canon-fingerprint comparison |
| `MIN_COUNT` / `MIN_SKEL` / `MAXWIN` | `1` / `1` / `100000` | mining parameters — **not canon** (see §2) |
| `REPO_DSL_CATALOG` | — | overrides the catalog path |
| `APPLY` | unset | `APPLY=1` turns a reporting script into a **writing** one (`enrich-chunk-leaves.js`, `reconcile-names.js`) |
| `SHOW_SKIPS`, `SDD_KEEP_SYNTH`, `TOP`, `NEAR`, `NEST`, `LIFT_TOP`, `ONE_WORD_FIRST`, `ALLOW_ORPHANS` | — | measurement/reporting knobs, not correctness gates |

**The two canon dials are the dangerous ones.** They are read **once at module load**, so setting
them mid-process does nothing — which is why `canon-fingerprint.test.js` spawns real subprocesses
rather than mutating `process.env`. If you flip either, the catalog must be re-mined; otherwise the
renderer computes keys the dictionary does not have, every lookup misses, every miss falls through to
verbatim, and **byte-identity still reads 1037/1037 while review surface silently doubles.**

---

## 7. The one-liner — just show me the goal number

```sh
cd skills/sdd-engine/tools/repo-dsl && node engine/the-goal.test.js 2>&1 | grep -oE 'got [0-9]+ constructs across [0-9]+ of [0-9]+ non-empty RENDERED files'
```

```
got 106261 constructs across 1035 of 1035 non-empty RENDERED files
```

> ⚠️ **The `2>&1` is mandatory.** The line is printed by `console.error`, so `2>/dev/null` — the
> instinctive way to quiet a test that exits 1 — silently produces **nothing at all**. I made exactly
> this mistake while writing this file.

Full context, including the per-construct breakdown and the worst offenders:

```sh
node engine/the-goal.test.js 2>&1 | tail -40
```

---

## 8. ⚠️ DESTRUCTIVE AND SHARED-STATE — read before running

These **were not run** while writing this file, precisely because they mutate shared state. Their
interfaces are documented from source; their behaviour is not claimed from a run.

| command | what it does | why it's dangerous |
|---|---|---|
| `node write-en-files.js` | **rewrites all 1,037 `.en`** | The corpus is shared. Two people rendering concurrently, or rendering against a stale catalog, silently rewrites every page. **Assert byte-identity from disk before AND after — 1037/1037, 0 wrong bytes.** Use `--no-write` unless you actually intend to publish. |
| `node build-lzw-generators.js` | rewrites the **36 MB** `generators-lzw.json` | Every `.en` on disk was rendered against the *previous* catalog. After a re-mine the corpus is stale until re-rendered, and **nothing will tell you** — byte-identity still passes. Re-mine and re-render together. |
| `npm run build` | `mine && name && render && measure && preflight --soft` | **Chains both of the above.** One command, entire corpus rewritten. |
| `node sdd-clean.js --wipe-sen` | **deletes the `sen/` tree** | Do not run to "test that it works". If you must verify it, use a throwaway temp directory. |
| `APPLY=1 node reconcile-names.js` | rewrites `word-names.json` | Has been measured to orphan **974 of 3,582** chunk names while reporting `newly orphaned names ....... 2`. Only the §8B required-key contract stopped a run that would have dropped all 3,582 with nothing to restore from. Back up first — see `tools/name-ledger-backup/README.md`. |
| `APPLY=1 node enrich-chunk-leaves.js` | rewrites `word-names.json` | Additive and idempotent, but still a write to the one ledger that **has no git history** (it lives under `Examples/`, which `.gitignore:32` excludes). |
| `node apply-worksheet-names.js` | applies a naming worksheet | Touches the name ledger. |

**The name ledger has no version control.** `Examples/hydra-source/sen/catalog/word-names.json`
carries 3,582 hand-authored chunk names and is excluded from git. The only tracked copies are in
`skills/sdd-engine/tools/name-ledger-backup/`. Re-copy after any authoring pass:

```sh
cp Examples/hydra-source/sen/catalog/word-names.json \
   tools/name-ledger-backup/word-names.$(date +%F).json
cd tools/name-ledger-backup && md5sum *.json > MD5SUMS
```

### Committing — `unset GIT_INDEX_FILE`

Per `CLAUDE.md §7`, commits in this tree are made through a **private index** (`GIT_INDEX_FILE=…`)
so that concurrent work is not swept into someone else's commit. The step that bites:

```sh
unset GIT_INDEX_FILE      # in a FRESH shell — otherwise the next `git add` SILENTLY NO-OPS
git add -- <the paths you just committed>
git show --stat HEAD      # the detector: run it AFTER the commit, never before
```

Also standing: **never rewrite history in this tree** — not to fix a message, not to fix a typo.
Never `--force`-push, never push to `main`.

---

## 9. Fast health check — the four commands worth running

```sh
cd skills/sdd-engine/tools/repo-dsl
node roots.js                                  # am I pointed at the right tree?
node engine/enfile.test.js                     # does the corpus ON DISK still compile? (1037/1037)
node engine/en-idempotence.test.js             # is the corpus what the current code would produce?
node engine/the-goal.test.js 2>&1 | grep -oE 'got [0-9]+ constructs across [0-9]+ of [0-9]+ non-empty RENDERED files'
```

Expected as of dictionary `2026-09-03 21:16:20` / corpus `21:16:53`: exit 0, exit 0, exit 0, and
`got 106261 constructs across 1035 of 1035 non-empty RENDERED files`.

**If `en-idempotence` (check 3) goes red, your first hypothesis is not a regression.** Names are an
input to compilation, so applying the worksheet (§8) stales all 1,037 `.en` *by design* until a
render. Check the mtimes above before diagnosing anything in the code.

> ⚠️ Use the **full** pattern, not a shortened `grep -oE 'got [0-9]+ constructs'`. The short form
> matches a **second** line too — the per-file assertion for `src/routers/links.ts.en` — and prints
> `got 106261 constructs` followed by `got 31 constructs`. Two numbers, one of which is not the
> corpus. I hit this while writing this file.
