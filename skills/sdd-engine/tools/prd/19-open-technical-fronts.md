# 6. Open technical fronts

*PART VI — WHAT IS NOT DECIDED · [index](README.md)*

**These are work items, not questions.** A front is something to build; §Q is something to decide.

**Fronts 0 and 4 are RETIRED — closed by measurement on 2026-08-31, see §Q-2.** Both were framed
around replacing a flat anti-unification layer that is not what the live path runs. Their text is
kept below, struck through, because "the core front" was cited across this document and a reader
who remembers it is owed the reason it is gone rather than a silent absence.

~~**0. THE CORE FRONT — replace flat anti-unification with LZW dictionary construction.**~~
**RETIRED — the replacement already happened.** Measured: the live `.en` path loads only
`generators-lzw.json` and composes with byte-identity held. **Real corpus, 2026-08-31 (§Q-8):
5,731 spans, all recursive, zero flat fallbacks, live composition depth 62, 1,037/1,037
byte-identical.** *(The 20 spans / depth 3 previously cited here were the synthetic fixture from
§Q-2 — right conclusion, ~20× off in magnitude.)* Nothing live reads `generators.json`; the four remaining mentions of
it in the tree are prose. The four requirements this front carried are **not** retired with it —
they are R-MECH-1, R-MECH-7, R-COMP-1..3 and the compression goal in R-MEAS-6, and they hold as
standing requirements rather than as work to schedule.

What survives as actual work is narrower and lives in **§Q-8**: how much of the *real* corpus
renders through depth ≥ 2, which needs one real mine.

1. **Finish the member/ctor-generalized procedure layer (specified in §5A).** The additive widened axis has begun landing (5,623 statements collapsed); the remaining work is to promote the rest of the WIDE-axis recurring bodies. The `type`-name hole is admitted only when the type is not load-bearing for refill — concretely, when replacing it with a `‹type›` hole still yields a byte-exact `fillOf` at every site (the same gate as every other hole), never on a subjective judgement. Hard constraint unchanged: every widened generator must **refill byte-exact** at every site.
2. **The language front: per-site productions in `spanProse` (§5C), scored by §7.** This is where the remaining readability lives. It replaced an earlier front that chased a file-count metric toward a ceiling nobody had measured, by routes that all amounted to *punch more holes until things match* — the §4A defect. A readability number bought that way is not readability.
3. **Whole-repo statement reduction, not per-file coverage.** Cross-file repetition carries the leverage (composites built from composites, at depth). Drive down `netStatementReduction`-eligible residue across the whole corpus (the §7 metric), not a per-file average.
4. ~~**Close the composition gap — point `.en` compilation at the composing layer.**~~ **RETIRED.**
   The premise — *"the capability already exists on the abandoned path and is being lost"* — measured
   false. `enfile.js` already compiles through generators-calling-generators: `generators.maxDepth`
   on the live path is **62**, not 0 or 1 (§Q-8; the fixture in §Q-2 showed 3). The success criterion this front named,
   `generators.maxDepth ≥ 2`, is met and is now a standing gate (R-COMP-7) rather than a target.
   Its one genuine residue — the manifest did not expose the field the gate reads — is fixed.
5. **Measurement discipline.** Keep the measure-first scripts as the source of truth; refresh the stale `gate.json` snapshot so the gate reflects the current library. **Corrected 2026-08-31 — the list here named three scripts that do not exist** (`measure-bytes.js`, `measure-middle-tier.js`, `measure-windows.js`; not on disk, not even archived), which is the failure mode §7's measurement discipline is meant to prevent: a "source of truth" nobody had run. What actually exists and is live: `measure-uncollapsed.js` (the frozen §7.3 classifier), `measure-operations.js`, `measure-callgraph.js`, `measure-english.js`, `measure-logic-english.js`, `measure-bespoke-composites.js`, and `write-en-files.js --dry-run` for the manifest. The WIDE canon is `engine/generators.js generalStmtParts(st, sf, wide)`, not a measure script.

## FRONT: TYPESCRIPT ON THE READING SURFACE — SIZED, AND HALF OF IT SPENT (2026-09-03)

