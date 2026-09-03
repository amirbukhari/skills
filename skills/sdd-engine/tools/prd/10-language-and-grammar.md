# 5C. Language and grammar — how a word becomes a sentence

*PART II — THE MECHANISM · [index](README.md)*

§5 says how structure is *discovered*. This section says how it is *read*. A rendered `.en` clause
is produced by exactly two layers, and knowing which layer owns a given site is the whole of the
design.

## The two layers

| | **Skeleton NAMES** | **Per-site PRODUCTIONS** |
|---|---|---|
| granularity | one per mined word | one per statement kind |
| where | `<corpus>/sen/catalog/word-names.json`, applied in `namedLabel` | `spanProse` in `engine/enfile.js` |
| sees | the canonical skeleton only | the actual AST at the actual site — identifiers, callees, literals |
| population | the whole nameable-word queue | **a handful of statement kinds** |
| ceiling | the skeleton share of corpus bytes — a hard cap | everything a statement can say about itself |

**Productions are the larger and cheaper half, and that is the central finding.** Fourteen
statement kinds reaches further than the entire nameable-word queue, because a production reads the
site and a name cannot. Naming is a background trickle against the queue; productions are the line
of work.

## The admission rule for naming (verbatim, decidable)

> **Name a leaf only where `spanProse` has nothing site-specific to say.**

Applied to the highest-frequency words, this rule **refuses the large majority and admits few** —
and that ratio is the rule working, not failing.
The reason a refusal is *correct* and not laziness: where `spanProse` can quote the real identifier
and the real callee — ``await `invoices` from `softDeleteRecordsForRun` `` — a static skeleton name
is a **REGRESSION**. It replaces two true facts about this site with one generic phrase about a
thousand sites. An unnamed word is honest; a vacuous name is noise that looks like progress.

## Names key on content, never on word id

A name's key is **`sha256(canonical skeleton)[0:16]`**, axis-prefixed — never the word's dictionary
id, which is an artifact of mining order and changes when anything upstream changes.

**The property that must hold: mining-parameter changes orphan NOTHING, and a canonicalizer change
orphans exactly the skeletons it altered.** Because names key on the content hash of the canonical
skeleton (never on the word id), retuning `MAXWIN`, `MIN_COUNT` or `MIN_SKEL` cannot orphan a name —
the skeletons are unchanged. A canonicalizer change *does* orphan the names of the skeletons it
altered, and **that is correct behaviour, not a failure**: those skeletons genuinely became different
skeletons, and a name that followed them across the change would be asserting a meaning nobody
verified.

## The steady state — orphan, never delete

Names outlive the words they were written for, so the naming catalog is append-and-orphan:

1. A name whose skeleton no longer exists moves to the **`orphans` ledger**. It is never deleted.
2. Before generating any new name, the authoring pass **matches against orphans first**.
3. A match produces a **re-adoption PROPOSAL** written to the rename queue (`<corpus>/.cache/spec-derived/name-queue.json`,
   derived/gitignored), scored by token edit distance. **It is never applied automatically.**
4. **Queue length is a first-class metric**, reported beside byte-identity.

> **Auto-re-attachment is the producer/consumer drift bug (§2.2) in a new costume.** A name silently
> re-attaching to a skeleton that merely *resembles* the one it was written for is a producer
> asserting a meaning no consumer verified — and the failure is silent by construction, because a
> wrong name renders as confident prose. The proposal step exists so a human is the consumer.

## The SENTENCE is authoritative — rewritten 2026-08-31, mechanics landed 2026-09-03 (`a5501a7`)

**This section used to say the opposite, and the old text is worth stating so the change is legible:**

> *"Names are cosmetic by CONSTRUCTION, not by test. `compileChunk` recovers a payload with
> `chunk.lastIndexOf(PAY_OPEN)` / `chunk.lastIndexOf(PAY_CLOSE)` and never reads the label region at
> all. A wrong name therefore yields wrong prose and byte-identical output. This is a structural
> property of the compiler, not a property maintained by a test — the test would be the weaker
> guarantee."*

### A STRUCTURAL HEADING IS RULED A REFUSAL, NOT AN HONOURED EDIT (2026-09-03, Amir's ruling)

**This is not a relaxation of rule 2, and it must not be read as one.** The sentence-authority
suite originally demanded that editing a *structural heading's* English change the compiled
TypeScript, exactly as it demands for an atomic clause. That demand was **dropped on argument and
approved**; what replaced it is a harder assertion, not a weaker one.

