# §5D.4A ONE WORD PER FILE — the mechanism, and how far the corpus actually is

*[index](README.md) · Measured 2026-09-01 against Amir's principle: **"Every file should be able to
be 1 word. If it's not able to be that then we've failed."** §5D.4 stated the target and named the
obstacle; this section supplies the numbers, the composition mechanics, and **one finding that
changes the picture: the largest single cause of the gap is a rule the PRD already superseded but the
code still enforces.***

## 1. Yes — the principle is already a stated requirement

**R-ARCH-15** ([11-requirements-register.md](11-requirements-register.md), row 122), verbatim:

> *"A file **MUST** be accounted for by **one top-level word**, whose rendered form **IS** its
> recursive definition — words made of words down to leaves — and which is **editable at every
> level**. An opaque whole-file token is forbidden."*

The full treatment is **§5D.4** ([05-architecture.md](05-architecture.md) §5D.4), which reads the LZW
invariant literally — *a word does not summarize its parts, it equals them* — and records that
**R-MINE-7 (THE LIFT)**, which used to say *"a file is never one word"*, was **amended** to refuse
only a whole-run word that is **unnamed or unexpandable**. So the principle is not new, and nothing
below revises it.

## 2. The mechanism — how a word calls another word

**The data structure.** Verified by reading the live dictionary (`sen/catalog/generators-lzw.json`,
axis `wide`): **115,661 entries — 3,238 leaves and 112,423 composites.**

- A **leaf** entry is `{ len: 1, d: 0, sym }`, where `sym` is a canonical statement skeleton with
  holes marked — e.g. word 18 is `import ‹gap›{‹gap›‹id›‹gap›}‹gap›from‹gap›‹str›;`
- A **composite** entry is `{ len, d, m: [prefixId, appendedId] }`. **`m` IS the call.** A word
  references other words **by id**; there is no separate call syntax, no inlining, no expansion
  stored. Nesting is just the id pair.

**Concrete, from the real corpus.** `partners.ts`'s first span is word 3344:

```
w3344  len=2  d=1  m=[18, 18]
  w18  len=1  d=0  LEAF  import ‹gap›{‹gap›‹id›‹gap›}‹gap›from‹gap›‹str›;
  w18  len=1  d=0  LEAF  import ‹gap›{‹gap›‹id›‹gap›}‹gap›from‹gap›‹str›;
```

Two statements, one word, built from two references to one leaf. **Deep composition is the same
shape all the way up** — the deepest live word, `w120513`, is a left spine in which every level is
*the previous word plus one more symbol*, which is the LZW invariant read literally:

```
w120513 len=64 d=63 = w120478 + w310
w120478 len=63 d=62 = w120438 + w310
w120438 len=62 d=61 = w120390 + w310   ... and so on down
```

(`len=64` and `d=63` are `MAXWIN` and `MAXWIN-1` — the depth is **pinned by the bound**, not a found
ceiling; see §4B / Q-6.)

**How it renders.** `enlzw.genSpans` walks the prefix+symbol automaton (`wordsAt`) to find the
longest kept word starting at each run position, then emits a span whose payload is
`{ d: "lzw", a: "w" | "n", w: <word id>, h: <hole fills> }`. So the `.en` carries **an id plus the
holes' exact source bytes** — nothing else. `expandKey` recurses the id pair to reconstruct the flat
skeleton (`expandKey(m[0]) + ‹gap› + expandKey(m[1])`, base case `len === 1 → sym`), `compileSpan`
refills the holes, and a span is emitted **only if the refill equals the exact source slice**. That
byte-exact gate is what makes recursion safe at any depth: a word that cannot refill is simply not
chosen.

**Where the English comes from** is the other half, and it is the §5D.3D problem: the span's gloss is
composed from its members' clauses, so `w3344` reads *"import 1 name from a module then import 1 name
from a module"* rather than as one named chunk.

## 3. MEASURED: today the corpus achieves this ZERO times

Same harness, same 943 files, in-process render + `compileFileEn` round-trip, no corpus writes. A
file counts as **one word** only if it has exactly one top-level span **and** nothing non-whitespace
outside it.

| | **today (default)** | **with `LIFT_TOP=0`** |
|---|---|---|
| **one-word files** | **0 (0.0%)** | **308 (32.7%)** |
| fully covered by spans (any count) | 230 | 314 |
| zero-span files (nothing folded at all) | 53 | 28 |
| total top-level spans | 7,222 | 5,364 |
| mean top-level spans per file | 7.66 | 5.69 |
| **byte-identity failures** | **0** | **0** |
| render exceptions | 0 | 0 |

*(A separate scan of the 1,037 `.en` files on disk agrees with the default column: 0 one-word files,
mean 8.22 top-level spans, max 126, median span byte coverage 88%.)*

## 4. The dominant cause is self-inflicted — and the PRD already retired the rule

**`enlzw.js:121`:**

