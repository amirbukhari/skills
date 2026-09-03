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

---

## R-REND-6 CUT 2, PROVEN ON REAL DRIFT — 405 stale files, ZERO wrong bytes (2026-09-03)

The guarantee had only ever been demonstrated on fixtures. On 2026-09-03 it fired on the whole
corpus, unplanned, the same night it shipped.

**The situation.** `sen/files/**.en` was rendered under catalog `491bf65b`. The `MIN_SKEL=1` re-mine
(`5e080ec`) and the ExpressionStatement productions (`8240298`) then moved the prose — a persisted
heading reads `loop over handler` where the engine now derives `loop over` \`handler\`.

**The measurement, all 1037 persisted `.en`:**

|  | REFUSES | COMPILES |
|---|---|---|
| **DRIFTED** from a fresh render | **405** | 33 |
| **IDENTICAL** to a fresh render | **0** | 599 |

**Compiled but produced WRONG BYTES: 0. In every cell.**

**That zero is the guarantee.** 405 files drifted and not one produced wrong TypeScript. Before
`a5501a7` the label region was an inert comment, so all 405 would have compiled **silently wrong** —
a compile producing the wrong program with nothing anywhere saying so, which is exactly the failure
`tools/prd/14-two-roots.md` §1B.5 names as the reason byte-identity alone cannot license the flip.
It is now demonstrated against real drift rather than a fixture.

### The 405-vs-438 gap, resolved — NEITHER check is blind

`engine/en-idempotence.test.js` HALF 1 counts **438** drifted where the compile check refuses
**405**. Amir, 2026-09-03: *"are the 33 drifted but not refusing (a hole in the derive check —
serious, it means R-REND-6 has a blind spot) or refusing but not counted as drifted (a hole in
idempotence)? One of the two checks is blind and I want to know which."*

**Neither. The two checks ask different questions, and both answer theirs correctly.**

| check | property | question |
|---|---|---|
| R-REND-6 derive check | **internal consistency** | does each heading derive from the children beneath it *in this file*? |
| `en-idempotence` HALF 1 | **currency** | is this file what *today's* renderer produces? |

The 33 are exactly `consistent ∧ ¬current`.

**Hole 1 ruled out by measurement, and it was the one worth fearing.** `compileChunk` gates on
`derived !== null && derived !== written`, so **a null `derived` is a silent skip** — the fail-soft
path in `deriveStructuralGloss`. Replicating that call on every `▷` heading:

| cell | structural headings | CHECKED | SKIPPED (`derived===null`) | disagreements |
|---|---|---|---|---|
| the 33 (drifted, compiles) | 350 | **350** | **0** | 0 |
| the 599 (identical) | 1488 | **1488** | **0** | 0 |

**Zero skips.** The check fires on all 350 headings in the 33 and all 350 agree.

**Hole 2 ruled out:** the refusing-but-identical cell is **0**, so refusal is a strict subset of
drift and idempotence sees everything the compile check sees plus 33 more.

### `derived === null` IS NOT A BUG — do not "fix" the fail-soft path

**Read this before touching `deriveStructuralGloss` or the `derived !== null` gate in
`compileChunk`.** It is the single line in this area most likely to be mistaken for a defect by a
later reader, and "fixing" it converts a correct check into a false-positive generator.

`compileChunk` gates on `derived !== null && derived !== written`. A `null` means the engine could
not derive a heading for that site **at all**, and the check is skipped. That reads like a hole. It
is not, and skills-4a's line-level census of the same 33 files (below) is what makes the reason
concrete rather than asserted:

| drifted lines | shape |
|---|---|
| **161** | neither side is a chunk heading — inline atom / value-span prose only |
| **38** | **disk has NO heading where a fresh render DOES** |
| 11 | disk has a heading, fresh does not |
| 7 | both have headings and the text differs |

**The 38 are the ones that look like blindness and are not.** With no heading at that site, the
file **asserts nothing there** — so there is no claim that could be right or wrong. **Having no
subject is a different thing from having a subject and missing it**, and only the second is a
blind spot. A check that invented a verdict where the file made no claim would be manufacturing
disagreements out of silence.

That is the *one name over two properties* lesson (§16 entry 6) landing one level down — on the
**site** rather than on the **check**. "The check didn't fire here" spans *it had nothing to check*
and *it failed to check something*, and those want opposite responses.

**Two measurements bound it, from directions that cannot see each other**, which is why both lanes
were told to measure independently:

- **Heading census (this lane):** every `▷` heading in the 33 — **350 checked, 0 skipped
  (`derived===null`), 0 disagreements**; and in the 599 clean files, **1488 checked, 0 skipped**.
  So on every site that *does* carry a heading, the check fires. Structurally cannot see sites with
  no heading.
- **Line census (skills-4a):** the 217 drifted lines above. Sees exactly those sites, and shows the
  majority of the drift (161) never touches the chunk layer at all — the strongest form of *the
  drift is the renderer improving*: most of it is inline spans the productions now fold in.

So: **a `null` return is the correct behaviour for a site that carries no heading.** If a future
change makes `null` mean "I failed to parse something I should have parsed", that is a different
condition and it needs a **different signal** — a counter, or a distinct sentinel — not a
repurposing of `null`. Both were measured at zero here; a nonzero skip count is the finding.


**What the drift actually is**, checked rather than assumed: in `src/csvUtils.ts` the persisted `.en`
carries inline value spans — `«an object with abnormalRows»`, `«text: "All rows must have…"»` — where
a fresh render emits a `«▶ … ⟪lzw1 n5009 …⟫»` chunk. Those inline spans are a legitimate older
dialect form, not marker-less garbage: they compile to `{ abnormalRows }` and to the template
literal, with no guillemet leak and byte-identical output. The productions are collapsing more into
chunks. **The drift is the renderer improving.**

**The §16 lesson, and it is not the one either session expected.** The two checks were never in
conflict; they were two different questions that both sessions independently read as one. That is
the same substitution as *"byte-identity 1037/1037"* covering both the **renderer** and the
**corpus** (§16 entry 6), one layer out: **one name over two properties.** Neither a guard that
could not fire nor a measurement that read low — a *name* that quietly spanned two subjects. Name
the subject in the assertion's own text.

### The drift, measured a second way — line-level, from the other lane

Two lanes answered the 405-vs-438 question with different methods on purpose (Amir, 2026-09-03:
*"Measure independently — do NOT converge methods with s2 first"*). The section above counts
STRUCTURAL HEADINGS and finds 350/350 checked, zero skips. This one counts DRIFTED LINES, and it
corroborates the same conclusion from a direction the heading census cannot see — because a heading
census can only look where a heading already is, which is precisely the blind spot being tested for.

**All 217 drifted lines across the 33 `consistent ∧ ¬current` files**, classified by whether each
side of the pair carries a chunk heading (`«▶` or `«▷`):

| drifted lines | shape |
|---|---|
| **161** | neither side is a chunk heading — inline atom / value-span prose only |
| **38** | disk has **no** heading, fresh **does** — a new chunk where the older render was flat |
| **11** | disk **has** a heading, fresh does not |
| **7** | both are headings, and the heading text differs |

**Why this is the load-bearing half of the answer.** The 38 are the case that *looks* like a derive
hole and is not: at those sites the persisted file contains **no heading at all**, so there is
nothing for a heading-vs-children check to disagree with. It is tempting to call that "the check
was blind there". It is not blindness — **there is no claim at that site to be right or wrong
about.** The file asserts nothing about a chunk it does not contain. The check has no subject there,
which is a different thing from having a subject and missing it, and conflating the two is how a
correct fail-soft path gets "fixed" into a false positive.

The 161 settle the other direction: the **majority** of the drift never touches the chunk layer at
all. It is inline value spans — `«an object with abnormalRows»`, `«a list of …»`, `«text: "…"»` —
which the productions now fold into chunks. Those compile byte-identically from either dialect, and
R-REND-6 makes no claim about them, correctly.

**Both methods agree and neither could have produced the other's evidence**, which is the whole
argument for having run them separately. A convergence here would have been worth less than the
agreement is.

---

## THE TARGET SENTENCE HAS TO BE DERIVED AND VERIFIED, NEVER AUTHORED

*2026-09-03. The argument for the honesty rule, and the worked example is the approved target
itself.*

Amir was shown `src/routers/links.ts.en`, whose first line was a ~200-word run-on naming all
fifteen imports and then every route joined by "then", and said **"You lied to me."** Every metric
reported about that file was true. The picture was false. The consequence taken from it: **no metric
stands in for the goal any more.**

The approved replacement, his words:

> The `links` router exposes two Freshbooks endpoints, both behind a JWT check.

**That sentence is false about his own code.** `isValidJwt` is imported once and called once, inside
the FIRST route only. The second route, `/authorized`, is a Freshbooks authorisation callback with
`validate<void, void, ICode>({ query: validateCode })` and `authorizeFreshbooksAccount(code)`, and
**no JWT reference anywhere in it** — verified twice independently, at the source, before either of
us built to it.

Read what the sentence gets right, because that is the point:

| clause | true? | why it survives review |
|---|---|---|
| counts — *two* | yes | trivially checkable, and checked |
| classifies — *Freshbooks endpoints* | yes | recurs in three identifiers across the file |
| names zero imports | yes | §4B; the thing the run-on got wrong |
| shared property — *both behind a JWT check* | **NO** | **one route of two** |

Three clauses out of four are right, the sentence is short, declarative and fluent, and the one
wrong clause is the one a reader would ACT on: it sends him looking for a check that is not there.
A run-on wastes his time; this misinforms him about his own system. **A wrong summary is worse than
a long one**, and this is what that costs.

**And a human wrote it, from the file, and approved it.** Not a model, not a generator — the person
who knows the codebase, working from the source. That is the whole argument, and it is why the
honesty rule is mechanised rather than trusted:

- **Quantifiers are derived from counts** (`quantify`), so no label can overstate. `both` requires
  2 of 2; `all` requires n of n; `most` requires a strict majority; a minority is **not stated at
  all**, because "some behind a `check…` guard" was measured on `src/xero-api/contact.ts` off one
  function of twelve and read as a classification when it was a coincidence of naming.
- **A shared property is an intersection**, never a sample. What `links.ts`'s two routes actually
  share is the `validate` guard, so that is what the engine says:
  `` The `links` router exposes two Freshbooks GET endpoints under `/links`, both behind a `validate` guard ``
- **Vacuous is counted, not hidden.** 5.5% of files (57 of 1038) get no claim. Amir: *"I would take
  an honest 40% vacuous over a plausible 0%."*

The corrected target (his, written in five minutes from the source, and offered with the warning
*"I am exactly the kind of author that finding warns about"*) holds on every clause. Two things in
it are still imprecise, reported rather than quietly built around:

1. It says the first route *"redirects to that invoice's share link and notifies user `1`"*. The
   source notifies **then** redirects. The conjunction reverses the order.
2. It says the second route *"returns the token's expiry"*. `ctx.body` returns **four** fields —
   `params`, `request: { query, body }`, `tokenResponseStatus` and `expiry`. Not false; partial.

Neither would mislead him. Both are the same class of defect as the JWT clause, two orders of
magnitude smaller, and they are recorded here because the rule cuts against whoever is writing —
including whoever writes the rule.

**The standing consequence:** a label is derived from the AST and cross-checked at compile
(R-REND-6), or it is not emitted. A sentence that cannot be re-derived from the bytes is not a
label, however good it reads. `engine/en-file-claim.test.js` §3b asserts, permanently, that the
engine does **not** say "both behind a JWT check" about this file.
