# §5D.4C THE ARBITRARY CEILINGS, REMOVED — and what actually blocks one word per file

*[index](README.md) · Amir's challenge, 2026-09-01: textbook LZW creates an entry from `prefix + one
new symbol` on **every** step of a single pass — recurrence decides whether an entry is ever
**reused**, not whether it is **created**. Does our engine impose limits beyond what LZW requires?
Investigated in the code, then relaxed on Amir's explicit go-ahead. **Byte-identity held at 1037/1037
throughout.** The honest headline: **both constraints were real and both are gone, and together they
were worth one file.** What actually blocks the goal is something else, named in §5.*

## 1. Was entry CREATION gated on recurrence? Effectively no — but the gate existed

- **`engine/wordlzw.js:119`** (before): `if (e.count < minCount) continue;` inside `buildSaturated`.
- **`build-lzw-generators.js:70`**: `MIN_COUNT = +(process.env.MIN_COUNT || 1)`.

**`MIN_COUNT` defaults to 1, so the creation gate never fired** — and **R-MINE-1 already required
exactly that** (*"`MIN_COUNT` **MUST** be 1 — a word need not recur"*), so the PRD had asked for
Amir's principle all along; only the code's shape had not caught up. The file's own sweep note already
said as much — *"at MIN_COUNT=1 the binding constraint becomes MAXWIN, not recurrence"*. So the
engine was already creating a structural entry for every window regardless of recurrence, which is
what Amir asked for. **But the default in the function signature was `opts.minCount || 2`**, and the
same `minCount` was threaded into both `buildSaturated` (creation) and `promote` (what the renderer
may use) — one dial silently controlling two unrelated decisions, and a latent trap for anyone who
set `MIN_COUNT=2` expecting a naming change and got a structural one.

**Changed:** creation now takes its own parameter, `createMinCount`, **defaulting to 1**, documented
as never being the place for a frequency judgement. `promote`'s `minCount` is untouched. **This is a
no-op on today's numbers by design** — it makes the existing behaviour intentional rather than
incidental, and separates "can we represent this as one word" from "is it worth naming".

## 2. Was `MAXWIN=64` a real limit? No — and removing it was measured free

`build-lzw-generators.js:70` capped window enumeration at 64 statements. Its own comment called it
*"an arbitrary bound, not a correctness gate"*.

**The cost argument for keeping it does not survive measurement.** The `K` loop can never produce a
window longer than the longest stream, so:

| `maxWin` | windows enumerated |
|---|---|
| 8 | 89,731 |
| 64 | 152,844 |
| 128 | 153,015 |
| 256 | **153,015** |
| 1024 | **153,015** |

**Identical from 128 up**, because the corpus's longest stream is 77 statements. A ceiling below 77
does not save work — it only forbids words.

**Changed** (R-MINE-2 superseded by R-MINE-12)**:** the default is now effectively unbounded (`MAXWIN || 100000`), and the `K` loop is
explicitly clamped to the longest stream so an unbounded ceiling costs exactly what a tight one did.

**Measured effect of the re-mine:**

| | before (`MAXWIN=64`) | after (unbounded) |
|---|---|---|
| maxDepth, both axes | 63 (= MAXWIN−1, *pinned by the parameter*) | **76** (= 77−1, *the corpus*) |
| composites, wide | 112,423 | 112,594 |
| catalog size | 40 MB | 41.85 MB |
| mine wall-clock | ~1.1 s | **3.96 s** |
| mine peak RSS | — | **591 MB** |
| render wall-clock / RSS | — | 22.9 s / 842 MB |

**None of these is a functional problem**, which was Amir's stated bar. The depth ceiling is now a
property of the corpus rather than of a constant, which is the point.

## 3. The gates held

| gate | result |
|---|---|
| **`.en → .ts` byte-identical** | **1037/1037, ALL PASS** |
| render exceptions | 0 |
| review surface | 13,874 → **13,873** |
| **one word per file** | 316/1037 → **317/1037 (30.6%)** |
| model calls | 0 |

## 4. So the ceilings were arbitrary — and worth one file

**+1 file.** Stated plainly because it would be easy to present the removal as a win: it was the
*correct* change (a ceiling that forbids words the corpus actually contains is indefensible, and it
now cannot silently bind again) and it was **not** the thing standing between us and the goal.

This also **re-settles a stale conclusion honestly.** The old sweep concluded *"the default stays
64"* and *"WHOLE-FILE WORDS DID NOT MOVE: 74/1037 at every value"* — measured against the **old**
renderer, which refused every whole-run word unconditionally. That conclusion could not be inherited
once the LIFT became conditional (R-ARCH-17), so it was re-measured rather than assumed. It happens
to survive; it was not entitled to.

## 5. WHAT ACTUALLY BLOCKS IT — measured, first blocking gate in pipeline order

941 files, each attributed to the **first** gate that stops it:

| files | share | first blocking gate |
|---|---|---|
| 308 | 32.7% | **— none: renders as ONE WORD** |
| **306** | **32.5%** | **passes every gate, still multi-span** — see §6 |
| 294 | 31.2% | **`enlzw.js:123`** — `win.filter(isUnit).length >= 2`. **This is R-MINE-8**, a stated requirement (*"No span MUST straddle two or more units. A word means one thing"*), already filed in §4B as **Amir's call** — so it is deliberate, not an oversight, and was not touched |
| 32 | 3.4% | top-level run broken by an unfoldable statement |
| 1 | 0.1% | `chunkGloss` refused |
| **0** | **0%** | **no whole-run word in the dictionary** |
| **0** | **0%** | byte-gate refill failure |

**Mining is no longer a blocker for a single file.** Every unbroken, <2-unit file now *has* a
whole-run word available. That is the real result of §1–2: the structural record exists everywhere it
could exist. What stops the file becoming one word is entirely downstream of mining.

## 6. THE UNANTICIPATED CONSTRAINT — the scheduler's objective (reported, NOT changed)

Amir's guardrail was to stop and report on finding a constraint neither of us anticipated. **This is
one**, and it is the largest single bucket.

`genSpans` picks spans by **weighted-interval scheduling that maximises total weight**, where
`weight = w.len - 1` (`enlzw.js`, the `cands` sort and `dp` reconstruction). A whole-file word covers
the file's *top-level* statements. Words inside a function body cover far more statements. So the
scheduler routinely prefers **several nested words over one whole-file word — correctly, by its own
objective.**

Measured on `src/build-react-index.ts`:

```
top-level statements: 6      whole-file word weight would be: 5
spans actually chosen: 2     total weight: 8
   stmts=5 weight=4  bytes [0,157)    <- NESTED (inside a top-level statement)
   stmts=5 weight=4  bytes [176,697)  <- NESTED (inside a top-level statement)
