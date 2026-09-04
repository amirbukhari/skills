# 5. Architecture

*PART II — THE MECHANISM · [index](README.md)*

**The core pipeline — LZW dictionary construction over the AST (the intended design).** This is the mechanism the rest of the system exists to serve:
1. **Parse → AST.** Each source file is parsed to its TypeScript AST.
2. **Linearize bottom-up.** The AST is walked leaves-first into a node-symbol stream (`engine/fanout.js`), so structure is encoded before the constructs that contain it.
3. **LZW encode → recursive dictionary.** The encoding half of LZW runs over that stream (`engine/lzw.js`, `engine/compose.js`): every new dictionary entry is an existing entry **plus one symbol**, so the dictionary is recursive — bigger words are literally defined as smaller words. **Each entry = a word = a generator**, and because entries cite earlier entries, **generators reference generators for free** (the composition of §2.4). Dictionary depth *is* the ARCHETYPE→SKELETON→IDIOM→LEAF hierarchy — emergent, not labeled.
4. **Re-emit as a word stream.** The file's `.en` is the file rewritten as references to those words; repeated structure becomes a single reference, so the source is **shorter and lossless** (LZW inverts exactly, and the fully-expanded result is gated byte-exact, §2.3).

✅ **This is what runs (§4A, §4B).** Steps 1–4 are the live path; the flat anti-unification layer is deleted. The tiers below describe the dictionary's emergent structure, not a target.

