# §5D.3C THE ADOPTED DESIGN — rules keyed to AST NODE KINDS, not to mined shapes

*[index](README.md) · **DECIDED by Amir, 2026-08-31. This supersedes the per-shape template framing
of §5D.3B (the "10 / 91 / 437 templates" scoping) as the direction for stage 2.** §5D.3B's specimen
— the target prose for `partners.ts` and the attribution of every line to code / model / mine —
**stands unchanged**; what is superseded is only its answer to *where the sentence templates come
from*.*

> **Extended by §5D.3D (Amir, 2026-09-01):** naming is **not** leaf-only. A recurring multi-statement
> run is named as **one chunk** by the LZW mine; node-kind rules render **the residual** the mine did
> not claim. The two mechanisms compose, and the layering already exists in code. Nothing below is
> withdrawn — only the scope of what the naming stage names.

## 1. The decision

> **Key the phrasebook rules to the target language's own AST node kinds, not to shapes mined from a
> specific corpus.**

**The rationale, in Amir's terms.** Shape-mining produces a combinatorially large, corpus-specific
set — **437 templates for 90% coverage of Hydra alone**, growing with every new codebase. That is a
**lookup table, not a grammar**, and it does not generalise. AST node kinds are a **small, finite set
fixed by the language itself**: `ImportDeclaration`, `VariableStatement`, `CallExpression`,
`IfStatement`, `ArrowFunction`, `PropertyAccessExpression`, `BinaryExpression`,
`ObjectLiteralExpression`, and so on. Every codebase in that language bottoms out in the same kinds,
so **a rule set written once covers any codebase**, not merely the one it was measured against.

## 2. The design, as it will be built

1. **One hand-authored rule per node KIND, not per mined shape.** The `ImportDeclaration` rule renders
   *any* import — one name or ten, named or default — through a list-join, rather than separate
   templates per cardinality. Cardinality is a **parameter of the rule**, never a reason for a second
   rule. (Today's shape table has four distinct entries that differ only by how many names are
   imported; under this design they are one rule.)
2. **Rules compose recursively.** A complex expression is rendered by applying the same small rule set
   to each child node and stitching the results per the parent's rule — the same recursion the
   renderer already performs when it nests generator spans. A rule never needs to know what its
   children are, only that they render.
3. **Coverage is a property of the LANGUAGE, not of a corpus.** The target is TypeScript's actual node
   kind vocabulary — the roughly 40–60 kinds that occur in ordinary code — and progress is measured
   against **that** list. It is explicitly *not* scoped or justified against Hydra's statement counts;
   those numbers describe one repository and were the thing that made the previous framing look
   tractable when it was not.