The front opened when Amir read `sen/files/src/routers/links.ts.en` and said *"You lied to me."* He
was right: the reported metrics — review surface 1,086/20,214, MUTE 2,362, byte-identity 1037/1037 —
were all true and the picture they painted was false. The file still read as TypeScript with
narration wrapped around it. `engine/the-goal.test.js` exists so that no metric can stand in for the
goal again, and it reports **surviving TypeScript constructs after a frozen strip**, corpus-wide,
detected by punctuation and never by keyword (the dialect legitimately contains the words
`import`/`return`/`if`/`await`).

### THE SIZING ANSWER: BOUNDED, NOT A PAYLOAD REDESIGN — AND "BOUNDED" IS NOT "CLOSE"

Asked whether removing the payload-borne TypeScript was bounded engineering or a format redesign.
It is **bounded**, and the evidence is mechanical rather than architectural:

**A hole's type is already recoverable at both ends.** `expandKey(axis, w)` yields the template and
its `‹type›` markers pair positionally with the payload's `h` array — measured **150,313 of 150,313
holes, 0 unknown word ids, 0 arity mismatches**. So the payload **format does not change at all**:
same tag, same axis, same word id, same hole introducer. Only each hole's *text encoding* moves,
per rule, gated by a byte-exact inversion with per-hole fallback to raw. That is the `dataByteExact`
construction one level down — worst case no improvement, **never a wrong byte**.

Nothing new needs inventing. The existing hole mechanism needs lifting.

**But the work splits into two tiers of very different size**, and reporting them as one number is
how "bounded" becomes "nearly done":

| tier | hole types | constructs | status |
|---|---|---|---|
| 1 | `str`, `obj`, `arr` | 36,062 (38.7% of inside) | **spent.** `data-english.js` already renders and compiles these |
| 2 | `args`, `expr`, `chain`, `fn` | 55,856 (59%) | **open.** No English exists for these today |

Tier 1 landed at −26,182 (−18.9%), taking the headline **138,387 → 112,205**. Tier 2 is the
remainder and it is not a plumbing exercise: `jest.mock('@src/…', () => ({…}))` and
`qb.select([…]).innerJoinAndSelect(…)` are *a call's argument list with an arrow or a chain inside
it* — the same **"complete node minus the extents its children cover"** shape the interior-production
work identified at structural headings, occurring inside a payload hole. The two are one problem seen
from two ends.

**The honest sentence:** bounded, nothing new needs inventing, and tier 1 was ~26% of the headline.
Dirty files went **1035 → 1035**. Not one file comes clean, and there is still no existence proof
that one can.

### THE PRICE OF THE INTERIOR-PRODUCTION WIN IS PAID IN THE WRONG COLUMN

Moving structural scaffolding off the prose surface and into a `«▷ heading ⟪payload⟫ ⟨children⟩»`
production makes the goal number look almost flat: `payload-spill` fires on any `⟪lzw`, so 1,809
if-block productions arrive as 1,809 new payload marks, and the net reads ~~**−2,215, about −1.3% of
the headline**~~ **+1,403 — the wrong sign; see the refutation below.**

**That headline understates the change, and the reason must not be lost:**

> As **raw prose bytes**, that scaffolding is addressable by **nothing** — no mechanism in the engine
> can reach it. As **typed payload holes**, it becomes addressable by exactly the hole-encoding
> machinery tier 1 just proved out. It is a transfer from an **unfixable column into a fixable one.**

~~The visible half of the transfer is the 1,809 payload marks and +14 call-parens; the invisible half
is 3,618 braces that stop existing. A reader looking only at the net will conclude the spike failed
when it succeeded.~~

**REFUTED IN PLACE, 2026-09-03, per §9. The struck paragraph is the most confidently wrong thing
either lane wrote that night, and it reads as the most careful one, because it anticipates a
misreading and corrects it in advance. Pre-empting an objection is not evidence of being right
about it.** Those 3,618 braces (2 per site × 1,809) **do not stop existing** — they are the body
hole's text, and hole text is on the page. So the paragraph warns a reader against concluding the
spike failed *at a point where the spike does in fact lose*: the net is **+1,403**, not −2,215.

