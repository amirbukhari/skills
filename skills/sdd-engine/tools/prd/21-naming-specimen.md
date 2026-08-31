# §5D.3B The naming-stage REFERENCE SPECIMEN — `partners.ts`

*[index](README.md) · **A SPEC ARTIFACT, HAND-AUTHORED.** This is what stage 2's output is aimed at,
written by hand so it exists before the stage does. Nothing here was produced by a model or by a
pipeline run. It plays for the naming stage exactly the role §5D.1's PaymentPlan sentence plays for
the archetype grammar: the thing the implementation is checked against, rather than a description of
one.*

**Why a specimen at all.** §5D.2 pins the *pipeline*, §5D.3A pins the *split* (deterministic grammar
shell, model supplies words only) — and neither says what the result should look like on the page.
A stage built to those two documents alone could satisfy every constraint and still miss the target,
because the target was never written down. §5D.1 is the precedent for why this works: the archetype
grammar could be built, pinned and tested precisely because one exact sentence existed to build it
against.

**Why `partners.ts`.** It is 7 lines, it renders today as **two** generator spans covering the whole
file with **no residual**, and it is real corpus code. Small enough to read whole; not a toy.

---

## 1. The source, verbatim

```ts
import { LiftPartner } from '../entities/hydra';
import { getManager } from '../helpers';
import { memoize } from './caching/node-cache';

export const getLiftPartnerFromAccountId = memoize(async (newFreshbooksClientId: number) => (
  getManager('hydra').findOne(LiftPartner, { where: { newFreshbooksClientId } })
));
```

## 2. TODAY'S ACTUAL OUTPUT — `sen/files/src/hydra-api/partners.ts.en`, verbatim

```
«▶ import 1 name from a module then import 1 name from a module ⟪lzw1 w3344⟨ ⟨ ⟨LiftPartner⟨ ⟨ ⟨ ⟨'../entities/hydra'⟨
⟨ ⟨ ⟨getManager⟨ ⟨ ⟨ ⟨'../helpers'⟫»
«▶ import 1 name from a module then get `getLiftPartnerFromAccountId` from memoize ⟪lzw1 w5964⟨ ⟨ ⟨memoize⟨ ⟨ ⟨ ⟨'./caching/node-cache'⟨

⟨export ⟨getLiftPartnerFromAccountId⟨memoize⟨async (newFreshbooksClientId: number) => (
  getManager('hydra').findOne(LiftPartner, { where: { newFreshbooksClientId } })
)⟫»
```

**Measured, so the specimen rests on facts rather than on reading the output.** `renderFileEn` on
this file reports `bodyStatements 4, collapsedStatements 4, residualStatements 0, genSpans 2`
(both recursive), `maxDepth 1`, `englishPct 99.4`, `reviewSurface 2`. **Four statements become two
things to read, and nothing is left over** — which is why this file, and not a larger one, is the
specimen: the naming question can be looked at without a residual argument tangled into it.

**What is already right about it, and worth not losing.** The two spans are real mined words
(`w3344`, `w5964`) that between them account for the whole file. Every hole fill is present, so the
`.ts` reconstructs byte-identically. Nothing is elided and nothing is invented.

**What is wrong with it as English.** Three things, and only the first is about names:

1. **The words have no names.** `w3344` is a correct word with no spelling — stage 1 finishing its
   job (§5D.2 consequence 1), not a defect.
2. **The gloss is prose, not a production.** *"import 1 name from a module then import 1 name from a
   module"* is assembled by `prose.js`'s humaniser; no grammar rule says it must take that shape, so
   nothing can reject it for drifting. §5D.3A says the shell must be code-owned and derived — this
   gloss is code-owned but not *derived from a production*.
3. **The payload dominates the page.** The `⟪lzw1 …⟫` block is the fills, correct and necessary, but
   it is set beside the sentence rather than beneath it, so the file reads as machine output that
   happens to contain English.

---

## 3. THE TARGET — the same file after stage 2

```
partners.ts is «liftPartnerAccess».

«liftPartnerAccess» is «entityAndHelperImports», then «memoizedEntityLookup».

  «entityAndHelperImports»  (w3344 — a 2-symbol word at depth 1)
    imports `LiftPartner` from `../entities/hydra`
    imports `getManager` from `../helpers`

  «memoizedEntityLookup»  (w5964 — a 2-symbol word at depth 1)
    imports `memoize` from `./caching/node-cache`
    exports `getLiftPartnerFromAccountId` as `memoize` of
      an async function taking `newFreshbooksClientId` (number)
      returning `getManager('hydra').findOne(LiftPartner, { where: { newFreshbooksClientId } })`
```