```js
if (LIFT_TOP && w.len >= run.length && run.length >= 2) continue;
```

`LIFT_TOP` defaults to **ON** (`enlzw.js:61`). That line **discards any word covering an entire
run** — which is precisely the *original* R-MINE-7, *"a file is never one word"*, the rule §5D.4
**superseded**. It is the direct and sole cause of the `0` in the table: turning it off recovers
**308 whole-file words with byte-identity fully intact**, and no test anywhere pins it (the only
references to `LIFT_TOP` in the tree are its own definition and use).

**So the honest accounting of the gap, per Amir's principle:**

| files | status | cause |
|---|---|---|
| **308 (32.7%)** | **one word already available, thrown away at render time** | superseded R-MINE-7, still live as `LIFT_TOP` |
| 6 | fully covered, but by **more than one** top-level span | adjacent runs whose *concatenation* never recurred — a merge problem, no new mining needed |
| 601 | partially covered — residual non-whitespace outside the spans | **THE RESIDUAL** (§5D.4): LZW builds an entry only where a run *recurs*, so once-only statements produce no entry |
| 28 | nothing folded at all | same cause, total |

**§5D.4's diagnosis was right and is now quantified: the residual is the real obstacle for ~67% of
files. But it is not the obstacle for the first third — that third is being refused.**

## 5. Why the one-line fix is NOT applied here, and what unblocks it

Flipping the `LIFT_TOP` default is one line and is measured to be byte-safe. **It is nevertheless
blocked, and by the same missing artifact as §5D.3D §4b.** The *amended* R-MINE-7 permits a
whole-run word only when it is **named and expandable**. `word-names.json` is deleted, so **every**
word is currently unnamed; flipping the default today would produce 308 whole-file spans whose gloss
is `genLabel`'s *"clause then clause then clause…"* composition — expandable, but not named, and not
readable as one sentence. That is the shape the amended rule exists to refuse.

**Recommended sequence, smallest step first — Amir's call on the first item:**

1. **Settle `word-names.json`** (§5D.3D §4b). Chunk names have nowhere to live until it exists.
2. **Give a word a whole-chunk name that overrides member composition** (R-LANG-19, §5D.3D §4a).
3. **Flip the `LIFT_TOP` default to OFF** — at that point the 308 files satisfy the amended
   R-MINE-7 as written, and the headline goes from 0% to ~33% with no other change.
4. **Then, and only then, attack the residual** (§5D.4's three moves) for the remaining ~67%.

**Do not re-render the corpus before step 3.** Re-rendering today reproduces the current output
exactly — the default is unchanged, so every `.en` would be byte-identical to what is on disk.

## 6. IMPLEMENTED, 2026-09-01 — 0% → 30.5%

Amir directed the recommended order to be executed. It was, and the numbers below are from the
producer itself (`en-index.json`), not an out-of-band script:

```
.en -> .ts BYTE-IDENTICAL ..... 1037/1037   (ALL PASS)
REVIEW SURFACE (R-ARCH-16) .... 13874 things to read, from S=33918   (59.1% left the reader's view)
ONE WORD PER FILE (R-ARCH-15) . 316/1037 files collapse to a single top-level word (30.5%)
modelCalls .................... 0
```

**Review surface improved as a side effect:** 16,889 → **13,874**, i.e. the collapse ratio went from
50.2% to **59.1%**, because a whole-file word replaces several partial ones.

### What was built, in the order Amir gave

1. **`word-names.json` settled.** Recreated as a properly stamped, contract-validated artifact at
   `<corpus>/sen/catalog/word-names.json`, now carrying **two** maps: `names` (one leaf skeleton, as
   before) and **`chunks`** (a whole multi-statement word, named as one clause). `chunks` is
   **declared in the registry's `requires`**, so a consumer cannot read a file that lacks it. Chunk
   keys are `wc:`/`nc:` + sha256 of the word's **ordered leaf skeletons** — content-addressed for the
   same reason leaf names are: word ids are array indices and move on every re-mine. *This clears the §8A / R-LANG-5 contradiction: the registered artifact exists again, validates, and
   declares `chunks`, so R-LANG-19's mechanism has a home.* **CORRECTION (§5D.4C §7): an earlier
   draft of this line also claimed `word-names.test.js` now passes "rather than being red by
   decision". That was wrong — a reporting error, the failing assertion sits early in the output and
   only the tail was read. The test is still red, for the right reason: its non-vacuity assertion
   needs a hand-authored leaf name to reach a label, and the file holds 0 authored names of either
   kind. Authoring is still Amir's pass.**

2. **Whole-chunk names outrank member composition (R-LANG-19).** `namedLabel` consults
   `WN.chunkNameFor` **first** and returns that one name; member composition is now the *fallback*
   for words with no chunk name. `enfile.js`'s old *"never invented whole"* rule is gone. Purely
   additive — an unnamed word renders exactly as before.

3. **Chunk RULES, keyed to node kinds, cardinality as a parameter (R-LANG-16/17).** Two mechanisms,
   both deterministic and both zero-model:
   - **`ImportDeclaration`**, the kind Amir named and the corpus's most repetitive (5,833 of 33,918
     statements): a maximal run of imports becomes **one clause naming each import**. `partners.ts`
     now reads *"import `LiftPartner` from `../entities/hydra`, `getManager` from `../helpers`, and
     `memoize` from `./caching/node-cache` then get `getLiftPartnerFromAccountId` from memoize"* —
     which is §5D.3B's target prose, produced by code. The same rule renders one import without a
     list, which is what "cardinality is a parameter" means in practice.
   - **generic cardinality**: adjacent identical clauses collapse with a count — *"call `res.set`
     twice"*, *"call `x` 3 times"* — the move `namedLabel`'s long-dead `(×N)` collapse was reaching
     for, in the one place that is reachable. Non-adjacent repetition (`A B A`) deliberately does
     **not** collapse; interleaving is not repetition.

