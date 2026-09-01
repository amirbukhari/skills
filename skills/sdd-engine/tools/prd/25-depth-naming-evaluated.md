# §5D.3E DEPTH-BOUNDED NAMING — evaluated against the live dictionary

*[index](README.md) · Amir's proposal, 2026-09-01: instead of a frequency threshold (`MIN_COUNT`),
**name every word at depth 1–8 regardless of occurrence count, and leave depth 9+ unnamed**, on the
grounds that a deep word is a composition of its shallower named parts (R-ARCH-15). Plus his
follow-up: **naming must proceed bottom-up in dependency order.** Every number below is measured on
the live catalog and a full render — none is an estimate.*

## 1. The measurements

**The dictionary is much larger than the part of it that is used.** Wide axis: 115,661 entries
(3,238 leaves, 112,423 composites, maxDepth 63). Narrow axis: 126,167.

| depth | distinct words, wide axis | cumulative % of the dictionary |
|---|---|---|
| d=0 (leaf) | 3,238 | 2.8% |
| d=1 | 6,835 | 8.7% |
| d=2 | 8,888 | 16.4% |
| d=3 | 9,093 | 24.3% |
| d=4 | 8,512 | 31.6% |
| d=5 | 7,711 | 38.3% |
| d=6 | 6,876 | 44.2% |
| d=7 | 6,111 | 49.5% |
| d=8 | 5,413 | 54.2% |
| **d=1–8 total** | **59,439** | |
| d≥9 | 52,984 | |

**But a full render emits only 3,921 spans drawn from 3,237 distinct words.** So "name all of depth
1–8" read against the *dictionary* means **59,439 names — roughly 18× more than naming every word the
corpus actually uses.** Read against the **used** set, which is the only sensible reading, it is 2,789
names. That distinction is the single most important number here.

| strategy | names needed | statements covered (of 21,323 in spans) | share |
|---|---|---|---|
| **today — name every used word (`MIN_COUNT=1`)** | **3,237** | **21,323** | **100%** |
| **Amir: depth 1–8 only** | **2,789** | **14,559** | **68.3%** |
| `count>=2` only (`MIN_COUNT=2` on naming) | 327 | 3,380 | 15.9% |
| **depth<=8 OR count>=2** | **2,793** | **14,695** | **68.9%** |
| depth<=4 only | 1,998 | 8,576 | 40.2% |

**So depth-bounding buys a 14% reduction in names (3,237 → 2,789) at the cost of 31.7% of covered
statements.** The 448 unnamed deep words carry 6,764 statements — 6.6% of the words, 32% of the
content, because a deep word is by definition a long one.

## 2. It does NOT solve the "87% used once" problem

**It barely moves it.** Of the 2,789 used words at depth 1–8, **2,466 (88.4%) occur exactly once** —
against 87% corpus-wide. Depth *does* correlate with frequency, but in the direction that defeats the
proposal: the once-only share **rises** with depth.

| depth | words used | sites | used exactly once |
|---|---|---|---|
| d=1 | 511 | 819 | 405 (79%) |
| d=2 | 570 | 748 | 479 (84%) |
| d=3 | 514 | 591 | 467 (91%) |
| d=4 | 403 | 466 | 362 (90%) |
| d=5 | 290 | 324 | 268 (92%) |
| d=6 | 224 | 239 | 212 (95%) |
| d=7 | 161 | 163 | 159 (99%) |
| d=8 | 116 | 118 | 114 (98%) |
| **d≥9** | **448** | **453** | **444 (99.1%)** |

**Depth is not a frequency filter.** Cutting at 8 removes the *most* once-only tier and keeps a tier
that is 88% once-only, so the naming cost per unit of coverage gets **worse**, not better:
0.152 names/statement today → 0.192 under depth 1–8.

**And the OR combination is a measured no-op.** `depth<=8 OR count>=2` needs **2,793** names against
2,789 for depth alone — **four words**, because 99.1% of deep words occur exactly once, so almost no
deep word qualifies on count. There is nothing to combine.

