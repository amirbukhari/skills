# §5D.3D NAMING HAS TWO LEVELS — the chunk and the leaf

*[index](README.md) · **DECIDED by Amir, 2026-09-01,** answering the Q-9 question left open by
§5D.3C: is an unnamed-but-ruled word acceptable on its own? **No.** This section records the answer,
how the two mechanisms compose, and — §4 — a real conflict and a dead mechanism that the answer
exposes. Neither is glossed.*

## 1. The decision

> **No.** A recurring run of similar statements — Amir's example: several import statements in a row
> — must be recognised as a **pattern** and collapsed under **one named word covering the whole
> chunk**, not rendered node-by-node as N separate rule-produced sentences.

So naming is **not** confined to leaf-level name slots. It applies at two levels:

| Level | What gets named | Who names it | Mechanism |
|---|---|---|---|
| **Chunk** | a recurring multi-statement run, as one unit | the naming stage | the recursive LZW word dictionary |
| **Leaf** | the identifiers inside a rendered sentence | the naming stage (§5D.3A) | node-kind rule slots (§5D.3C) |

## 2. The two mechanisms compose — and the layering already exists

They are not rivals, and the order is **already built and already enforced**:

1. **`enlzw.genSpans` runs first** — `enfile.js` labels it *"0a PRIMARY: the RECURSIVE word
   dictionary"*. It claims multi-statement runs, byte-gated (`fill === source slice`).
2. **`inGen(s, e)` fences off everything a span claimed.** Nothing already inside a generator span
   is eligible for per-statement rendering.
3. **Per-statement rendering is the residual path only.** The import branch at `enfile.js:561` sits
   under a comment that says so outright: *"imports/exports the naming pass did not cover (rare
   arities)"*.

**So the division of labour Amir describes is the division the engine already has:** the LZW mine
recognises and names recurring multi-statement chunks; node-kind rules (§5D.3C) render the grammar of
whatever the mine did not claim. §5D.3C's fallback clause — an unruled kind falls back to today's
unfolded output — is the *same* residual path, one layer down.

**Imports specifically were made mine-eligible on purpose.** `generators.js`'s `isDeclStmt` carries
the v3 note: an import *"is the single most repetitive construct in the corpus (5,833 of 33,918
statements) and it was not foldable, so it never entered the symbol stream AND it split the run at
that point — every file's head was shredded before LZW saw it."* Chunk-level recognition of import
runs is therefore not new work; it is work already done.

**Measured, on `sen/files/src/hydra-api/partners.ts.en` as rendered today.** Word `w3344` covers
**two import statements as one word**; `w5964` covers **a third import plus the export**. The chunk
level demonstrably works.

## 3. What this changes

Nothing in §5D.3C's design is withdrawn. What changes is the **scope of the naming stage**, which
§5D.3A had pinned to leaf slots only:

- The naming stage names **words** (chunks) *and* **leaf slots**. Both are name-only; neither invents
  structure. §5D.3A's constraint — the model supplies spellings, never grammar — holds at both
  levels unchanged.
- A word that spans N statements gets **one** name, not N clauses joined by *"then"*.
- Node-kind rules therefore do **not** need to produce fluent prose for statements the mine has
  already claimed. Their target is the residual.

## 4. What this exposes — two findings, stated plainly

### 4a. CONFLICT: "composed from its members, never invented whole" contradicts the decision

`enfile.js:799` states the current rule for a span's sentence:

> *"A span's sentence is COMPOSED from its members' names, in source order, **never invented whole**
> … clause i belongs to statement i."*

Amir's decision requires the opposite at the chunk level: **one name for the whole chunk** is, by
definition, a name not composed from its members. These cannot both stand. The composed rule is also
exactly what produces the output he is objecting to — today's real gloss on `partners.ts` reads:

```
import 1 name from a module then import 1 name from a module
```

which is N sentences joined by *"then"*, i.e. the thing the decision rejects. **Resolution is
Amir's call**, and the choice is narrow: either a word may carry its own whole-chunk name that
overrides member composition (composition demoted to a fallback for unnamed words), or composition
stays authoritative and the chunk level cannot satisfy the decision. **Recommended: the former** —
it is additive, it leaves the fallback intact for unnamed words, and it does not touch the payload,
so no byte-level gate moves.

### 4b. DEAD MECHANISM: the run-collapse already written cannot currently fire

`namedLabel` already collapses repeated clauses, with a comment aimed at precisely Amir's example:

> *"names are per-skeleton, so seven identical imports should say it once with a count rather than
> seven times"*

It emits `clause (×N)`. **It is unreachable today.** `NAMES = WN.load(AC.pathFor("word-names"))`
resolves to `<corpus>/sen/catalog/word-names.json`, which **does not exist** — it was deleted by
Amir's decision (see §8 of the s7 handoff and `ASSUMPTIONS.md`). With no names, `clausesFor` returns
null, `namedLabel` returns null, and every gloss falls through to `genLabel`'s *"X then Y"*
composition. That is the direct cause of the output in §4a.

**This means the chunk-naming gap is a disabled mechanism, not a missing one** — but it also means
the word-names artifact question is now **load-bearing for the adopted design**, not a doc-cleanup
leftover. §8A / R-LANG-5 / the registered `word-names` kind say the file must never be deleted; it
is deleted. That contradiction was previously cosmetic. It is not any more: **chunk-level naming has
nowhere to be stored until it is resolved.** Amir's call.

### 4c. NOT a redundancy, but a boundary that does not align

The mine's chunk boundaries are **dictionary-driven, not human-meaningful**. `partners.ts` has three
consecutive imports; the mine split them **2 + 1**, and attached the third to the export. Amir's
phrasing — *"a block of N imports"* — implies the boundary is the block. The longest-match LZW
dictionary gives whatever it gives. This is not a conflict between the two mechanisms; it is a
limitation of the chunk mechanism, and it means a chunk name must describe **the word the mine
found**, not a block a reader would have drawn. Whether to add block-alignment pressure to the miner
is a separate, unopened question.

## 5. Requirements

- **R-LANG-18** — The naming stage MUST be able to name a **word** (a multi-statement chunk) as a
  unit, not only leaf slots. Check: a word of arity ≥ 2 with a whole-chunk name renders as one
  clause, and the rendered `.en` still compiles byte-identically.
- **R-LANG-19** — A whole-chunk name, where present, MUST take precedence over member composition;
  member composition remains the fallback for words with no whole-chunk name. Check: `enfile.js:799`
  no longer asserts *"never invented whole"*, and an unnamed word still renders via composition.
  **Blocked on §4a and §4b — recorded, not yet holding.**