This site is also where **"a correction is a new projection"** (§16) gets its sharpest evidence.
This section was written **after** the −1,795 → −2,215 correction. It spent the corrected number as
though it were measured, built an argument on top of it, and then pre-empted a reader's doubt about
it. The correction did not merely carry unearned trust — **it accrued more, three times over, and
each relay added confidence instead of a check.**

**THE QUALITATIVE HALF SURVIVES, AND IT IS THE PART WORTH KEEPING.** The block quote above is still
true, and the measurement is what makes it true rather than rhetorical: the braces land in a
`‹body›` **hole**, and a hole is exactly what the tier-1 rule table can reach. What dies is *"stop
existing"* and *"−2,215"*; what lives is *"become addressable"*. **The honest version is a transfer
at par — +1,403 with the payload mark counted — justified by reachability rather than by any
immediate reduction.** That is a weaker claim and a real one.

**AND THE REACHABILITY CLAIM WAS THEN TESTED, BECAUSE "ADDRESSABLE" IS NOT "ENCODABLE".** The one
route to the braces leaving the page without a canon change is for the rule table to encode the
residual wrapper a wired `compileChild` would leave behind. Measured:

| | |
|---|---|
| `{}` encodable by the rule table | **yes** — `⟦an empty object⟧`, exact round-trip, 2 constructs → 0 |
| simple if-blocks with a non-empty body | 1,822 |
| distinct residual wrappers at those sites | 24 |
| residual **encodable** | **0 of 1,822** |

**`{}` encodes; `{}` never occurs.** Real source writes `{\n    \n  }` — brace, newline, indent,
newline, brace — in 24 indentation variants, and encoding those as "an empty object" would emit
wrong bytes, so the byte-exactness gate refuses them. **Correctly**: the refusal is the contract
working, not a gap to widen. To encode the whitespace the English must carry it, which puts the
braces back on the page or ends byte-identity.

So the braces have exactly two possible homes — **skeleton (off-page) or hole text (on-page)** — and
recursion relocates the dilemma rather than resolving it, because a child chunk's own braces arrive
at the same fork. Of **244,795** dictionary words across both axes, 232 wrap a hole in braces;
`if=0 · for=0 · while=0 · arrow=0 · function=0`, and the wrapped hole is `gap` in **232/232**
(`import` 191 · `class` 22 · `type` 10 · `export` 7 · `interface` 2 — empty-bodied declarations;
`interface X { }` is a word because the body *is* whitespace). **No word in either axis wraps a
content hole in braces.** Putting them there means the canon spelling a block as `{‹child›}` rather
than `‹body›` — a canon change, so the fingerprint moves and every catalog re-mines.

**RULING (2026-09-03): under the current canon, closed. The interior production is landed-but-unused
and nothing is wired through it.** Stated as *"under the current canon"* and **not** *"by
construction"* — the same qualification this front insisted on for the arrow row, now applying to
its own. `interior-production.test.js` asserts the price is not a reduction and **fires if the
braces ever do leave the page**, so the door is held open in code rather than in memory.

**This is recorded here rather than left to the number because the number structurally cannot say
it** — which is §16 class 7, and the reason the goal test's total is kept as the headline anyway:
re-classifying payload text as non-page would lower the number by redefining the page instead of
cleaning it, and that is the cheat the goal test was written to forbid. The split (inside/outside)
stays published *beneath* the total so the work can be aimed, and the inside term is **never**
published alone as "the" number.

### WHAT DID NOT MOVE, AND WHY THAT IS THE MAP OF TIER 2

After tier 1, the buckets that did not budge by a single construct are the whole of the remaining
problem: `call-paren` 19,751 · `arrow-fn` 8,369 · `semicolon` 5,026 · `template-interp` 4,212, plus
38,783 braces that are **block bodies rather than object literals**. Every one of them sits in an
`args`/`expr`/`chain`/`fn` hole.

The cheap discriminator for what is reachable is **`body=skel`** — whether the existing skeleton
already reaches inside the construct. A hole type reading `0/N` is one the canon treats as a single
opaque blob, and the only thing that moves it is decomposition *inside* the hole. Recorded with the
qualification §16 requires: `0/N` is a fact about **the current canon**, not about the construct.