*(The word annotations are **measured**, not invented: both are `len: 2, d: 1` in the wide axis of
`generators-lzw.json`. The boundaries are `w3344` and `w5964` exactly as the mine drew them, not
boundaries chosen to make the example read well. A **usage count** is deliberately NOT shown: the
dictionary entry carries no per-word file count, and `generators.filesUsing` is a corpus-level
figure. Inventing one here would put a number in a spec that no command produces — R-MECH-8's
failure shape.)*

### 3.1 Reading the specimen against §5D.3A's split

Every line above is one of exactly three things, and the specimen is only useful if which is which
is unambiguous:

| in the target | comes from | may a model touch it? |
|---|---|---|
| `is`, `then`, `imports … from …`, `exports … as … of`, `taking`, `returning`, the indentation, the full stops | **code** — the production for each word, derived from its role signature (§5D.3A, R-LANG-15) | **no** |
| `liftPartnerAccess`, `entityAndHelperImports`, `memoizedEntityLookup` | **the model** — three tokens, one per word | **yes, and only these** |
| `LiftPartner`, `'../entities/hydra'`, `getManager`, `newFreshbooksClientId`, the whole `getManager('hydra').findOne(…)` expression | **the mine** — hole fills, byte-gated | **no** |

**Three tokens.** That is the entire contribution of the LLM to this file. If a fourth piece of text
in that block came from a model, the stage is built wrong.

### 3.2 What the specimen is asserting about the FORM

1. **The file is one word, and the word is its expansion.** `partners.ts is «liftPartnerAccess»` is
   the whole file's account of itself, and the next line **is** `liftPartnerAccess` — its definition,
   in the same file, in English. Nothing is hidden behind the name, so there is nothing to unhide
   (R-ARCH-15, §5D.4). A reader who trusts `entityAndHelperImports` stops there; one who does not
   reads two lines further and sees the imports themselves.
2. **The payload is gone from the page, not from the artifact.** The fills are the backticked spans
   inside the expansion, where a reader can see and edit them. There is no separate `⟪lzw1 …⟫` block
   because the expansion *is* the payload, rendered. This is the change §5E.5 calls "the sentence is
   authoritative, the payload is a derived index".
3. **Every level is editable and every edit is real.** Changing `` `../helpers` `` changes the
   compiled import. Changing `memoizedEntityLookup` renames the word everywhere it is used, gated by
   byte-identity and injectivity. Changing a *connective* — `then` to `and` — is **rejected**: it is
   not in the production, and that refusal is what "stops you from drifting outside of the patterns".
4. **Names are compositional, so naming is cheap.** `memoizedEntityLookup` did not have to describe
   what `memoize` does, because `memoize` is already a word. §5D.2: *"a name at depth 5 inherits the
   domain vocabulary of everything beneath it."*
5. **A residual would be admitted, not hidden.** `partners.ts` has none. Where a file has statements
   outside every word, the expansion carries them **as themselves**, under a line that says so in
   English — *"…and 4 statements not yet part of any pattern"* (§5D.4 move 2, R-LANG-10). The file is
   still one word; the word admits what it has not factored.

### 3.3 What makes this checkable, and not merely nice

The specimen is a target, so it has to be falsifiable. A stage-2 run over `partners.ts` is correct
against it when all five hold, and each is a re-run, not a judgement:

| check | how it fails |
|---|---|
| **byte-identity** | compile the target back; one differing byte fails (R-REND-1) |
| **structural inertness** | strip names from the dictionary before and after; any other difference fails (R-LANG-15, `structuralSkeleton`) |
| **coverage invariance** | the same two words still cover the same spans; a name that changes what is covered fails |
| **injectivity** | two distinct words must not render to the same spelling (§5E.4) |
| **token budget** | the diff between today's `.en` and the target contains **exactly three** model-supplied tokens for this file; a fourth is a spec violation, not a style question |

### 3.4 What this specimen does NOT claim

- **Not that these three names are the right names.** They are plausible, and they are placeholders
  for whatever the stage proposes. The specimen pins the **form**, the **split**, and the **checks** —
  never the vocabulary.
- **Not that the production text is settled.** `imports … from …` is one reasonable derivation from
  a two-role signature; a different derivation that satisfies §5D.3A is still in bounds. What is
  settled is that **code** derives it.
- **Not that every file will read this cleanly.** `partners.ts` is fully covered by two words. A file
  with a large residual will read worse, honestly, and that is the number §7.3 measures.
- **Not a UI.** This is the artifact on disk. How it is displayed is a separate question and is not
  this document's business.
