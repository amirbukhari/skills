# §5D.3G THE RULE-COVERAGE FILTER — measured, and the leaf tier is 98% already done

*[index](README.md) · Built 2026-09-02 on Amir's call after the 80-leaf pilot measured a 72% loss of
concrete identifiers (§5D.3F §2d): "measure which leaf skeletons already have a node-kind rule
rendering real specifics vs which don't, and only spend model-naming calls on the ones no rule
reaches." Every number below is measured against the live corpus at commit `8882830`; zero model
calls were spent producing any of it.*

## 1. The criterion, and why it is variance

A leaf NAME is **hole-free**; a node-kind RULE is **hole-filled**. That is the whole of it:

```
RULE   import `ITokenData` from `./hydra-ui/src/customHooks/ITokenData`     <- renders THIS import
NAME   import one named export from a module                               <- renders ANY import
```

So the test cannot be "does this clause look specific". A clause may quote a `identifier` that is
part of the skeleton itself and therefore identical at every site — a name reproduces that perfectly
well. **The test is whether the clause CHANGES FROM SITE TO SITE**, because that, and only that, is
what one fixed name cannot stand in for.

| what the rule does across real instances | verdict |
|---|---|
| any instance renders a clause that **says nothing** (`enfile.SAYS_NOTHING`) | **UNREACHED — name it** |
| clauses **vary** between instances | rule-covered — naming it *is* the pilot's 72% loss |
| one **constant** clause that quotes the code | rule-covered — already good prose |
| one **constant, generic** clause | **UNREACHED — name it** |

`SAYS_NOTHING` is not re-implemented here: `enfile.js` now exports it and `rule-coverage.js` uses
that exact object, so "carries no information" has one definition in the tree rather than two that
drift.

**The statement -> skeleton mapping is the miner's own** (`generalStmtParts` + `keyOf`, keyed through
`word-names.hashOf`), so a bucket in this measurement is the same word the dictionary holds, not a
re-derivation that could disagree with it.

## 2. THE MEASUREMENT — 1,414 leaf skeletons, 28 worth a model call

Measured over every foldable statement in all 1,037 files, both axes, clause by clause through the
real rule path (`enfile.spanActions`):

| class | skeletons | sites | verdict |
|---|---|---|---|
| `rule-covered-constant` | 1,112 | 1,303 | skip |
| `rule-covered-varying` | 274 | 37,161 | skip |
| `unreached-generic` | **28** | **1,562** | **NAME** |
| **total** | **1,414** | | **28 namable — 2.0%** |

**98% of the leaf tier is already rendered by code.** The naming target's leaf half collapses from
1,414 names to **28** — roughly **one model call**, against the ~35 calls a full leaf tier would have
taken. And the 274 varying skeletons carry **37,161 sites**: those are the high-frequency shapes, and
they are exactly the ones the pilot damaged.

**R-LANG-21 is untouched.** d=0 remains inside the naming scope; every chain still bottoms out at a
leaf. A rule-covered leaf is still *accounted for* — by code, which is the cheaper and better of the
two ways. The filter changes **who** accounts for a leaf, not **whether** it is accounted for. The
rows stay in the plan, carrying their classification and the clause the rule produces today.

## 3. A false positive this measurement caught in itself

The first run reported **36** namable, nine of them guard throws (`if (!x) { throw new E(...) }`)
with a `null` clause. That was wrong, and it was my classifier's bug, not a gap in the rules:
`spanActions` files a guard under `guards`, not `actions`, so reading `actions[0]` alone saw nothing
where the renderer was in fact producing *failing when "x is required"* — quoting the throw message,
which is about as hole-filled as a clause gets. **Naming those nine would have repeated the pilot's
regression on the shapes least able to afford it.** Fixed, pinned by a regression assertion, and the
corrected figure is 28.

*It was caught by reading the output of the measurement, not by reasoning about the code — which is
CLAUDE.md's rule working as intended.*

## 4. The 28 split into two DIFFERENT kinds of work, and only one of them is naming

| | skeletons | sites | what it actually is |
|---|---|---|---|
| **A. the export family** | 9 | 113 | **a missing rule, not a naming job** |
| **B. genuinely unreached** | 19 | 198 | **a name is the right instrument** |

**A — the export family.** `export { X } from './m';` renders as *"re-export 1 name from another
module"*: the rule counts the names but never quotes them, while the sibling `ImportDeclaration` rule
quotes both symbol and module. That is not a shape needing a name; it is `ExportDeclaration` needing
the rule `ImportDeclaration` already has (R-LANG-16/17). **Writing that rule serves every codebase in
the language; naming these nine skeletons serves this corpus only** — §5D.2's "build the phrasebook
first, name second", landing on a concrete work item.

**B — genuinely unreached**, led by `describe(‹args›)` at 143 sites rendering as *"call describe"*
(the test-suite declaration in every spec file), `‹id›.mock(‹args›)` at 28, `test(‹args›)` at 6.
These carry no holes the rule could read; a name is the right instrument and the model is worth
spending on them.