**Tiers (top → bottom) — realized as composition (§2.4, §5B), not as labels.** A file is described at the coarsest tier that conforms, and each tier expands *through* the tier below it (a higher generator's fill invokes a lower generator, down to leaves):
1. **Archetype** (`archetypes.js`) — the file *is* a word: a fixed architectural template with big typed slots (Entity = `@Entity` + columns\* + relations\*; RouterModule = `Router(prefix)` + routes\*). Conformance-gated: residual top-level code is *reported*, never absorbed to inflate the number.
2. **Skeleton / operation-idiom** (`operations.js`; the builder `build-operation-idioms.js` is **archived**, see the retirement notice below) — recurring statement/procedure shapes via anti-unification, **assembled from tier-3 idioms**. *(Middle tier — **RETIRED**; kept in this list only because the tier numbering below refers to it. Flow in §5A, composition requirement in §5B.)*
3. **Statement + data idiom** (`cnl.js`, `data-english.js`) — single statements and data leaves rendered as controlled English.
4. **Leaf / literal** — opaque atoms and genuinely-novel bytes, verbatim (the base case of the composition recursion).

✅ **Live-path status — MEASURED, not asserted (§Q-2, 2026-08-31).** These tiers are realized as real
composition on the live path: `enfile.js` loads `<CORPUS>/sen/catalog/generators-lzw.json` and
nothing else, spans are all recursive with no flat producer in existence, and `generators.maxDepth`
on the live path clears R-COMP-7's `≥ 2`. The flat `generators.json` is read by nothing live.
*(This line previously carried a specific depth figure and a `catalog/…` path. Both were stale — the
figure was a point-in-time reading and the path predates §8B moving every artifact under the corpus
root. How deep the REAL corpus goes is unmeasured and is §Q-8.)*

⛔ **The statement-idiom layer is RETIRED and must not be revived as a parallel producer.** It was
never invoked by the mine, so its catalog froze at its last manual run and **no action a user could
take could move the count it published** — and nothing on the `.en` compile path ever read it. Two
rules follow. **A number no mine can move is not a measurement, and the engine must not publish
one.** And a catalog with no consumer on the byte-exact path is not a layer; it is drift waiting for
an audience. *(That is drift in the sense of an unread catalog. For drift of a file away
from the shape its own archetype claims — a different mechanism, residual over the top-level tiling —
see §5F, R-ARCH-20.)*

**The fold (universal invariant).** At every tier a construct is only replaced by a higher-tier form when the higher-tier form refills to the **exact source span**. Segment lists tile `[0, len)` exactly (`checkTiling`), each segment reproduces its own bytes, so `reconstruct === source` by construction. This is what makes byte-identity a property of the *design*, not of any particular file.

**On-disk layout.**
- `<corpus>/sen/files/<rel>.en` — the **canonical human artifact** (English + verbatim TS). Edited by hand.
- `.cache/` — build intermediates and the derived `spec-derived/` artifacts. **Gitignored, regenerable, never committed.**

> **RETRACTED 2026-09-04 — `.calc` is retired.** Amir: *"I dont think we do .calc anymore bro"*, then *"yeah kill that lol"*. Kept and corrected in place rather than deleted (`../../CLAUDE.md` §9) so a stale memory cannot re-derive it. **Measured 2026-09-04:** `sen/files/` holds **1,037 `.en` and zero `.calc`**, there is no `.calc` anywhere under `CORPUS`, `.cache/compose/` does not exist, and **no step of the 14-step `sdd-run --list` manifest reads or writes one**.
> This line used to read *"derived compose IR (`.calc`) and build intermediates"*. The `.en` under `sen/files/` is the user-facing view and there is no second derived form beside it. `.cache/` still exists and is still gitignored — it holds `spec-derived/` (the naming plan, name queue, en-index, gate, language) — but it holds no `.calc`, and `.cache/compose/` was never created.

- `.ts` — derived output; byte-identical to what the `.en` compiles to.

**The panel loop.** `mine → author (.en) → compile → verify`, driven by `repo-dsl.js`:
`repo-dsl mine` (fan-out + LZW + promote generators, write library + coverage) → author/edit `.en` (`enfile.js`, `author.js` for the CNL authoring grammar) → `compileFileEn` back to TS → `repo-dsl verify` (byte-diff over the token stream) → `gate` (pass/fail on corpus coverage). **`verify-expand` was removed from this loop on 2026-09-04** with the rest of the `.calc` surface; the corpus-wide `verify` is what remains. `prose.js` narrates a file across the tiers for the panel, with an explicit HONESTY RULE (un-named bodies read as "custom logic (N statements)", never invented prose).

---

## 5D. The ARCHETYPE LAYER — a pattern/words hybrid (REQUIRED; **direction SETTLED**, mechanics being designed)

> **STATUS, 2026-08-31.** Everything in §5D.0 is **settled direction**, not a design input to be
> weighed. **Amir, verbatim:** *"put all that shit I just said into the PRD. its the final truth so
> far. get rid of shit that doesnt agree with that because its old shit."* Where earlier PRD text
> disagreed it has been **rewritten or cut**, not left standing beside the new position — see the
> superseded-text ledger in §5D.3. What remains open is **HOW**, not whether (§Q-3, §Q-9).

### 5D.0 Amir's direction, verbatim — the eight statements the design must satisfy

Recorded in his own words, because every reframe in this project has cost a rework. The design pass
these produced is **§5E**; what is still open after them is **§Q-3** (archetype mechanics) and
**§Q-9** (naming-stage mechanics).

**(1) The hybrid, 2026-08-31:**

> *"I do think the archetype stuff needs to stay though and it needs to be a pattern/words archetype
> hybrid."*

**(2) Archetypes are FORWARD/GENERATIVE, and re-mining must reproduce the identical `.en`,
2026-08-31:**

> *"the architecture layer is supposed to be things like, this is the high level pattern like
> entities, this is what you call to make a new entity in that pattern, and it makes it and gets
> translated/built into the source codebase. then if I mine the codebase again I should see no change
> to the .en file because it backwards builds the .en file back into exactly what was written
> anyways"*

An archetype is a **constructor you invoke to author new code**, not only a shape the miner
recognizes. And the acceptance criterion is **idempotence under re-mine** — the re-mined `.en` must
be byte-identical to the `.en` that was authored — which is strictly stronger than byte-identity of
the `.ts`. Formalized as **AT-ARCH-1** in §5E.

**(3) Composition IS grammar — sentences calling sentences, 2026-08-31:**

> *"then we need to make sure we are using grammar and words to form sentences that can be patterns
> that generate code. its supposed to be code generators that call code generators but its
> sentences"*

The generator-calls-generator mechanism (§4A, §5B) is **not** opaque symbolic references with English
as a cosmetic gloss. **A generator's call to another generator is a sentence invoking a sentence** —
*"an Entity **has columns** […]"*, where *"has columns"* invokes the column-sentence generator.
Consequence, and it is a large one: **§5C's grammar/production layer and the archetype/word
composition mechanism are the SAME system**, not two layers that coexist. §5E.3.5 states how.

**(4) The full lifecycle runs in BOTH directions, 2026-08-31.** Mine the codebase **first** to
generate the `.en`; hand-edit the `.en`; it goes back into the codebase. **And the reverse must also
hold** — edit the codebase directly, re-mine, and get the `.en` back matching. Neither direction is
the derived one.

**(6) ONE WORD PER FILE, read in English — a hard target, 2026-08-31:**

> *"and it needs to be in english. I can read english faster than I can read code. with the LZW
> pattern you can turn the whole codebase into 1 word, each file can become 1 word. dont tell me that
> you cant do this."*

**Settled requirement, not an open question.** Stated as a design target in §5D.4 and as R-ARCH-15 /
R-REND-8. It **supersedes R-MINE-7 (THE LIFT)** as that rule was written; see §5D.4.

**(7) The file word IS its parts — the editability nuance, 2026-08-31:**

> *"the thing is that what you should do is make it so that each file isnt actually its word. its the
> words that make up that word. so that it can be editable."*

**This is a correction to any reading of statement 6 as opacity.** "One word per file" is a claim
about **compositional structure**, not about collapsing to a black box. Stated in §5D.4.

**(8) The success metric is REVIEW SURFACE, not compression, 2026-08-31:**

> *"its not about compression, its about less of a review surface. I need to be able to review less
> code because im reviewing deterministic code generators which are made of preexisting patterns from
> my code base."*

Compression is the **mechanism**; the **goal** is that a human reviews less. Carried into §7 —
see `15-success-criteria.md`, "Review surface is the metric".

**(5) TWO pipeline stages — a deterministic mine, then an LLM-assisted naming step that is still a
script, 2026-08-31:**

> *"the deterministic words that get generated wont be human readable, neither will be the grammar I
> would assume, so that would be an LLM step that we trigger, but it should be a script in the
> codebase still. then what comes out of the LZW pattern code generators calling code generators are
> .en files that can be written and read like english and it knows the whole domain of the code base
> because each pattern/code generator is word made up of other words."*

This settles something the PRD previously had backwards, and §5D.2 states it as a pipeline.

### 5D.2 The two stages — DETERMINISTIC MINE, then SCRIPTED LLM NAMING

The pipeline has exactly **two kinds of step**, and the boundary between them is a hard line:

| | **Stage 1 — the mine** | **Stage 2 — the naming** |
|---|---|---|
| what it does | pattern discovery, LZW dictionary construction, generators referencing generators, hole extraction | turns raw discovered patterns into readable English **words and grammar** |
| model calls | **ZERO** (R-MECH-4, §3 P1) — non-negotiable | **an LLM, deliberately** |
| reproducible | bit-for-bit, from the corpus alone | no — the model's output is an input to the corpus from then on |
| invoked how | `npm run mine` | **a script in the codebase** (`npm run name`), triggered on purpose — **never ad hoc, never by hand in a chat** |
| output | `generators-lzw.json` — correct and unreadable | `word-names.json` — the same dictionary, now sayable |
| what gates it | byte-exact refill of every hole | byte-identity + coverage invariance + grammar injectivity (§5E.4) |

Three consequences, all of them requirements:

1. **The raw dictionary is expected to be unreadable, and that is not a defect.** `g_412_a1b2c3` is
   a correct word with no name yet. The PRD must not treat unreadable mined output as a mining
   failure — it is stage 1 finishing its actual job.
2. **The naming step is a first-class pipeline stage with a script, not a human worksheet.** It
   *runs*; it does not merely *propose* and wait. What replaces the human as the consumer is the
   **gate**, not a review queue: a name that changes one output byte, lowers coverage, or breaks
   grammar injectivity is rejected mechanically. (The one place a proposal queue survives is
   **orphan re-adoption** — see §5D.3 note 3.)
3. **The LLM's blast radius is WORDS — the spelling of a nonterminal — and nothing else.**
   Nothing correctness-relevant comes from a model: not a hole, not a span boundary, not a
   dictionary entry, not a compile, and **not a production, a connective, or a slot boundary**.
   The grammar shell is deterministic and code-owned; see **§5D.3A**, which pins the split and
   retires the older phrasing of this line ("names *and grammar surface* only" — a phrase defined
   nowhere, whose loose reading would have let a model author the sentence shapes themselves).
   R-LANG-11 is tightened to match.

**Why the `.en` is readable at all** — Amir's last clause is the mechanism, and it is worth stating
plainly: *"it knows the whole domain of the code base because each pattern/code generator is word
made up of other words."* Readability is **compositional**. Naming a word does not require describing
everything it covers, because its parts are already named, and a name at depth 5 inherits the domain
vocabulary of everything beneath it.

**The cost claim that followed this, "stage 2's cost is per *word*, not per *site*", is CORRECTED by
measurement (2026-08-31, §5D.3B.3.4).** Counted over the rendered corpus: **5,192 span occurrences,
3,290 distinct words, and 2,853 of those words — 87% — used exactly once.** At 1.58 sites per word,
naming every word is very nearly naming every site. The cause is not a defect: `MIN_COUNT = 1`
promotes a word that occurs once, and a one-off run of 12 statements still collapses 12 statements
into 1 call, so it earns its place on review surface while recurring nowhere.

**What actually amortises is the PHRASEBOOK, not the names.** One declared rule for
`ImportDeclaration` serves every import in every codebase — one name or ten — without any of those
words being named. Rules amortise; names do not amortise at all. So the priority inverts: **build the
phrasebook first, name second, and name only words whose reuse justifies a noun phrase.**

*The strength of that instruction changed on 2026-08-31 when the phrasebook's key did.* It was argued
here from mined-shape counts (10 / 91 / 437 templates for 50 / 80 / 90% of **this** corpus), which
made the table look tractable while it in fact grew with every new codebase. **§5D.3C** replaces the
key with the language's **AST node kinds**: 8 / 19 / 28 rules for the same coverage, fixed by the
parser rather than discovered by the miner, and **enumerable in advance** — the corpus exercises 100
of TypeScript's 400 kinds, and 53 rules reach 99%. Same instruction, and now a justification that
terminates. Two things need Amir's call: whether
`MIN_COUNT` moves to 2 on the naming path (trading a third of the collapse for vocabulary that
repeats), and whether an unnamed-but-templated word is acceptable — one reads as *"imports getManager
from '../helpers'"*, which is already English and needs no model at all.

### 5D.3A THE SPLIT — a DETERMINISTIC GRAMMAR SHELL, and an LLM that fills only WORDS

**Settled 2026-08-31.** Amir, on the fixed-slot template he wants the naming stage to produce:
*"structured English with grammar rules and syntax that stops you from drifting outside of the
patterns."* The line this draws is the one that matters for stage 2, and §5D.2's table did not draw
it sharply enough on its own:

> **The grammar, the syntax, the template and the slot boundaries are DETERMINISTIC and produced by
> code. The model supplies WORDS — the name that spells a nonterminal — and nothing else. It never
> writes a sentence, never chooses a connective, never decides where a slot begins or ends, and
> never emits prose.**

| | produced by | may a model touch it? |
|---|---|---|
| the production (`Entity → "«Name» is an entity stored in «table»." Columns Relations`) | code, from the entry's role signature | **no** |
| slot boundaries, order, and the connectives between them | code | **no** |
| which alternative of a production applies at a site | code, from the mined structure | **no** |
| hole fills (the file's actual bytes) | the mine, byte-gated | **no** |
| **the SPELLING of a nonterminal** — `g_412_a1b2c3` → `chargeCommission` | **the model** | **yes, and only this** |
| **how many clauses a label has, and which statements each covers** | code, from the rules (`spanActions`) | **no** — see the amendment below |

**AMENDED 2026-09-01 (Amir's ruling, R-LANG-23).** The table above was necessary and not sufficient.
It constrains what a model may *supply*; it says nothing about what an already-supplied name may
*displace*, and a name that displaces a rule has taken a structural decision as surely as if the
model had written the sentence itself. Measured, twice, both times passing every gate then in force:

> **SEGMENTATION AND CLAUSE STRUCTURE ARE COMPUTED FROM THE UNNAMED DICTIONARY FIRST. NAMES ARE
> APPLIED AFTERWARDS, PURELY AS LABELS.** A name may change how a clause READS. It may never change
> how many clauses there are, which statements each one covers, or where a word begins and ends.

Concretely, this binds `enfile.namedLabel`, which is the only code that turns names into prose:

1. it takes its clause list from `spanActions` over the WHOLE run — the same call `spanProse` and
   `genLabel` make, so the unnamed shape is identical by construction rather than by agreement;
2. it substitutes a name only where a clause covers **exactly one** statement. A clause covering
   two or more is a chunk rule speaking about a pattern (R-LANG-16/17); a leaf name is one
   statement's spelling and has no standing to replace it;
3. `spanActions` publishes `covers[i]`, the `[from, to)` range each clause was built from, so (2)
   is a check rather than an assumption.

**What was measured, and why the ruling is stated as a boundary rather than a bug fix.** Before
this, `namedLabel` composed ONE CLAUSE PER STATEMENT (`clauses.map((c, i) => c || spanProse([stmts[i]]))`),
asking the renderer about each statement in isolation. So naming a single leaf in a run dissolved
every fold in it: naming `dotenv.config()` unfolded the IMPORT run beside it, and corpus-wide,
import repeats inside one clause went **1 -> 284** and emitted clauses **45,767 -> 46,055**. Bytes
round-tripped, payloads held, coverage held, and every identifier was still quoted — three times in
three clauses instead of once in one — so none of the four gate checks saw it. With the boundary in
place the same 20 names give **1** and **45,764** (the -3 is the adjacent-identical collapse, which
is cardinality doing its job, R-LANG-16).

**A correction to the record.** This was first reported as *segmentation* becoming name-sensitive
under nested rendering. That was wrong, and the ruling above is right for a different reason than
the one given. Segmentation never moved: `enlzw.genSpans` reads no names, its `wholeRunOk` hook is
`chunkGloss` (AST and rules only), and word ids are carried in the payloads, which gate check 2 was
comparing successfully the whole time. The clause-marker count was identical across both renders and
should have been read as the tell. The defect was one level up, in the label.


**This is not a new mechanism; it is the one `refine-language.js` already implements.** That script
is the working precedent and it is stricter than the prose that describes it:

- The model is asked for, and may return, **only** `[{index, name, rationale}]` — a name per mined
  composite, keyed by index. There is no channel through which a sentence could arrive.
- Grammar productions are **derived**, never authored: `renderProduction(c)` builds a composite's
  one-line production from its **role signature** (subject, types, marked roles), so the shape is a
  function of the mined structure and the model has no say in it.
- The gate is **structural identity modulo names**: `structuralSkeleton()` strips `name`,
  `minedName` and `namedBy` from both libraries and compares the rest **as JSON strings**. A step
  that changed anything but names fails with *"refined library changed the mined structure —
  refusing (step must touch names/metadata only)"*, on top of byte-identity and coverage invariance.

So the answer to *"does the spec already separate it this way"* is **yes in the pipeline, and yes in
the built precedent — but there was one loophole in the wording, and it is closed here.**

**The loophole, named.** R-LANG-11 read *"An LLM **MAY** produce names **and grammar surface** only"*,
and §5D.2 consequence 3 repeated it. **"Grammar surface" was never defined anywhere in this
document.** Read strictly it means "the spelling of nonterminals", which is the rule above. Read
loosely it permits a model to author productions — the sentence shapes themselves — which is exactly
the drift Amir's constraint exists to prevent, and it would put the *syntax* of the English inside
the model's blast radius rather than the *vocabulary*. **The loose reading is retired.** The
requirement now says names only, and names the deterministic producer of everything else.

**Why this is the right line and not merely the cautious one.** A fixed grammar with model-supplied
words is *checkable*: injectivity, byte-identity and coverage invariance are all decidable against a
production set that code owns. A model-authored production set is not — there is nothing to check it
against, because the thing that would define "correct" is the output being checked. The determinism
is what makes the LLM's contribution safe to accept, so the shell must not be part of what it
contributes.

**The target form is written down, not left to the implementer.** §5D.3B
([21-naming-specimen.md](21-naming-specimen.md)) is the hand-authored reference specimen — the real
`partners.ts.en` as it renders today, beside what it should read like once stage 2 has named its
words, with each line attributed to code, model or mine. It plays the role §5D.1's PaymentPlan
sentence plays for the archetype grammar. **Two model-supplied phrases for that file; a third is a
spec violation, not a style question.**

**And it carries the correction that the split alone was not enough.** The specimen's first draft
satisfied every rule in this section and still read as notation rather than English. What produces
prose is a **phrasebook** of declared sentence rules, authored by a human the way
`entity-sentence.js`'s four lines were, filled by mined slots. `refine-language.js`'s
`renderProduction` — a signature line from a role signature — **cannot** produce English and no
amount of naming will make it. So stage 2 has **two** inputs and only one is a model's: the
phrasebook (human, before the run) and the names (model, gated, at the run).

**Naming has TWO LEVELS — see §5D.3D ([23-two-naming-levels.md](23-two-naming-levels.md)).** The LZW
mine names a recurring multi-statement **chunk** as one word; node-kind rules render the **residual**
the mine did not claim. The two mechanisms compose, and `genSpans`-before-`inGen`-before-per-statement
is already the built order. §5D.3A's *model supplies spellings, never grammar* holds at both levels.

**What the phrasebook is keyed to is DECIDED — see §5D.3C ([22-node-kind-rules.md](22-node-kind-rules.md)),
the adopted design.** Rules are keyed to the target language's **AST node kinds**, one rule per kind,
**not** to shapes mined from a corpus. A mined table is corpus-specific and grows without end (437
templates for 90% of Hydra alone); the language's kinds are a closed set, so a rule set written once
covers any codebase in that language — **28 kinds cover 90% of node instances, 53 reach 99%, and the
whole corpus exercises only 100 of TypeScript's 400 `SyntaxKind` values.** The split above is
unchanged by this and is reinforced by it: a key space closed by the language spec constrains a model
*more* tightly than one discovered by a miner.

**What stage 2 therefore is, mechanically:** for each unnamed dictionary entry, code emits the
production and the slot inventory; the model returns one lexical token per entry; the renderer
substitutes spellings into productions code already built; the gate re-renders the corpus and rejects
the batch on one changed byte, one point of lost coverage, or one collision that breaks injectivity.
A rejected name costs a re-ask, never a corpus edit.

### 5D.4 ONE WORD PER FILE — a statement about STRUCTURE, not about opacity

> **MEASURED 2026-09-01 — see §5D.4A ([24-one-word-per-file-measured.md](24-one-word-per-file-measured.md)).**
> Today the corpus achieves this **0 times in 943 files**. The diagnosis below — THE RESIDUAL — is
> confirmed as the obstacle for ~67% of files. **It is not the obstacle for the first third:**
> `enlzw.js:121` still enforces the *original* R-MINE-7 that this section superseded, and switching
> it off recovers **308 one-word files (32.7%) with byte-identity intact**. R-ARCH-17, R-MEAS-9.

**The target, stated without hedging.** A file collapses to **one top-level word** — its archetype,
which per §5E.3.1 is itself a dictionary entry at the top of the recursive dictionary. What a human
reviews is **English**, not code and not `«g_412_a1b2c3»`.

**And the top word is not a sealed reference. It IS its recursive definition.** Per statement 7:
*"each file isnt actually its word. its the words that make up that word. so that it can be
editable."* This is the LZW mechanism read literally — *every new dictionary entry is an existing
entry plus one symbol* — so a word does not **summarize** its parts, it **equals** them. Three
consequences, and they are the design:

1. **The `.en` file's content for a file IS the expanded composition** — word made of words made of
   words, down to leaves. Drill-down is not an optional viewer convenience bolted onto an opaque
   token; **nothing was hidden in the first place**, so there is nothing to unhide.
2. **It is short to READ** because repeated substructure appears **once, as a reference**, and every
   further occurrence cites it. That is where the review-surface reduction comes from (statement 8)
   — not from eliding anything.
3. **It is editable AT ANY LEVEL**, which is the whole reason for the constraint. A human can edit
   the file's top sentence, or a sub-word's sentence, or a leaf's hole fill, and each is a real edit
   to real content. **A sealed top-level symbol would make the hand-edit half of the lifecycle
   (statement 4) impossible**, which is exactly the failure Amir is heading off.

So the honest phrasing of the target is: **the file is one word in the sense that one word's
definition accounts for all of it** — totality — not in the sense that the reader is handed one
token.

**This supersedes THE LIFT (R-MINE-7).** That rule said *"the renderer MUST refuse any word that
covers an entire run. A file is never one word."* Its stated purpose was that a reader must not get
*"one opaque reference instead of the file's structure"* — and the operative word was always
**opaque**. Statement 7 satisfies that purpose *directly*: the whole-file word's structure is its
content. **Amended form:** the renderer **MUST** refuse a whole-run word that renders as an
**unexpanded opaque reference**, and **MUST** render one whose recursive definition is present and
editable. An anonymous mined token still may not swallow a file.

**Two of the three mechanisms already exist. Named precisely, with what remains:**

| what the target needs | status |
|---|---|
| a dictionary deep enough to reach file scope | **exists, measured.** §Q-2 measured recursive depth **62** on the real corpus — deep collapse is not hypothetical. |
| the nested composition, machine-readable | **exists.** `repo-dsl/explain.js` already walks a composition into its generator tree, large composite → mid → leaf, and emits *"stable, documented machine JSON"* — the structure statement 7 requires is already produced; it needs to reach the `.en` and a UI, not to be invented. |
| **a single entry that accounts for the whole file** | **the real gap** (below). |

**The genuine obstacle, named precisely: THE RESIDUAL.** LZW builds an entry for a run only where
that run *recurs*. A file's statements that appear nowhere else produce no entry, so nothing accounts
for those positions. Depth 62 proves the dictionary goes deep; it does not by itself produce one
entry per file. **How to clear it — three moves, none speculative:**

1. **Seed the archetype as an entry with a variadic tail (§5E.3.4).** A file word does not have to be
   *discovered*; `Entity` is declared, and the miner binds a file to it. Totality then depends on
   recognizing the archetype, not on the run recurring.
2. **Make the residual explicit rather than fatal.** Where statements fall outside every slot, the
   top word's definition includes them **as themselves**, and the gloss says so in English —
   *"…and 4 statements not yet part of any pattern"* — under §7.0's honesty rule (R-LANG-10). The
   file is still accounted for by one word; the word admits what it has not yet factored, which is
   what makes the number shrinkable instead of hidden.
3. **Report the per-file residual as the component that closes the gap.** *Unclaimed statements per
   file* is what the mine is tuned against, because the target is **totality per file**, not an
   aggregate percentage.

   **It is not a second metric.** §7.3's frozen definition is the only one:
   **review surface = `calls + (S − statementsCollapsed)`**. Per-file residual is the
   `S − statementsCollapsed` term of that formula, computed per file so the worst file is visible
   instead of averaged away. *An earlier draft of this section proposed "unclaimed statements per
   file → 0" as its own headline metric, which would have left two definitions of one goal in one
   document; §7.3's is measured and already had a producer, so it wins.* One producer emits both
   views (`en-index.json → reviewSurface` and `perFile[].reviewSurface`).

**What it does NOT require:** a model call (stage 1 stays deterministic, §5D.2), a hand-authored
grammar per file, or abandoning byte-identity — the one word's holes carry the file's exact bytes,
and byte-exact refill gates it exactly as it gates every other word.

### 5D.1 The canonical worked case — the `Author → Compile` panel

An existing panel already does this for the Entity pattern: *"Describe an entity in plain English →
TypeScript"*, labelled **"no model call; nothing is written to the corpus"** until Compile is pressed.
It is the reference case every archetype design is checked against. The input sentence, verbatim:

> *"PaymentPlan is an entity stored in payment_plans. It has an auto-generated id, a required account
> id (int), a required amount (decimal), an optional note (varchar), and a required status (enum
> EPaymentPlanStatus). It belongs to a BillingAccount (join account_id). It has many Installments."*

It compiles deterministically to typechecked TypeScript — an `@Entity('payment_plans')` class with
`@PrimaryGeneratedColumn`, one `@Column` per field, `@ManyToOne` + `@JoinColumn` for the belongs-to,
and an implied `@OneToMany` for the has-many — and the output panel reports *"Typechecks, valid
TypeScript, entity PaymentPlan, 5 cols, 2 rels"*.

**What this example pins down that prose could not:** the slot inventory (name, table, columns with
type and required/optional, relations with two distinct forms), that a column has **alternative**
shapes (`an auto-generated id` carries no type or nullability), that the compiler may emit a
decorator the sentence does not literally name (the implied `@OneToMany`), and that the whole thing
is **deterministic with zero model calls** (R-MECH-4). §5E.4 checks the proposed grammar against it
clause by clause.

### 5D.3 Superseded text — what was cut, and what it used to say

Kept visible on purpose: the repo's rule is *"this used to say X, that was wrong"*, not a silent
rewrite. Each of these disagreed with §5D.0 and has been changed to agree with it.

1. **"Names are cosmetic BY CONSTRUCTION"** (§10, R-REND-6) — *used to say* the compiler recovers a
   payload by `lastIndexOf(PAY_OPEN/PAY_CLOSE)` and **never reads the label region**, so a wrong name
   yields wrong prose and byte-identical output, and this was celebrated as a structural guarantee.
   **That is incompatible with statement 4.** If the compiler ignores the prose, then Amir editing
   the English by hand changes nothing and the hand-edit half of the lifecycle does not exist. The
   sentence is **authoritative**; the payload is a derived index. Rewritten in §10 and in R-REND-6;
   the mechanics are §5E.5's sentence-authority section.
2. **"Archetypes are deliberately unwired"** — superseded earlier the same day by statement 2; an
   archetype is a constructor you invoke.
3. **"A generated name Amir did not choose is worse than no name at all"** (`name-words-lzw.js`
   header, and R-LANG-7's never-apply-automatically rule) — *used to say* the naming pass emits a
   **worksheet only** and the apply step is Amir's hand-authoring. **Statement 5 overrides this for
   naming**: the step is a script that names. The narrower claim it was really protecting —
   that an **orphaned** name must not silently re-attach to a skeleton it merely *resembles* — is
   preserved, because that is a drift bug rather than a naming policy (§10). *This is name-vs-skeleton drift,
   detected by edit-distance proposals; it is **not** the architecture drift check of §5F, which
   compares a file against its archetype's slot schema. §5F §5 tabulates the three.*
5. **"A file is never one word" (R-MINE-7, THE LIFT)** — *used to say* the renderer must refuse any
   whole-run word outright. Superseded by statements 6 and 7; amended to refuse an **opaque**
   whole-run word while requiring a compositional one (§5D.4).
6. **"The metric is real lossless compression"** (§2, §7) — compression is the mechanism, not the
   goal; superseded by statement 8. Rewritten in `15-success-criteria.md`.
4. **"content-hashed, cosmetic by construction"** as the description of the skeleton-name layer
   (§2) — the content-hashed half is right and load-bearing (R-LANG-2; it is what makes ids survive
   a re-mine). The **cosmetic** half is cut per note 1.

---

**Amir, 2026-08-31, verbatim:** *"I do think the archetype stuff needs to stay though and it needs to
be a pattern/words archetype hybrid."*

**This supersedes the previous entry, which said tier-1 archetypes were "deliberately not wired" and
treated their disconnection as a settled decision. That is no longer the direction.** Archetypes
stay, and they are a **requirement**, not an optional overlay parked beside the live path.

**The requirement.** The archetype layer and the LZW word layer must work **together** as one
mechanism. Neither is subordinate:

- **The word layer** (mined LZW dictionary) supplies the *vocabulary* — the recurring statement and
  member shapes it discovered on its own, each with a byte-exact refill.
- **The archetype layer** (`engine/archetypes.js`, `build-archetypes.js`) supplies the *file-level
  shape* — the architectural template with big typed slots that says what kind of file this is
  (Entity = decorated class + columns\* + relations\*; RouterModule = prefix + routes\*), which the
  word layer cannot state because it works bottom-up from statements.
- **The hybrid** is an archetype whose slots are filled by **mined words** rather than by
  hand-authored sub-grammars. The archetype names the composition; the dictionary supplies the parts.

**Why a hybrid rather than either alone.** The mined dictionary demonstrably rediscovers much of what
a hand-authored grammar would say — the decorated-property shape is learned as a word with variadic
fill, without anyone writing the grammar down — so a hand-authored grammar is **redundant wherever
the miner already succeeded**. But the miner works bottom-up and cannot say *"this file is an
Entity"*; that is a whole-file claim, and it is what archetypes are for. Each layer covers exactly
what the other cannot.

**Constraints the hybrid MUST satisfy** — these are carried over from the analysis that produced the
old "leave it unwired" position. They were never arguments against archetypes; they are the bar any
wiring has to clear:

1. **One producer, one gate.** The hybrid must not stand a second, unverified producer beside a
   working byte-exact one. Everything an archetype emits passes the **same** byte-exact gate as every
   other span (§2.3), and there is **no silent fallback** — a slot that cannot refill exactly leaves
   its span as verbatim TypeScript, loudly, exactly as any other tier does.
2. **Archetypes need a REAL generation check.** The existing `byteIdentical: 100%` reported for
   archetypes **is a tautology and must not be cited as evidence**: `checkTiling` computes
   `rebuilt = segs.map(s => src.slice(s.a, s.b)).join("")` — it re-slices the source and rejoins it.
   That verifies *segmentation completeness* and verifies nothing about generation. No archetype has
   yet regenerated a byte it did not copy. **A hybrid archetype must be measured by refilling its
   slots from the dictionary and comparing to original bytes**, not by re-slicing.
3. **Arbitration must be deterministic.** Where an archetype slot and a mined word both claim
   overlapping bytes, one deterministic rule decides, with no coin-flip — the §5A arbitration rule is
   the model.
4. **Fix the extractor's shape before relying on it.** `extractEntity` currently returns
   `className`, `table` and per-column `.name` as **undefined** — it stores them as `slots.className`,
   `slots.table` and column `.prop`. Recorded so no future reader copies the shape from the call
   site.
5. **Panel-quality still counts only the round-tripping path** (§7.2). An archetype that reads
   beautifully but does not compile back byte-exactly contributes nothing.

**⚠️ NOT YET DESIGNED — do not infer these.** The direction above is settled; the mechanics are not.
Open, and needing Amir's decision or a design pass:

- **How a slot binds to a word.** Does an archetype slot reference a dictionary word id directly, or
  does it declare a hole type that the word layer fills at render time?
- **Whether an archetype is itself a dictionary entry.** Is the archetype the top of the same
  recursive word hierarchy (the natural reading of §2.4, where tier *is* dictionary depth), or a
  separate template layer sitting above it? These have different failure modes.
- **Who wins a contested span** — the concrete arbitration order between archetype slots and mined
  words, beyond "it must be deterministic".
- **Whether hand-authored grammars survive at all** in the hybrid, or whether the archetype reduces
  to a slot *skeleton* with every fill mined.
- **What replaces per-site productions.** `spanProse`'s per-site productions (§5C) currently carry
  the readability that tier-1 grammars would have; how the two divide the work is undecided.

Until those are answered, no wiring should be built on a guess. Write the design, get it confirmed,
then build.

---