```

**8 > 5, so the nested pair wins.** Of 307 non-one-word files examined, **280 have at least one span
sitting inside a top-level statement** — the same shape.

**This is a genuine objective conflict, not a bug.** R-ARCH-16 (review surface) rewards collapsing
the most statements; R-ARCH-15 (one word per file) rewards collapsing the *outermost* run. They
disagree, and today the scheduler only knows about the first. Changing the objective would trade
review surface for one-word rate — a real design decision with a measurable cost, and **Amir's to
make.** It is recorded, not taken.

*Also noted:* a file whose top level is a **single** statement (e.g. `src/config.ts`) can never be
"one word" as currently defined, because a word requires `len >= 2`. That is a definitional edge, not
a failure — worth deciding rather than leaving implicit.

## 7. A correction to §5D.4A

§5D.4A claimed that recreating `word-names.json` made **`word-names.test.js` pass "rather than being
red by decision"**. **That was wrong, and it was my reporting error** — the failing assertion sits
early in the output and I read only the tail. The test is **still red**, for the right reason: its
non-vacuity assertion requires a **hand-authored leaf name** to reach a label, and the recreated file
has `names: {}` / `chunks: {}` — **0 authored names of either kind.** What recreating the artifact
actually fixed is narrower and still true: the registered artifact exists, validates, and declares
`chunks`, so R-LANG-19's mechanism has a home. Authoring names remains Amir's pass, by design
(*"a generated name Amir did not choose is worse than no name at all"*).

## 8. Requirements

- **R-MINE-11** — Structural entry creation **MUST NOT** be gated on recurrence. A dictionary entry
  records that a composition *exists*; whether it recurs decides only whether it is reused, and
  whether it is worth naming is a third, separate question. Check: `buildSaturated`'s creation gate
  is its own parameter, defaulting to 1, and is never fed `MIN_COUNT`. Rationale: this is what
  decouples "can we represent this as one word" from "is it worth spending a model call to name it".
- **R-MINE-12** — No fixed depth/window ceiling may bind below the corpus's own longest stream.
  Check: `maxDepth` reported by a mine is a property of the corpus (`longest stream − 1`), never
  `MAXWIN − 1`; **measured: 76 = 77 − 1, where it was 63 = 64 − 1.** Rationale: enumeration is
  bounded by stream length regardless, so a lower ceiling forbids words without saving work
  (152,844 windows at 64 vs 153,015 at 128, 256 and 1024 alike).

---

## 9. The register row, and proof it can fire (§10.3)

`verify-register.js`'s R-MINE-2 row checked one thing: that the `MAXWIN` literal equals 64. Once the
literal moved that row failed, and it would have been dishonest to relax it into a row that passes on
any value. It is replaced by an **R-MINE-12** row that checks the property the requirement is
actually about — that the ceiling does not bind:

    if (d === maxWin - 1) FAILS(...)   // d = generators.dictionaryMaxDepth

A mine that stopped because the parameter said so reports `maxDepth === MAXWIN − 1`; a mine that
stopped because the corpus ran out does not. §10.3 says a guard that cannot be shown to FIRE is not
a guard, so: **this one fires on the state of the tree an hour ago.** The pre-change artifact
reported `dictionaryMaxDepth` **63** against `MAXWIN` **64** — exactly `d === maxWin − 1`. The row
would have gone red on the old code and is green on the new (76, with 99,923 of headroom), which is
the direction of travel a requirement is supposed to have.

Register after the change: **38 hold, 0 fail, 3 manual** of 41 mechanized rows.