### CORRECTED: TIER 2 IS NOT "NO MACHINERY EXISTS". THE CANON ALREADY REACHES INTO 91% OF IT

Tier 2 was described above, and reported to Amir, as having *"no English today"*. **That was wrong.**
Measured by running the WIDE canon (`generalStmtParts(st, sf, true)`) over every payload hole's raw
text and asking whether it yields a skeleton with *both* literals and holes — i.e. whether the canon
decomposes the content or treats it as one atom:

| hole type | holes | constructs | canon reaches in | one atom | unparseable |
|---|---|---|---|---|---|
| `args` | 10651 | 22328 | 7122 / **22168** | 8 / 16 | 20 / 144 |
| `expr` | 2993 | 20035 | 2721 / **19950** | 4 / 85 | 0 |
| `obj` | 2031 | 17291 | 1961 / **17151** | 70 / 140 | 0 |
| `str` | 7906 | 10248 | 7898 / **10248** | 0 | 0 |
| `arr` | 637 | 8523 | 637 / **8523** | 0 | 0 |
| **`chain`** | 1864 | 7162 | **0 / 0** | 0 | **1864 / 7162** |
| `fn` | 606 | 5169 | 606 / **5169** | 0 | 0 |
| `bind` | 732 | 1540 | 732 / 1540 | 0 | 0 |
| `type` | 1436 | 783 | 78 / 225 | 0 | 252 / 558 |
| `body` | 34 | 133 | 26 / 125 | 6 / 6 | 2 / 2 |
| `gap` | 81390 | 87 | 0 | 0 | 21 / 87 |
| **TOTAL** | 110280 | 93299 | 21781 / **85099** | 88 / 247 | 2159 / 7953 |

**So the missing piece is not a mechanism and not a canon change — it is RECURSION**: applying the
existing hole mechanism to hole *content*, i.e. a nested payload inside a hole. That is the same
conclusion the interior-production work reached for structural headings, arriving one level down. The
sentence covers both lanes' remaining work: *nothing new needs inventing; the existing hole mechanism
needs lifting.*

**THIS TABLE IS AN UPPER BOUND, NOT A FORECAST.** "The canon yields parts with holes" is *necessary
and not sufficient*. It does not say a dictionary word exists for that content, does not say a word
would refill byte-exact, and does not say the result would read as English. The if-block spike
verified all three; this verifies one. 85,099 is the ceiling on what decomposition could reach and
the measured figure will be lower — on this session's evidence, lower by a lot rather than a little.
Recorded this way because publishing it as a forecast is the exact failure this section exists for.

**Counted in decoded RAW hole text, not on the stripped page.** The subject is "can the canon
decompose this source?", so 93,299 here is *not* comparable to the 76,704 inside-payload page figure.
Two populations; summing them is what produced the 93,162 error above.

### `fn` READS 606/606 HERE AND 0/1524 THERE, AND BOTH ARE RIGHT

The two measurements ask different questions and the shared name is a live class-6 risk:

- `body=skel` **0/1524** — can the canon reach inside an *arrow statement*? **No.** The entire
  signature (`(`, `)`, `:`, `=>`, `[`, `]`, `{`, `}`) is one `fn` hole.
- canon-reach **606/606** — can the canon decompose the *text inside that hole* once it is handed
  over? **Yes.**

That is the seam stated numerically: **one lane cannot open the hole, the other can decompose what is
in it, and neither finishes alone.** Either figure quoted without its question attached is wrong.

### `chain` IS THE ONE ROW THAT IS ARCHITECTURE RATHER THAN PLUMBING

1,864 holes, 7,162 constructs, and **0 the canon can even parse** — not "will not decompose",
*cannot parse*. A `chain` hole is a fragment beginning with a dot:

```
"\n    .select([\n      'creditNote.id',\n      'creditNote.noteNumber',\n …"
```

It is neither a statement nor an expression without a receiver. Every other row on the board is a
parse away from decomposition; this one needs a receiver synthesised, or the hole re-cut at mine
time. 7.7% of the inside term, and the only row that is not reachable by lifting the existing
mechanism.
