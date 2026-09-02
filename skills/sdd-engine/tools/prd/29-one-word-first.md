# §5D.4D — One word per file, chosen over compression

*Decided by Amir, 2026-09-01. Both remaining blockers on R-ARCH-15 were relaxed on his instruction.
Byte-identity held throughout; every number below was measured on the Hydra corpus, not estimated.*

## 1. Headline

| | before | after |
|---|---|---|
| **one word per file (R-ARCH-15)** | 317 / 1037 — **30.6%** | **965 / 1037 — 93.1%** |
| byte-identity | 1037 / 1037 | **1037 / 1037** |
| **review surface (R-ARCH-16)** | 13,873 | **23,784** |
| collapse ratio | 59.1% | **29.9%** |
| generator spans | 4,787 | **1,135** |
| statements collapsed | 24,832 | 11,269 |
| model calls | 0 | 0 |

R-ARCH-15 went up by a factor of three. R-ARCH-16 went the other way by nearly the same factor.
That is not an accident of implementation — it is the trade itself, and §5 says exactly why.

## 2. Blocker 1: the units rule, narrowed (R-MINE-8-amended)

`enlzw.js:123` refused any span containing two or more *named units* (a function/class definition, or
a `const` whose initializer is one). It blocked 294 of 941 files from having a whole-file word.

**What the rule was actually for.** Its own comment answers this, and every word of the answer is
about the LABEL: *"its label reads as several unrelated things joined however well each clause
renders (e.g. 'define A, define B, define C' for three unrelated helpers)."* It was never about
correctness — the byte gate owns that — and never about the dictionary. It was about a span **whose
boundaries are arbitrary**: a miner-chosen window that swallows `alpha` and half of `beta` has no
referent anywhere in the code, so no honest name exists for it. Nothing to point at, nothing to call it.

**Why that argument does not reach a whole-run span.** A whole-run span's boundaries are not the
miner's at all. They are the enclosing construct's — the file, for a run of top-level statements, or
one function body, for a run inside a `Block`. The word denotes exactly one syntactic container. So
*"a word means one thing"* survives intact; the one thing is the **container**, not a definition
inside it. A file with three exported helpers is one thing: a module.

**The narrowing, therefore, is not a deletion.** The rule now binds **proper sub-spans only**, and
the whole-run exemption still rides on `wholeRunOk` (`chunkGloss`) — an exempt word must still be
sayable. Measured on real corpus source: **827 spans remain bound by the rule with 0 violations**,
and **309 whole-run spans exercise the exemption**, every one of which was refused before.

### What breaks — stated, not glossed

The thing the rule was standing guard over is now real and visible: a whole-file word over N
unrelated definitions glosses as a **list** — *"define `alpha`, then define `beta`, then define
`gamma`"* — which is a description, not a concept. That is a worse label than a concept, and it is
the honest cost.

It is not, however, a *new* problem: the instrument for it is a **name** (§5D.3D chunk naming,
`chunkKeyOf`/`chunkNameFor`), and the rule was only ever a stand-in for the naming layer not
existing yet. With the naming layer in place, `packages/hydra-internal/src/helpers.ts` — 33 units
under one word — is a file that wants exactly one name. Without it, that file reads as a 33-clause
list. **The narrowing moves this from "forbidden" to "unnamed", which is the residual work queue,
not a regression in kind.**

### One vacuity found and fixed (§10.3)

`engine/unit-boundary.test.js` asserted the invariant over a synthetic two-function fixture. Those
statements' symbols are **not in the mined dictionary** (`cat.narrow.leaf[key]` is `undefined` for
both), so `genSpans` returned **zero** spans and the `for (const sp of ...)` assertion iterated
nothing. It had been passing by having nothing to check — since before this change. The test is
rebuilt on real corpus source, publishes its own population counts, and carries a control proving
the exemption rides on `wholeRunOk` rather than on `isUnit` being ignored.

## 3. Blocker 2: the scheduler objective (R-ARCH-22)

`genSpans` picked the maximum-weight non-overlapping set of candidate words, `weight = w.len - 1`
(statements removed). Under that objective **k nested words covering the same bytes score `n - k`
against a single whole-file word's `n - 1`** — so the scheduler structurally *prefers fragments*.
306 of 941 files had a whole-file word available, passed every gate, and did not take it.

Weight maximisation was never the goal. It was a **proxy** for "least left to read", and it is the
wrong proxy: one word is less to read than three, whatever the arithmetic says. So the ordering is
now stated rather than implied, as **R-ARCH-22: R-ARCH-15 outranks R-ARCH-16.**

Implemented **lexicographically**, not as a tuned bonus: if a candidate covers the file's entire
top-level statement range, it is returned directly and the DP never runs; otherwise the weighted
scheduler decides, with **no weight adjusted**. The fallback objective is bit-for-bit unchanged.
`ONE_WORD_FIRST=0` restores the pure weight objective for measurement — that is how the cost below
was quantified, and it is the row's proof that it binds: **30.6% off, 93.1% on.**

## 4. Guardrail check

| guardrail | result |
|---|---|
| byte-identity broken for any file | **No — 1037/1037, unchanged** |
| words that no longer mean anything coherent | **Partly — see §2 "what breaks". Reported, not hidden.** |
| unanticipated cost | **See §5. Anticipated in kind, not in magnitude.** |

## 5. The cost, and exactly where it comes from

Review surface nearly doubled. This is not incidental, and it is worth being precise about, because
the mechanism is more interesting than the number.

Take `src/xero-api/invoice.ts`, measured both ways:

    ONE_WORD_FIRST=1 ->  1 span,  76 statements  (bytes 0..49,376 of 49,377)
    ONE_WORD_FIRST=0 -> 68 spans, 365 statements

The one whole-file word covers the file's **76 top-level statements**. The 68 nested words live
**inside those statements' bodies** — that is, inside the whole word's **holes**, which R-MINE-9
keeps as verbatim TypeScript. Under a flat, non-overlapping span model the two sets are **mutually
exclusive by construction**: every nested span overlaps the whole-file span's byte range, so
choosing one forfeits the other entirely.

So the file is now "one word" **with a large verbatim hole inside it** — 410 of its 486 body
statements still read as code. That is a real qualification on the 93.1%, and it should be read as
such: *93.1% of files have a single top-level word*, not *93.1% of the corpus has become English*.

**The way to have both is not a better objective — it is nested rendering.** A word's holes would
have to render as English in their own right, recursively, so the whole-file word and the words
inside its bodies coexist at different depths instead of competing for the same byte range. That is
R-ARCH-15's own *"words made of words down to leaves ... editable at every level"* applied to holes,
and it does not exist today. **It is now the single highest-value piece of engine work outstanding**,
and it would recover the collapse ratio without giving back one point of the one-word rate.

## 6. What was not changed

- **Weights.** No candidate's weight was touched. The priority is a separate, earlier decision.
- **Admissibility.** Every emitted span passes the identical `wp.fill === source.slice(...)` gate.
  Both changes only *admit* or *rank* candidates, so byte-identity is preserved by construction —
  which is why 1037/1037 was the expected result, and it was.
- **R-ARCH-16 as the headline metric.** R-ARCH-22 orders the two requirements; it does not retire
  the measurement. Review surface is still reported per file and per corpus, and it is now worse.
  Recording that plainly is the point of R-MECH-8.

## 7. Downstream figure now stale

R-LANG-22's naming target was measured against the render's span set of 4,787. That set is now
**1,135**, so the *used-word* half of the 5,861 target must be re-measured; the leaf half is
unaffected. It is retained as-is and flagged, rather than re-derived by guess.
