# PRD — English-as-Source (the repo-DSL engine)

**Status:** in progress · normative for the engine under `sdd-engine/tools/repo-dsl/`
**Home:** `sdd-engine/tools/PRD.md` — beside the engine and the `README.md` it describes. (It has moved twice: out of `scrutinize-spec/` when the engine became its own skill, then up out of `tools/repo-dsl/` at Amir's direction, because it is the PRD for the whole engine and not for one tool inside it.)
**Contains no measurements.** Every point-in-time number has been removed; a number here is a *threshold or a definition*, never a reading. Run the tools for current values (`npm run measure`, `npm run measure:uncollapsed`, `npm test`).

---

## How to read this document

**If you are an agent picking this up cold and building:** read **Part I** (what and why), then
**Part III — the requirements register**, which is the normative build list. Everything else is
rationale you consult when a requirement is not obvious. Read **Part VI** before you make any
design decision — it is the list of things that are *not decided*, and guessing at one of them is
the most expensive mistake available here.

**Normative language.** **MUST** / **MUST NOT** are requirements; every one appears in the register
in Part III with an ID and a way to test it. **SETTLED** marks a decision that is closed — do not
re-litigate it without new measurement. **OPEN** marks a question that needs Amir; it is never
resolved by inference.

**Section labels are stable.** `§4A`, `§8B`, `§10.3` and the rest keep the identifiers they have
always had, because engine source comments, `CLAUDE.md` and past decisions all cite them. This
restructure changed the **order and the navigation**, not the labels — so a code comment reading
`PRD §8B` still resolves. The parts below are a reading order over stable sections, not a
renumbering.

**Three things this document is not.** It is not a scoreboard (Part V states gates, not readings).
It is not a status report (where implementation status is contested, that contest is an OPEN
question in Part VI, not a claim). It is not a roadmap — §6 lists work fronts, but the register in
Part III is what defines *done*.

---

## Table of contents

**PART I — WHAT THIS IS**
- [§1 Problem & goal](#1-problem--goal) — the success definition, in one paragraph
- [§2 Non-negotiable principles](#2-non-negotiable-principles) — P1–P4, the four things that never bend
- [§3 Explicit NON-goals](#3-explicit-non-goals) — what a rise in the wrong metric looks like

**PART II — THE MECHANISM**
- [§5 Architecture](#5-architecture) — the core pipeline in four steps; the tiers; the fold; on-disk layout; the loop
- [§5D The archetype layer — a pattern/words hybrid](#5d-the-archetype-layer--a-patternwords-hybrid-required-mechanics-still-to-be-designed)
- [§4 The layers, and how they are measured](#4-the-layers-and-how-they-are-measured) — Layer A, Layer B, the denominator rule, the middle-tier gap
- [§4A The live path MUST be the recursive LZW dictionary](#4a-the-live-path-must-be-the-recursive-lzw-dictionary)
- [§4B Mining parameters — settled decisions](#4b-mining-parameters--settled-design-decisions)
- [§5A The middle-tier generator layer — a flow](#5a-the-middle-tier-generator-layer--specified-as-a-flow)
- [§5B The composition layer — a requirement](#5b-the-composition-layer--specified-as-a-requirement)
- [§5C Language and grammar — how a word becomes a sentence](#5c-language-and-grammar--how-a-word-becomes-a-sentence)

**PART III — THE REQUIREMENTS REGISTER (the build list)**
- [§R How to use the register](#r-the-requirements-register)
- [R-MECH](#r-mech--the-core-mechanism) · [R-MINE](#r-mine--mining-parameters) · [R-REND](#r-rend--rendering-and-compiling) · [R-COMP](#r-comp--composition) · [R-WIDE](#r-wide--the-middle-tier-generator-layer) · [R-ARCH](#r-arch--the-archetypeword-hybrid) · [R-LANG](#r-lang--language-names-and-productions) · [R-PAY](#r-pay--payload-encoding) · [R-ART](#r-art--the-artifact-contract) · [R-PIN](#r-pin--corpus-pinning) · [R-CFG](#r-cfg--roots-configuration-and-wipability) · [R-MEAS](#r-meas--measurement-discipline) · [R-TEST](#r-test--test-integrity)

**PART IV — CONTRACTS, CONFIGURATION AND LAYOUT**
- [§8 Constants](#8-constants) — every threshold with its source of truth
- [§8A SOURCE-PROTECTED artifacts](#8a-source-protected-artifacts-never-wipable-derived)
- [§8B The artifact contract](#8b-the-artifact-contract--location-header-and-enforcement-2026-08-31) — location, header, registry, enforcement, guard
- [§8C Corpus pinning](#8c-corpus-pinning--publisher-and-consumer-rules)
- [§1B The two roots](#1b-the-two-roots--source-and-corpus-and-the-sen-folder) — `SOURCE`/`CORPUS`, `sen/`, wipability, the one-file rule, and the open direction-of-truth question (§1B.5)

**PART V — ACCEPTANCE**
- [§7 Success criteria](#7-success-criteria) — the four gates, the frozen definitions, the remaining gates
- [§7A Payload encoding requirements](#7a-payload-encoding--requirements)
- [§10 Test integrity](#10-test-integrity--what-a-test-is-allowed-to-assert-against)
- [§9 Load-bearing assumptions](#9-load-bearing-assumptions)

**PART VI — WHAT IS NOT DECIDED**
- [§Q Open questions — BLOCKING, needing Amir](#q-open-questions--none-of-these-may-be-resolved-by-inference)
- [§6 Open technical fronts](#6-open-technical-fronts) — work, not questions

> **Removed, not misplaced:** an earlier `EN_ROOT` / `TS_ROOT` / `BUILD_ROOT` three-root proposal is
> **superseded and cut** (Amir, 2026-08-31). The engine has two roots — see §1B. What remains open
> about the direction of truth is §1B.5 and §Q-1.

---

## Glossary — the eight terms that carry the design

| term | means |
|---|---|
| **word** = **generator** = **dictionary entry** | one LZW entry: a prior entry plus one symbol, with typed holes. The three names are the same thing seen from mining, rendering and compiling. |
| **hole** | a typed slot inside a word, recording the exact source span it abstracted. Holes carry the domain meaning; they stay verbatim TypeScript. |
| **the fold** | the universal invariant: a construct is replaced by a higher-tier form **only** when that form refills to the exact source span. |
| **byte-exact gate** | the per-span check that enforces the fold at render time. A span that fails it stays verbatim TypeScript, loudly. |
| **byte-identity** | `compileFileEn(renderFileEn(src)) === src`. The floor, for every file, always. |
| **tier** | dictionary *depth*, emergent from LZW recursion — never a hand-assigned label. |
| **SOURCE / CORPUS** | the two roots: the `.ts` tree that is read, and the tree that is written (holding `sen/`). |
| **residue** | bytes no word claimed. Must be classified (non-recurring shape · free-text slot · comment/trivia · formatting variance), never papered over. |

---

# PART I — WHAT THIS IS

## 1. Problem & goal

We have a large real TypeScript corpus. (Two layer-specific byte totals exist and are reconciled in §4 — never use a bare "corpus size" number.) Most of it is not novel — it is the same shapes, the same procedures, the same data structures, re-typed with different names. Today that repetition sits on disk as raw code, over and over.

**The success definition, in plain terms:**

> **Repeated code — whether it repeats inside one file or across files — must never appear as raw code.** Recurring structure is mined *deterministically* into a **recursive dictionary of words (generators)**, and the English source is each file **re-emitted as a stream of those words**. Because bigger words are defined in terms of smaller words, the source is genuinely **shorter** (repeated structure → a single word reference) **and** losslessly `.en → .ts` **byte-identical**. The **whole repo stays the real, editable source** — you edit the English (`.en`), the `.ts` is derived.

**The core mechanism is LZW dictionary construction over the AST — this is the design, stated up front (§5).** Parse each source file to its AST; walk **bottom-up from the leaves**; run the **dictionary-building (encoding) half of LZW** over that node stream. LZW's defining property is that *every new dictionary entry is an existing entry plus one more symbol* — so the dictionary is **recursive by construction**: larger patterns are defined in terms of smaller patterns already in it. **Each dictionary entry is a word is a generator.** Because entries reference earlier entries, **generators reference generators automatically** — composition is *emergent* from LZW, not bolted on, and the ARCHETYPE→SKELETON→IDIOM→LEAF hierarchy is the emergent **dictionary depth**, not hand-labeled levels.

**Two things the compressor does not settle, and §5C does.** A dictionary makes a file *short*; it
does not make it *read*. Two layers turn a word into a sentence — **skeleton names** (word-level,
content-hashed, cosmetic by construction) and **per-site productions** (statement-level, reading the
real AST). The measured finding is that productions are the larger and cheaper half: ~14 statement
kinds out-reach the whole nameable-word queue, because a name caps at the skeleton share of corpus bytes and a production
can quote the site. See §5C for the design and §7.0 for the scoreboard.

**The compiling half is DONE, and should not be read as a roadmap item.** "Write the `.en` and get
the file" is **already true for every file in the corpus** (§4B). Everything now in flight is a question about
how the `.en` *reads*.

So "English source" here is not translation and not documentation. It is a *lossless compressor's dictionary made readable*: LZW factors the repo into a recursive word dictionary; the English re-emits each file as a short word stream; and a byte-exact gate guarantees the derived code is the exact bytes we started from. LZW is **lossless *and* compressing** — real compression under byte-exactness is exactly what the mechanism delivers. The metric that matters is **real (lossless) compression via recursive word reuse plus statement-collapse**, not how much prose we produce.

---

## 2. Non-negotiable principles

1. **Pattern discovery IS LZW dictionary construction over the bottom-up AST node stream — deterministic, zero model calls.** The miner parses each file to its AST, linearizes it bottom-up (leaves first), and runs the encoding half of LZW to build a **recursive word dictionary**: each entry = a prior entry + one symbol, so every word is defined in terms of smaller words and **generators reference generators by construction** (§5). Each hole records the exact source span it abstracted, so expansion rebuilds the site's **original bytes**; LZW is lossless, so byte-exactness and compression coexist. See `engine/pipeline.js`, `engine/lzw.js`, `engine/compose.js`, `engine/fanout.js`.
   *Deviation to fix (§4A):* the current live path uses **flat anti-unification / clone detection** (`engine/operations.js`, `engine/generators.js`) instead of LZW dictionary construction — this is the root defect, not the intended mechanism.

2. **The LLM may only propose NAMES — never anything correctness-relevant.** The "librarian" pass (`refine-language.js`) proposes readable names for mined `g_<len>_<hash>` generators and is **gated on byte-identity + coverage invariance**: a rename that changes a single output byte or lowers coverage is rejected. Names are cosmetic by construction.

3. **A byte-exact gate on every span.** Nothing is ever *guessed* into English. A span is swapped for English only when it re-compiles to its exact source bytes — verified at render time (`engine/enfile.js` render pass; `engine/data-english.js` `dataByteExact`; `engine/cnl.js` compile↔render). Anything that doesn't verify stays verbatim TypeScript. Consequence: **English coverage varies; byte-identity does not.** `compileFileEn(renderFileEn(src)) === src` holds for *every* file.

4. **Composition is mandatory — and it is EMERGENT from LZW, not bolted on.** Because each LZW dictionary entry is a prior entry plus one symbol (§2.1), generators reference generators automatically: the vocabulary is a **recursive hierarchy, not a flat list**, and the ARCHETYPE→SKELETON→IDIOM→LEAF tiering *is* the emergent dictionary depth. A generator's expansion invokes lower generators, down to leaf atoms; higher tiers expand *through* lower tiers. A **flat vocabulary** (every generator expanding directly to raw TS, holes = verbatim bytes — what the current live path produces) is the **degenerate failure mode**, not an acceptable simplification: it means LZW recursion was replaced by flat clone detection (§4A). The flat path is permitted **only as a fallback for genuinely-unique one-offs** that recur nowhere. Composition inherits the same guarantees — every nested expansion is deterministic and the fully-expanded result passes the byte-exact gate (§2.3). See §4A (current defect) and §5/§5B (requirement).

---

## 3. Explicit NON-goals

- **Line-by-line English translation is a failure mode, not the goal.** If a statement can only be rendered as a one-to-one English restatement of the code, that means *no shared generator was found* — the pattern is bespoke. We render it verbatim and count it as residue. We do not dress arithmetic, one-off calls, or novel logic up as prose (`data-english.js` keeps every atom in a `` `backtick` `` escape precisely so this stays honest).
- **Coverage-% is not the north-star metric.** A high English-% achieved by paraphrasing unique code would be worthless. The real target is *repeated code collapsed to a generator call* (§7).
- **Line-by-line translation is the failure; real compression is the goal.** The success axis is **real lossless compression through recursive word reuse** *plus* statement-collapse — *not* prose length. (Superseded claim, corrected: an earlier draft said "byte-shrink is physically capped ~4.5% under the byte-exact gate." **That cap is a property of the FLAT anti-unification approach only** — where every per-site token re-emits verbatim into a hole. **LZW is lossless *and* compressing**, so real byte compression under byte-exactness is achievable and *is* a goal, delivered by recursive word references, not by paraphrase. The current `.en` being larger than the `.ts` is a symptom of the flat-path defect (§4A), not a law.)
- **No cherry-picked showcase/demo files.** Measurement runs over the whole corpus; the `demo`/`coined-demo` trees are excluded from the walk (`write-en-files.js` SKIP set). Per-module verify results include the failures, not just the wins.

---

# PART II — THE MECHANISM

This part is the design. §5 is the pipeline; §4 is how the pipeline is *measured*, which is a
separate concern that has been conflated with it before. §4A/§4B, §5A, §5B, §5C and §5D each own one
layer of the mechanism. Every requirement extracted from this part appears in the Part III register.

## 5. Architecture

**The core pipeline — LZW dictionary construction over the AST (the intended design).** This is the mechanism the rest of the system exists to serve:
1. **Parse → AST.** Each source file is parsed to its TypeScript AST.
2. **Linearize bottom-up.** The AST is walked leaves-first into a node-symbol stream (`engine/fanout.js`), so structure is encoded before the constructs that contain it.
3. **LZW encode → recursive dictionary.** The encoding half of LZW runs over that stream (`engine/lzw.js`, `engine/compose.js`): every new dictionary entry is an existing entry **plus one symbol**, so the dictionary is recursive — bigger words are literally defined as smaller words. **Each entry = a word = a generator**, and because entries cite earlier entries, **generators reference generators for free** (the composition of §2.4). Dictionary depth *is* the ARCHETYPE→SKELETON→IDIOM→LEAF hierarchy — emergent, not labeled.
4. **Re-emit as a word stream.** The file's `.en` is the file rewritten as references to those words; repeated structure becomes a single reference, so the source is **shorter and lossless** (LZW inverts exactly, and the fully-expanded result is gated byte-exact, §2.3).

✅ **This is what runs (§4A, §4B).** Steps 1–4 are the live path; the flat anti-unification layer is deleted. The tiers below describe the dictionary's emergent structure, not a target.

**Tiers (top → bottom) — realized as composition (§2.4, §5B), not as labels.** A file is described at the coarsest tier that conforms, and each tier expands *through* the tier below it (a higher generator's fill invokes a lower generator, down to leaves):
1. **Archetype** (`archetypes.js`) — the file *is* a word: a fixed architectural template with big typed slots (Entity = `@Entity` + columns\* + relations\*; RouterModule = `Router(prefix)` + routes\*). Conformance-gated: residual top-level code is *reported*, never absorbed to inflate the number.
2. **Skeleton / operation-idiom** (`operations.js`, `build-operation-idioms.js`) — recurring statement/procedure shapes via anti-unification, **assembled from tier-3 idioms**. *(Middle tier — partially built; flow in §5A, composition requirement in §5B.)*
3. **Statement + data idiom** (`cnl.js`, `data-english.js`) — single statements and data leaves rendered as controlled English.
4. **Leaf / literal** — opaque atoms and genuinely-novel bytes, verbatim (the base case of the composition recursion).

✅ **Live-path status (§4A):** these tiers are realized as real composition on the live path, at depth 14 through `catalog/generators-lzw.json`. The flat `generators.json` is no longer read by anything.

⛔ **The statement-idiom layer is RETIRED and must not be revived as a parallel producer.** It was
never invoked by the mine, so its catalog froze at its last manual run and **no action a user could
take could move the count it published** — and nothing on the `.en` compile path ever read it. Two
rules follow. **A number no mine can move is not a measurement, and the engine must not publish
one.** And a catalog with no consumer on the byte-exact path is not a layer; it is drift waiting for
an audience.

**The fold (universal invariant).** At every tier a construct is only replaced by a higher-tier form when the higher-tier form refills to the **exact source span**. Segment lists tile `[0, len)` exactly (`checkTiling`), each segment reproduces its own bytes, so `reconstruct === source` by construction. This is what makes byte-identity a property of the *design*, not of any particular file.

**On-disk layout.**
- `<corpus>/sen/files/<rel>.en` — the **canonical human artifact** (English + verbatim TS). Edited by hand.
- `.cache/` — derived compose IR (`.calc`) and build intermediates. **Gitignored, regenerable, never committed.**
- `.ts` — derived output; byte-identical to what the `.en` compiles to.

**The panel loop.** `mine → author (.en) → compile → verify`, driven by `repo-dsl.js`:
`repo-dsl mine` (fan-out + LZW + promote generators, write library + coverage) → author/edit `.en` (`enfile.js`, `author.js` for the CNL authoring grammar) → `compileFileEn` back to TS → `repo-dsl verify` / `verify-expand` (byte-diff, machine JSON verdict with coverage + residue classes) → `gate` (pass/fail on corpus coverage). `prose.js` narrates a file across the tiers for the panel, with an explicit HONESTY RULE (un-named bodies read as "custom logic (N statements)", never invented prose).

---

### 5D. The ARCHETYPE LAYER — a pattern/words hybrid (REQUIRED, mechanics still to be designed)

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

## 4. The layers, and how they are measured

There are **two distinct layers**, and they must not be conflated: they walk **different file sets**,
so they have **different byte totals**.

**The denominator rule (a requirement, because mixing the two produces a wrong ratio).** The
compose-layer walk (`engine/pipeline.js` `walkDir`) is broad. The enfile-layer walk
(`write-en-files.js`) skips more directories — the demo trees, `sen/`, `catalog/`, `.cache/` — so it
sees fewer files and a smaller total. **Every English-coverage and statement-collapse ratio uses the
enfile-layer total as its denominator**, because the `.en` lives in that layer. A compose-layer
figure must always be labelled as such, and **the two are never mixed inside one ratio.**

### Layer A — word-tiling / compose (the generator library + `.calc` IR)

`fanout → LZW → generators (pipeline.js) → compose.js`. Every file is byte-losslessly tiled into an
ordered stream of **words** (recurring parameterized spans that refill byte-exact) and **literal
slots** (verbatim bytes). Byte-losslessness is by construction; the discriminating measure is *how
much* is a recurring word versus residue. **Residue must be classified, never papered over** — the
buckets are non-recurring shape, free-text slot, comment/trivia, and formatting variance.

### Layer B — English source of truth (`.en` files, `enfile.js`)

The `.ts` is rendered to an editable `.en` by swapping **only verified spans** into `«English»`: data
leaves via `data-english.js` ("an object with a = `x`", "a list of …") and pure-logic simple
statements via the `cnl.js` grammar ("Let `x` be …", "When <cond>, …", "Return …"). Everything else
stays verbatim TypeScript. The `.en` files are written to `<corpus>/sen/files/<rel>.en`; the derived
`.calc` IR is relocated to a gitignored `.cache/`.

### The middle-tier gap

Layers A and B hold their byte gate. The open tier is **multi-statement function/method bodies that
recur *up to renaming***.

**Why it is hard.** The narrow anti-unifier (`operations.js`) abstracts data and literals
(`str`/`num`/`obj`/`arr`/`fn` holes) and bare identifiers (`id` hole), but it **pins member-access
names, method names, constructor names and chain-root call names as skeleton literals**. Two
procedures identical except for which property or method they touch produce *different* narrow keys
and never cluster. A **widened** axis — member/method/ctor names promoted to holes, α-equivalence up
to renaming — is what lets them cluster. That layer is specified in §5A.

### The fix is ADDITIVE, not a replacement

Identifiers and types are already generalized by the narrow axis; what is missing is
member/method/constructor generalization. **Do not widen the existing axis in place** — that weakens
byte-elimination on the narrow tier. Add a **second, coexisting layer** (§5A): keep narrow-axis
generators for byte-elimination on structural clones, *and* add member/ctor-generalized procedure
generators that claim spans currently emitted verbatim.

### Compression is achievable under the byte-exact gate — the flat path is why it looked otherwise

An earlier draft concluded that physical byte compression is capped under the byte-exact gate.
**That holds only for the FLAT anti-unification path**, where every per-site-unique token — names,
types, member and method names, URLs, field keys — re-emits verbatim into a hole and nothing
cross-references. **The intended LZW design is lossless *and* compressing:** repeated structure is
replaced by a single recursive word reference, so a file reusing a deep word does not re-emit that
structure at all. Byte-identity is preserved either way; compression is what the correct mechanism
adds on top. Any observation that the `.en` is larger than the `.ts` is a symptom to attribute, not a
law to accept.

---

### 4A. The live path MUST be the recursive LZW dictionary

**What the wrong mechanism looked like** — worth recording, because it is the failure to recognise:
the compiler discovered patterns by anti-unification / clone detection, canonicalizing each
statement or body to a skeleton-with-holes and grouping identical skeletons. That finds **flat
clones** but never builds a recursive dictionary — no entry is defined as "a previous entry plus one
symbol", so nothing references anything else, every hole is verbatim TypeScript, and a generator's
span can end up **larger than the code it replaces**.

**The requirement.** `engine/enfile.js` loads the LZW dictionary as the **ONLY** generator layer,
through `engine/enlzw.js`. Words are LZW dictionary entries (`m[0]`/`m[1]` = a prior entry plus one
symbol), so generators reference generators by construction and `expand` recurses to leaves exactly
as §5B specifies. **The flat path is deleted, not bypassed** — a bypassed alternative producer is the
§8B drift shape waiting to happen.

**`engine/generators.js` is NOT the flat layer** — recorded so nobody deletes it by mistake. It is
the shared AST canonicalization library (`keyOf`, `refill`, `generalStmtParts`, `isFoldable`,
`skelBytes`) that `enlzw.js` and `build-lzw-generators.js` are built on.

**Diagnostic requirement: attribute every un-collapsed body.** `measure-uncollapsed.js` buckets each
one as **MINER**, **GATE**, or **ARBITRATION** per §5A admission. This matters because the three have
different fixes: a MINER gap is a word never mined, a GATE gap is a refill that failed, an
ARBITRATION gap is a span lost to a competing claim. A bare count without that split is not
actionable.

---

### 4B. Mining parameters — settled design decisions

These are decisions, not tuning knobs to be re-litigated.

- **`MIN_COUNT` is 1 — a word need not recur.** A threshold of 2 encodes the assumption that only
  shared structure is worth naming. It is not: a file's own shape is admissible vocabulary, and a
  word used once still buys the reader a sentence in place of a statement. Compression comes from the
  **dictionary's recursion** (§5 step 3), not from a frequency floor.
- **`MAXWIN` is 64, which is the point past which the parameter is inert.** MAXWIN binds only
  `maxDepth`; raising it past the longest node stream in the corpus can do nothing. It is a ceiling,
  not a tuned value.
- **Imports and declarations are foldable.** `isFoldable` once excluded them, which removed the most
  regular structure in the corpus from the dictionary. They are admitted like any other statement and
  gated identically.
- **The canonicalizer rolls back rather than lying.** When a sub-expression cannot be refilled
  byte-exactly, it does **not** fail the whole skeleton: it rolls that sub-expression back to an
  opaque hole and keeps the surrounding structure.
- **THE LIFT — a file is never one word.** The renderer **refuses any word that covers an entire
  run**. Without it a file can be tiled by a single whole-file span, and the reader sees one opaque
  reference instead of the file's structure. Every file must render as its constituent words.

**Settled — do not re-open without new measurement:**

- **The unit-boundary rule STAYS.** No span may straddle two or more units: a word means one thing.
  Amir's call, and the readability of every clause downstream depends on it.
- **`MIN_SKEL` stays 8.** Lowering it buys files by promoting near-trivial two-statement words — a
  number bought with readability.
- **Holes stay verbatim TypeScript.** See the hole taxonomy in §5C.
- **"Write the `.en` and get the file back" is the STANDING STATE, not a roadmap item.** Byte-identity
  already holds across the corpus. Every criterion in §7 is a question about *how the `.en` reads*,
  never about whether it compiles back.

---

## 5A. The middle-tier generator layer — specified as a flow

This is the one piece of *new* work, specified end-to-end so it can be built without guessing.

**Input.** The corpus `.ts` file set (the enfile-layer walk, §4). Each function/method body is canonicalized twice: once by the existing **narrow** axis (`operations.js` `fnKey`) and once by the **widened** axis (`measure-middle-tier.js` WIDE canon — member-access names, method names, and constructor names become typed holes `‹m›`/`‹ctor›`, on top of the narrow data/identifier holes). A body is a **middle-tier candidate** when its widened key recurs across the corpus with frequency **≥ `minCount` (2)** and it is not already claimed by an archetype slot.

**Generator record (schema).** Each promoted middle-tier generator is one catalog entry in `catalog/mined-library.json → composites[]`, same envelope as existing composites, with these fields:
- `id` — `g_<len>_<sha256-10>` (opaque; the librarian pass may add a `name`).
- `axis: "wide"` — distinguishes it from narrow-axis composites (`axis: "narrow"`), so the arbitration rule below can tell them apart.
- `template` — the widened skeleton as an ordered parts list (`lit` runs interleaved with typed holes), exactly as `keyOf`/`fillOf` in `operations.js` already emit.
- `holes[]` — ordered `{ type }` where `type ∈ {id, str, num, obj, arr, fn, type, member, method, ctor, args, chain}`. The `member`/`method`/`ctor` types are the ones this layer adds.
- `freq`, `filesUsing` — corpus recurrence, for arbitration tie-breaks.

**Fill at a site.** A candidate site binds each hole to the exact source span it abstracted; `fillOf(template, boundHoles)` must equal the site's original bytes. **A site is only admitted if this equality holds** (the universal byte-exact gate). Names that were widened into `member`/`method`/`ctor` holes ride as ordinary string-valued parameters of the generator call.

**Arbitration rule (which layer wins a span).** When more than one generator can claim overlapping bytes at a site, selection is deterministic:
1. Discard any candidate whose `fillOf` is not byte-exact at this site.
2. Among the survivors, choose the one covering the **most source bytes** (widest claim).
3. Tie on coverage → higher `freq`; still tied → **narrow axis beats wide** (prefer the byte-eliminating generator); still tied → lowest `id` lexicographically (total order, no coin-flip).
4. A site claimed by nothing falls back to the statement/data tier, then to verbatim TS.
No two selected spans overlap; the selected spans plus verbatim gaps tile `[0, len)` exactly, so `checkTiling` still holds and byte-identity is preserved.

**Renderer wiring contract.** `enfile.js` gains a pass (ordered *before* the statement/data passes, since a procedure generator subsumes whole statements) that: walks bodies, looks up the widened key in the catalog, and for an admitted site emits a single `«call <generator> with <params>»` span. The `.en → .ts` compiler resolves that span by `fillOf(template, params)`. The pass is span-gated identically to the others — it emits a generator span **only** when the round-trip is byte-exact; otherwise the body stays raw TS. The manifest records `generators.calls`, `generators.statementsCollapsed`, `generators.netStatementReduction`, `generators.filesUsing` (the fields already present in `en-index.json`).

---

## 5B. The composition layer — specified as a requirement

Realizes principle §2.4 and closes the §4A gap. This is a **first-class, load-bearing requirement**, not an optimization.

**Requirement.** A generator's `template` MAY contain **generator-reference holes** — a hole whose fill is *another generator invocation* (its id plus that inner site's params), not verbatim TS. Compilation resolves such a hole by recursively expanding the referenced generator. A leaf generator (no generator-reference holes, fills are atoms) is the base case; the four tiers are the levels of this same recursion (ARCHETYPE assembled from SKELETONs from IDIOMs from LEAFs), so "tier" is a **structural fact of the composition graph**, not a label.

**Record schema (additive to §5A).** A composite generator additionally carries:
- `members[]` — ordered ids of the generators this one invokes (the composition edges; this is the `builtFrom`/`memberIds` field that `generators.json` currently lacks).
- `hierarchyDepth` — longest path to a leaf (leaf = 0). Enables the depth-9 assembly the compose-layer already achieves.
- Each generator-reference hole in `template` names a `memberId` and the ordered params to pass to it.

**Expansion (deterministic, recursive, still byte-exact).** `expand(gen, params)` walks `template`: literal parts emit verbatim; a typed-atom hole emits its bound span; a **generator-reference hole emits `expand(memberGen, innerParams)`**. Recursion terminates at leaves (the graph is a DAG — acyclic, enforced at promotion). The **fully-expanded** result at a top-level `.en` span must equal the site's exact source bytes — the byte-exact gate (§2.3) applies to the final expansion, so every nested level is implicitly gated. No model call anywhere in expansion (§2.1); the librarian may still only propose names for composites (§2.2).

**Cycle safety.** Promotion rejects any composite whose `members` would introduce a cycle (a generator can never, transitively, reference itself); `hierarchyDepth` is finite by construction, so `expand` always terminates.

**Wiring.** The `.en` generator pass (§5A) emits the **highest-tier** admitted generator for a span (widest byte-exact claim, per the §5A arbitration rule extended so a composite outranks its own members on coverage ties); the compiler expands it recursively. The manifest gains `generators.composites`, `generators.maxDepth`, and `generators.compositionEdges` alongside the existing counters, so flatness is visible as a regression (maxDepth collapsing to 0/1 fails the §7 composition metric).

---

## 5C. Language and grammar — how a word becomes a sentence

§5 says how structure is *discovered*. This section says how it is *read*. A rendered `.en` clause
is produced by exactly two layers, and knowing which layer owns a given site is the whole of the
design.

### The two layers

| | **Skeleton NAMES** | **Per-site PRODUCTIONS** |
|---|---|---|
| granularity | one per mined word | one per statement kind |
| where | `catalog/word-names.json`, applied in `namedLabel` | `spanProse` in `engine/enfile.js` |
| sees | the canonical skeleton only | the actual AST at the actual site — identifiers, callees, literals |
| population | the whole nameable-word queue | **a handful of statement kinds** |
| ceiling | the skeleton share of corpus bytes — a hard cap | everything a statement can say about itself |

**Productions are the larger and cheaper half, and that is the central finding.** Fourteen
statement kinds reach further than two and a half thousand names, because a production reads the
site and a name cannot. Naming is a background trickle against the queue; productions are the line
of work.

### The admission rule for naming (verbatim, decidable)

> **Name a leaf only where `spanProse` has nothing site-specific to say.**

Applied to the highest-frequency words, this rule **refuses the large majority and admits few** —
and that ratio is the rule working, not failing.
The reason a refusal is *correct* and not laziness: where `spanProse` can quote the real identifier
and the real callee — ``await `invoices` from `softDeleteRecordsForRun` `` — a static skeleton name
is a **REGRESSION**. It replaces two true facts about this site with one generic phrase about a
thousand sites. An unnamed word is honest; a vacuous name is noise that looks like progress.

### Names key on content, never on word id

A name's key is **`sha256(canonical skeleton)[0:16]`**, axis-prefixed — never the word's dictionary
id, which is an artifact of mining order and changes when anything upstream changes. Measured
stability:

| change | names surviving | collisions |
**The property that must hold: mining-parameter changes orphan NOTHING, and a canonicalizer change
orphans exactly the skeletons it altered.** Because names key on the content hash of the canonical
skeleton (never on the word id), retuning `MAXWIN`, `MIN_COUNT` or `MIN_SKEL` cannot orphan a name —
the skeletons are unchanged. A canonicalizer change *does* orphan the names of the skeletons it
altered, and **that is correct behaviour, not a failure**: those skeletons genuinely became different
skeletons, and a name that followed them across the change would be asserting a meaning nobody
verified.

### The steady state — orphan, never delete

Names outlive the words they were written for, so the naming catalog is append-and-orphan:

1. A name whose skeleton no longer exists moves to the **`orphans` ledger**. It is never deleted.
2. Before generating any new name, the authoring pass **matches against orphans first**.
3. A match produces a **re-adoption PROPOSAL** written to the rename queue (`results/name-queue.json`,
   derived/gitignored), scored by token edit distance. **It is never applied automatically.**
4. **Queue length is a first-class metric**, reported beside byte-identity.

> **Auto-re-attachment is the producer/consumer drift bug (§2.2) in a new costume.** A name silently
> re-attaching to a skeleton that merely *resembles* the one it was written for is a producer
> asserting a meaning no consumer verified — and the failure is silent by construction, because a
> wrong name renders as confident prose. The proposal step exists so a human is the consumer.

### Names are cosmetic by CONSTRUCTION, not by test

`compileChunk` recovers a payload with `chunk.lastIndexOf(PAY_OPEN)` / `chunk.lastIndexOf(PAY_CLOSE)`
and **never reads the label region at all**. A wrong name therefore yields wrong prose and
**byte-identical output**. This is a structural property of the compiler, not a property maintained
by a test — the test would be the weaker guarantee (§10).

### The hole taxonomy — a per-site predicate, not a per-type policy

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

### The honesty rule for productions

If a production cannot say something **true** about a site, it emits the vacuous clause and that
site is **counted** (§7). A production retires a vacuous clause by saying something true about the
site — **never** by rewording the placeholder into something that merely escapes the frozen list.

---

# PART III — THE REQUIREMENTS REGISTER

## §R The requirements register

**This is the build list.** Every requirement stated anywhere in this document appears here once,
as a single testable sentence with an ID, the check that decides it, and a pointer to the section
carrying the rationale. If a requirement is not in this register it is not a requirement — it is
explanation. If two sections disagree, the register is not the tie-breaker either: a disagreement
is an OPEN question (§Q), and it is listed there.

**How to read a row.** `MUST` / `MUST NOT` is binding. **Check** is how a second engineer decides
whether it holds — a command, an assertion, or a named test file. A check reading *"not yet
mechanized"* is an admission, not an excuse: the requirement stands and the check is missing work.

**ID scheme.** `R-<AREA>-<n>`, stable. Areas: MECH (core mechanism) · MINE (mining parameters) ·
REND (rendering/compiling) · COMP (composition) · WIDE (middle tier) · ARCH (archetype hybrid) ·
LANG (language, names, productions) · PAY (payload) · ART (artifact contract) · PIN (corpus pinning)
· CFG (roots, config, wipability) · MEAS (measurement discipline) · TEST (test integrity).

---

### R-MECH — the core mechanism

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-MECH-1 | Pattern discovery **MUST** be LZW dictionary construction over the bottom-up AST node stream. Flat anti-unification / clone detection **MUST NOT** be the discovery mechanism. | The live `.en` compile path loads `generators-lzw.json` through `engine/enlzw.js` and no other generator vocabulary. | §2 P1, §4A, §5 |
| R-MECH-2 | Every non-leaf dictionary entry **MUST** be an existing entry **plus exactly one symbol** (`m[0]` + `m[1]`). | For each entry, `m[0]` resolves to an earlier entry and `m[1]` is a single symbol. | §5 step 3 |
| R-MECH-3 | The dictionary **MUST** be a DAG: no entry may transitively reference itself. | Promotion rejects a cycle; `hierarchyDepth` is finite for every entry. | §5B cycle safety |
| R-MECH-4 | Discovery, expansion and compilation **MUST** make **zero** model calls. | `foldModelCalls === 0` and `buildModelCalls === 0` in every published catalog. | §2 P1 |
| R-MECH-5 | Every hole **MUST** record the exact source span it abstracted. | `fillOf(template, boundHoles) === ` the site's original bytes, at every admitted site. | §2 P1, §5A |
| R-MECH-6 | Tiers **MUST NOT** be hand-assigned labels; tier **is** dictionary depth. | ARCHETYPE→SKELETON→IDIOM→LEAF is derivable from `hierarchyDepth`, not stored as a tier field. | §2 P4, §5 |
| R-MECH-7 | The flat, holes-are-verbatim path is permitted **only** as a fallback for genuinely-unique one-offs that recur nowhere, and **MUST NOT** stand as a second producer beside the LZW path. | No live code path reads `catalog/generators.json`. | §2 P4, §4A |
| R-MECH-8 | A retired layer **MUST NOT** be revived as a parallel producer, and the engine **MUST NOT** publish a number that no mine can move. | Every published count is produced by the mine, not by a stale manual run. | §5 (retired statement-idiom layer) |

### R-MINE — mining parameters

**All SETTLED. Do not re-open without new measurement.** Values and their source of truth are in §8.

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-MINE-1 | `MIN_COUNT` **MUST** be 1 — a word need not recur. | `engine/compose.js MIN_COUNT === 1`. | §4B |
| R-MINE-2 | `MAXWIN` is 64, a **ceiling and not a tuned value**; it binds only `maxDepth`. | `engine/enlzw.js`. | §4B, §Q-6 |
| R-MINE-3 | `MIN_SKEL` **MUST** stay 8. | `engine/enlzw.js`. | §4B |
| R-MINE-4 | `MIN_WORD_CHARS` is 4 — trivial punctuation tokens are not words. | `engine/compose.js`. | §8 |
| R-MINE-5 | Imports and declarations **MUST** be foldable, gated identically to any other statement. | `isFoldable` admits them. | §4B |
| R-MINE-6 | The canonicalizer **MUST** roll a non-refillable sub-expression back to an opaque hole, and **MUST NOT** fail the whole skeleton. | A skeleton containing one bad sub-expression still promotes, with that span as a hole. | §4B |
| R-MINE-7 | **THE LIFT** — the renderer **MUST** refuse any word that covers an entire run. A file is never one word. | No `.en` renders as a single opaque span. | §4B |
| R-MINE-8 | No span **MUST** straddle two or more units. A word means one thing. | Unit-boundary test (`engine/unit-boundary.test.js`). | §4B (Amir's call) |
| R-MINE-9 | Holes **MUST** stay verbatim TypeScript. | The hole taxonomy in §5C; no hole interior is paraphrased. | §4B, §5C |
| R-MINE-10 | Every un-collapsed body **MUST** be attributed **MINER**, **GATE** or **ARBITRATION**. A bare count is not actionable. | `measure-uncollapsed.js` emits the three-way split. | §4A |

### R-REND — rendering and compiling

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-REND-1 | `compileFileEn(renderFileEn(src)) === src` **MUST** hold for **every file, always**. This is the floor and it never regresses. | `en-index.json → gate.byteIdentical`; the round-trip tests. | §2 P3, §7.0 gate 1 |
| R-REND-2 | A span **MUST** be swapped to English only when it recompiles to its exact source bytes; anything unverified **MUST** stay verbatim TypeScript. | The per-span byte-exact gate at render time. | §2 P3 |
| R-REND-3 | Selected segments **MUST** tile `[0, len)` exactly, and no two selected spans may overlap. | `checkTiling`. | §5 the fold, §5A |
| R-REND-4 | A readability improvement that loses one byte of identity **MUST** be treated as a regression, not a trade. | Gate 1 is unconditional. | §7.0 |
| R-REND-5 | The `.en` **MUST** be written to `<CORPUS>/sen/files/<rel>.en`; derived `.calc` IR **MUST** go to a gitignored `.cache/`. | §5 on-disk layout; `engine/artifact-location.test.js`. | §5, §8B |
| R-REND-6 | The compiler **MUST NOT** read a span's label region when recovering a payload — names are cosmetic **by construction**, not by test. | `compileChunk` locates the payload by `lastIndexOf(PAY_OPEN/PAY_CLOSE)` only. | §5C, §10 |
| R-REND-7 | Measurement **MUST** run over the whole corpus with a published SKIP set; showcase or demo trees **MUST** be excluded, and per-module results **MUST** include failures. | `write-en-files.js SKIP`; §8 lists the set. | §3 |
| R-REND-8 | A body that is not named **MUST** read as an honest placeholder (e.g. "custom logic (N statements)") and **MUST NOT** be given invented prose. | The `prose.js` honesty rule. | §5 the loop, §5C |

### R-COMP — composition

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-COMP-1 | A generator's `template` **MAY** contain **generator-reference holes** whose fill is another generator invocation rather than verbatim TS. Composition is a first-class requirement, not an optimization. | Schema admits the hole kind. | §5B |
| R-COMP-2 | `expand(gen, params)` **MUST** resolve a generator-reference hole by recursively expanding the referenced generator, terminating at leaves. | `expand` on a depth-`n` composite reaches leaves. | §5B |
| R-COMP-3 | The **fully-expanded** result at a top-level `.en` span **MUST** equal the site's exact source bytes, so every nested level is implicitly gated. | Byte-exact gate applied to the final expansion. | §2 P3, §5B |
| R-COMP-4 | A composite record **MUST** carry `members[]` (ordered ids of the generators it invokes) and `hierarchyDepth` (longest path to a leaf, leaf = 0). | `mined-library.json → composites[]`. | §5B |
| R-COMP-5 | Each generator-reference hole **MUST** name a `memberId` and the ordered params to pass to it. | Schema. | §5B |
| R-COMP-6 | The manifest **MUST** expose `generators.composites`, `generators.maxDepth` and `generators.compositionEdges`, so **flatness is visible as a regression**. | `en-index.json`. | §5B |
| R-COMP-7 | `generators.maxDepth` on the **live** `.en` path **MUST** be ≥ 2 and rising. Depth 1 is the degenerate flat path. | §7.3 remaining gates. | §2 P4, §7.3 |
| R-COMP-8 | Promotion **MUST** reject any composite whose `members` would introduce a cycle. | Cycle check at promotion. | §5B |
| R-COMP-9 | The `.en` pass **MUST** emit the **highest-tier** admitted generator for a span, and a composite **MUST** outrank its own members on a coverage tie. | §5A arbitration, extended. | §5B |

### R-WIDE — the middle-tier generator layer

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-WIDE-1 | Every function/method body **MUST** be canonicalized twice — the existing **narrow** axis and the **widened** axis (member-access, method and constructor names become typed holes `‹m›`/`‹ctor›`). | `operations.js fnKey` + the WIDE canon. | §5A |
| R-WIDE-2 | The widened axis **MUST** be an additive, coexisting layer. The narrow axis **MUST NOT** be widened in place — that weakens byte-elimination on structural clones. | Both axes present and separately labelled (`axis: "narrow"` / `"wide"`). | §4 the fix is additive |
| R-WIDE-3 | A body is a middle-tier candidate **iff** its widened key recurs across the corpus with frequency ≥ 2 **and** it is not already claimed by an archetype slot. | Candidate selection. | §5A |
| R-WIDE-4 | Each promoted generator **MUST** carry `id` (`g_<len>_<sha256-10>`), `axis`, `template` (ordered `lit` runs interleaved with typed holes), `holes[]`, `freq` and `filesUsing`. | `mined-library.json → composites[]`. | §5A |
| R-WIDE-5 | `holes[].type` **MUST** come from the closed set `{id, str, num, obj, arr, fn, type, member, method, ctor, args, chain}`. | Schema validation. | §5A |
| R-WIDE-6 | A site **MUST** be admitted only when `fillOf(template, boundHoles)` equals its original bytes. Widened names ride as ordinary string-valued parameters. | The universal byte-exact gate. | §5A |
| R-WIDE-7 | A `type`-name hole **MUST** be admitted only when replacing the type with a `‹type›` hole still yields a byte-exact `fillOf` **at every site** — never on a subjective judgement about whether the type is load-bearing. | The same gate as every other hole. | §6 front 1 |
| R-WIDE-8 | Arbitration **MUST** be deterministic with no coin-flip, in this order: (1) discard any candidate not byte-exact here; (2) widest byte coverage; (3) higher `freq`; (4) **narrow beats wide**; (5) lowest `id` lexicographically. A site claimed by nothing falls back to the statement/data tier, then verbatim TS. | Arbitration is a total order. | §5A |
| R-WIDE-9 | `enfile.js` **MUST** run the generator pass **before** the statement/data passes, since a procedure generator subsumes whole statements. | Pass ordering. | §5A |
| R-WIDE-10 | The pass **MUST** emit a generator span only when the round-trip is byte-exact; otherwise the body stays raw TS. | Span-gated identically to every other pass. | §5A |
| R-WIDE-11 | The manifest **MUST** record `generators.calls`, `.statementsCollapsed`, `.netStatementReduction` and `.filesUsing`. | `en-index.json`. | §5A |

### R-ARCH — the archetype/word hybrid

**Direction SETTLED by Amir; mechanics OPEN (§Q-3). Do not build on a guess.**

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-ARCH-1 | The archetype layer and the LZW word layer **MUST** work together as **one** mechanism, neither subordinate: the word layer supplies the vocabulary, the archetype layer supplies the file-level shape. | The hybrid design, once written. | §5D |
| R-ARCH-2 | An archetype's slots **MUST** be filled by **mined words**, not by hand-authored sub-grammars, wherever the miner already succeeds. | Slot fills resolve to dictionary entries. | §5D |
| R-ARCH-3 | Everything an archetype emits **MUST** pass the **same** byte-exact gate as any other span, with **no silent fallback**: a slot that cannot refill exactly leaves its span as verbatim TypeScript, loudly. | One producer, one gate. | §5D constraint 1 |
| R-ARCH-4 | Archetype correctness **MUST** be measured by refilling slots from the dictionary and comparing to original bytes. A `byteIdentical: 100%` derived from `checkTiling` — which re-slices and rejoins the source — **MUST NOT** be cited as a generation check; it is a tautology. | A real generation check, not `rebuilt = segs.map(s => src.slice(s.a,s.b)).join("")`. | §5D constraint 2 |
| R-ARCH-5 | Where an archetype slot and a mined word claim overlapping bytes, one **deterministic** rule **MUST** decide. | Arbitration order, per R-WIDE-8's model. | §5D constraint 3 |
| R-ARCH-6 | `extractEntity`'s shape **MUST** be fixed before anything relies on it: it returns `className`, `table` and per-column `.name` as **undefined**, storing them as `slots.className`, `slots.table` and column `.prop`. | Read the stored keys, not the returned ones. | §5D constraint 4 |
| R-ARCH-7 | Panel-quality **MUST** count only bytes on the round-tripping path. An archetype that reads beautifully and does not compile back byte-exactly contributes nothing. | §7.2 definition. | §5D constraint 5, §7.2 |
| R-ARCH-8 | Residual top-level code under an archetype **MUST** be reported, never absorbed to inflate conformance. | Conformance gate. | §5 tier 1 |

### R-LANG — language, names and productions

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-LANG-1 | A rendered clause **MUST** be produced by exactly two layers — skeleton **names** (one per mined word) and per-site **productions** (one per statement kind) — and it must be knowable which layer owns a site. | §5C's two-layer table. | §5C |
| R-LANG-2 | A name's key **MUST** be `sha256(canonical skeleton)[0:16]`, axis-prefixed — **never** the word's dictionary id, which is an artifact of mining order. | `engine/word-names.js`. | §5C, §8 |
| R-LANG-3 | Mining-parameter changes **MUST** orphan nothing; a canonicalizer change **MUST** orphan exactly the skeletons it altered. | Retune `MAXWIN`/`MIN_COUNT`/`MIN_SKEL` → zero orphans. | §5C |
| R-LANG-4 | A leaf **MUST** be named only where `spanProse` has nothing site-specific to say. A static name where a production could quote the real identifier and callee is a **regression**. | The admission rule, decidable per site. | §5C |
| R-LANG-5 | A name whose skeleton no longer exists **MUST** move to the `orphans` ledger and **MUST NEVER** be deleted. | `word-names.json → orphans`. | §5C |
| R-LANG-6 | Before generating a new name the authoring pass **MUST** match against orphans first. | Authoring pass order. | §5C |
| R-LANG-7 | A re-adoption **MUST** be written to the rename queue as a **proposal**, scored by token edit distance, and **MUST NEVER** be applied automatically. Auto-re-attachment is the drift bug in a new costume. | `results/name-queue.json`; a human is the consumer. | §5C |
| R-LANG-8 | Rename-queue length **MUST** be reported beside byte-identity, as information — **never minimised** as a target. | §7.0 gate 4. | §5C, §7.0 |
| R-LANG-9 | Whether a hole is **word-like** (quoted verbatim into the clause) or **code-bearing** (left as code) **MUST** be a per-site predicate on the hole's contents evaluated at render time — **never** a policy attached to the hole's type. | The English-completeness scanner is the mechanical form of the predicate. | §5C, §7.0 gate 3 |
| R-LANG-10 | When a production cannot say something **true** about a site it **MUST** emit the vacuous clause and that site **MUST** be counted. A vacuous clause is retired by saying something true — **never** by rewording the placeholder to escape the frozen list. | §7.0 gate 2 + the frozen list. | §5C |
| R-LANG-11 | An LLM **MAY** propose **names only**, and every rename **MUST** be gated on byte-identity plus coverage invariance. Nothing correctness-relevant may come from a model. | `refine-language.js` rejects a rename that changes one output byte or lowers coverage. | §2 P2 |

### R-PAY — payload encoding

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-PAY-1 | Payloads **MUST** be plain readable UTF-8 text, never an opaque blob. The live form is `lzw1 <axis><wordId>⟨hole⟨hole…`. | `engine/payload.js`; `engine/dialect-guard.test.js`. | §7A.1 |
| R-PAY-2 | Any future encoding **MUST** be checked against the failure mode an opaque payload has: it **scales with success**, so improving the miner actively degrades the artifact. | Design review against that property. | §7A.2 |
| R-PAY-3 | Sentinel safety **MUST** be structural: an encoded payload **provably** contains none of `« » ⟪ ⟫ ▶ ⟨`, by escaping — never by an assumption about what the corpus happens to contain. | Escaping is total; the guard test asserts it. | §7A.3 |
| R-PAY-4 | `decode()` **MUST** be fail-closed: wrong tag, bad axis, missing id or unknown escape all throw, naming a stale superseded encoding specifically. | `engine/dialect-guard.test.js`. | §7A.4 |
| R-PAY-5 | Hole dedup via a shared fill table, and parameter hoisting, are **REJECTED**: both compress further and both replace visible source text with an indirection a reader must resolve by hand. Residual negative compression from gloss prose is honest and acceptable. | Neither is implemented. | §7A.5, §3 |
| R-PAY-6 | **A word id is not stable across a re-mine, and the payload references word ids.** A `.en` is therefore decodable only against the dictionary it was rendered with. The engine **MUST** close this either by (a) each `.en` naming the dictionary `fingerprint` it was rendered against, with `compileFileEn` **REFUSING** on mismatch, or (b) making ids content-addressed as skeleton names already are (strictly better, strictly more work). | Today's harm is bounded because the `.ts` is authoritative and a `.en` can always be re-rendered; the failure mode is a compile producing **wrong bytes, not an error**. | §1B.5, §8B |

### R-ART — the artifact contract

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-ART-1 | The engine tree is **engine code + PRD only**. It **MUST NOT** hold bytes derived from anyone's corpus; its remote is public and the corpus is not. | `engine/artifact-location.test.js`: no corpus-derived file on disk in the engine tree. | §8B |
| R-ART-2 | Every artifact **MUST** resolve from the corpus root through `AC.pathFor(kind, corpusRoot)`. No source line may name a corpus artifact relative to `__dirname`. | Guard assertion 4. | §8B |
| R-ART-3 | `tracked` artifacts **MUST** live at `<corpus>/sen/catalog/`; `cache` artifacts at `<corpus>/.cache/spec-derived/`. Root `catalog/` is forbidden for tracked artifacts because the corpus `.gitignore` ignores it and the file would be silently untracked. | `AC.HOMES`; guard assertion 2. | §8B, §1B.4 |
| R-ART-4 | Every artifact **MUST** carry the header `schema`, `artifactVersion`, `corpus` (corpus-pinned kinds), `generated`, `fingerprint = sha256(canonical body without header)[0:16]`. | `AC.stamp` is the only publisher; `AC.validate` refuses a missing or wrong fingerprint. | §8B |
| R-ART-5 | `schema` **MUST** be bumped on **any** shape change, and the registry's `requires` **MUST** name the top-level keys a consumer actually reads, so a same-version shape change is caught too. | The registry table in §8B. | §8B |
| R-ART-6 | A consumer that cannot verify what it is reading **MUST REFUSE**, naming what it expected and what it got. `catch { return null }` is the bug class, not the safety net. | No silent fallback anywhere downstream. | §8B |
| R-ART-7 | Validation **MUST** be the default read path: `AC.load` is the only read helper, so a new consumer must go out of its way to be unsafe. A genuinely-correct fallback is passed explicitly as `{optional: true}` and returns a **reason**, never a bare null. | `artifact-contract.js` exports no unvalidated read. | §8B |
| R-ART-8 | Compose-layer composites carry **no `id`**; they identify by `name` (`g_<len>_<6hex>`) plus `entryId`, and only `leaves` carry `id` (`p_<8hex>`). Consumers **MUST** use `AC.idOf(record)`. | Keying a composite on `.id` yields `undefined` for every one of them. | §8B |
| R-ART-9 | The id spaces **MUST** stay disjoint: `word-names` keys are `w:`/`n:<16hex>` over the LZW dictionary; compose-layer leaves are `p_<8hex>`. **Names key the LZW dictionary; panel surfaces key the compose layer** — a naming UI must read the LZW dictionary directly. | §8B composite id contract. | §8B |
| R-ART-10 | `word-names` entries **MUST** be the v1 shape `{sym, en, sites, named}` keyed by `sha256(sym)[0:16]` axis-prefixed. The v0 `{name, hint, tier}` shape is retired and its producers archived. | §8B registry. | §8B |

### R-PIN — corpus pinning

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-PIN-1 | Every generated artifact **MUST** carry a corpus stamp written **on the artifact**, never inferred from its path or filename. A filename is not provenance. | `corpus` header field. | §8C.1 |
| R-PIN-2 | There **MUST** be one publisher, and it **MUST** refuse to publish a library whose declared `corpus` is not the tree it is being published into. It writes the artifact **beside the corpus it describes**. | Publisher refusal. | §8C.2 |
| R-PIN-3 | A consumer **MUST** refuse a non-matching artifact and **MUST NEVER** fall back: it returns an honest miss naming what it looked for and where, and renders nothing. | `AC.load(kind, AC.pathFor(kind, selected), { corpus: selected })`. | §8C.3 |
| R-PIN-4 | An **absent** stamp is UNKNOWN, not WRONG: the artifact is unusable *for reporting* until republished, and **MUST NEVER** be silently adopted as an answer. | `allowUnstamped` is explicit, never default. | §8C.4 |
| R-PIN-5 | Version shadowing **MUST** filter by corpus **first**, then take the highest `vN` (unversioned sorts lowest). Version rank **MUST NEVER** override provenance. | Rank applied before provenance is exactly how a correct mine gets shadowed by a stale one. | §8C.5 |
| R-PIN-6 | An artifact **MUST** declare only what it carries: the publisher refuses when a summary count disagrees with the body or cannot be verified, and a build that cannot walk the whole tree **MUST** fail loudly or mark itself `complete: false`. Silent under-reporting is banned. | Publisher assertion. | §8C.6 |
| R-PIN-7 | A consumer **MUST** take its roots as **one selection**. There **MUST NOT** be a second independent setting for one fact — keeping two paths equal by discipline is not an invariant. | Resolution and validation take the same root from the same source. | §8C, §1B.1 |

### R-CFG — roots, configuration and wipability

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-CFG-1 | There **MUST** be exactly two roots: `SOURCE` (**read** — the `.ts` tree, never written by any tool) and `CORPUS` (**write** — holds `sen/` and every derived tree). | §1B.1. | §1B.1 |
| R-CFG-2 | The two roots **MUST** be independently settable and defaultable, with no crosstalk: same directory (self-hosting, the default) and different directories (render a fork into a fresh tree) must both work. | `engine/corpus-root.test.js`: setting one never moves the other. | §1B.1 |
| R-CFG-3 | Precedence **MUST** be resolved per root in exactly one module: `--source/--corpus` flag > env var > `<engine>/.env` > engine-relative default. | `engine/corpus-root.js` is the single resolver. | §1B.1 |
| R-CFG-4 | A root that is **set but missing MUST refuse loudly**, naming the root, the resolved absolute path, and **which layer supplied it**. There is no silent fallback to a default when an explicit setting is wrong. | Refusal message content. | §1B.1 |
| R-CFG-5 | Repointing either root **MUST** be a **one-file change** — one line in `<engine>/.env`. *"if you need to make more than 1 file change to alter the directory we are pointing at then we have done this wrong and need to fix it"* (Amir). | `corpus-root.test.js` greps the live tree and fails if a root literal or a second spelling appears outside the resolver and `.env`. | §1B.6 |
| R-CFG-6 | `sen` **MUST** be spelled in exactly one place (`LAYOUT.sen`) and consumed everywhere else through `CR.senDir()` / `AC.HOMES.tracked`. It is a folder name, **not** a root, and **MUST NOT** become configurable. | The grep guard. | §1B.2 |
| R-CFG-7 | Wiping `sen/` **MUST** require an explicit flag the user types (`--wipe-sen` **and** `--go`) — never a default, never silent, never a side effect of a cheaper cleanup or of an engine change alone. | `sdd-clean.js` gate. | §1B.3 |
| R-CFG-8 | **No flag = refuse**, and the refusal **MUST** name what it would have deleted, with file and byte counts, so the cost is visible before it is paid. | Dry-run output. | §1B.3 |
| R-CFG-9 | `SOURCE` **MUST NEVER** be wipable by any tool, and the protection **MUST** hold structurally even in the self-hosting case where `SOURCE === CORPUS` — not by the cleaner happening to be pointed elsewhere. | `sdd-clean.js` refuses at plan time, before any `rm`. | §1B.3 |
| R-CFG-10 | The wipe **MUST NOT** touch `<CORPUS>/catalog/`, the legacy STEP-4 tree. It is a separate, still-undetermined question (§Q-4). | `PROTECTED` name list. | §1B.3, §1B.4 |
| R-CFG-11 | A tool that deletes a tree **MUST NOT** live inside that tree, and a fresh corpus **MUST** need no scripts copied into it. | `sdd-clean.js` lives in the engine. | §1B.3 |
| R-CFG-12 | SOURCE-PROTECTED artifacts (§8A) **MUST** be tracked in the corpus's own repo and **MUST NEVER** be classified as regenerable-cache, gitignored away, or deleted in any cleanup. A cleanup that cannot tell them apart **MUST** stop and ask. | §8A list. | §8A |

### R-MEAS — measurement discipline

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-MEAS-1 | Every metric **MUST** be computed by one committed command reading one field of one committed artifact. **No metric is computed by eye**, and "done" **MUST** be a number a second engineer can reproduce. | §7.3. | §7.3 |
| R-MEAS-2 | Every English-coverage and statement-collapse ratio **MUST** use the **enfile-layer** total as its denominator; a compose-layer figure **MUST** be labelled as such, and the two **MUST NEVER** be mixed inside one ratio. | The denominator rule. | §4 |
| R-MEAS-3 | The un-collapsed classifier **MUST** stay frozen: (a) WIDE key recurs with freq ≥ 2; (a2) placeholder density **`holes / N < 0.5`**, a **strict** comparison; (b) not covered by a generator span in that file's `.en`; (c) not claimed by an archetype slot. The metric is the **count of files containing ≥ 1 such body**. | `engine/uncollapsed-density.js` + its mutation-checked test. | §7.3 |
| R-MEAS-4 | **(a2) MUST NOT be dropped.** Without it, a body whose every statement fails to generalize keys as all-placeholders, collides with every other such body, and scores `freq ≥ 2` — functions sharing no content counted as repeated structure. | The guard test. | §7.3 |
| R-MEAS-5 | The frozen vacuous-clause list **MAY** be added to and an entry **MUST NEVER** be removed to make the number fall. (Note `Object.freeze` on a `Set` does not prevent `.add()`.) | `engine/clause-quality.js VACUOUS`. | §7.0 |
| R-MEAS-6 | English-% **MUST** be reported and **MUST NOT** be optimised: a rise achieved by paraphrasing unique code is a regression in disguise. Byte size, by contrast, **IS** a metric — real lossless compression through recursive word reuse is a goal. | §7.1, §7.3. | §3, §7.1 |
| R-MEAS-7 | Residue **MUST** be classified, never papered over: non-recurring shape · free-text slot · comment/trivia · formatting variance. | Layer A reporting. | §4 |
| R-MEAS-8 | A candidate count **MUST NOT** be reported as a collapse count. WIDE-axis tools report *cluster candidates*; only sites passing the byte-exact gate become spans, and the two are not comparable. | Any "how much is left" claim comes from R-MEAS-3's classifier. | §9.1 |

### R-TEST — test integrity

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-TEST-1 | Correctness **MUST** assert against real source through a round-trip: the oracle is the corpus itself, `compileFileEn(renderFileEn(src)) === src` over actual files on disk. | §10.1. | §10 |
| R-TEST-2 | A mined artifact **MAY** be an **input**, and **MUST NEVER** be the **oracle**. Grading the engine against a catalog the engine wrote proves only that the engine still agrees with itself. | §10.2. | §10 |
| R-TEST-3 | Every guard **MUST** be mutation-checked at authoring time — disable the assertion, confirm it goes red *with the message it promises*, restore, confirm green — and that **MUST** be stated in the merge request. | §10.3. | §10 |
| R-TEST-4 | Pinning an **inventory** is legitimate; pinning an **answer** is not. A drift guard pins the current inventory so each addition becomes a decision someone makes, and is updated in the same commit with a stated reason. | §10.4. | §10 |
| R-TEST-5 | Where a full-corpus assertion is too slow, a test **MUST** sample deterministically (a fixed, evenly-spread sample) rather than narrowing its oracle. A test that skips is honest; a test that narrows its oracle to pass is not. | §10.5. | §10 |

# PART IV — CONTRACTS, CONFIGURATION AND LAYOUT

The register in Part III is the *what*. This part is the *where and how much*: the constants with
their sources of truth, the two protection levels an artifact can have, the executable artifact
contract, the provenance rules, and the two-root configuration model.

## 8. Constants

Every threshold the implementation depends on, with its literal value and source of truth.

| Constant | Value | Where |
|---|---|---|
| `MIN_COUNT` (word recurrence threshold) | **1** — a word need not recur; a file's own shape is admissible (§4B) | `engine/compose.js` `MIN_COUNT` |
| `MAXWIN` (max window length) | **64** — binds only `maxDepth`; past the longest node stream in the corpus the parameter is inert, so this is a ceiling, not a tuning choice (§4B) | `engine/enlzw.js` |
| `MIN_SKEL` (minimum skeleton bytes to promote a word) | **8** — settled; lowering it buys files with near-trivial words (§4B) | `engine/enlzw.js` |
| Skeleton-name key | **`sha256(canonical skeleton)[0:16]`**, axis-prefixed — never the word id (§5C) | `engine/word-names.js` |
| Frozen vacuous-clause list | frozen; **may be added to, never removed to lower the count** (§7.0) | `engine/clause-quality.js` `VACUOUS` |
| `MIN_WORD_CHARS` (ignore trivial punctuation tokens as words) | **4** | `engine/compose.js` `MIN_WORD_CHARS` |
| Gate corpus-coverage threshold | **≥ 20%**; note the `--min` flag default in code is 80 | `repo-dsl gate --min` |
| Gate worst-file threshold | **disabled (null)** — no per-file floor is enforced | `results/gate.json → thresholds.perFile` = `null`; `repo-dsl gate --min-file` unset |
| Byte-identity requirement | **every file, always — the floor** (§7.0) | §7 |
| Enfile-layer walk SKIP set | `node_modules, .git, .worktrees, dist, build, coverage, sen, spec, catalog, .cache, demo, coined-demo` (both `sen` and `spec` on purpose — §1B.2) | `write-en-files.js` `SKIP` |
| Roots | **not a constant** — `SOURCE` (read) and `CORPUS` (write), resolved per root: flag > env > `<engine>/.env` > engine-relative default (§1B.1) | `engine/corpus-root.js` `ROOTS` |
| Composition depth target (live `.en`) | **`generators.maxDepth ≥ 2`** | §7 |

---

### 8A. SOURCE-PROTECTED artifacts (never wipable-derived)

**All SOURCE-PROTECTED artifacts live in the CORPUS tree, never in the engine tree (§8B).** **TRANSITIONAL, NOT A CLAIM ABOUT AUTHORSHIP.** §1 states the `.en` is the source and the `.ts` is derived; §1B.5 records that the built direction is currently the opposite and that the question is open. The protections below cover the period in which the `.ts` is still the only copy — a sequence, not a contradiction. The composition capability was nearly lost by being treated as deletable derived output. The following are **SOURCE-PROTECTED**: they are the mined vocabulary the English source *depends on to compile and to compose*, and must **never** be classified as regenerable-cache, gitignored-away, or deleted in any cleanup — even though a mine can rebuild them, deleting them without a full re-mine breaks `.en → .ts`:

- **`<corpus>/sen/catalog/generators-lzw.json`** — the recursive LZW word dictionary; the ONLY generator
  vocabulary the live `.en` compiles through (§4A). It supersedes `catalog/generators.json`, which
  belonged to the deleted flat path and is no longer read by anything.
- **`<corpus>/sen/catalog/mined-library.json`** (the compose-layer composites — `compositeGenerators`, `builtFromComposites`, `maxHierarchyDepth`) — the **composition graph** (§4A, §5B). This is the artifact that was nearly lost; protect it explicitly.
- **`<corpus>/sen/catalog/word-names.json`** — the NAMES of the dictionary's leaf words, keyed by content hash
  of each canonical skeleton (§2.2). Hand-authored and *not* reproducible by a re-mine: the mine
  rebuilds the words, never their names. It also carries the `orphans` ledger, which is the only
  record of names authored for skeletons that have since drifted — deleting it destroys work that
  no amount of re-mining brings back.
- **`word-library.json` / coined-word catalog** and **`catalog/english-idioms.json`** — read-time coined-phrase and narration vocabularies.

Only `.calc` IR, coverage/index reports, and naming worksheets are wipable-derived (§5 on-disk layout). A cleanup that cannot tell these apart must **stop and ask**, never delete a catalog.

---

### 8B. THE ARTIFACT CONTRACT — location, header, and enforcement (2026-08-31)

> This section was previously documentation, so it was not a contract. It is now **executable**:
> `engine/artifact-contract.js` is the single resolver and validator, and
> `engine/artifact-location.test.js` fails the build if any rule below stops holding.

#### The location rule

**The engine tree is ENGINE CODE + PRD ONLY.** It is generic, corpus-agnostic and publishable, and
its remote is PUBLIC. It holds no bytes derived from anyone's corpus. Every artifact resolves from
the corpus root the engine was pointed at — `AC.pathFor(kind, corpusRoot)` — and lives with the
corpus:

| home | path | for |
|---|---|---|
| `tracked` | `<corpus>/sen/catalog/` | SOURCE-PROTECTED (§8A): expensive or hand-authored, must survive a cleanup |
| `cache` | `<corpus>/.cache/spec-derived/` | purely derived, regenerable by one command |

`sen/catalog/` rather than root `catalog/` is deliberate: the corpus `.gitignore` ignores root
`catalog/*`, so a SOURCE-PROTECTED artifact placed there would be **silently untracked** — which is
precisely how one gets lost.

**Why this rule exists.** The engine tree was found holding corpus-derived artifacts in a repo whose
remote is public: a dictionary in which the majority of leaf skeletons carried **verbatim function
and property names** from a private codebase (holes generalize *arguments*, never the callee or
property name), and a coverage artifact carrying **real corpus file paths and literal source lines**.
An artifact is corpus data, and corpus data lives with the corpus — not because of tidiness, but
because the engine tree is publishable and the corpus is not.

#### The header — every artifact carries one

```
schema           "sdd-repo-dsl/<kind>/<n>"   versioned identity; bump n on ANY shape change
artifactVersion  <n>                          split out so a consumer can range-check
corpus           <absolute path>              corpus-pinned kinds only
generated        <ISO date>
fingerprint      sha256(canonical body without header)[0:16]
```

Current strings — **authoritative, for cross-repo consumers that cannot import the validator**:

| kind | schema | home | file | consumer must read |
|---|---|---|---|---|
| generators-lzw | `sdd-repo-dsl/generators-lzw/1` | tracked | `generators-lzw.json` | `wide`, `narrow`, `gap` |
| mined-library | `sdd-repo-dsl/mined-library/1` | tracked | `mined-library.json` | `leaves`, `composites` |
| word-names | `sdd-repo-dsl/word-names/1` | tracked | `word-names.json` | `names`, `orphans` |
| corpus-coverage | `sdd-repo-dsl/corpus-coverage/1` | cache | `corpus-coverage.json` | `rollup`, `files` |
| gate | `sdd-repo-dsl/gate/1` | cache | `gate.json` | `pass`, `thresholds` |

`word-names` entries are **v1** `{sym, en, sites, named}`, keyed by `sha256(sym)[0:16]` axis-prefixed.
The **v0** shape `{name, hint, tier}` is retired and its producers are archived.

#### The enforcement rule — refuse loudly, never fall back silently

A consumer that cannot verify what it is reading **REFUSES**, naming what it expected and what it
got. `catch { return null }` is the bug class, not the safety net: it converts *"your vocabulary is
missing"* into *"your corpus contains no patterns"*, which reads as a measurement rather than a
failure. Validation is the DEFAULT path — `AC.load` is the only read helper, so a new consumer must
go out of its way to be unsafe. A genuinely-correct fallback is passed explicitly (`{optional:true}`)
and returns a **reason**, never a bare null.

Two silent fallbacks were removed when this landed: `loadIndex`'s `catch { idx._lzw = null }`, which
disabled the entire generator layer without a word, and `word-names.load`'s `catch { return {} }`,
which is drift incident 5's silent half.

#### The composite id contract (settled — do not guess again)

Compose-layer **composites carry NO `id` field.** They identify by `name` (`g_<len>_<6hex>`) plus
`entryId`; only `leaves` carry `id` (`p_<8hex>`). Any consumer keying a composite on `.id` is wrong
by construction and gets `undefined` for every one of them. Use `AC.idOf(record)`, which returns
`.id` for leaves and `.name` for composites. The id spaces are **disjoint with zero overlap**:
`word-names` keys are `w:`/`n:<16hex>` over the LZW dictionary, compose-layer leaves are `p_<8hex>`.
**Names key the LZW dictionary; the panel surfaces key the compose layer** — so a naming UI must read
the LZW dictionary directly, not the compose library.

#### The failure modes this rule exists to prevent

Every one of these has happened, and every one has the **same shape**: a producer changed, a consumer
kept reading, **nothing failed**, and a human eventually noticed a wrong number.

1. A payload written in one encoding, read by a decoder expecting another.
2. **The miner and the renderer walking different file sets** — the miner cannot mine what it never
   sees, so the gap is reported as un-collapsed structure rather than as a walk mismatch. This one
   accounted for the large majority of un-collapsed bodies at the time.
3. An artifact published before a switch, read against the corpus after it.
4. An artifact written to one directory and read from another.
5. **A shape change where the `schema` field already recorded it and nothing checked the field.** The
   most damning of the set: the contract existed as data and was never consulted, which is precisely
   why it is now executable.
6. A count describing one layer while the compile path runs through a different one.

#### The guard

`engine/artifact-location.test.js` (5 assertions, mutation-checked three ways): no artifact resolves
inside the engine tree; each lands in the home its protection level demands; no corpus-derived file
sits on disk in the engine tree; **no source line names a corpus artifact relative to `__dirname`**;
every artifact is contract-valid at its corpus location. It is mutation-checked per §10.3 — and it is worth
recording that on its first run it caught call sites that a careful reading of the same code had
missed, which is the §10 argument in one line.

---

### 8C. Corpus pinning — publisher and consumer rules

**The failure mode these rules exist to make impossible.** With more than one corpus in play and no
stamp binding an artifact to its tree, a consumer has no way to tell whose numbers it is rendering.
A correct, fresh mine can be **shadowed** by a higher-numbered file from a different project, and
nothing is capped and nothing is stale — the reporting layer is faithfully rendering *another
corpus's artifact*. **The reporting layer cannot be trusted while a number can arrive without
provenance.** The following are non-negotiable.

1. **Every generated artifact carries a corpus stamp.** `schema`, `artifactVersion` and `corpus` (the
   absolute root it was mined from) are written on the artifact itself, never inferred from its path
   or filename. **A filename is not provenance** — two corpora produce identically-named files.
2. **One publisher, and it refuses a mismatch.** Artifacts are written by a single publisher, which
   refuses to publish a library whose declared `corpus` is not the tree it is being published into,
   and writes the artifact **beside the corpus it describes** rather than into a shared catalog.
   Putting the artifact with its corpus is what makes wrong-repo substitution *structurally
   impossible* rather than merely unlikely.
3. **A consumer refuses a non-matching artifact and never falls back.** Resolution matches the
   selected corpus against the artifact's `corpus`. On no match the consumer returns an honest miss
   naming **what it looked for and where it looked**, and renders nothing. Serving another corpus's
   numbers is forbidden: a number without provenance is indistinguishable from a correct one once it
   reaches a screen, which is exactly how this class of failure stays invisible.
4. **An absent stamp is UNKNOWN, not WRONG.** An unstamped artifact is not condemned — it is unusable
   *for reporting* until republished through rule 2. It is never silently adopted as an answer.
5. **Version shadowing is explicit: highest `vN` wins, unversioned sorts lowest — but version rank
   NEVER overrides rule 3.** Filter by corpus first, then take the highest `N` among the matches.
   Rank applied before provenance is the precise mechanism that shadows a correct mine with a stale
   one.
6. **An artifact declares only what it carries.** The publisher asserts that any summary count it
   writes equals what is actually present in the body, and refuses to write when they disagree or when
   the value cannot be verified at all. **Silent under-reporting is banned:** a build that cannot walk
   the whole tree fails loudly or marks itself `complete: false` — it never emits a smaller plausible
   number for a consumer to render as truth.

---

## 1B. THE TWO ROOTS — `SOURCE` and `CORPUS`, and the `sen/` folder

**Status: BUILT, not proposed.** This section records what is actually implemented on disk and is
the engine's real configuration model. **It is the only root design.** An earlier proposal for three
roots (`EN_ROOT` / `TS_ROOT` / `BUILD_ROOT`) is **superseded and removed** — Amir, 2026-08-31:
*"The PRD still has a TON of stale data in it. like the 3 folders shit."* Two roots is the design;
what remains open about the *direction of truth* is §1B.5, stated in full there and nowhere else.

### 1B.1 Two environment variables, and only two

| var | role | contents |
|---|---|---|
| **`SOURCE`** | the **READ** root | the `.ts` tree the engine walks, parses and mines. **Never written by any tool.** |
| **`CORPUS`** | the **WRITE** root | holds `sen/` (the rendered English + the mined catalog artifacts) and every generated/derived tree (`.cache/`, root rollups). |

Amir, verbatim: *"Okay so it needs to be 2 different environment variables. One is where we read from
and one is where we write too. I need it to be this way because I should be able to copy the contents
of one codebase into a new one. and then I should be able to flip the path and then have both env
files point at the same corpus for reading and writing"*

**They are independent.** Each is settable and defaultable on its own, with no crosstalk:

- **Same directory** — `SOURCE=X CORPUS=X`. Self-hosting. This is today's behaviour and the shipped
  default (`Examples/hydra-source`), and it is why the distinction was invisible for so long.
- **Different directories** — `SOURCE=old CORPUS=new`. Render a copied or forked codebase into a
  fresh tree without writing a byte into the tree being read. This is the case that required two
  variables rather than one, and it is the reason `CORPUS` could not simply be renamed `SOURCE`.

Precedence, **per root, resolved in exactly one module** (`tools/repo-dsl/engine/corpus-root.js`):

```
--source=… / --corpus=…   (flag, relative to cwd)
  > SOURCE= / CORPUS=     (process env, relative to cwd)
  > <engine>/.env         (relative to the engine root)
  > engine-relative default   Examples/hydra-source
```

A root that is **set but missing refuses loudly**, naming the root, the resolved absolute path, and
**which layer supplied it**. There is no silent fallback to a default when an explicit setting is
wrong — a wrong path that silently becomes the right one is how a measurement gets attributed to the
wrong tree (§8B, incident 3).

### 1B.2 `spec/` is renamed `sen/` (lowercase)

Amir: *"the .en files go into the corpus folder. right now we have it called spec but it should be
called sen"*, then *"rename that folder SEN"*, then *"lowercase"*.

The **whole** folder was renamed inside `CORPUS`, substructure preserved and every file's content
byte-identical — verified by comparing a file manifest hash before and after:

```
<CORPUS>/sen/files/       the rendered .en, mirroring the SOURCE tree
<CORPUS>/sen/catalog/     the §8B tracked artifact home (generators-lzw, mined-library, word-names)
<CORPUS>/sen/skeletons/   derived
<CORPUS>/sen/archetypes/  derived
```

**`sen` is not a third root.** It is a folder *name*, spelled in exactly one place —
`LAYOUT.sen` in `engine/corpus-root.js` — and consumed everywhere else through `CR.senDir()` or
`AC.HOMES.tracked`. It is not configurable, and it should not become configurable: its position is
defined by `CORPUS`, and a second knob for one fact is a second source of truth (R-PIN-7).

Variable names stay uppercase by convention (`SOURCE`, `CORPUS`); the folder on disk is lowercase
`sen`. Note that §8A/§8B prose written before today still says `<corpus>/sen/catalog/`; that path
now reads `<corpus>/sen/catalog/`, and the code is the authority.

### 1B.3 `sen/` is wipable — behind an explicit flag, never otherwise

Amir: *"the SEN folder with the catalog is supposed to be wipable"*.

It is, and the gate is deliberate rather than incidental:

- Wiping `sen/` requires an **explicit flag the user types**. Never a default, never silent, never a
  side effect of a cheaper cleanup, and never triggered by an engine change alone.
- **No flag = refuse**, and the refusal must *name what it would have deleted*, with file and byte
  counts, so the cost of the wipe is visible before it is paid.
- The wipe must not touch `<CORPUS>/catalog/` — the **legacy STEP-4 tree** at the corpus root. That
  is a separate and still-undetermined question, explicitly out of scope. See §1B.4.
- **`SOURCE` is never wipable, by this or any tool.** It is read-only input, full stop. The
  protection must hold *structurally* even in the self-hosting case where `SOURCE === CORPUS`, not
  by the cleaner happening to be pointed elsewhere.

Owner: `tools/repo-dsl/sdd-clean.js`, gated on `--wipe-sen` **and** `--go`. It lives in the
**engine**, not in the corpus. It used to be `<corpus>/sdd-clean.js`; on 2026-08-31 Amir wiped the
corpus by hand and the cleaner went into the wastebasket along with the tree it existed to clean.
A tool that deletes a tree must not live inside it — and a fresh corpus should need no scripts
copied into it. Amir on that wipe: *"it was a deliberate wipe. I shouldnt see any of those files
show up again unless I run the command"* — which is the requirement stated as an operating habit.

**Why a wipe is tolerable at all.** `sen/catalog/` holds SOURCE-PROTECTED artifacts (§8A) that a
`.en` cannot compile without — wiping them is closer to wiping source than to clearing a cache. What
makes the gated wipe acceptable **today** is that `sen/` is entirely **re-derivable from `SOURCE`**:
the `.en` is rendered from the `.ts`, not the reverse. If that ever inverts (§1B.5), this gate must
harden from *"explicit flag"* to *"refuse"*.


### 1B.4 The two catalogs are different things

`<CORPUS>/catalog/` (legacy STEP-4: `operation-idioms.json`, `function-archetypes.json`, and the
hand-curated `coined-words.json`) is **not** `<CORPUS>/sen/catalog/` (the §8B tracked artifact home).
They are separately produced, separately consumed, and separately protected. Do not merge or
conflate them without a decision. `sen/catalog/` was chosen over the root `catalog/` precisely
because the corpus `.gitignore` ignores root `catalog/*`, so a SOURCE-PROTECTED artifact put there
would be silently untracked (§8B).

### 1B.5 OPEN — the direction of truth is not settled

**Unresolved. Do not resolve it by inference, and do not treat the two roots as having settled it.**

§1 states the thesis: the English is the source and the `.ts` is derived. **What is built is the
opposite** — the `.ts` in `SOURCE` is authoritative, the `.en` in `CORPUS/sen/` is generated from
it, and `sen/` is therefore wipable (§1B.3). Nothing in the two-root work moves the project across
that line; it makes the two directions cheap to point at different trees, which is a **precondition**
for a flip, not the flip.

**Full-corpus byte-identity is necessary and NOT sufficient to flip**, for two specific reasons:

1. **The gate only tests machine-rendered `.en`.** It asserts `compile(render(ts)) === ts`. A
   *hand-edited* `.en` — the entire point of a flip — exercises paths the gate has never run. Until
   a human has edited a `.en`, compiled it, and reviewed the resulting `.ts` as a normal diff,
   "English is the source" is an assertion about a path nobody has walked.
2. **THE BLOCKER — `.en` payloads reference word ids, and the ids move.** See **R-PAY-6**: ids are
   array indices renumbered by every re-mine, so a `.en` is decodable only against the exact
   dictionary it was rendered with. Harmless today, because the `.ts` is authoritative and a `.en`
   can always be re-rendered. After a flip it is fatal: one re-mine silently invalidates every `.en`,
   and the failure is a compile producing **wrong bytes, not an error**. **Nothing may flip until
   R-PAY-6 is closed.**

**And whatever happens, the `.ts` stays generated AND committed** — like generated clients or
protobufs: authored elsewhere, checked in anyway. A broken compiler then costs a rebuild, never the
code. The failure this ordering exists to prevent is a cleanup treating `src/` as derived output
while the `.en` still cannot be trusted to reproduce it — deleting the only copy on the strength of a
gate that never tested hand-authored input. This effort has already destroyed irreplaceable
artifacts once.

**Any session that touches direction-of-truth must ask Amir which direction is current before
assuming.** This gap was silently forgotten once already; it is written here so it cannot be again.


### 1B.6 Acceptance test — the one-file rule

Amir, verbatim, 2026-08-31, and this is a **rule**, not a preference:

> *"if you need to make more than 1 file change to alter the directory we are pointing at then we
> have done this wrong and need to fix it"*

**Repointing any one root — `SOURCE` or `CORPUS` — must be a ONE-FILE change: one line in
`<engine>/.env`.** It holds per root, independently. Any future change to how roots are found must
preserve it, and it is enforced executably, not by review:
`tools/repo-dsl/engine/corpus-root.test.js` greps the live tree and fails if a root literal, a
corpus-rooted `spec` join, or a second spelling of `sen` reappears anywhere outside the resolver
and `.env`.

---

# PART V — ACCEPTANCE

**This part states GATES, not readings.** A number here is a threshold or a definition. Nothing in
this part is a status report; where status is contested, that is §Q-2.

## 7. Success criteria

**This section states GATES, not readings.** A PRD says what must be true; it does not carry a
scoreboard. Every number that was a point-in-time measurement has been removed — run the tools for
current values (`npm run measure`, `npm run measure:uncollapsed`, `npm test`). What remains is the
definition of each measure and the bar it must clear, because a definition is a requirement and a
reading is not.

### 7.0 The four gates

| # | Gate | Computed by | Requirement |
|---|---|---|---|
| 1 | **Byte-identity** | `en-index.json → gate.byteIdentical` | **Every file in the corpus, always.** This is the floor and it never regresses. A change that improves readability and loses one byte of identity is a regression, not a trade. |
| 2 | **Vacuous clauses** | `measure-english.js` (i), classifier frozen in `engine/clause-quality.js` | **Zero** — or a floor stated with sampled evidence for why it cannot be zero. |
| 3 | **English-completeness** | `measure-english.js` (ii) | **100%, held.** No clause may carry TypeScript syntax outside quoted verbatim regions. |
| 4 | **Rename queue** | `results/name-queue.json` | **Reported, never minimised.** The number is information, not a target to drive down. |

**Gate 2 — the frozen vacuous classifier.** A fixed list of placeholder clauses (`run a step`,
`compute a value`, `return the result`, `branch on a condition`, …) — the phrases that say only that
*something* happened. It is a frozen array plus a private lookup `Set`; note that `Object.freeze` on
a `Set` does not prevent `.add()`. **The list may be added to; an entry may NEVER be removed to make
the number fall.** That rule is the whole point of freezing it.

**Gate 3 — the English-completeness scanner.** Strip every quoted verbatim region (`` `ids` `` and
`"literals"`) and every parenthetical idiom from a clause; if TypeScript syntax survives in the
residue, the clause is code wearing a sentence's clothes and it fails. This is the mechanical form of
the per-site predicate in §5C, and it is trusted over the author's eye.

### 7.1 The byte-level ceiling is not a gap to close

There are two ceilings and they behave differently.

- **Sentence-level: ~100%.** Every clause the renderer emits can be made to read as English. This is
  gate 3, and it is a real target.
- **Byte-level: bounded well below 100%, and that is correct.** A large share of corpus bytes are
  **code-bearing hole interiors** — expressions with their own syntax. That is **code by nature, not
  a gap**. Rendering it as prose would be a lie the gate-3 scanner exists to catch.

**Requirement: do not chase the byte-level English percentage.** A rise in it achieved by
paraphrasing unique code is a regression in disguise (§3). Report it; do not optimise it.

### 7.2 Panel-quality reading

**"Panel-quality" is the name of an engine metric, not a dependency on any UI.** `measure-english.js`
computes and prints it per archetype. Read it as *"reads well enough to show a human unedited."*

**Definition:** the share of an archetype's bytes inside spans whose every clause is both
English-complete and non-vacuous.

**What it must be measured on.** Panel-quality counts only bytes on the **round-tripping path** —
mined words plus the §5C per-site productions. A number produced by a grammar that does not compile
back byte-exactly does not qualify, whatever it reads like. The comparison that matters is not the
percentage but the **totality**: a hand-authored grammar renders the archetypes someone wrote a
grammar for; this path must render *every* file and compile every one of them back byte-exactly.

### 7.3 Frozen definitions and the remaining gates

**Measurement discipline (a requirement, not a convention).** Every metric is computed by one
committed command reading one field of a committed artifact. `write-en-files.js` regenerates
`en-index.json` into the gitignored cache (`--dry-run --out <dir>` measures without writing to the
corpus); `measure-uncollapsed.js` implements the frozen classifier below and buckets each gap as
MINER / GATE / ARBITRATION per §5A. **No metric is computed by eye**, and "done" must be a number a
second engineer can reproduce, not a judgement.

**Frozen definitions.**

- **Total statements `S`** — the sum of function/method body statements over the enfile-layer walk
  (§4), as counted by `fnStmtCount` in `operations.js`. The fixed denominator.
- **Statement-collapse ratio** = `generators.netStatementReduction ÷ S`, where
  `netStatementReduction = statementsCollapsed − calls` (both fields of `en-index.json →
  generators`). It is the fraction of body statements removed from the reader's view by being folded
  into a generator call.
- **Un-collapsed repeated structure** — decidable, frozen to one classifier. A function/method body
  qualifies iff **(a)** its WIDE-axis canonical key recurs across the corpus with frequency
  ≥ `minCount` (2); **(a2)** its key has **placeholder density below ½** — of the *N* per-statement
  parts of the key, the number equal to the hole symbol `·` must satisfy **`holes / N < 0.5`**, a
  strict comparison, since exactly one half is not enough; **(b)** it is not covered by a generator
  span in that file's `.en`; and **(c)** it is not claimed by an archetype slot. The metric is the
  **count of files containing ≥ 1 such body**. Membership is a pure function of the two canonical
  keys and the `.en`, so two engineers get the same answer.

  *(a2) is load-bearing and must not be dropped.* Without it, a body whose every statement fails to
  generalize keys as all-placeholders, so every such body collides with every other and each scores
  `freq ≥ 2` — functions sharing no content are counted as repeated structure. Frozen in
  `engine/uncollapsed-density.js`, guarded and mutation-checked by `engine/uncollapsed-density.test.js`.

**The remaining gates.**

| Measure | Requirement |
|---|---|
| **Files with un-collapsed repeated structure** | **→ 0**: every recurring-up-to-renaming body is promoted, or provably non-refillable. |
| **Composition depth on the live `.en` path** (`generators.maxDepth`) | **≥ 2 and rising** — the live compile must expand generators that call generators (§5B). Depth 1 means the flat degenerate path (§2.4). |
| **Real lossless compression** (`1 − .en ÷ .ts` over the enfile-layer walk) | **Must turn positive and rise.** The `.en` must become smaller than the `.ts`, by recursive word reuse — never by paraphrase. |
| **Statement-collapse** | Rising, with byte-identity held. |

**Explicitly not a metric: English-%.** It is a by-product; a rise from paraphrasing unique code is a
regression in disguise. **Byte size IS a metric:** real lossless compression through recursive word
reuse is a goal, not a forbidden one. The earlier "compression is capped, not a target" framing
applied only to the flat anti-unification path and does not hold for LZW.

---

### 7A. Payload encoding — requirements

The `.en` payload carries each span's hole fills. Its encoding is a **readability requirement**, not
an implementation detail, because the `.en` is the canonical human artifact (§1).

1. **Payloads MUST be plain readable UTF-8 text, never an opaque blob.** Hole text is the code's own
   identifiers and literals; encoding it opaquely turns the artifact a human is meant to read and
   edit into something they cannot. The `lzw1` encoding (`engine/payload.js`) is the live form:
   `lzw1 <axis><wordId>⟨hole⟨hole…`, holes introduced by `⟨` and running to the next `⟨` or the
   payload end, with no closing bracket.
2. **The failure mode this rule exists to prevent:** an opaque payload scales with success — each
   newly mined word appends more blob, so **improving the miner actively degrades the artifact**.
   Any future encoding must be checked against that property.
3. **Sentinel safety MUST be structural, not incidental.** The `.en` scanner locates spans by
   searching for its sentinels, which is sound only if no payload can contain one. Escaping provides
   that **by construction**, so an encoded payload provably contains none of `« » ⟪ ⟫ ▶ ⟨`. This must
   not rest on an assumption about what source happens to contain — that no sentinel appears in a
   given corpus today is luck, and luck is a hazard, not a guarantee.
4. **`decode()` MUST be fail-closed.** Wrong tag, bad axis, missing id, or unknown escape all throw.
   A stale payload in a superseded encoding is named specifically, so the fix is obvious.
5. **Readability beats further compression.** Hole dedup via a shared fill table, and parameter
   hoisting, both compress further and both replace visible source text with an indirection a reader
   must resolve by hand. Per §3, and Amir's standing instruction that compression is the strategy and
   not the point, they are **rejected**. Residual negative compression from gloss prose and span
   structure — which the `.ts` does not carry — is honest and acceptable.

Guarded by `engine/dialect-guard.test.js`, mutation-checked per §10.3.

---

## 10. Test integrity — what a test is allowed to assert against

`enfile.test.js` and `enfile-label-sanitize.test.js` asserted against **committed mined data** —
artifacts the engine itself had produced. A test that compares the engine's output to the engine's
own earlier output cannot fail for the reason it claims to check: it proves only that the engine
still agrees with itself. Both passed continuously, proved nothing, and revealed it only when the
data they leaned on was deleted and they went red for a reason unrelated to correctness. The
byte-exact gate (§2.3) is the whole guarantee this project sells; a self-confirming test of it is
worse than no test, because it reports confidence that was never earned.

1. **Correctness asserts against real source, through a round-trip.** The oracle is the corpus
   itself: `compileFileEn(renderFileEn(src)) === src` over actual files on disk. A test of engine
   correctness must never take a mined artifact as its expected value.
2. **A mined artifact may be an INPUT, never the ORACLE.** Feeding a catalog into a test is fine —
   grading the engine against a catalog the engine wrote is not.
3. **Every guard is mutation-checked at authoring time.** Disable the assertion, confirm the test
   goes red *with the message it promises*, restore, confirm green. State that it was done in the
   merge request. An unmutated guard is a guess about whether it guards anything.
4. **Pinning an inventory is legitimate; pinning an answer is not.** A drift guard (§“prefer a drift
   guard to a frozen value”) pins the *current inventory* so each addition becomes a decision someone
   makes. That is not self-confirmation, because a failure is a decision point and the pin is updated
   in the same commit with a stated reason — unlike a mined artifact silently reused as truth.
5. **Sample deterministically rather than skipping.** Where a full-corpus assertion is too slow for
   the loop, take a fixed, evenly-spread sample so the test is cheap, reproducible, and still asserts
   against real source — the full-corpus run stays the build's own gate. A test that skips is honest;
   a test that narrows its oracle to make itself pass is not.

---

## 9. Load-bearing assumptions

Premises this PRD relies on but has not independently verified — surfaced so they are visible rather
than silent.

1. **A candidate count is not a verified-collapse count.** The WIDE-axis measurement tools report
   *cluster candidates*; only sites whose refill passes the byte-exact gate become real generator
   spans. The two differ by construction and are **not comparable**. Any claim about "how much is
   left" must come from the frozen classifier in §7.3, never from a candidate count.
2. **`S` (total body statements) is stable enough to be a denominator.** It is recomputed on each
   render run, so a large refactor of the corpus would move it. The statement-collapse ratio is only
   comparable between runs **over the same corpus revision**.
3. **Metrics are not portable between corpora.** Every path and byte total is relative to the
   resolved corpus root with its SKIP set. Moving to another tree requires re-deriving `S` and both
   byte totals before any ratio means anything.
4. **Documenting a risk is not a control.** An artifact recorded as stale in a document will still be
   served, because nothing downstream reads the document. Every guarantee in this PRD must be
   enforced by code that refuses, or it is not a guarantee. This assumption has already failed once
   and is the reason §8B is executable rather than descriptive.

---

# PART VI — WHAT IS NOT DECIDED

## §Q Open questions — none of these may be resolved by inference

**Read this part before making any design decision.** Everything here is genuinely undecided.
Guessing at one of them and building on the guess is the most expensive mistake available in this
project, and it has happened. Each entry says who can close it and what closing it requires.

**Severity.** **BLOCKING** — work that depends on it must stop and ask. **DESIGN** — needs a written
design pass, then confirmation. **CLARIFY** — a contradiction or gap in this document that someone
must settle so the register stops being ambiguous.

---

### Q-1 — Direction of truth: does English ever become authoritative? · BLOCKING · Amir

**The question.** §1's thesis is that the `.en` is the source and the `.ts` is derived. **What is
built is the opposite.** Whether the project actually flips — and when — is not decided and has
never been scheduled.

Stated in full in **§1B.5**, which is the only place it lives. In short: the original direction may
have wanted English as the authoritative source with TypeScript derived from it. **That is not
decided and not built.** Two roots (`SOURCE`/`CORPUS`) is the design that ships.

**What closing it requires:** Amir's decision on direction, plus **R-PAY-6** closed first (word ids
renumber on every re-mine, so a flip would let one re-mine silently invalidate every `.en`), plus a
human having actually authored a `.en` and reviewed the compiled `.ts` as a diff.

**Downstream of it, and therefore also open:** when `sen/`'s wipe gate must harden from *"explicit
flag"* to *"refuse"* (§1B.3 says "at the flip"; the flip has no defined trigger).

### Q-2 — Is the LZW core front DONE? This document contradicts itself. · CLARIFY · one measurement

**The contradiction, verbatim from two places in this file:**

| says | where |
|---|---|
| the live path **is** the LZW dictionary; "the flat anti-unification layer is deleted"; tiers are realized as real composition at depth | §5 (both status lines), §4A ("the requirement"), §4B ("the STANDING STATE, not a roadmap item") |
| the live path **is still** flat anti-unification, and replacing it is the core front; the composition capability "already exists on the abandoned path and is being lost" | §2 P1 ("Deviation to fix"), §6 front 0, §6 front 4 |

**Both cannot be true.** The requirement is not in doubt — **R-MECH-1** and **R-COMP-7** stand
either way. What is unknown is whether they currently hold.

**What closing it requires:** one measurement, not a reading. Run the render and report
`generators.maxDepth` and which vocabulary `enfile.js` actually loaded. If `maxDepth ≥ 2` through
`generators-lzw.json`, the §5/§4A claims are right and §2 P1's "deviation to fix" plus §6 fronts 0
and 4 are stale text to cut. If not, the reverse. **Do not settle it by reading the code** — that
method has produced a confident wrong answer here before.

### Q-3 — The archetype/word hybrid: how does a slot bind to a word? · DESIGN · Amir + a design pass

**Direction is SETTLED** (Amir: *"it needs to be a pattern/words archetype hybrid"*) and the
requirements are R-ARCH-1..8. **The mechanics are not designed.** Five specific unknowns, stated in
§5D and repeated here so they are visible from the open-questions list:

1. **How a slot binds to a word** — does an archetype slot reference a dictionary word id directly,
   or declare a hole type the word layer fills at render time?
2. **Whether an archetype is itself a dictionary entry** — the top of the same recursive hierarchy
   (the natural reading of §2 P4, where tier *is* dictionary depth), or a separate template layer
   above it? Different failure modes.
3. **Who wins a contested span** — the concrete arbitration order between archetype slots and mined
   words, beyond "it must be deterministic" (R-ARCH-5).
4. **Whether hand-authored grammars survive at all**, or the archetype reduces to a slot *skeleton*
   with every fill mined.
5. **What replaces per-site productions** — `spanProse`'s productions (§5C) currently carry the
   readability tier-1 grammars would have; how the two divide the work is undecided.

**What closing it requires:** write the design, get it confirmed, then build. **No wiring should be
built on a guess.**

### Q-4 — Does the legacy `<CORPUS>/catalog/` tree survive? · CLARIFY · Amir

`<CORPUS>/catalog/` (STEP-4: `operation-idioms.json`, `function-archetypes.json`, and the
hand-curated `coined-words.json`) is a different tree from `<CORPUS>/sen/catalog/` (§1B.4, R-ART-3).
It is explicitly out of scope for the `sen/` wipe (R-CFG-10) and is still read by
`engine/operation-idioms.test.js`, which joins the corpus root directly rather than going through
`AC.pathFor` — deliberately, with a comment saying so.

**Undecided:** whether it is retired, migrated under the artifact contract, or kept indefinitely as
a separate hand-curated tree. Until it is decided, **do not merge or conflate the two catalogs.**
`coined-words.json` is hand-curated and not reproducible by any mine, so a wrong answer here loses
work permanently.

### Q-5 — Which gate threshold is normative? The constants table disagrees with the code. · CLARIFY

§8 records the gate corpus-coverage threshold as **≥ 20%** and then notes that *"the `--min` flag
default in code is 80"*. Those are different requirements, and the table states both without saying
which binds. The worst-file threshold is separately recorded as **disabled (null)** with no per-file
floor enforced.

**What closing it requires:** one decision — the PRD value, the code default, or a deliberate
"coverage is not a gate any more" — and then the losing number deleted rather than annotated. A
constant with two values is not a constant.

### Q-6 — Two requirements that are readings of current behaviour, not requirements · CLARIFY

Flagged rather than silently promoted or cut:

- **`MAXWIN` is "64, which is the point past which the parameter is inert"** (§4B, R-MINE-2). *Inert*
  is an observation about the longest node stream in a particular corpus, not a property of the
  design. On a corpus with longer streams the number would bind. Keep 64 as the value; confirm
  whether "inert" is meant as a permanent claim.
- **`minCount` appears twice with different values** — `MIN_COUNT = 1` for word promotion
  (§4B, §8, R-MINE-1) and `minCount ≥ 2` for middle-tier body candidacy (§5A, §7.3, R-WIDE-3).
  They are two different thresholds in two different modules, and this document has never said so in
  one place. Confirm the reading, so nobody "fixes" one to match the other.

### Q-7 — Implied but never stated: where does the naming worksheet go? · CLARIFY

The register has no requirement for the naming worksheet's location because the document states
none. `name-words-lzw.js` currently writes its worksheet **into the engine tree**, which is a
straight violation of the location rule (**R-ART-1**: engine code + PRD only, no corpus-derived
bytes). Either the worksheet is corpus-derived and belongs under `<corpus>/.cache/spec-derived/`, or
it is not, and the document should say why.

**This is a gap surfaced by reorganizing, not a new requirement — it is not in the register.**

---

## 6. Open technical fronts

**These are work items, not questions.** A front is something to build; §Q is something to decide.
Front 0 and front 4 both assert an implementation status that §5/§4A contradict — see **§Q-2** before
acting on either.

**0. THE CORE FRONT — replace flat anti-unification with LZW dictionary construction (§4A).** This supersedes and subsumes fronts 1–4 below: they were framed around the flat generator layer, which is itself the defect. The required work, as explicit requirements:
   - **Pattern discovery MUST be LZW dictionary construction over the bottom-up AST node stream** (§5 core pipeline), *not* flat anti-unification / clone detection.
   - **Generators MUST be able to reference other generators** (recursive words, `members[]`/`hierarchyDepth`); the flat, holes-are-verbatim-TS path is retained **only as a fallback for genuinely-unique one-offs** that recur nowhere.
   - **Byte-identity is preserved** — LZW losslessness is exactly what makes real compression compatible with the byte-exact gate (§2.3).
   - **Success is real (lossless) compression via recursive word reuse + statement-collapse** (§7), not line-by-line translation.
   Build on the compose-layer seed (`compose.js`, `lzw.js`, `mined-library.json`) — SOURCE-PROTECTED (§8A) — not on `generators.json`. Then point `enfile.js` at the recursive dictionary and expand nested word references recursively.

1. **Finish the member/ctor-generalized procedure layer (specified in §5A).** The additive widened axis has begun landing (5,623 statements collapsed); the remaining work is to promote the rest of the WIDE-axis recurring bodies. The `type`-name hole is admitted only when the type is not load-bearing for refill — concretely, when replacing it with a `‹type›` hole still yields a byte-exact `fillOf` at every site (the same gate as every other hole), never on a subjective judgement. Hard constraint unchanged: every widened generator must **refill byte-exact** at every site.
2. **The language front: per-site productions in `spanProse` (§5C), scored by §7.** This is where the remaining readability lives. It replaced an earlier front that chased a file-count metric toward a ceiling nobody had measured, by routes that all amounted to *punch more holes until things match* — the §4A defect. A readability number bought that way is not readability.
3. **Whole-repo statement reduction, not per-file coverage.** Cross-file repetition carries the leverage (composites built from composites, at depth). Drive down `netStatementReduction`-eligible residue across the whole corpus (the §7 metric), not a per-file average.
4. **Close the composition gap — point `.en` compilation at the composing layer (§4A, §5B).** Either wire `enfile.js` to expand compose-layer composites recursively, or rebuild the middle-tier generators as composites carrying `members[]`/`hierarchyDepth`. Success = the live `.en` path compiles through generators-calling-generators (manifest `generators.maxDepth ≥ 2`), not the flat `generators.json`. This is the highest-value front — the capability already exists on the abandoned path and is being lost.
5. **Measurement discipline.** Keep the measure-first scripts (`measure-bytes.js`, `measure-middle-tier.js`, `measure-windows.js`, `measure-operations.js`, `measure-callgraph.js`) as the source of truth; refresh the stale `gate.json` snapshot so the gate reflects the current library.