4. **THE LIFT is now conditional, not unconditional (R-ARCH-17).** `enlzw.js` refused *every*
   whole-run word. It now asks the renderer: `wholeRunOk(run)` → `enfile.chunkGloss(run)`, which
   returns a gloss only when the run reads as a named chunk — **no mechanical repetition, nothing
   that says nothing**. A run that cannot be glossed is still refused and still re-segmented, so an
   unruled repetitive kind never becomes an opaque blob; it shows up as a file that did not collapse,
   which *is* the work queue. The gate is deliberately **not** "exactly one clause": two *different*
   actions joined by "then" is ordinary English.

**The gate matters more than the count.** Every one of the 316 collapses is *earned* by a real
English gloss. Forcing the old `LIFT_TOP=0` behaviour yields 308 by comparison — so the conditional
gate is now admitting **more** files than blanket permission did, while refusing the ones that would
have read as noise.

**Pinned by `engine/chunk-naming.test.js`, 34 assertions**, each mechanism tested firing *and*
declining — including one bug the test found rather than the code review: the cardinality collapse
turned `"run a step"` ×2 into `"run a step twice"`, which is not in the says-nothing set and would
have slipped a meaningless whole-file word past the gate. The check now runs on the **pre-collapse**
clauses.

## 7. WHAT REMAINS — the residual, 721 files

Honest, from `en-index.json`:

| | files |
|---|---|
| collapse to one word | **316** |
| fully accounted for by words, but in more than one span | 221 |
| **do not collapse** | **721** |

The cause for the great majority is unchanged and is **not** the LIFT any more — it is **THE
RESIDUAL** named in §5D.4: LZW builds an entry only where a run *recurs*, so once-only statements
produce no entry and nothing accounts for those positions. The worst files are large and
test-heavy — `tests/hydra-api/massCredits.test.ts` (94 spans, 7,085 non-whitespace bytes outside
them), `src/xero-api/invoice.ts` (82), `src/rentsync-api/reporting/index.ts` (78).

**§5D.4's three moves are still the plan, and are now the next work**, in this order:

1. **More node-kind chunk rules** (§5D.3C). Only 88 runs corpus-wide are now refused *for want of a
   rule* (down from 163 before the generic cardinality collapse), and their repeated kinds are
   `ExpressionStatement` and `VariableStatement`/`FirstStatement`. This is the cheapest remaining
   move and it is pure §5D.3C work.
2. **Seed the archetype as a dictionary entry with a variadic tail** (§5E.3.4) — so a file word does
   not have to be *discovered* by recurrence.
3. **Make the residual explicit in the top word's gloss** — *"…and 4 statements not yet part of any
   pattern"* — under §7.0's honesty rule (R-LANG-10), so a file is accounted for by one word that
   *admits* what it has not factored.

**Not attempted tonight, and flagged rather than guessed at:** move 2 changes the miner, which means
a fresh mine (tens of minutes) and a parameter decision (`MIN_COUNT`, still open in Q-9). That is
Amir's call on cost, and it is the gate on the remaining ~70%.

## 8. Requirements

- **R-ARCH-17** — The renderer **MUST NOT** discard a whole-run word solely because it covers the
  run. Check: with names present, a file whose run is covered by one word renders as **one** top-level
  span; `enlzw.js:121`'s unconditional refusal is gone. **Measured cost of the current refusal: 308
  of 943 files. BLOCKED on R-LANG-19.**
- **R-MEAS-6** — The per-file **one-word rate** MUST be published by the render producer, alongside
  review surface. Check: `en-index.json` carries `oneWordFiles` and `perFile[].topSpans`; a run that
  cannot state the rate is not a passing run. *(Currently neither key exists — `en-index.json` has no
  `perFile` at all, so this measurement had to be taken by an out-of-band script, which is the
  R-MECH-8 shape and should not persist.)*