## 3. "Deep words compose from named shallower words" — true, but weaker than it sounds, and it has a hole

**Verified structurally, across the whole dictionary: 0 violations on both axes.** Every composite is
`m: [prefix, appended]` where **`appended` is always exactly one leaf**. The dictionary is a set of
strictly left-leaning **chains**, not balanced trees — which is the LZW invariant (*every entry is a
prior entry plus one symbol*) read literally.

**Consequence: a deep word does not decompose into several named shallower words. It decomposes into
ONE named prefix plus a tail of bare leaves.** Measured on the 448 used words at d≥9:

- **448/448** prefix chains terminate at an entry with **d≤8** — so the named prefix always exists ✓
- the leaf tail averages **5.9 statements, maximum 54**, totalling **2,659** leftover statements
- **2,659 of 2,659** appended halves are leaves — **zero** non-leaf branches

So a d=20 word renders as *one* 8-statement name followed by **twelve individual leaf clauses**. That
is close to per-statement rendering, not a composition of names.

**The hole: leaves are d=0, outside the 1–8 range.** The used words are built from **2,619 distinct
leaf skeletons**, and *every* chain bottoms out there — a d=1 word is literally `[leaf, leaf]`.
Naming "1 through 8" therefore leaves the base of every chain unnamed, and the tail of every deep
word unnamed with it. **d=0 cannot be excluded; it is the foundation, not an edge case.**

## 4. ORDERING — Amir is right, and the current producer does the opposite

He asked whether naming proceeds bottom-up in dependency order. **It does not, and the one producer
that exists actively reverses it.**

- **`name-words-lzw.js:89`** — the only naming producer — sorts rows
  `(b.count - a.count) || (b.depth - a.depth)`: occurrence descending, then **depth DESCENDING**.
  Deepest first, which is exactly backwards.
- **It enumerates only TOP-LEVEL emitted words.** A deep word's components never receive a worksheet
  row at all, so they could not be named first even if someone wanted to.
- **Render-time lookup is order-free** and cannot compensate: `chunkNameFor` → `clausesFor` →
  `genLabel` are hash-keyed fallbacks with no notion of dependency.

**And the ordering requirement is stronger than a preference — the data structure forces it.** Because
every composite is prefix + one leaf, the dependency relation is a **total order along each chain**:
naming d=k requires d=k−1, which requires d=k−2, … down to **d=0**. There is no branching to
parallelise and no way to skip a tier. Bottom-up is not a good practice here; it is the only order in
which a name can be grounded in already-named parts.

**R-LANG-20** is added for this.

## 5. Recommendation

**Depth-bounded naming is the wrong shape for a coverage rule and the right shape for a WORK ORDER.**

1. **Do not adopt depth 1–8 as a naming boundary.** Measured: 14% fewer names for 31.7% less
   coverage, with cost-per-statement getting worse (0.152 → 0.192). It does not address the once-only
   problem (88.4% vs 87%).
2. **Do not adopt `depth<=8 OR count>=2`.** Measured to add exactly four words.
3. **Do adopt depth as the ORDER, ascending, starting at d=0.** Name leaves first, then d=1, then
   d=2 … Use `count` only to prioritise *within* a depth tier — depth decides *when* a word can be
   named at all, count decides *which first*. This is the correction to `name-words-lzw.js:89`.
4. **A ceiling then becomes a stopping point you may choose at any time, not a rule.** Stop after any
   tier k and every deeper word still renders as one name plus a tail of leaf clauses — which is
   precisely why **the leaves must be named regardless of where you stop.**
5. **The coherent target is leaves + shallow words: 2,619 + 2,789 = 5,408 names.** At that point
   *every* used word is either named directly (d≤8) or expressible as a named prefix plus **named**
   leaves (d≥9) — full grounding, guaranteed by the 0-violations result. That is **more** names than
   today's 3,237, and it is the honest price of R-ARCH-15's "words made of words down to leaves".
6. **`MIN_COUNT` stays a MINING parameter, not a naming one.** The naming path does not need a
   frequency threshold at all — count is a priority, not a gate. This narrows Q-9's open question
   rather than answering it: what remains is only *how far up* to go, and that is a budget decision.