**Why a heading cannot be honoured.** A heading is not an independent statement about the code — it
is **computed from its children** (`namedLabel`/`genLabel` over the run), so every identifier in it
is an *echo* of an identifier in a clause below it. An edit to the heading alone is therefore not
"the sentence disagreeing with a derived index"; it is **two pieces of English contradicting each
other**, and there is no principled winner. Honouring the heading would silently rewrite child
clauses the human never touched and left **visibly saying the old name** — which is the same failure
shape as automatic re-adoption (R-LANG-7): a plausible inference applied without a human seeing it.
So the ruling is a **loud refusal naming both sides**.

**Why rule 2 is untouched.** The edit remains fully **expressible** — at the child, where it takes
effect through the hole-repair path, after which the heading re-derives to match on its own. Every
semantic edit has an effective home; a heading simply is not it. `engine/sentence-authority.test.js`
§9 **proves** this end-to-end rather than asserting it, in three rows:

| | edit | outcome |
|---|---|---|
| 9a | child clause only, heading untouched | **honoured** — the heading is *behind* the body, not contradicting it, so the body wins |
| 9b | child and heading edited to agree | **honoured** — consistent English at both levels |
| 9c | child edited, heading edited to a **different** name | **refused** — a heading the human really did edit is still a contradiction |

**9c is the load-bearing row.** Without it, 9a's allowance could silently degrade into "accept
anything once a child moved", and every row above it would look identical. The discriminator is
exact rather than heuristic: re-compile the body with repair off to reproduce the **pre-edit** bytes
and derive the heading from those — if it matches what the human wrote, the heading is merely stale;
if it matches neither, they edited it too.

That was a real guarantee, and it is still an accurate description of `compileChunk` today. **It is
also incompatible with the lifecycle Amir requires** (§5D.0 statement 4): he mines the codebase to
get the `.en`, **hand-edits the `.en`**, and it goes back into the codebase. If the compiler never
reads the label region, then editing the English changes nothing and the hand-edit half of the
lifecycle does not exist — the `.en` would be a read-only report with an editable-looking surface.
The old rule made prose safe by making it inert.

**The rule now:**

1. **A hand-edit to a clause's English MUST change the compiled TypeScript.** The sentence is the
   source; that is what §1 has claimed all along.
2. **The payload is a DERIVED INDEX, not the source of truth.** It stays — it is what makes compiling
   fast and unambiguous — but it is a cache of what the sentence says, regenerable from it.
3. **Sentence and payload disagreeing is an ERROR, loudly.** Not a tie the payload wins. This is the
   §8B contract discipline applied one level in: a consumer that cannot verify what it is reading
   refuses. The specific check is that re-deriving the payload from the sentence reproduces it.
4. **What the old rule was really protecting is kept by other means.** Its worry was that a wrong
   name silently produces confident wrong prose. Under sentence-authority a wrong name is no longer
   silent: it changes the compiled output, so **byte-identity catches it** — a stronger guard than
   inertness, because it fails loudly instead of not mattering.

**Mechanics are §5E.5**, and the mechanics are genuinely open (§Q-3): making the compiler parse
sentences through the grammar rather than `lastIndexOf` a payload is a real change to `compileChunk`.
The **direction** is not open.

## The one place a proposal queue survives — ORPHAN RE-ADOPTION

§5D.2 makes naming a script that *names*, not a worksheet that waits. That override is about
**naming**. It does not touch the narrower rule above it: a name whose skeleton no longer exists goes
to `orphans` and **re-adoption is proposed, never applied automatically** (R-LANG-7). Re-adoption is
not naming — it is a name silently re-attaching to a skeleton that merely *resembles* the one it was
written for, which is the producer/consumer drift bug in a new costume, and no gate catches it
because the output is byte-identical either way. That queue stays.

## The hole taxonomy — a per-site predicate, not a per-type policy

Holes are the domain meaning: they carry the identifiers, literals, and type names the skeleton
generalized away. The cut that matters is **word-like vs code-bearing**:

- **word-like** — a hole whose contents read as a noun in a sentence: `` `invoices` ``, `` `./helpers` ``,
  `` `HttpStatusCode.NotAcceptable` ``. These **stay verbatim** and are quoted into the clause. They are
  already the clearest possible words; §3 backs literals staying verbatim.
- **code-bearing** — a hole whose contents are an expression with its own syntax: index arithmetic,
  chained ternaries, inline object construction. These are code, and a template that splices one into
  a sentence produces **code wearing a sentence's clothes**.

**The cut runs ACROSS hole types, not along them.** An identifier hole is usually word-like and
sometimes not; a literal hole is usually word-like and sometimes an inline object. So the rule is a
**per-site predicate on the hole's contents**, evaluated at render time — never a policy attached to
the hole's type. The English-completeness scanner (§7) is the mechanical form of that predicate:
strip the quoted verbatim regions, and if TypeScript syntax remains, the clause failed.