## 5. The updated leaf-tier plan

- `plan` now measures rule coverage for d=0 on every run, writes the classification and the clause
  the rule produces today onto each row, and **orders namable rows first**.
- `name --tier 0` **does not ask about a rule-covered leaf.** `--include-rule-covered` exists to
  re-measure the claim, not for production use.
- Cost of the leaf tier as it now stands: **28 names, ~1 model call** — and 9 of those 28 are better
  answered by writing one `ExportDeclaration` rule, which would take it to **19**.

## 6. What this does NOT answer — and it is the same hazard one level up

**Chunk names (d>=1) are not covered by this filter, and they carry the same risk.** R-LANG-19 says a
whole-chunk name OUTRANKS member composition — so a chunk name replaces N rule-rendered clauses, each
of which may be quoting the code, with one hole-free clause. That is *intended* compression rather
than the pilot's accidental loss, and it is Amir's decided direction. **But the trade is now
measurable with the instrument built here**, and it has not been measured. Recorded as the open
question, not decided: before the composite tiers are named, run the same before/after identifier
count over a chunk-named render.

## 7. Requirements

- **R-LANG-16/17** gain a concrete, measured work item: the `ExportDeclaration` rule (9 skeletons,
  113 sites) is the highest-value missing rule in the corpus.
- **R-LANG-21** unchanged and explicitly reaffirmed: d=0 stays in scope; the filter decides who
  accounts for a leaf, not whether.
- **R-LANG-22**'s leaf half is now **28** rather than 1,414 at `8882830`. The composite half (638)
  is unchanged and unmeasured against this hazard — see §6.

---

## 8. DELIVERED: the `ExportDeclaration` rule (§4's "missing rule" half)

Written first, per the design's own priority (§5D.2: a rule serves every codebase, a name serves this
corpus). `exportPhrase` mirrors `importPhrase` and covers `export {A}`, `export {A as B}`,
`export * from`, `export * as ns from`, `export type {T}`, and local `export {A}`; the rule declines a
run that MIXES re-exports with local exports rather than fudging one verb onto two different things,
falling through to the per-statement path (R-LANG-17). Cardinality is a parameter, as with imports.

    was:  re-export 1 name from another module
    now:  re-export `LiftPartner` from `../entities/hydra`

