# §5D.3B The naming-stage REFERENCE SPECIMEN — `partners.ts`

*[index](README.md) · **A SPEC ARTIFACT, HAND-AUTHORED.** This is what stage 2's output is aimed at,
written by hand so it exists before the stage does. Nothing here was produced by a model or by a
pipeline run. It plays for the naming stage exactly the role §5D.1's PaymentPlan sentence plays for
the archetype grammar: the thing the implementation is checked against, rather than a description of
one.*

**Read §3 first; §3.5 is the draft it replaced.** The first version of this specimen satisfied every
constraint in §5D.3A and still was not English — Amir's verdict on reading it was *"That's not
English."* Both are kept, because the gap between them is the finding: **the split says who may write
what, and says nothing about whether the result reads.**

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

**What is wrong with it as English.** Three things, and only the first is about names — see §3.3 for
why the second is the one that actually blocks prose:

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

## 3. THE TARGET — the same file, in English

**REWRITTEN 2026-08-31 after Amir read the first draft: *"That's not English."* He was right, and the
first draft is kept below as §3.5 because the reason it failed is the finding.**

```
partners.ts is a lift partner lookup. It imports LiftPartner from '../entities/hydra', getManager
from '../helpers', and memoize from './caching/node-cache'. It exports getLiftPartnerFromAccountId,
a memoized lookup that takes a newFreshbooksClientId (number) and returns the one LiftPartner whose
newFreshbooksClientId matches.
```

That is the whole file. No guillemets, no word ids, no indentation blocks, no payload — sentences a
person would write, in the register of §5D.1's PaymentPlan sentence, which is the standard this
document is held to.

### 3.1 Reading it against §5D.3A's split

**The model supplied two phrases: `lift partner lookup` and `memoized lookup`.** Nothing else in
those four lines came from a model.

| in the target | comes from | may a model touch it? |
|---|---|---|
| `is a`, `It imports … from …`, the `,`/`and` list, `It exports`, `a … that takes a … and returns`, `the one … whose … matches`, every full stop | **code** — declared sentence templates (§3.3) | **no** |
| `lift partner lookup`, `memoized lookup` | **the model** — one noun phrase per named word | **yes, and only these** |
| `LiftPartner`, `'../entities/hydra'`, `getManager`, `'../helpers'`, `memoize`, `'./caching/node-cache'`, `getLiftPartnerFromAccountId`, `newFreshbooksClientId`, `number` | **the mine** — hole fills, byte-gated | **no** |

The split is **unchanged** from the notation draft. Prose costs nothing in blast radius: a template
that reads as a sentence constrains a model exactly as tightly as one that reads as a signature.
That is the point of this rewrite — **notation was never required by the constraint.**

### 3.2 What it asserts about the form

1. **A name is a noun phrase in a sentence, not a token in brackets.** `«memoizedEntityLookup»`
   became *"a memoized lookup"*. Same word, same gate, same one-token contribution — spelled where a
   reader meets it rather than announced.
2. **The word ids are gone from the page.** `w3344` is how the engine addresses the word; a reader
   never needs it, and the first draft printed it out of engine habit. It belongs in the index, not
   the sentence.
3. **The expansion is still present and still editable.** *"imports LiftPartner from
   '../entities/hydra'"* IS the word's definition, not a summary of it — it just reads as a clause
   instead of an indented block (R-ARCH-15). Editing `'../helpers'` changes the compiled import.
4. **Two levels collapsed into one sentence.** The notation draft showed the file word and its two
   sub-words as three nested blocks. English does that with subordination: *"It exports X, a memoized
   lookup that …"* names the sub-word **inside** the sentence that uses it. Nesting is what prose is
   for.
5. **A residual would be a sentence too** — *"Four statements are not yet part of any pattern:"*
   followed by the code, quoted. `partners.ts` has none.

### 3.3 WHERE THE PROSE COMES FROM — and the plain statement Amir asked for

**The current mined-word production builder cannot produce any of this, and no amount of naming will
make it.** `refine-language.js` `renderProduction(c)` emits:

```
<keyword> <subject> : <type> -> <type>  <marker> <field>
```

— a **signature line**, derived from the role signature. It is deterministic, it is code-owned, and
it will never read as English, because a role signature does not carry the information English needs:
which verb, which preposition, what is subject and what is object, singular or plural. My first draft
rendered that shape faithfully and called it the target, which is how notation ended up presented as
the answer.

**What produces prose is what already produces the PaymentPlan sentence: a DECLARED sentence template
per shape.** `entity-sentence.js` reads fluently because a human wrote four lines of template text
once, and the entity's mined slots fill them. Nothing about that mechanism is specific to entities:

```
shape: "import { X } from 'M'"                    →  "It imports «X» from «M»."
shape: "export const F = memoize(async (p:T) => …)" →  "It exports «F», «name» that takes a «p» («T») and …"
shape: "getManager(D).findOne(E, { where: { f } })" →  "returns the one «E» whose «f» matches"
```