## 6. THE NAMING TARGET, recorded

**Decided material, not a proposal.** The coherent bottom-up target is:

| | names |
|---|---|
| leaf skeletons the used words are built from (d=0) | **2,619** |
| used words at d=1–8 | **2,789** |
| **total naming target** | **5,408** |
| *today, for comparison (every used word, `MIN_COUNT=1`)* | *3,237* |

**This is MORE names than today, not fewer — 5,408 against 3,237 — and that is the honest cost of
R-ARCH-15's "words made of words down to leaves."** It is recorded here explicitly so the target is
never mistaken for a saving. What it buys is **completeness**: at 5,408 every used word is either

- named directly (d≤8), or
- expressible as a **named** d≤8 prefix plus a tail of **named** leaves (d≥9),

which is guaranteed, not hoped for, by the 0-violations result in §3 — every composite is prefix +
exactly one leaf, so there is no third case. The 448 deep words need no names of their own.

**R-LANG-22** records this.

## 7. Provenance — how to reproduce every number above

So a future reader can trace these rather than trust them. All were produced 2026-09-01 against the
catalog at `<corpus>/sen/catalog/generators-lzw.json` and a full in-process render of the 943
mineable `.ts` files; **zero model calls**; the corpus was not written to.

| number | how it was obtained |
|---|---|
| 115,661 / 126,167 entries; 3,238 / 5,684 leaves; per-depth counts; maxDepth 63 | direct walk of `cat.wide.words` / `cat.narrow.words` via `enfile.loadIndex(corpusRoot())._lzw`, bucketing by `w.d` (`w.len === 1` ⇒ d=0) |
| **0 violations** of "appended half is a leaf" | same walk: for every composite, `words[w.m[1]].len === 1`. 112,423 wide + 120,483 narrow composites, zero exceptions |
| 3,921 spans, 3,237 distinct used words, 21,323 in-span statements | `enlzw.genSpans(sf, src, cat, { wholeRunOk })` over every mineable file, keyed by `payload.a + ":" + payload.w`, statements counted as `sites × w.len` |
| per-depth used words / sites / once-only (79% → 99.1%) | the same used-word map, bucketed by `w.d`; "once" is `sites === 1` |
| strategy table (68.3% / 15.9% / 68.9% / 40.2%) | filters over that map: `d 1..8`, `n >= 2`, the OR, and `d 1..4` |
| leaf tail: 448/448 terminate at d≤8, mean 5.9, max 54, 2,659 total | for each used word with `d ≥ 9`, walk `m[0]` while `d > 8`, counting steps; every step's `m[1]` checked for `len === 1` |
| **2,619** distinct leaf skeletons | `word-names.leavesOf(axis, id)` over every used word, de-duplicated per axis |
| review surface 13,874 / S=33,918; one-word 316/1037 | published by the producer in `<corpus>/.cache/spec-derived/en-index.json` → `reviewSurface` (§5D.4A, R-MEAS-6) |

## 8. Requirements

- **R-LANG-20** — Names **MUST** be assigned in **ascending depth order**, leaves (d=0) first, and a
  word **MUST NOT** be named before every word in its `m` chain is named. Check: the naming producer
  emits rows sorted by depth ascending and enumerates a word's components, not only top-level emitted
  words; `count` may order rows *within* a depth tier and nothing else. Rationale: every composite is
  prefix + one leaf (0 violations measured across 115,661 wide / 126,167 narrow entries), so the
  dependency relation is a total order and an ungrounded name is unavoidable in any other order.
  *`name-words-lzw.js:89` currently sorts depth **descending** — this requirement is FAILING as
  written.*
- **R-LANG-21** — Leaf skeletons (d=0) **MUST** be inside whatever naming scope is chosen. Check: no
  naming scope excludes d=0. Rationale: every chain bottoms out at a leaf, and the tail of every
  deep word is leaves (2,659 of 2,659 appended halves measured); a scope that skips d=0 leaves the
  base of every word unnamed.
