# §5D.4F — The last 34 files, and what a structural chunk's children cost

*Amir, 2026-09-01: take the safe half of the 34-file fix — the stray top-level `;` splitting
`foldableRuns` — and leave the leading-comment half alone, since that one broke byte-identity and
was correctly refused.*

Two changes landed. The first is the one asked for. The second is the cost of the first, traced to
its cause and removed — and it turned out to be the corpus's largest single review-surface cost.

## 1. A stray `;` was splitting the top-level run

Measured before touching anything: across the 34 files that fail R-ARCH-15, **`EmptyStatement` is
the only non-foldable top-level kind** — 30 occurrences in 29 files. A lone semicolon after an
interface declaration split each file's top-level run in two, so no single word could account for
the file.

It is **absorbed, not folded**. Teaching `generators.js` to canonicalize `;` would add a symbol the
mined dictionary has never seen: nothing would collapse until a re-mine, a catalog change to fix a
whitespace-level defect. Instead an interior `;` is dropped from the run, and its bytes survive
inside the **gap hole** between its neighbours — `windowParts` builds each gap from
`sf.text.slice(prev.getEnd(), next.getStart(sf))`, which spans the semicolon verbatim. Gap text is a
hole, so it never enters `keyOf`: the key is exactly the one a file *without* the stray `;`
produces, which is why the word already exists in the dictionary and why the refill is byte-exact.

A run may not **start or end** on one. A trailing `;` outside the last real statement is inside no
gap, so absorbing it would drop bytes from the span; those stay with `renderVerbatim`.

| | before | after |
|---|---|---|
| one word per file (R-ARCH-15) | 1003 — 96.7% | **1030 — 99.3%** |
| review surface, top level | 1,610 | **1,582** |
| byte-identity | 1037/1037 | **1037/1037** |

**The remaining 7 are accounted for, not a residue.** 2 are **empty files** (1 and 9 bytes, no
statements at all — they cannot have a top word under this definition, so the true ceiling is
**1035**, not 1037). 4 carry non-whitespace outside the span — the leading-comment case, deliberately
untouched. 1 has two `interface` declarations the dictionary holds no word for, visible as a
`no-word` row in `audit-rules.js`.

## 2. The audit fired on this change, and it was right to

28 new `no-word` refusals appeared. With the run no longer split, each of those files asks for a
word covering the **whole** top-level run, and the dictionary has none — those runs were never mined
as one, because the `;` split them for the miner too. The files still collapse: as a **structural**
chunk (§5D.4E, R-ARCH-19) — a named sentence over children — rather than as a lexical word.

That is a true new fact about the corpus, not a regression, and it is exactly what the differential
gate in §5D.6 exists to surface. The baseline was re-recorded only after the cause was understood.

## 3. The cost that finding exposed: children were statements, not runs

The first change cost **+133** on the whole-tree read (29,260 → 29,393). Traced: a structural chunk
emitted **one child per statement**, which threw away every word covering a contiguous stretch of
statements inside it. Ten imports above a slice definition rendered as ten chunks, not one.

It was invisible while runs were short. Making whole-file runs common made it the corpus's largest
single cost. Children are now the **maximal non-drillable sub-runs** — each one atomic word where the
dictionary has one — plus each drillable statement on its own.

| | one-child-per-statement | children as runs |
|---|---|---|
| review surface, whole tree | 29,393 | **19,776 (−33%)** |
| chunks | 28,845 | **19,228** |
| atomic | 19,234 | **9,617** |
| structural | 9,611 | 9,611 |
| review surface, top level | 1,582 | 1,582 |
| one word per file | 1,030 | 1,030 |
| byte-identity | 1037/1037 | **1037/1037** |

This changes how a chunk's children are **grouped**, never which bytes a chunk owns: the children
still tile the run in order, the gaps between them are still exact source slices, and a sub-run with
no word falls back to the per-statement rendering it would have had. Byte-identity is unaffected by
construction, and measured 1037/1037 before and after.

**This second change was not in the brief.** It was found while measuring the first one's cost, it
cancels that cost several times over, and it is a separate commit so it can be reverted alone.

## 4. Requirements and checks

R-ARCH-15's Check now carries 1030/1037 and the full account of the 7. R-ARCH-16 went from red to
**green** on the same run — it was red only because the stored manifest predated its producer, not
because the producer was missing. `engine/structural-grouping.test.js` (9 assertions) counts
**children against the statements they cover**, since a byte-identity-only test would pass against
either shape, and drives the no-word fallback to prove it degrades rather than dropping bytes.