4. **Enforcement is unchanged and already built.** Render → parse the English back → the reconstructed
   AST must be identical, which is the byte-identity round-trip the engine already gates every span
   with (R-REND-1, and R-REND-6's derive-and-check for hand edits). **A node kind with no authored
   rule falls back to today's residual/unfolded output.** The design is additive: nothing regresses,
   and the first rule can ship alone.
5. **The LLM's role is unchanged from §5D.3A.** It fills **leaf-level name slots only**. It never
   invents rule structure and never introduces a new phrase type. A rule set keyed to node kinds is
   *more* constraining than a mined template table, not less, because the key space is closed by the
   language spec rather than open-ended by whatever the miner happened to find.

## 3. The measurement that supports the decision

Node kinds counted over the same 1,037-file corpus, structural kinds only (tokens, keywords and bare
identifiers excluded — they carry no rule):

| | |
|---|---|
| `SyntaxKind` values in the TypeScript language | **400** |
| distinct structural kinds occurring in this corpus | **100** |
| node instances | 307,009 |
| kinds needed to cover **50%** | **8** |
| kinds needed to cover **80%** | **19** |
| kinds needed to cover **90%** | **28** |
| kinds needed to cover **95%** | **37** |
| kinds needed to cover **99%** | **53** |
| kinds occurring fewer than 10 times in the whole corpus | 14 |

The eight most common: `PropertyAccessExpression`, `CallExpression`, `StringLiteral`,
`PropertyAssignment`, `VariableDeclaration`, `VariableDeclarationList`, `FirstStatement`,
`ObjectLiteralExpression`.

**Set against the superseded framing, the same coverage costs 15× fewer rules:**

| coverage | mined shapes (§5D.3B, corpus-specific) | node-kind rules (this design, language-fixed) |
|---|---|---|
| 50% | 10 | **8** |
| 80% | 91 | **19** |
| 90% | **437** | **28** |

**And the two columns are not comparable in kind, which is the actual argument.** The left column is
valid for Hydra and starts again at zero for the next repository. The right column is a property of
TypeScript: the same 28 rules cover 90% of *any* TypeScript codebase, because the kinds are fixed by
the parser, not discovered by the miner. **53 rules reach 99% here, and the whole corpus exercises
only 100 of the language's 400 kinds** — a rule set that is finite, enumerable in advance, and
completable.

*(These figures justify the decision; per §2 point 3 they do **not** define the target. The target is
the language's kind vocabulary, and a rule for a kind that happens to be rare in Hydra is still worth
writing, because it is not rare everywhere.)*

### THE TABLE ABOVE IS NOT REPRODUCIBLE, AND THAT IS THE DEFECT — measured 2026-09-04

**Nothing on disk reproduces `100 / 307,009 / 53`, and no correction is applied above.** The figures
were re-measured over the same 1,037-file corpus with the live walk (`engine/walk-skip.js`) under
four predicates. **None returns the published triple**, and two candidate corrections offered from
outside the repo — *"99% is 54, not 53"* and *"101 structural kinds, not 100"* — appear in no
measurement either:

| predicate | kinds | instances | 50 / 80 / 90 / 95 / 99% |
|---|---|---|---|
| **A** `kind > LastToken` — `phrasebook-worklist.js:109`, the ONLY live predicate | **95** | **274,091** | 8 / 19 / 27 / 35 / **51** |
| **B** A plus literals | **102** | **321,214** | 8 / 20 / 30 / 39 / **56** |
| **C** all but keywords, punctuation and `Identifier` | **102** | **321,214** | 8 / 20 / 30 / 39 / **56** |
| **D** every node kind, no exclusion | 158 | 541,157 | 5 / 21 / 36 / 51 / 78 |
| — | *published above:* **100** | **307,009** | 8 / 19 / 28 / 37 / **53** |

**THE ROOT CAUSE IS THAT THE TABLE NEVER NAMED ITS PREDICATE, AND THE PROSE CONTRADICTS ITSELF.**
The heading says *"structural kinds only (tokens, keywords and bare identifiers excluded)"*, which is
predicate **A** — and A's eight most common kinds do **not** include `StringLiteral`. The published
list of eight does, in third place. `StringLiteral` **is** a token, so the table excludes tokens in
its prose and counts one in its results. Predicates **B** and **C** reproduce the published eight
**exactly, in order**, which identifies the family the table was really measured under — but they
return 102 / 321,214 / 56, not 100 / 307,009 / 53.

**The residual gap is most likely corpus drift.** The table landed in `e87d526` (2026-08-31); the
corpus is untracked (`Examples/` is gitignored), so the state it was measured against cannot be
recovered to confirm that. **That is a statement of what cannot be checked, not a diagnosis.**

**Why the numbers above are left standing.** Substituting today's figures would replace one
unreproducible triple with another, since the predicate that produced the original is not recorded
anywhere and B/C is an inference from a top-eight ordering. **The argument the table exists to make
is unaffected under every predicate measured:** 8 kinds reach 50% and the 99% figure lands between 51
and 56 out of 400 — the rule set is finite and enumerable either way. What must change is the
method, not the digits.

**Whoever next touches these figures must name the predicate in the table itself** — file and line —
so the next reader can re-run it. A measurement whose producer is unnamed cannot be corrected, only
re-guessed, which is exactly what happened here.

## 4. What this changes, and what it does not

**Changed — the answer to "where do sentence templates come from":**

| | superseded (§5D.3B §3.3) | adopted (this section) |
|---|---|---|
| key | a mined shape (`import‹gap›{‹gap›‹id›‹gap›}‹gap›from‹gap›‹str›;`) | an AST node kind (`ImportDeclaration`) |
| set size | open-ended, grows per corpus | closed by the language spec |
| cardinality variants | separate templates | one rule, list-join |
| portability | none — re-mine, re-author | total — same rules, any codebase |
| completion | never provably done | enumerable: kinds with a rule ÷ kinds in the language |

**Unchanged:**

- **§5D.3B's specimen and its attribution table.** The target prose for `partners.ts`, and which text
  comes from code / model / mine, are exactly as written. Only the provenance of the template text
  changes — and `It imports «X» from «M».` is now the `ImportDeclaration` rule rather than a template
  for one mined shape.
- **§5D.3A's split.** Deterministic shell, model supplies words only. Reinforced, not relaxed.
- **The gates.** Byte-identity, structural inertness, coverage invariance, injectivity.
- **The residual is still honest.** An unruled kind renders as today's unfolded output, and the file
  says so in English rather than hiding it (§5D.4 move 2, R-LANG-10).

**Also retired: the priority argument that came with the superseded framing.** §5D.2's corrected
paragraph tells stage 2 to "build the phrasebook first, name second" on the strength of the mined
shape counts. The instruction survives; its justification is now the node-kind vocabulary, which is
stronger — a rule set that terminates, rather than a table that grows.

## 5. Requirements this adds

Written into §R: **R-LANG-16** (rules keyed to node kinds, one per kind, cardinality as a parameter),
**R-LANG-17** (recursive composition, and an unruled kind falls back rather than fails).
