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
if-block productions arrive as 1,809 new payload marks, and the net reads **−2,215, about −1.3% of
the headline**.

**That headline understates the change, and the reason must not be lost:**

> As **raw prose bytes**, that scaffolding is addressable by **nothing** — no mechanism in the engine
> can reach it. As **typed payload holes**, it becomes addressable by exactly the hole-encoding
> machinery tier 1 just proved out. It is a transfer from an **unfixable column into a fixable one.**

The visible half of the transfer is the 1,809 payload marks and +14 call-parens; the invisible half
is 3,618 braces that stop existing. A reader looking only at the net will conclude the spike failed
when it succeeded.

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
