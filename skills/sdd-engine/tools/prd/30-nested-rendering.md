# §5D.4E — Nested rendering: words made of words, to leaves

*Amir, 2026-09-01: build nested rendering so a whole-file word and the words inside it coexist
instead of competing. Full recursion to leaves, no depth cap — "capping at 2 levels just recreates
the same 'some code stays raw' problem one level in." Byte-identity held throughout.*

## 1. Headline

| | flat (§5D.4D) | nested | vs. before R-ARCH-22 |
|---|---|---|---|
| byte-identity | 1037/1037 | **1037/1037** | 1037/1037 |
| **one word per file (R-ARCH-15)** | 965 — 93.1% | **1003 — 96.7%** | 317 — 30.6% |
| **review surface, top level** | 23,784 | **1,610** | 13,873 |
| review surface, whole tree | 23,784 | 29,260 | 13,873 |
| statements with no English at all | 22,592 | **546** | 9,086 |
| english coverage (bytes) | 98.6% | **100%** | 98.6% |
| files fully accounted for by words | 226 | **890** | 226 |
| max composition depth, live path | 76 | 14 (nesting) / 76 (dictionary) | 76 |
| `.en` size vs `.ts` | +19% | **+74%** | +19% |
| render + gate, whole corpus | 22.9 s | **5.0 s** | 22.9 s |
| model calls | 0 | **0** | 0 |

## 2. What a chunk is now

    ATOMIC      «▶ gloss ⟪payload⟫»       a word whose statements have no inner blocks. Its
                                          skeleton stays in the catalog; only holes are emitted.
                                          This is where compression happens — unchanged, but now
                                          the FRONTIER of the recursion rather than the whole of it.

    STRUCTURAL  «▷ gloss ⟨ children ⟩»    a word whose statements DO contain inner runs. It carries
                                          NO payload. It is a name over children, and it compiles
                                          by concatenating them.

A file's top-level run becomes a chunk; each statement in it becomes a chunk inside that; each
inner block's runs become chunks inside those; and so on to straight-line statements. Measured on
the corpus: **19,102 atomic + 9,612 structural chunks, deepest nest 14.**

Parent and child no longer compete because they are at different depths. That is the whole fix:
§5D.4D §5 showed the two sets were mutually exclusive *under a flat span model*, and the flat span
model was the assumption worth dropping — not the objective.

**Why ▷ and not a delimiter search.** `payload.js:34` emits `⟨` RAW as its hole marker, so "does
this chunk contain ⟨" calls every atomic chunk structural. One character at a fixed position tells
the two shapes apart with no scanning at all.

## 3. Byte-identity, by induction rather than by assertion

An atomic chunk passes the same `wp.fill === source.slice(...)` gate every span has always passed.
A structural chunk reconstructs its range **if and only if its children do**, since it emits its
own bytes plus its children and nothing else. The induction bottoms out at atomic chunks and
verbatim text, both byte-exact. So the tree is byte-exact — and it measured that way, 1037/1037,
first try and after every subsequent fix.

`compileFileEn` had to learn to match `»` **by depth**. It previously took the first one, which
inside a structural chunk belongs to a child. `engine/nested-rendering.test.js` case 3 shows the
difference is real rather than theoretical: on `csvUtils.ts` the first `»` and the matched `»` are
**2,142 bytes apart**.

## 4. The costs, measured

**`.en` is now +74% of `.ts`, up from +19%.** A structural chunk emits the bytes it owns — a
function's signature, a class's members, an `if`'s condition. Those bytes used to sit inside a
catalog skeleton and are now in the `.en`, verbatim. This is the honest price of a drillable tree,
and it is the one number that got materially worse. It is also the *legible* half of the file: what
a reader sees between the sentences is the structure, not the body.

**Reading the tree exhaustively is 29,260 units, up from 23,784.** A tree does not have one answer
to "how many things must you read", and publishing only the flattering half would be exactly what
R-MECH-8 forbids. Both are published, always, side by side (R-MEAS-10):

- **top level — 1,610.** What the corpus costs to understand at a glance: one sentence per file for
  1,003 of 1,037 files. This is the number R-ARCH-16 is about, and it is **8.6x better than the
  13,873 that stood before any of this work**, not merely a recovery of the §5D.4D regression.
- **whole tree — 29,260.** The ceiling if someone read every node. Still fewer units than the
  33,918 raw statements it replaces, and every one of them is a sentence rather than code.

**Render got faster, not slower: 22.9 s → 5.0 s** for render + the byte gate over 1,037 files. The
nested renderer asks a local question ("is there one word for exactly this run") instead of building
and scheduling every overlapping candidate in the file. No cap was needed at any point.

## 5. Two regressions the first cut shipped with, both found by tests

**The leaf layers stopped running.** The nested path returned before passes 1 and 2, so
`@Column({ name: 'account_id', … })` no longer rendered as *"an object with …"* — the region was
inside a structural chunk's own bytes and nothing reached it. Fixed by routing every verbatim
emission through `renderVerbatim`, which renders any cnl or data span falling wholly inside it.
The candidates are computed **once per file** rather than per region: the obvious implementation
re-walks the AST for every verbatim range, which is O(nodes x ranges) and there are thousands of
ranges in a deep file. Corpus after the fix: **95 cnl statement spans + 1,128 data spans**, and
english coverage reached **100%**.

**The chunk's sentence had two definitions.** The renderer labelled chunks with
`namedLabel || chunkGloss || spanProse || genLabel`; `deriveGloss` — R-REND-6's check that the
written sentence matches its payload — recomputes `namedLabel || genLabel`. Any chunk labelled by
the middle two failed its own check at compile time. Measured on the real corpus: *"await find one
or fail into `payment`"* written against *"await await into `payment`"* derived. **A renderer and
its checker computing the same thing two ways is the producer/consumer drift shape (§8B) with
R-REND-6 as the consumer**, so the renderer now calls exactly what the checker calls, in the same
order. `chunkGloss` keeps its real job: the admissibility gate in `genSpans`.

## 6. What did not change

- The mined dictionary. Not re-mined; `generators-lzw.json` is byte-identical to `216f928`'s.
- The byte gate, in form or in strictness.
- R-ARCH-22. One-word-per-file still outranks compression; nesting is what makes the ordering
  cheap rather than a trade. `ONE_WORD_FIRST=0` and `NEST=0` both still restore the older
  behaviours for measurement, and both are exercised by tests.
- Zero model calls, at every level of the tree.