**Measured** at `3df26f8`: 1037/1037 files byte-identical; 15 files render through the new rule;
`chunk-naming.test.js` 47 assertions. The 9 export skeletons reclassified as rule-covered and the
namable leaf set fell **28 -> 20** (the extra movement is another lane's re-mine, not this rule).

## 9. The gate gained a FOURTH check, because checks 1-3 all passed during the pilot

The 80-leaf pilot gated clean and still took the corpus from 27,673 quoted identifiers to 7,644.
Nothing in byte-identity, payload identity or coverage invariance can see that: the bytes round-trip,
the payloads are untouched, coverage is identical — the render simply says less. `naming-gate.js` now
counts **concrete identifiers the PROSE supplies** (backticked tokens outside any verbatim payload,
`detailOf`) per file and fails any file that loses one. `naming-gate.test.js` shows it FIRING against
an injected renderer built to the pilot's exact shape. The figure prints on every run, pass or fail.

## 10. The 20 were named, gated, applied — and REVERTED. Names are no longer cosmetic.

One model call produced 20 names; all four gate checks passed (identifiers 2,226 -> 2,226 over the 23
affected files, and 77,766 -> 77,766 over all 1,037), 1037/1037 still byte-identical. The names were
applied and then measured against the corpus, and a fifth thing had moved:

| toggling ONLY word-names.json, same tree (`3df26f8`) | without names | with 20 names |
|---|---|---|
| import repeats INSIDE one clause (`, import \``) — an UNFOLDED run | 1 | **284** |
| clause markers | 28,714 | 28,714 |

    without:  import `fs` (its default) from `fs`, `path` ... , and `dotenv` from `dotenv`, call config
    with:     import `fs` (its default) from `fs`, import `path` ..., import `dotenv` ..., configure a module

Naming ONE leaf in a run (`dotenv.config()`) unfolded the IMPORT run beside it — the import rule's
cardinality parameter stopped applying and three statements that were one clause became three. **A
name changed structure, which §5D.3A says only code may do.** It is invisible to all four gate checks:
bytes round-trip, payloads hold, coverage holds, and every identifier is still quoted — they are just
quoted three times in three clauses instead of once in one.

~~The cause is not the names. It is that nested rendering makes segmentation name-sensitive.~~
**THAT DIAGNOSIS WAS WRONG — struck rather than deleted, because the ruling below was made on it.**
Segmentation never moved. `enlzw.genSpans` reads no names; its `wholeRunOk` hook is `chunkGloss`,
which consults the AST and the rules only; and word ids ride in the payloads, which gate check 2 was
comparing successfully throughout. The clause-marker count was *identical* across both renders
(28,714) and that should have been read as the tell rather than passed over.

The real cause was one level up, in the LABEL. `namedLabel` composed one clause per statement —
`clauses.map((c, i) => c || spanProse([stmts[i]], frag))` — so it asked the renderer about each
statement in isolation and dissolved any rule that folds a run, wherever that run contained one named
leaf. Confirmed by building the pre-fix composition as a throwaway module and reproducing the exact
unfolded line, then confirming the fix removes it.

**Amir's ruling (2026-09-01), which stands and is now §5D.3A + R-LANG-23:** a leaf name must NOT
participate in segmentation; structure is computed from the unnamed dictionary first and names are
applied afterwards, purely as labels. Implemented one level up from where it was asked for, since
that is where the violation was:

| at commit `3df26f8`, toggling ONLY word-names.json | no names | 20 names, pre-fix | 20 names, fixed |
|---|---|---|---|
| unfolded import repeats | 1 | **284** | **1** |
| clauses the labels emitted | 45,767 | **46,055** | **45,764** |
| files byte-identical | 1037 | 1037 | 1037 |

The -3 is the adjacent-identical collapse (`declare a test suite 5 times`) — cardinality doing its
job, R-LANG-16 — which is why gate check 5 fails on an INCREASE and merely reports a decrease. Two
adjacent clauses can only become identical if the statements share a skeleton, because namer.js's
injectivity ledger refuses to spend one name on two keys in an axis.

**The check Amir specified — "word-id sequence identical with and without names" — already existed**
as gate check 2: a payload is `lzw1 n<id>⟨holes⟫`, so payload identity IS word-id-sequence identity,
and it was green the whole time. The new check 5 is the clause-level analogue, and is the one that
catches this.

The 20 names are applied and the corpus is re-rendered (1037/1037 byte-identical; `enfile.test.js`'s
corpus assertion, which had been failing against the stale `.en`, passes again).

**A note on evidence, since it was nearly recorded wrong.** `Examples/` is gitignored, so
`word-names.json` and every `.en` are UNTRACKED: a silent `git status` on them means nothing, and the
revert above was verified by re-measuring the corpus (284 -> 1), not by git. Any future claim that a
catalog "matches its committed state" has to come from a hash or a measurement.

Also worth Amir's eye independent of that: three of the 20 (`clearPartnerActivePropertiesCache` and
friends) came back WITHOUT the word "partner", and `‹id›.set(‹args›)` was named "set a configuration
value" while one of its two sites is a cache write (`cacheProxy.set(...)`). Both are the same defect
in miniature — a hole-free name standing in for a receiver the render had already dropped — and both
argue for the rule that quotes a call's receiver ahead of any further naming.

---

## 11. The filter run backwards: `name-words.js retire` (R-LANG-24)

§1's criterion decides, BEFORE a call is made, that a leaf a node-kind rule already renders is not
worth naming. Rules are written continuously, so the same criterion has a second direction that this
document did not state: **a name authored when no rule reached its skeleton becomes a DOWNGRADE the
moment one does.** The name is hole-free; the rule that overtook it is hole-filled.

This stopped being hypothetical the first time a rule landed after a naming batch. R-LANG-24 made a
call name its receiver, and of the 20 authored leaf names:

| | before R-LANG-24 | after |
|---|---|---|
| `‹id›.set(‹args›)` | "set a configuration value" | ``call `set` on `acc` `` |
| `clearPartnerActivePropertiesCache();` | "clear the active properties cache" | ``call `clearPartnerActivePropertiesCache` `` |
| `‹id›.credits.forEach(‹args›);` | "iterate over credits array" | ``call `forEach` on `creationData.credits` `` |

The first is the defect the pilot flagged — a name that is right for `Decimal.set` and wrong for
`cacheProxy.set`. The second is the name that dropped the word "partner"; the rule quotes the
identifier whole and the word comes back. **Measured: keeping those 14 names cost the corpus 1,768
concrete identifiers** against letting the rules speak.

**Nothing in the naming gate catches this**, and that is not a gap in the gate: the gate scores a
BATCH BEING APPLIED, and these names were correct when they were written and were already on disk.
What changed was the world around them. So retirement is its own command, with the same discipline
as every other step here:

- it re-tests each authored name against TODAY's rule annotations (`plan` must be current);
- it never touches a name whose skeleton is still unreached — 6 of the 20 stayed;
- it measures the corpus before and after, prints the figure either way, and **REFUSES to write if
  retiring would cost detail** — that outcome would mean the classification is wrong, not that the
  names should go;
- it stamps `retiredBy` into `word-names.json` so the deletion has a reason on disk.

**The standing consequence, which is the real content of this section:** a name is not a permanent
asset. It is a CLAIM that no rule says this better, and it has to be re-tested whenever the rules
change. §5D.2's priority — a rule serves every codebase, a name serves this corpus — is not only
about which work to do first; it decides which of the two gives way when they collide.