## The honesty rule for productions

If a production cannot say something **true** about a site, it emits the vacuous clause and that
site is **counted** (§7). A production retires a vacuous clause by saying something true about the
site — **never** by rewording the placeholder into something that merely escapes the frozen list.

---

---

## A SCALE LABEL IS A CLAIM, NOT A CONCATENATION (ruled 2026-09-03)

**The defect.** The first folder and program labels joined their children's labels with `", then "`.
That is *a concatenation wearing a summary's clothes* — the same failure the file scale had, one
level up. Measured: the median file label is **36 words, p90 103, max 1158**, so a program heading
built by joining them opened `root program: packages: hydra-internal: src: enums: list the choices
for …` and ran to ~10 MB. *Amir:* **"it should have been one word with the composition of the words
that made up that one word... shouldn't have been a hundred words it should have been like a couple
dozen words."** The composition is what makes a label **derivable**. It is not what the label should
**say**.

**Two designs were tried and rejected on evidence before the ruled one.** Both are recorded because
each is the obvious next idea, and the first is the dangerous one.

| attempt | result | why rejected |
|---|---|---|
| classify each file into an **archetype** ("shape", "route module", "function module") and count them | 0.6% unclassified; reads beautifully | **It lies about real files.** Found only by spot-checking the buckets: `infinityReportHelpers.ts`, a helpers module that happens to declare one interface, was confidently labelled a *shape*; `properties.ts` a *type alias*. **A file that CONTAINS a shape declaration is not a shape.** |
| give a file a kind only when **exactly one** category matches; call the rest `mixed` | honest | **626 of 1038** files match more than one category, and *"626 mixed modules"* tells Amir nothing about his own code. |

**The ruling: count files by the clauses they CONTAIN — a non-exclusive observation, never a
judgement about what a file *is* — and state it with a quantifier derived from that count.**

```
enums: 9 files, all listing choices
invoicing: 23 files, all defining functions, most describing shapes, some listing choices
```

`all` = every descendant file, `most` = more than half, `some` = at least one. This is a claim
**about the folder**, it is short, and it is checkable clause by clause. It is also the shape of
Amir's own example — *"twelve HTTP routers, all behind a JWT check"* is a count plus a universal,
and **the universal is the part that says something.**

**Categories test for phrases THIS ENGINE RENDERS**, so a category is a statement about the English
in the artifact rather than a guess about intent — which is also why it is reproducible on compile
from the file `.en` alone, with no artifact lookup and no second source of truth.

**THE HONESTY RULE IS IMPLEMENTED, NOT ASPIRED TO.** A category is only ever reported at a
quantifier its count supports, so **no label can overstate by construction**. When nothing is
observable the label is the bare folder name — **vacuous** — and it is **counted** in
`vacuousLabels` and reported. *Amir:* **"If you can't make a true claim about a folder, emit the
vacuous label and COUNT it... I would take an honest 40% vacuous over a plausible 0%."** A run-on
wastes his time; a wrong summary misleads him about his own code, and those are not the same cost.

**A measured over-claim, caught by comparing two markers rather than by reading either.** The
`set constants` category first used a bare `/\bset\b/`. That matched **424** files where the
anchored form matches **315** — **109 of them on prose that is not a constant at all**: *"stop early
when `generationType` is set"*, *"check whether `con.isConnected` is set"*. Every one would have been
reported to Amir as a folder that sets constants, and the loose version read plausibly at every
folder inspected. `define` and `compute` were measured the same way and are clean at 705 and 386.
Anchoring it **changed the program's own claim** from *most setting constants* to *some setting
constants*, which is the proof the correction was load-bearing rather than cosmetic. Pinned by
§9b of `engine/en-scales.test.js`, using the exact prose that produced it.

**A consequence worth naming, because it is an improvement and not merely a simplification.** A
parent now composes from its children's **digest** (counts and categories), not their label strings.
So renaming a folder stales **exactly one** label — its own — where it previously staled every
ancestor's. The refusal Amir gets names the folder he actually edited instead of an ancestor he did
not. The superseded test comment that reasoned about the old cascade is quoted in place in §7 of
`engine/en-scales.test.js` rather than deleted.

**Measured, whole corpus, catalog `1e5349a1`:** words per label **median 12, mean 10.6, max 16**,
**0 of 216 labels over 24 words**, vacuous **3/216 (1.4%)**, unclassified files **16/1038 (1.5%)**,
round-trip **byte-identical 1038/1038**, program `.en` **10,002,931 → 6,759,155 bytes** (−32%, all of
it run-on headings). `engine/en-scales.test.js` **55/55**.
