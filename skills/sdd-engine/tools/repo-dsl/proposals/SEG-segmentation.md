# Proposal: meaning-aware span boundaries (unit-boundary constraint)

**Status:** investigation + proposal (nothing shipped, scheduler untouched). Follow-on to the Tier-1
prose work. North star (Amir): a composed `.en` span should read as *one thing*. Tier-1 made the
prose good; it cannot fix a span that merges *unrelated* code, because the span boundary is chosen
by **compression**, not **meaning** — however well we render "define A, define B, define C", the
fact that three unrelated functions are one span at all is a segmentation artefact.

**Bottom line up front:** unit-merge is real but **atypical** — 9.1% of emitted spans, only 2.2%
pure merges. A candidate-admissibility constraint in the scheduler fixes it for a **6.5%**
composition cost, concentrated entirely on shallow (depth-1/2) spans; deep composition is
untouched. **Byte-identity remains guaranteed by construction, not merely expected** — the change
only *removes* candidates before scheduling, and every surviving candidate plus every fallback
statement is byte-gated by the identical check that gates them today. All numbers below were
produced by executing a faithful copy of `enlzw.genSpans` with the constraint toggled, against the
live corpus.

---

## 1. How often does a span merge unrelated units?

Measured across the **3,226 recursive emitted spans** (a "named unit" = a `function`/`class`
declaration or a `const` whose initializer is an arrow/function/class expression — the thing a
reader thinks of as one item):

| Category | Count | Share |
|---|---|---|
| Clean in-body spans (no unit merge, inside one function) | 2,704 | **83.8%** |
| Module-scope spans | 304 | 9.4% |
| **Unit-merge spans (≥2 unit definitions in one span)** | **293** | **9.1%** |
| — pure merges (all statements are units, like `dateTimeHelpers`) | 72 | 2.2% |
| — mixed (units + other statements) | 221 | 6.9% |
| Unit definitions swallowed into merge spans | 704 | — |

**So the depth-2 `dateTimeHelpers` case is atypical, not typical.** The dominant span (83.8%) is
already a clean run of statements *within a single function body* — exactly what Tier-1 renders
well. Merges cluster in a handful of helper-heavy files (`helpers.ts`, `dateTimeHelpers.ts`) where
several small functions sit adjacent and compress together.

## 2. What the constraint looks like in the scheduler

It is **not** a change to the weighted-interval DP. It is a one-line **candidate-admissibility
predicate** applied at candidate-generation time, before the DP runs:

```js
// in the candidate push(), after building `win`, before the byte-gate:
if (constrain) { const units = win.filter(isUnit).length; if (units >= 2) continue; }
```

A candidate word whose statement window straddles a unit boundary (≥2 unit definitions) is never
admitted. Everything downstream — the byte-gate `wp.fill === source.slice(start,end)`, the sort,
the `ends`/`prevIdx` binary search, the DP, the reconstruction — is **byte-for-byte identical**.
The scheduler simply optimizes over a smaller, meaning-respecting candidate set and picks smaller
non-straddling spans in place of each merger.

Design choices left open for Amir (all candidate-side, none touch the DP):
- **Hard reject vs. soft penalty.** Hard reject (above) is simplest and provably drops all merges.
  A soft variant (subtract a penalty from `weight` for straddling candidates) would let a very
  high-value merge survive — not recommended; it reintroduces the artefact for a compression win.
- **Boundary definition.** "≥2 unit definitions" is the tested predicate. A stricter variant also
  splits at module-scope statement boundaries; a looser one merges only same-named-family units.
  The tested one matches the readability complaint exactly.

## 3. Compression cost (measured, both paths caveat noted)

Executing the real candidate-gen + scheduler with the constraint toggled:

| Metric | Baseline (current) | Constrained | Delta |
|---|---|---|---|
| Recursive spans | 3,226 | 3,045 | **−181 (−5.6%)** |
| Statements collapsed (composition weight) | 4,689 | 4,384 | **−305 (−6.5%)** |
| Max composition depth | 10 | 10 | **0** |
| Files with any composition | 659 | 631 | −28 |

**Depth histogram — the cost is entirely shallow:**

```
depth:            1     2    3   4   5   6  7  8  9  10
baseline:      2300   635  157  76  32  11  7  4  3   1
constrained:   2228   535  150  75  32  11  7  3  3   1
```

Depths 5–10 are essentially untouched (one depth-8 span lost). **Deep composition is safe because
it lives inside single functions, not across units** — the constraint only bites the shallow
depth-1/2 mergers, which is exactly where the readability problem is. Of the 293 merge spans, 181
stop composing entirely and 112 re-form as smaller single-unit spans.

**Effect on the 3,226 recursive / 46 flat ratio.** Recursive drops to ~3,045; the 28 files that
lose all composition fall back to per-statement rendering (or flat-fallback). **Important
consistency caveat:** the flat-fallback candidate-gen (`generators.generatorSpans`, used by
`enfile.js` Pass 0) is a *separate* code path and would need the *same* predicate — otherwise a
merge rejected on the recursive path simply reappears as a flat-fallback merge and the readability
win leaks away. The 46 flat count is therefore a floor: apply the constraint to both paths, or the
fix is incomplete. This is the one piece of real implementation surface beyond the one-liner.

## 4. Byte-identity: guaranteed by construction

**Guaranteed, not merely expected.** Two independent reasons, both structural:

1. The constraint only ever **removes** candidates from the set the scheduler sees. It never adds a
   span, never widens one, never changes how a chosen span is emitted. Every span that survives is
   admitted through the *unchanged* byte-gate `wp.fill === source.slice(start,end)`.
2. Any statement no longer covered by a composed span falls back to **per-statement rendering**,
   which is itself byte-gated (`enfile.js` emits a statement span only when `back === text`). A
   statement that composes into nothing is rendered as itself — the identity case.

So there is no code path under this change that emits a byte that was not equality-checked against
the source. The `1037/1037` gate cannot regress by construction; the post-change gate run is a
formality, not a risk — the same standing that Tier-1 prose has.

## 5. Recommendation

The readability win (no span ever reads as "define A, define B, define C" for unrelated A/B/C) is
worth a **6.5% composition cost that falls only on shallow spans**, and it is byte-safe by
construction. Recommended **if** it ships to *both* candidate paths (recursive + flat-fallback);
shipping it to only the recursive path is worse than not shipping, because merges reappear via flat
and the numbers look fixed while the artefact persists. This is a bounded, self-contained change —
one predicate, applied in two places, plus a re-run of the gate — but it is a deliberate call about
trading measured compression for readability, so it stops here at a proposal.

### Honest caveats

1. **Two paths or none.** §3's consistency caveat is the whole risk surface. A drift-guard test
   asserting "no emitted span contains ≥2 unit definitions" would pin it and catch a path that was
   missed.
2. **It does not improve mid-function segmentation.** A span that groups two logically distinct
   *phases within one function* (setup then teardown) is not a unit merge and is untouched — those
   read as joined clauses still. That is a subtler, lower-frequency problem and a separate question.
3. **Simulation vs. production.** §3 numbers come from a faithful copy of `genSpans`, not the
   production function, because the task was investigate-not-change. Before shipping, the predicate
   goes into the real `enlzw.genSpans` (and the flat path) and the gate is re-run through
   `write-en-files.js --no-write` to confirm 1037/1037 and the new span counts.