So the naming stage needs **two** inputs, not one, and only the second comes from a model:

| | what it is | who authors it | when |
|---|---|---|---|
| **the phrasebook** | one declared sentence template per recognised shape, with slots | **a human**, once per shape — the §5E.3.4 "seeded, not emergent" rule applied to sentences | before stage 2 runs |
| **the names** | one noun phrase per mined word | **the model**, gated | at stage 2 |

**This is a real cost and it is stated rather than hidden.** English is not free: somebody writes the
first sentence for each shape. What makes it bounded is that a template is per **shape**, not per
site, and shapes recur where words do not.

### 3.4 THE MEASUREMENT THAT MAKES THIS URGENT — and it contradicts §5D.2

Counted over the rendered corpus (`grep` for `lzw1 w<id>` across all 1,037 `.en` files):

| | |
|---|---|
| span occurrences | **5,192** |
| distinct words used | **3,290** |
| **words used exactly once** | **2,853 — 87%** |
| words needed to cover 50% of occurrences | 694 |
| words needed to cover 80% | 2,252 |

**§5D.2 argues naming is cheap because "stage 2's cost is per *word*, not per *site*". On the live
path that argument nearly collapses: 3,290 words for 5,192 sites is 1.58 sites per word, and 87% of
words are used exactly once.** Naming every word is very close to naming every site.

**Why, and it is not a defect:** `MIN_COUNT = 1` (`build-lzw-generators.js:59`) promotes a word that
occurs **once**. A one-off run of 12 statements still collapses 12 statements into 1 call, so it
earns its place on review surface — but it recurs nowhere, so its name is used once and pays for
itself once. At `MIN_COUNT = 2` words recur by construction; the PRD's own sweep records that setting
as net 11,180 against 15,388, i.e. **a third less collapse in exchange for vocabulary that repeats.**

**What this changes.** The phrasebook is the answer to the long tail, not more naming. A single
declared template for *"import a name from a module"* serves every one of the thousands of import
words without any of them being named. **Templates amortise across shapes; names do not amortise at
all.** That inverts the priority §5D.2 implies: build the phrasebook first, name second, and name
only words whose *reuse* justifies a noun phrase — the 694 that cover half the corpus, not the 2,853
that appear once.

**This is a measurement, not a proposal, and it needs Amir's call on two things:** whether
`MIN_COUNT` should move to 2 for the naming path (trading collapse for a reusable vocabulary), and
whether unnamed-but-templated words are acceptable — a word with a template and no name reads as
*"imports getManager from '../helpers'"*, which is already English and needs no model at all.

### 3.5 THE FIRST DRAFT, kept — what "not English" looked like

```
partners.ts is «liftPartnerAccess».

«liftPartnerAccess» is «entityAndHelperImports», then «memoizedEntityLookup».

  «entityAndHelperImports»  (w3344 — a 2-symbol word at depth 1)
    imports `LiftPartner` from `../entities/hydra`
    imports `getManager` from `../helpers`
```

Every constraint in §5D.3A held: three model tokens, code-owned structure, mined fills, byte-exact.
**And it is not English.** Guillemets around names, engine word ids on the page, an indentation block
standing in for subordination, and `imports X from Y` repeated mechanically where a person would
write one sentence with a list.

**The lesson, which is why this draft is preserved rather than deleted:** satisfying the split does
not produce English. The split says *who may write what*; it says nothing about whether the result
reads. A specimen is what closes that gap, which is exactly why one was needed — and the first
attempt failing on its first reading is the evidence that it was.

### 3.6 What this specimen does NOT claim

- **Not that `lift partner lookup` and `memoized lookup` are the right names.** Placeholders. The
  specimen pins form, split, phrasebook and checks — never vocabulary.
- **Not that the three templates in §3.3 are settled.** They are the shape of the answer; the exact
  wording is a content call.
- **Not that every file reads this well.** `partners.ts` is fully covered by two words with zero
  residual. A file with a large residual reads worse, honestly, and that is what §7.3 measures.
- **Not a UI.** This is the artifact on disk.

### 3.7 What makes it checkable

| check | how it fails |
|---|---|
| **byte-identity** | compile the target back; one differing byte fails (R-REND-1) |
| **structural inertness** | strip names; any other difference in the dictionary fails (R-LANG-15) |
| **coverage invariance** | the same words still cover the same spans |
| **injectivity** | two distinct words must not render to the same phrase (§5E.4) |
| **token budget** | **exactly two** model-supplied phrases for this file; a third is a spec violation, not a style question |
| **no artifact leakage** | the rendered `.en` for this file contains no `«`, no `w<id>`, and no `⟪lzw1 …⟫` block — grep-checkable, and the first draft fails it |
