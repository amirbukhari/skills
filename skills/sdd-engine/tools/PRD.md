# PRD — English-as-Source (the repo-DSL engine)

**Status:** in progress · grounded in the code under `sdd-engine/tools/repo-dsl/` as of 2026-08-30
**Home:** this file lives at `sdd-engine/tools/repo-dsl/PRD.md` (moved out of `scrutinize-spec/` on 2026-08-31 when the engine became its own skill) — beside the engine and `README.md` it describes, not at the repo root (the root is a multi-skill monorepo; this feature is one tool inside it).
**Scope note:** written READ-ONLY while another session (s1) is actively editing the engine. Numbers below are read from committed catalog/result files and the live corpus manifest; where a result file is a stale snapshot it is flagged as such.

---

## 1. Problem & goal

We have a large real TypeScript corpus (Rentsync/Hydra: **1037 source files**; two layer-specific byte totals are given and reconciled in §4 — do not use a bare "corpus size" number). Most of it is not novel — it is the same shapes, the same procedures, the same data structures, re-typed with different names. Today that repetition sits on disk as raw code, over and over.

**The success definition, in plain terms:**

> **Repeated code — whether it repeats inside one file or across files — must never appear as raw code.** Recurring structure is mined *deterministically* into a **recursive dictionary of words (generators)**, and the English source is each file **re-emitted as a stream of those words**. Because bigger words are defined in terms of smaller words, the source is genuinely **shorter** (repeated structure → a single word reference) **and** losslessly `.en → .ts` **byte-identical**. The **whole repo stays the real, editable source** — you edit the English (`.en`), the `.ts` is derived.

**The core mechanism is LZW dictionary construction over the AST — this is the design, stated up front (§5).** Parse each source file to its AST; walk **bottom-up from the leaves**; run the **dictionary-building (encoding) half of LZW** over that node stream. LZW's defining property is that *every new dictionary entry is an existing entry plus one more symbol* — so the dictionary is **recursive by construction**: larger patterns are defined in terms of smaller patterns already in it. **Each dictionary entry is a word is a generator.** Because entries reference earlier entries, **generators reference generators automatically** — composition is *emergent* from LZW, not bolted on, and the ARCHETYPE→SKELETON→IDIOM→LEAF hierarchy is the emergent **dictionary depth**, not hand-labeled levels.

**Two things the compressor does not settle, and §5C does.** A dictionary makes a file *short*; it
does not make it *read*. Two layers turn a word into a sentence — **skeleton names** (word-level,
content-hashed, cosmetic by construction) and **per-site productions** (statement-level, reading the
real AST). The measured finding is that productions are the larger and cheaper half: ~14 statement
kinds outreach 2,450 nameable words, because a name caps at 8.4% of corpus bytes and a production
can quote the site. See §5C for the design and §7.0 for the scoreboard.

**The compiling half is DONE, and should not be read as a roadmap item.** "Write the `.en` and get
the file" is **already true for all 1037 files** (§4B). Everything now in flight is a question about
how the `.en` *reads*.

So "English source" here is not translation and not documentation. It is a *lossless compressor's dictionary made readable*: LZW factors the repo into a recursive word dictionary; the English re-emits each file as a short word stream; and a byte-exact gate guarantees the derived code is the exact bytes we started from. LZW is **lossless *and* compressing** — real compression under byte-exactness is exactly what the mechanism delivers. The metric that matters is **real (lossless) compression via recursive word reuse plus statement-collapse**, not how much prose we produce.

---

## 1A. THE THREE ROOTS — spec only, nothing moved (2026-08-31)

Amir: *"I think there needs to be 3 folders involved. Theres the English source code folder, then
theres the typescript source folder, then theres the typescript build folder."* This section names
them and states their contract. **Nothing has been moved; this is a specification awaiting a
decision.**

| root | contents | written by | read by | authoritative? | safe to wipe? |
|---|---|---|---|---|---|
| **EN_ROOT** — English source | `**/*.en` | today `write-en-files.js`; **after the flip, a human** | `compileFileEn` | **intended** source of truth (§1) | **NO** |
| **TS_ROOT** — TypeScript source | `src/`, `packages/`, `tests/` | today a human; after the flip, the compiler | `tsc`, the miner, every tool | **today's** source of truth | **NO** — see §1A.2 |
| **BUILD_ROOT** — TypeScript build | `tsc` output (`dist/`) | `tsc` | the running application | never | **YES, always** |

**VOCAB is not a fourth root — it belongs to EN_ROOT.** `generators-lzw.json`, `mined-library.json`
and `word-names.json` (§8B, `<corpus>/spec/catalog/`) are *part of the English source*: a `.en`
cannot compile without them, exactly as a program cannot compile without its headers. Wiping VOCAB
is wiping source. This is why they are SOURCE-PROTECTED (§8A) and tracked, not cached.

### 1A.1 The direction-of-truth question

§1 has always said the `.en` is the source and the `.ts` is derived. §8A protects the `.ts` and
treats the `.en` as derived. **These are opposite rules over the same bytes**, and the contradiction
has been latent because we only ever render in one direction.

**Ruling: the PRD should state what §1 already states — the `.en` is the source.** Amir's phrase
"English source code folder" is the project's thesis, not a new idea. §8A's protection of the `.ts`
is not a competing claim about authorship; it is a **transitional safety** covering the period in
which the `.ts` is still the only copy. §8A should say so in those words, so a reader stops seeing a
contradiction and starts seeing a sequence.

### 1A.2 Is byte-identity 1037/1037 sufficient to flip? **NO.**

It is necessary and it is not sufficient, and the gap is specific, not theoretical:

1. **It only tests machine-rendered `.en`.** The gate asserts `compile(render(ts)) === ts`. A
   *hand-edited* `.en` — the entire point of the flip — exercises paths the gate has never run.
2. **THE BLOCKER: `.en` payloads reference word IDS, and the ids move.** The payload dialect is
   `lzw1 <axis><wordId>⟨hole⟨…` (`engine/payload.js`), and those ids are **array indices into
   `generators-lzw.json` that are renumbered by every re-mine** (`engine/word-names.js:6`). So a
   `.en` is decodable **only against the exact dictionary it was rendered with**. Today that is
   harmless because the `.ts` is authoritative and a `.en` can always be re-rendered. After the flip
   it is fatal: **one re-mine silently invalidates every `.en` in the repo**, and the failure mode is
   a compile that produces *wrong bytes*, not an error.

**Nothing may flip until (2) is fixed.** Two ways, in preference order:
- **Pin the dictionary per file.** Each `.en` names the dictionary `fingerprint` it was rendered
  against (§8B headers now carry one), and `compileFileEn` **REFUSES** on mismatch rather than
  decoding against the wrong vocabulary. Cheap, and it converts a silent corruption into a loud
  refusal — the §8B rule applied to the payload.
- **Make ids content-addressed**, as skeleton names already are (`sha256(sym)[0:16]`, §5C), so a
  re-mine cannot renumber anything. Strictly better and strictly more work.

### 1A.3 The safe transition — the `.ts` is never the only copy

1. **Fix the id/fingerprint blocker.** No step below is safe before this.
2. **Parallel period.** Both trees tracked; `.ts` remains authoritative; CI asserts
   `compile(.en) === .ts` for all 1037 files on every commit. Nothing is wiped, nothing is
   untracked.
3. **Prove the authoring direction.** A human edits a `.en`, compiles it, and the resulting `.ts`
   is reviewed as a normal diff. Until that has happened on real files, "English is the source" is
   an assertion about a path nobody has walked.
4. **Flip the protection language** in §8A only when 1–3 hold.
5. **The `.ts` stays generated AND committed, permanently.** Like generated clients or protobufs:
   authored elsewhere, checked in anyway. A broken compiler then costs a rebuild, never the code.

**The failure this ordering exists to prevent:** flipping the protection rule first would let a
cleanup treat `src/` as derived output while the `.en` still cannot be trusted to reproduce it —
deleting the only copy on the strength of a gate that never tested hand-authored input. This effort
has already destroyed irreplaceable artifacts once.

### 1A.4 The panel contract — three roots, and no cross-project read

Amir's binding rule: **Kraken's SDD UI reads and writes only the paths specified in the SDD Panel.**
With three roots, the panel specifies three, and the `corpusDir` ambiguity dissolves:

> The panel's **selected project** determines EN_ROOT, TS_ROOT and BUILD_ROOT together. There is no
> independent `corpusDir` input to artifact resolution — a second setting for one fact is a second
> source of truth, and keeping two paths equal by discipline is not an invariant. Resolution and
> validation take the **same** root from the **same** source:
> `AC.load(kind, AC.pathFor(kind, selected), { corpus: selected })`.

**The invariant that makes a cross-project read IMPOSSIBLE, not merely unlikely:** every
corpus-pinned artifact **declares the tree it was mined from** in its own `corpus` header field, and
every read passes the selected root as the expectation. A mismatch **REFUSES at the read**, naming
both paths (§8B). Equality of two independently-maintained settings is a coincidence that holds
until the day it doesn't — which is precisely how s2's A/B test went red. An artifact that names its
own origin holds even when the settings diverge.

### 1A.5 BUILD_ROOT is a naming exercise, not work

`tsc` output. Nothing in this system writes it, reads it, mines it, or gates on it, and it is the one
root that is **always** safe to delete and regenerate. It is named here **only** so that "the
TypeScript folder" is never ambiguous between source and build — an ambiguity that has already cost
us once in a different guise. **No work is proposed for it and none should be inferred.**

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

## 4. Current state (from the code, honest)

There are **two distinct layers** in the tree today. They must not be conflated — they measure different things, and critically **they walk different file sets, so they have different byte totals.**

**Two byte totals, reconciled (this is the authoritative denominator statement).** The corpus has *two* legitimate size figures because the two layers apply different directory SKIP sets:
- **4.06 MB (4,058,230 chars)** — the **compose-layer** walk (`engine/pipeline.js` `walkDir`), recorded as `results/corpus-coverage.json → rollup.chars`. This walk is broad.
- **3.40 MB** — the **enfile-layer** walk (`write-en-files.js`, whose SKIP set additionally excludes `demo/`, `coined-demo/`, `spec/`, `catalog/`, `.cache/`), so it sees fewer files and a smaller total. This is the `.ts` total against which the `.en` size and all English/collapse ratios are measured.

**Authoritative denominator:** every English-coverage and statement-collapse ratio in this PRD (§7) uses the **enfile-layer 3.40 MB / its statement count** as denominator, because the `.en` source lives in that layer. Layer A's char-coverage % is a **compose-layer** figure over its own 4.06 MB walk and is always labelled "(compose-layer)"; the two are never mixed in one ratio.

### Layer A — word-tiling / compose (the generator library + `.calc` IR)
`fanout → LZW → generators (pipeline.js) → compose.js`. Every file is byte-losslessly tiled into an ordered stream of **words** (recurring parameterized spans that refill byte-exact) and **literal slots** (verbatim bytes). Byte-losslessness is by construction; the discriminating number is *how much* is a recurring word vs. residue.

Current mined library (`catalog/mined-library.json`, regenerated by s1 2026-08-30 09:29):
- **2866 leaf generators**, **1063 composite generators**, of which **323 are built from other composites**; max hierarchy depth **9**; 38,048 dict entries.
- Corpus coverage (`results/corpus-coverage.json`, same run): **41.4% of characters (compose-layer, over the 4.06 MB walk)** reproduced by pure composition over 1037 files. Residue is classified, nothing papered over: **A non-recurring shape = 1.88 MB** (the dominant bucket — genuinely one-off code), B free-text slot 172 KB, C comment/trivia 45 KB, D formatting variance 120 KB.
- ⚠️ `results/gate.json` is a **stale snapshot** (`corpusCoveragePct 30.5`, `leafGenerators 173`, `compositeGenerators 33`, depth 4). It predates the current mine; do not cite its generator counts as current. Threshold logic (`pass` at corpus ≥ 20) still holds.

### Layer B — English source of truth (`.en` files, `enfile.js`)
The `.ts` is rendered to an editable `.en` by swapping **only verified spans** into `«English»`: data leaves via `data-english.js` ("an object with a = `x`", "a list of …", `text: "…"`) and pure-logic simple statements via the `cnl.js` grammar ("Let `x` be …", "When <cond>, …", "Return …"). Everything else stays verbatim TS.

Live corpus manifest (`hydra-source/spec/en-index.json`, s1 run 2026-08-30; values move as s1 iterates — the metric *definitions* in §7 are what stay fixed):
- **1037 / 1037 files round-trip byte-identical** (`.en → .ts`). This is the gate, and it passes for the whole corpus.
- **English-of-bytes: 32.5%** (denominator = enfile-layer 3.40 MB) — split **3,920 logic-statement spans + 7,562 data spans**, plus the generator layer below. **1037 `.en` files** are written to `spec/files/<rel>.en`; the derived `.calc` IR is relocated to a gitignored `.cache/`.
- **Middle-tier generator layer (now partially wired):** `generators` block = **4,362 generator calls collapsing 11,282 statements**, for a **net statement reduction of 6,920** (`statementsCollapsed − calls`), across **715 / 1037 files**. This is the additive layer of §6 landing — it is no longer hypothetical.

### The middle-tier gap (now closing, not closed)
Layers A and B hold their byte gate; the open work is the **middle tier: multi-statement function/method bodies that recur *up to renaming***. It was the last un-mined tier; it is now partially captured (the 5,623 collapsed statements above) and the front is to finish it.

- The miner captures **(top) file archetypes** — Entity, RouterModule, ReduxModule, DtoBuilder (`archetypes.js`, conformance-gated) — and **(bottom) tiny statement/data idioms** (data-as-English leaves; single-statement cnl grammar). The middle tier sits between them.
- **Why it was hard:** the narrow anti-unifier (`operations.js`) abstracts data and literals (`str`/`num`/`obj`/`arr`/`fn` holes) and **bare identifiers** (`id` hole), but **pins member-access names, method names, constructor names, and chain-root call names as skeleton literals**. Two procedures identical except for which property/method/field they touch produce *different* narrow keys and never cluster. The widened axis (`measure-middle-tier.js`, member/method/ctor names → holes, α-equivalence up to renaming) is what lets them cluster; the specification of that layer is §5A.
- **Where it is not yet complete:** per-module expansion (`verify-expand`) still fails to round-trip on some modules — `flatFeeCostCalculator` → 100% byte-identical pass, but `activeFeatureCostCalculator` → 91.9% coverage, **not** byte-identical; `BooleanFieldValidator` → 0%, fail. The whole-file `.en` layer stays 1037/1037 byte-identical regardless because any span that does not verify is left as raw TS — those un-verified spans are exactly the remaining middle-tier residue that keeps English-of-bytes at 32.5% rather than higher.

### The current `.en` is LARGER than the `.ts` — but that is the flat-path defect, not a law (corrected)
Measured today (s1, 2026-08-30): the current `.en` is **4.32 MB vs 3.40 MB of `.ts` source** (both enfile-layer totals — the same 3.40 MB denominator used in §7; the 4.06 MB compose-layer figure is a *different, broader* walk, see §4 top). So today the `.en` is **1.27× larger** than the code.

**Why — and the correction.** An earlier draft concluded from this that "physical byte compression is capped ~4.5% under the byte-exact gate." **That conclusion is wrong in general — it holds only for the FLAT anti-unification path** the live compiler currently runs, where every per-site-unique token (names, types, member/method names, URLs, field keys) re-emits verbatim into a hole and nothing cross-references. **The intended LZW design is lossless *and* compressing:** repeated *structure* is replaced by a single recursive word reference, so a file that reuses a depth-3 word does not re-emit that structure at all — it emits one short symbol. The `.en` is inflated *because* the live path is flat (base64 payloads bigger than the code they replace — see the worked example in §4A notes), **not** because byte-exactness forbids compression. Under real LZW, `.en` size drops with dictionary depth. Byte-identity is preserved either way; compression is what the correct mechanism adds on top.

### The fix is ADDITIVE, not a replacement
Identifiers and types are *already* generalized by the narrow axes; what was missing is **member/method/constructor generalization**. The plan is not to widen the existing axis in place (that would weaken byte-elimination on the narrow tier) but to add a **second, coexisting layer** (fully specified in §5A): keep the narrow-axis generators for byte-elimination on structural clones, *and* add member/ctor-generalized procedure generators that claim spans currently emitted verbatim. `measure-middle-tier.js` first sized the candidate pool at **~2,804 WIDE-axis recurring statements**; the layer has since begun landing and now collapses **5,623 statements via 2,305 calls** (candidates and byte-exact-verified collapses are different counts — see Assumptions, §8).

Honest one-liner: **byte-identity is solved and universal; the `.en` is larger than the code *today because the live path is flat*, not by law — the correct LZW mechanism compresses losslessly via recursive word reuse; the win is real compression AND fewer statements to read, and the front (§4A, §5) is to replace flat clone detection with LZW dictionary construction.**

### 4A. The ROOT DEFECT — RESOLVED (2026-08-31). The live path is the recursive LZW dictionary.
> **STATUS: FIXED.** This section previously recorded the live `.en` path as flat anti-unification
> with `maxDepth 1` and "0 of 2,648 decoded call-sites containing a nested generator span." That is
> no longer true and the measured numbers below supersede it. The flat path has been **deleted**,
> not merely bypassed.

**What was wrong.** The live `.en → .ts` compiler discovered patterns by anti-unification / clone
detection: it canonicalized each statement/body to a skeleton-with-holes and grouped identical
skeletons. That finds flat clones but never builds a recursive dictionary — no entry was ever
defined as "a previous entry plus one symbol," so nothing referenced anything else. Every hole was
verbatim TypeScript, and one `opw` generator's `.en` span was 268 B of base64 standing for 136 B of
TS: bigger than the code it replaced.

**What runs now.** `engine/enfile.js` loads `catalog/generators-lzw.json` as the ONLY generator
layer, through `engine/enlzw.js`. Words are LZW dictionary entries (`m[0]`/`m[1]` = a prior entry
plus one symbol), so generators reference generators by construction and `expand` recurses to
leaves exactly as §5B specifies. Measured over the full corpus (`node write-en-files.js`):

| | before (flat) | now (recursive) |
|---|---|---|
| byte-identity | 1037 / 1037 | **1037 / 1037** (floor held) |
| composition depth | 1 | **14** |
| generator calls | 3,108 (63 flat, 2%) | **4,362 — 100% recursive, 0 flat** |
| statements collapsed | 7,576 | **11,282** |
| net statement reduction | 4,468 | **6,920** |
| files using a generator | 638 / 1037 | **715 / 1037** |

**The flat path is gone.** `engine/generators.js` remains, but it is NOT the flat layer: it is the
shared AST canonicalization library (`keyOf`, `refill`, `generalStmtParts`, `isFoldable`,
`skelBytes`) that `enlzw.js` and `build-lzw-generators.js` are built on. What was deleted is
`loadGenerators`/`generatorSpans`/`genRanges` in `enfile.js`, the flat `{g,h}` payload dialect,
`build-generators.js`, and `name-generators.js`. `catalog/generators.json` lives in the corpus and
is simply no longer read.

**The remaining limiter is the MINER, not the gate.** `node measure-uncollapsed.js` implements the
§7 frozen classifier and buckets every un-collapsed recurring body by §5A admission:
**179 unclaimed bodies across 126 files — 179 MINER, 0 GATE, 0 ARBITRATION.** The byte-exact gate
rejects nothing and arbitration steals nothing; every remaining gap is a word that was never mined.
(It was 937 bodies / 232 files before the miner walked the same file set as the renderer.)

---

### 4B. Mining parameters and THE LIFT — the pipeline's current shape (2026-08-31)

The mechanism of §4A is settled; what changed after it is the *shape* of the words it mines. These
are design decisions with measurements attached, not tuning knobs to be re-litigated.

**`MIN_COUNT` is 1 — a word need not recur.** The recurrence threshold of 2 encoded an assumption
that only shared structure is worth naming. It is not: a file's own shape is admissible vocabulary,
and a word used once still buys the reader a sentence in place of a statement. Compression comes
from the *dictionary's* recursion (§5 step 3), not from a frequency floor.

**`MAXWIN` is 64, and 64 is the true ceiling.** MAXWIN binds only `maxDepth`; raising it past the
length of the longest stream in the corpus can do nothing, and the longest corpus stream is **60**.
64 is therefore not a tuned value but the point past which the parameter is inert.

**Imports and declarations are foldable.** `isFoldable` previously excluded them, which removed the
most regular structure in the corpus from the dictionary. They are now admitted like any other
statement and are gated identically.

**The canonicalizer rolls back rather than lying.** When a sub-expression cannot be refilled
byte-exactly, the canonicalizer no longer fails the whole skeleton: it rolls that sub-expression
back to an opaque hole and keeps the surrounding structure. Measured effect: **3,683 `null`
canonicalization failures → 15.**

**THE LIFT — a file is never one word.** The renderer now refuses any word that covers an entire
run. Before the lift, a file could be tiled by a single whole-file span, and **317 files were**;
the reader then saw one opaque reference instead of the file's structure. After the lift, **0 of
1037 files are a single whole-file span** and every file renders as its constituent words.
> **The pre-lift reading of "317 whole-file words" is SUPERSEDED and must not be re-quoted.** It
> was true, it is now 0, and it was repeated in analysis after it stopped being true.

**Settled — do not re-open without new measurement:**
- **The unit-boundary rule STAYS.** No span may straddle two or more units: a word means one thing.
  Amir's call, and the readability of every clause downstream depends on it.
- **`MIN_SKEL` stays 8.** The curve below it (8→715, 6→719, 4→732 `filesUsing`) buys files by
  promoting near-trivial two-statement words — a number bought with readability.
- **Holes stay verbatim TypeScript.** See the hole taxonomy in §5C.
- **"Write the `.en` and get the file" is ALREADY TRUE, for all 1037 files.** Byte-identity is not
  a roadmap item; it is the standing state of the system. Every readability metric in §7 is a
  question about *how the `.en` reads*, never about whether it compiles back.

---

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

⛔ **Tier 1 is NOT wired in, and that is a decision, not a gap (2026-08-31).** `engine/archetypes.js` / `build-archetypes.js` hold hand-authored generative grammars (Entity, RouterModule, ReduxModule, DtoBuilder) and **nothing on the live path consumes them**. They stay disconnected:
- Wiring them in would stand a **second, lossy, unverified producer beside a working byte-exact one** — the producer/consumer split (§2.2) in a new costume, with silent fallback as the failure mode.
- Their reported **`byteIdentical: 100%` is a TAUTOLOGY.** `checkTiling` computes `rebuilt = segs.map(s => src.slice(s.a, s.b)).join("")` — it re-slices the source and rejoins it. That verifies *segmentation completeness*; it verifies nothing about generation. No archetype has ever regenerated a byte it did not copy.
- **The LZW dictionary already discovered the entity grammar.** 90.5% of Entity bytes fall inside mined spans, and the payload holes *are* the grammar's slots: the dictionary learned `@Column(...) prop: type;` as a word with variadic fill, without anyone writing the grammar down. A hand-authored grammar is redundant where the miner already succeeded and unverifiable where it did not.
- `extractEntity` currently returns `className`, `table`, and per-column `.name` as **undefined** (it stores them as `slots.className`, `slots.table`, and column `.prop`). This is recorded so no future reader copies the shape from the call site; the live path reads the AST directly instead (§5C).

The replacement for tier-1 grammars is **per-site productions in `spanProse`** (§5C), which run on the byte-exact path and cannot desynchronize from it.

⛔ **The statement-idiom layer is SUPERSEDED (2026-08-31).** `build-statement-idioms.js` was never
invoked by `repo-dsl mine`, so `catalog/statement-idioms.json` froze at its last manual run and
pressing Mine could not move the count the panel displayed (drift incident 6 — the "616"). It is not
merely uninvoked: `engine/enfile.js` and `engine/enlzw.js` contain **zero** references to
statement-idioms, so nothing on the `.en` compile path has ever read it; its only consumers were two
LLM naming overlays and the panel. Archived with its overlays. **The panel must stop displaying that
count**, because no action a user can take will change it.

**The fold (universal invariant).** At every tier a construct is only replaced by a higher-tier form when the higher-tier form refills to the **exact source span**. Segment lists tile `[0, len)` exactly (`checkTiling`), each segment reproduces its own bytes, so `reconstruct === source` by construction. This is what makes byte-identity a property of the *design*, not of any particular file.

**On-disk layout.**
- `spec/files/<rel>.en` — the **canonical human artifact** (English + verbatim TS). Edited by hand.
- `.cache/` — derived compose IR (`.calc`) and build intermediates. **Gitignored, regenerable, never committed.**
- `.ts` — derived output; byte-identical to what the `.en` compiles to.

**The panel loop.** `mine → author (.en) → compile → verify`, driven by `repo-dsl.js`:
`repo-dsl mine` (fan-out + LZW + promote generators, write library + coverage) → author/edit `.en` (`enfile.js`, `author.js` for the CNL authoring grammar) → `compileFileEn` back to TS → `repo-dsl verify` / `verify-expand` (byte-diff, machine JSON verdict with coverage + residue classes) → `gate` (pass/fail on corpus coverage). `prose.js` narrates a file across the tiers for the panel, with an explicit HONESTY RULE (un-named bodies read as "custom logic (N statements)", never invented prose).

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
| population | 2,450 words in the queue | **~14 statement kinds** |
| ceiling | **8.4% of corpus bytes** (the skeleton share; §7 bucket B) | everything a statement can say about itself |

**Productions are the larger and cheaper half, and that is the central finding.** Fourteen
statement kinds reach further than two and a half thousand names, because a production reads the
site and a name cannot. Naming is a background trickle against the queue; productions are the line
of work.

### The admission rule for naming (verbatim, decidable)

> **Name a leaf only where `spanProse` has nothing site-specific to say.**

Applied to the top 250 words by frequency, this **refused 193 and admitted 57** (48 after
declaration rules were retired, once productions covered declarations better than any name could).
The reason a refusal is *correct* and not laziness: where `spanProse` can quote the real identifier
and the real callee — ``await `invoices` from `softDeleteRecordsForRun` `` — a static skeleton name
is a **REGRESSION**. It replaces two true facts about this site with one generic phrase about a
thousand sites. An unnamed word is honest; a vacuous name is noise that looks like progress.

### Names key on content, never on word id

A name's key is **`sha256(canonical skeleton)[0:16]`**, axis-prefixed — never the word's dictionary
id, which is an artifact of mining order and changes when anything upstream changes. Measured
stability:

| change | names surviving | collisions |
|---|---|---|
| `MAXWIN` 64 → 16 | **8922 / 8922 (100.0%)** | 0 |
| `MIN_COUNT` 1 → 2 | **2576 / 2576 (100.0%)** | 0 |
| canonicalizer change (`8ae62a3`) | **5982 / 6596 (90.7%)** | 0 |

Mining-parameter changes orphan **nothing**. The canon change orphaned **exactly the 614 skeletons
it altered** — which is the correct behaviour, not a failure: those skeletons genuinely became
different skeletons, and a name that followed them across the change would be asserting a meaning
nobody verified.

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

## 6. Open technical fronts

**0. THE CORE FRONT — replace flat anti-unification with LZW dictionary construction (§4A).** This supersedes and subsumes fronts 1–4 below: they were framed around the flat generator layer, which is itself the defect. The required work, as explicit requirements:
   - **Pattern discovery MUST be LZW dictionary construction over the bottom-up AST node stream** (§5 core pipeline), *not* flat anti-unification / clone detection.
   - **Generators MUST be able to reference other generators** (recursive words, `members[]`/`hierarchyDepth`); the flat, holes-are-verbatim-TS path is retained **only as a fallback for genuinely-unique one-offs** that recur nowhere.
   - **Byte-identity is preserved** — LZW losslessness is exactly what makes real compression compatible with the byte-exact gate (§2.3).
   - **Success is real (lossless) compression via recursive word reuse + statement-collapse** (§7), not line-by-line translation.
   Build on the compose-layer seed (`compose.js`, `lzw.js`, `mined-library.json`, depth 9) — SOURCE-PROTECTED (§8A) — not on `generators.json`. Then point `enfile.js` at the recursive dictionary and expand nested word references recursively.

1. **Finish the member/ctor-generalized procedure layer (specified in §5A).** The additive widened axis has begun landing (5,623 statements collapsed); the remaining work is to promote the rest of the WIDE-axis recurring bodies. The `type`-name hole is admitted only when the type is not load-bearing for refill — concretely, when replacing it with a `‹type›` hole still yields a byte-exact `fillOf` at every site (the same gate as every other hole), never on a subjective judgement. Hard constraint unchanged: every widened generator must **refill byte-exact** at every site.
2. **~~Widen renderer consumption of the middle-tier generators.~~ RETIRED (2026-08-31).** This front chased `filesUsing` toward a target that turned out to sit under an unmeasured wall, and every remaining route to it was *punch more holes until things match* — the §4A defect. It is replaced by **the language front: per-site productions in `spanProse` (§5C), scored by §7.0.** That is where the remaining readability lives.
3. **Whole-repo statement reduction, not per-file coverage.** Cross-file repetition carries the leverage (composites built from composites, depth 9). Drive down `netStatementReduction`-eligible residue across the whole corpus (the §7 metric), not a per-file average.
4. **Close the composition gap — point `.en` compilation at the composing layer (§4A, §5B).** Either wire `enfile.js` to expand compose-layer composites recursively, or rebuild the middle-tier generators as composites carrying `members[]`/`hierarchyDepth`. Success = the live `.en` path compiles through generators-calling-generators (manifest `generators.maxDepth ≥ 2`), not the flat `generators.json`. This is the highest-value front — the capability already exists on the abandoned path and is being lost.
5. **Measurement discipline.** Keep the measure-first scripts (`measure-bytes.js`, `measure-middle-tier.js`, `measure-windows.js`, `measure-operations.js`, `measure-callgraph.js`) as the source of truth; refresh the stale `gate.json` snapshot so the gate reflects the current library.

---

## 7. Success metrics

### 7.0 THE OFFICIAL SCOREBOARD (2026-08-31 — supersedes every readability metric before it)

Four numbers. Everything else in this section is history or supporting detail.

| # | Metric | Source | Today | Target |
|---|---|---|---|---|
| 1 | **Byte-identity** | `en-index.json → gate.byteIdentical` | **1037 / 1037** | **1037 / 1037** — the floor, never regresses |
| 2 | **Frozen vacuous-clause count** | `node measure-english.js` (i), classifier frozen in `engine/clause-quality.js` | **135 of 25,456 clauses (0.5%)** | **0**, or a floor stated with sampled evidence |
| 3 | **English-completeness** | `node measure-english.js` (ii), same module | **25,456 / 25,456 (100.0%)** | 100%, held |
| 4 | **Rename-queue length** | `results/name-queue.json` | 0 orphans, 48 names | reported, not minimised |

**Metric 2 — the frozen vacuous classifier.** A fixed, frozen list of thirteen placeholder clauses
(`run a step`, `compute a value`, `return the result`, `branch on a condition`, …) — the phrases that
say only that *something* happened. The list is a frozen **array** plus a private lookup `Set`;
`Object.freeze` on a `Set` does not prevent `.add()`, a defect the suite caught before it shipped.
The list may be added to; **an entry may never be removed to make the number fall.**

**Metric 3 — the English-completeness scanner.** Strip every quoted verbatim region (`` `ids` `` and
`“literals”`) and every parenthetical idiom from a clause; if TypeScript syntax survives in the
residue, the clause is code wearing a sentence's clothes and fails. This is the mechanical form of
the §5C per-site predicate, and it is trusted over the author's eye.

### 7.1 THE TWO CEILINGS — both official, and the byte-level one is not a failure

- **Sentence-level: ~100%.** Every clause the renderer emits can be made to read as English. This is
  metric 3 and it is met.
- **Byte-level: 33.8%** (40.2% optimistic). This is the fraction of *corpus bytes* that can ever be
  read as English prose. Today: **33.7% against a 33.8% ceiling.**

> **39.7% of the corpus is code-bearing hole interiors. That is code BY NATURE and it is the correct
> answer, not a gap to close.** An expression with its own syntax is not connective tissue; rendering
> it as prose would be a lie the scanner is built to catch. A byte-level number near 34% is the
> system succeeding.

**The byte partition** (`node measure-english.js`, full corpus, 4,058,328 B):

| | bucket | share | reads as English? |
|---|---|---|---|
| A | residue, no span (§3 one-off code) | **20.1%** | no — verbatim by design |
| B | skeleton → English (the naming ceiling, §5C) | **8.4%** | yes |
| C | gap (whitespace / comments) | **4.5%** | n/a |
| D | word-like holes, quoted verbatim | **20.9%** | yes — as quoted nouns |
| E | long but structureless | **6.4%** | no |
| F | **code-bearing hole interiors** | **39.7%** | **no — code by nature** |

B + D = 29.3% carried by the two layers of §5C; the remainder of the 33.8% ceiling is the
structureless and gap material that can still be captioned.

### 7.2 Panel-quality reading, by archetype

The direct comparison to a hand-authored generative panel: the share of an archetype's bytes inside
spans whose every clause is both English-complete and non-vacuous.

| archetype | files | % corpus | panel-quality |
|---|---|---|---|
| IndexBarrel | 10 | 0.1% | **94.3%** |
| ConstMapConfig | 9 | 0.1% | **90.8%** |
| **Entity** | 64 | 2.9% | **90.5%** |
| TestSuite | 81 | 16.1% | 84.1% |
| TypeDefs | 73 | 1.4% | 83.6% |
| RouterModule | 35 | 7.6% | 82.8% |
| ClientWrapper | 33 | 3.8% | 78.9% |
| ServiceClass | 131 | 11.3% | 78.7% |
| DataAccessModule | 135 | 27.7% | 75.3% |
| AsyncFunctionModule | 153 | 14.7% | 74.2% |
| PureModule | 145 | 5.1% | 70.7% |

Entity reaches 90.5% **on the round-tripping path**, through mined words plus the §5C decorated-class,
relation, and route productions — not through a disconnected grammar. **The comparison that matters
is not the percentage but the totality: a hand-authored grammar renders the archetypes someone wrote
a grammar for; this path renders all 1037 files and compiles every one of them back byte-exactly.**

---

### 7.3 Compression and collapse metrics (unchanged)


The metrics are **real lossless compression AND statement/readability collapse** — not prose length. Under the intended LZW mechanism (§2.1) byte-size compression is a legitimate goal, not a forbidden one; the flat-path "capped ~4.5%" framing is corrected and retired (§3, §4A). Today the `.en` is still *larger* than the `.ts`, so the compression metric reads negative and must cross zero — but the attribution has been **corrected**: this was blamed on the flat path, and the flat path is deleted. The inflation was the **payload encoding** (base64(JSON)), now fixed in §7A; what remains is gloss prose and span structure, which are deliberate. Every metric below is computed by one committed command and reads one field, so "done" is a number, not a judgement.

**The one measurement command.** `node write-en-files.js` regenerates `en-index.json` (it lives in the gitignored `hydra-source/.cache/spec-derived/`; `--dry-run --out <dir>` measures without writing to the corpus). All three metrics read that file. (`node measure-uncollapsed.js` implements the frozen classifier below and buckets each gap as MINER / GATE / ARBITRATION per §5A. `measure-middle-tier.js` is referenced elsewhere in this document but does not exist in the tree.) No metric is computed by eye.

**Frozen definitions.**
- **Total statements `S`** = the sum of function/method body statements over the enfile-layer walk (§4), as counted by `fnStmtCount` in `operations.js`. This is the fixed denominator.
- **`statement-collapse ratio` = `generators.netStatementReduction ÷ S`**, where `netStatementReduction = statementsCollapsed − calls` (both fields of `en-index.json → generators`). It is the fraction of all body statements removed from the reader's view by being folded into a generator call. Today: `netStatementReduction = 3,318`.
- **`un-collapsed repeated structure`** is decidable and frozen to one classifier: a function/method body is *un-collapsed repeated structure* iff (a) its **WIDE-axis canonical key** (`measure-middle-tier.js` WIDE canon) recurs across the corpus with frequency **≥ `minCount` (2)**, **(a2)** its key has **placeholder density below ½** — of the *N* per-statement parts of that key, the number equal to the hole symbol `·` must satisfy **`holes / N < 0.5`** (exactly one half is **not** enough; the comparison is strict), (b) it is **not** covered by a generator span in that file's `.en`, and (c) it is **not** claimed by an archetype slot. The metric is the **count of files containing ≥ 1 such body**; `→ 0` means every recurring-up-to-renaming body has been promoted or is provably non-refillable. Membership is a pure function of the two canonical keys and the `.en` — two engineers get the same answer.

**Current reading (2026-08-31, `node write-en-files.js` + `node measure-uncollapsed.js`, real run against the pinned corpus):**

| | |
|---|---|
| byte-identity | **1037 / 1037** |
| `filesUsing` | **715 / 1037** |
| `netStatementReduction` | **6,920** |
| `maxCompositionDepth` | **14** |
| `flatFallback` | **0** (0.0%) |
| `englishBytesPct` | **44.9** |
| `.ts` bytes | **4,058,328** |
| `.en` bytes | **4,598,270** (compression **−13.3%**; was 5,306,753 / −30.8% under base64) |
| payload bytes | **1,536,665** = 33.4% of `.en`, of which **1,371,044 is readable hole text** (the code's own identifiers and literals) and **165,621 is span structure** = **3.6% of `.en` opaque** (was 42.3%) |
| files with un-collapsed repeated structure (§7 incl. (a2)) | **38** |


| Metric | Formula / source field | Today | Milestone target |
|---|---|---|---|
| **Byte-identity** | `en-index.json → gate.byteIdentical` | **1037 / 1037** | **1037 / 1037** (the floor — never regresses) |
| **Statement-collapse ratio** | `generators.netStatementReduction ÷ S` | net reduction **6,920** (`calls 4,362`, `statementsCollapsed 11,282`, `filesUsing 715/1037`, `maxCompositionDepth 14`, `flatFallback 0`) — target met | **netStatementReduction ≥ 4,500 and filesUsing ≥ 715 / 1037**, byte-identity held at 1037/1037. ~~filesUsing ≥ 750~~ and the ~~753 ceiling~~ are **RETIRED (2026-08-31)**: readability is now measured by §7.0, not by how many files hold a generator. |
| **Files with un-collapsed repeated structure** | `node measure-uncollapsed.js` — implements this classifier exactly | **38 files / 46 bodies** (all MINER-limited; 0 gate, 0 arbitration). Corrected by §7(a2); the pre-(a2) reading was 126 files / 179 bodies. A further **133 bodies** are excluded by density, 24 of them all-placeholder. | **0** |
| **Composition depth (live `.en` path)** | `en-index.json → generators.maxDepth` (longest generator-calls-generator chain the live compile actually expands, §5B) | **14 — target met (§4A)** | **≥ 2**, rising toward the compose-layer's depth 9 |
| **Real (lossless) compression ratio** | `1 − (.en bytes ÷ .ts bytes)` over the enfile-layer walk — LZW makes this positive without breaking byte-identity (§2.1) | **−13.3%** (`.en` 4,598,270 B > `.ts` 4,058,328 B). Was **−30.8%** before the `lzw1` payload encoding (§7A); the residual is gloss prose (334,343 B) plus 165,621 B of span structure, neither of which the `.ts` carries. | **positive and rising** — `.en` smaller than `.ts`, growing with dictionary depth |

> **NEAR-MISS — why (a2) exists (2026-08-31).** The classifier shipped with only (a), (b), (c). A body whose every statement fails to generalize keys as `·<GAP>·`, so **all** such bodies collide with each other and **every one of them scores `freq ≥ 2`**. Two functions sharing no content whatsoever were being counted as repeated structure. The metric read **126 files / 179 bodies**; the truth was **38 files / 46 bodies** — an inflation of roughly **3×**, and it would have sent someone hunting 102 files of nothing. The number was already being steered by when the error was caught. Placeholder density is the decidable discriminator: a key that is at least half holes carries too little evidence to assert recurrence. Frozen in `engine/uncollapsed-density.js`, guarded by `engine/uncollapsed-density.test.js` (mutation-checked: removing the condition turns 4 cases red, including the real-source one).

> **RETIRED TARGET — `filesUsing ≥ 750`, and with it the 753 ceiling (retired 2026-08-31; kept for the reasoning, not as a target).** The measured ceiling at the current readability bar is **753**: 715 files use a generator today, and only **38 files** hold a genuinely repeated, genuinely unclaimed body (§7 as corrected by (a2)). The target was therefore set one to two files under a wall nobody had measured. Worse, **none of those 38 are reachable by legitimate miner work**: 15 need `MIN_SKEL` dropped below 8 (measured curve 12→649, 8→715, 6→719, 4→732, byte-identity holding throughout, but promoting near-trivial two-statement words), and 23 recur only at whole-body silhouette while sharing no recurring adjacent statement pair anywhere in the corpus — reaching them means widening the canon until more of each statement is a hole. Both routes are *punch more holes until things match*, which is the flat anti-unification defect §4A exists to kill, and both trade readability for a number. **Decision: leave the miner alone.** §3 already rules that genuinely one-off code stays verbatim and is counted as residue; these 38 files are that residue. The replacement is not another `filesUsing` number at all: **§7.0 replaces it.** `filesUsing ≥ 715` is held, not chased, and the 753 ceiling is retired along with the target it bounded. The history is kept here rather than deleted because *why* a target moved is the part worth having.

### 7A. Payload encoding — why the `.en` grew as reuse improved (fixed 2026-08-31)

**The symptom.** Between two runs reuse improved on every axis — `filesUsing` 638→715, `netStatementReduction` 4,468→6,920, `maxDepth` 10→14, `flatFallback` 0 — and the `.en` got **381 KB BIGGER** (4,925,805 → 5,306,753), compression falling −21.4% → −30.8%. Every additional collapse made the source *worse*. That is backwards for a compressor, and it contradicted §1 and §3 directly.

**The cause was the payload encoding, and the real defect was not the bytes.** Payloads were `base64(JSON)`. Measured over the corpus:

| component | bytes | % of `.en` |
|---|---|---|
| base64 4/3 expansion | 565,670 | 10.7% — carries **zero** information |
| JSON scaffolding | 308,434 | 5.8% |
| hole text (**real source**: identifiers, literals) | 1,371,044 | 25.8% |

The third row is the point. **Hole text is the code's own text**, and base64 was turning a quarter of "the canonical human artifact" (§1) into an opaque blob — 42.3% of the `.en` was payload a reader cannot read. It also scaled the wrong way: each newly mined word appended ~515 B of blob, so **improving the miner actively degraded the artifact Amir is meant to read and edit.** Negative compression was the *symptom*; opacity was the *defect*.

**The fix.** One encoding, `lzw1`, plain UTF-8 text (`engine/payload.js`):

```
lzw1 <axis><wordId>⟨hole⟨hole...
```

Holes are introduced by `⟨` and run to the next `⟨` or the payload end. There is no closing bracket — `⟨` is 3 bytes in UTF-8 and the corpus holds 40,667 holes, so a closer nobody needs costs 122 KB of the artifact.

**Sentinel safety is structural, not incidental.** The `.en` scanner locates spans by searching for `«` `»`, which is sound only if no payload can contain one. base64 gave that for free; plain text does not. Escaping (`⟡0`–`⟡7`) provides it **by construction**, so an encoded payload provably contains none of `« » ⟪ ⟫ ▶ ⟨`. This is deliberately *not* an assumption about what TypeScript source happens to contain — no sentinel appears in the corpus today, but that is luck, and luck is the hazard §4A's dialect work just finished removing. `decode()` is fail-closed: wrong tag, bad axis, missing id, or unknown escape all throw, and a stale base64 payload is named specifically so the fix is obvious.

**Result** (real run, byte-identity **1037/1037** held throughout):

| | before | after |
|---|---|---|
| `.en` bytes | 5,306,753 | **4,598,270** (−708,483) |
| compression | −30.8% | **−13.3%** |
| payload as % of `.en` | 42.3% | 33.4% |
| **opaque** % of `.en` | **42.3%** | **3.6%** |

The last row is the one that matters: payload is still a third of the file, but 89% of it is now readable source text rather than base64. Guarded by `engine/dialect-guard.test.js`, mutation-checked per §10.3 (disabling escaping, passing through unknown escapes, and accepting stale base64 each turn their own case red; source restored byte-identical).

**Rejected on readability grounds:** hole dedup via a shared fill table would save a further 280,455 B (5.9%), and parameter hoisting more. Both replace visible source text with an indirection a reader must resolve by hand. Per §3 and Amir's standing instruction that compression is the strategy and not the point, they are **not** taken. The remaining negative compression is honest: the `.en` carries gloss prose and span structure the `.ts` does not.

**Explicitly not a metric:** English-% (a by-product — a rise from paraphrasing unique code would be a regression in disguise). **Byte size IS a metric now (corrected):** real lossless compression via recursive word reuse is a goal, not forbidden — the earlier "not a target / capped ~4.5%" framing applied only to the flat path (§3, §4A). Byte-identity is the floor and never regresses; the progress signals are *real compression turning positive*, *composition depth ≥ 2*, *statement-collapse up*, and *files-with-un-collapsed-repeated-structure → 0*.

---

## 8. Constants

Every threshold the implementation depends on, with its literal value and source of truth.

| Constant | Value | Where |
|---|---|---|
| `MIN_COUNT` (word recurrence threshold) | **1** — a word need not recur; a file's own shape is admissible (§4B) | `engine/compose.js` `MIN_COUNT` |
| `MAXWIN` (max window length) | **64** — binds only `maxDepth`; the longest corpus stream is 60, so 64 is the true ceiling, not a tuning choice (§4B) | `engine/enlzw.js` |
| `MIN_SKEL` (minimum skeleton bytes to promote a word) | **8** — settled; below it the curve buys files with near-trivial words (§4B) | `engine/enlzw.js` |
| Skeleton-name key | **`sha256(canonical skeleton)[0:16]`**, axis-prefixed — never the word id (§5C) | `engine/word-names.js` |
| Frozen vacuous-clause list | **13 entries**; may be added to, never removed to lower the count (§7.0) | `engine/clause-quality.js` `VACUOUS` |
| Byte-level English ceiling | **33.8%** (40.2% optimistic); 39.7% is code by nature (§7.1) | `measure-english.js` |
| `MIN_WORD_CHARS` (ignore trivial punctuation tokens as words) | **4** | `engine/compose.js` `MIN_WORD_CHARS` |
| Gate corpus-coverage threshold | **≥ 20%** (the run of record; the `--min` flag default in code is 80) | `results/gate.json → thresholds.corpus`; `repo-dsl gate --min` |
| Gate worst-file threshold | **disabled (null)** — no per-file floor is enforced | `results/gate.json → thresholds.perFile` = `null`; `repo-dsl gate --min-file` unset |
| Statement-collapse milestone target | **netStatementReduction ≥ 4,500; filesUsing ≥ 715 / 1037** (~~≥ 750~~, ~~ceiling 753~~ — both retired 2026-08-31, §7.0) | §7 (this document) |
| Byte-identity target | **1037 / 1037** | §7 |
| Enfile-layer walk SKIP set | `node_modules, .git, .worktrees, dist, build, coverage, spec, catalog, .cache, demo, coined-demo` | `write-en-files.js` `SKIP` |
| Corpus root | `/home/amir/Documents/Rentsync/delonix/hydra-source` | `write-en-files.js`, `measure-middle-tier.js` `CORPUS` |
| Composition depth target (live `.en`) | **`generators.maxDepth ≥ 2`** | §7 |

### 8A. SOURCE-PROTECTED artifacts (never wipable-derived)

**All SOURCE-PROTECTED artifacts live in the CORPUS tree, never in the engine tree (§8B).** **TRANSITIONAL, NOT A CLAIM ABOUT AUTHORSHIP (see §1A.1).** §1 states the `.en` is the source and the `.ts` is derived. The protections below cover the period in which the `.ts` is still the only copy; they are a sequence, not a contradiction, and §1A.3 states what must be true before they flip. The composition capability was nearly lost by being treated as deletable derived output. The following are **SOURCE-PROTECTED**: they are the mined vocabulary the English source *depends on to compile and to compose*, and must **never** be classified as regenerable-cache, gitignored-away, or deleted in any cleanup — even though a mine can rebuild them, deleting them without a full re-mine breaks `.en → .ts`:

- **`<corpus>/spec/catalog/generators-lzw.json`** — the recursive LZW word dictionary; the ONLY generator
  vocabulary the live `.en` compiles through (§4A). It supersedes `catalog/generators.json`, which
  belonged to the deleted flat path and is no longer read by anything.
- **`<corpus>/spec/catalog/mined-library.json`** (the compose-layer composites — `compositeGenerators`, `builtFromComposites`, `maxHierarchyDepth 9`) — the **composition graph** (§4A, §5B). This is the artifact that was nearly lost; protect it explicitly.
- **`<corpus>/spec/catalog/word-names.json`** — the NAMES of the dictionary's leaf words, keyed by content hash
  of each canonical skeleton (§2.2). Hand-authored and *not* reproducible by a re-mine: the mine
  rebuilds the words, never their names. It also carries the `orphans` ledger, which is the only
  record of names authored for skeletons that have since drifted — deleting it destroys work that
  no amount of re-mining brings back.
- **`word-library.json` / coined-word catalog** and **`catalog/english-idioms.json`** — read-time coined-phrase and narration vocabularies.

Only `.calc` IR, coverage/index reports, and naming worksheets are wipable-derived (§5 on-disk layout). A cleanup that cannot tell these apart must **stop and ask**, never delete a catalog.

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
| `tracked` | `<corpus>/spec/catalog/` | SOURCE-PROTECTED (§8A): expensive or hand-authored, must survive a cleanup |
| `cache` | `<corpus>/.cache/spec-derived/` | purely derived, regenerable by one command |

`spec/catalog/` rather than `catalog/` is deliberate: the corpus `.gitignore` ignores root
`catalog/*`, so a SOURCE-PROTECTED artifact placed there would be **silently untracked** — which is
precisely how one gets lost.

**Why this section exists.** The engine tree was holding, in a public repo:
`generators-lzw.json` with **5,754 of 8,922 leaf skeletons (64.5%) carrying non-keyword Hydra
identifiers — 143,891 B of verbatim function and property names** (holes generalize *arguments*,
never the callee or property name), and `corpus-coverage.json` with **1,037 real corpus file paths
plus literal source lines**. Verified never pushed: `origin` held only `main` and one `claude/*`
branch at `80a953b`; `git ls-tree -r origin/main | grep -c repo-dsl` = 0; every introducing commit
failed `merge-base --is-ancestor origin/main`.

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
by construction and gets `undefined` for all 1,063 of them. Use `AC.idOf(record)`, which returns
`.id` for leaves and `.name` for composites. The id spaces are **disjoint with zero overlap**:
`word-names` keys are `w:`/`n:<16hex>` over the LZW dictionary, compose-layer leaves are `p_<8hex>`.
**Names key the LZW dictionary; the panel surfaces key the compose layer** — so a naming UI must read
the LZW dictionary directly, not the compose library.

#### The six incidents this rule exists to prevent (2026-08-31, one day)

1. base64 payload vs the `lzw1` decoder.
2. miner SKIP set vs renderer SKIP set — 696 of 937 un-collapsed bodies.
3. `mined-library.v1.json` published pre-switch, read against the current corpus.
4. `word-names.json` written to `catalog/`, read from `projectDir/`.
5. `word-names.json` v0 vs v1 — **the `schema` field existed and nothing checked it.**
6. the panel's idiom count describing the compose layer while the `.en` compiles through the LZW
   dictionary.

Every one: producer changed, consumer kept reading, nothing failed, a human spotted a wrong number.

#### The guard

`engine/artifact-location.test.js` (5 assertions, mutation-checked three ways): no artifact resolves
inside the engine tree; each lands in the home its protection level demands; no corpus-derived file
sits on disk in the engine tree; **no source line names a corpus artifact relative to `__dirname`**;
every artifact is contract-valid at its corpus location. On its first run it found 20 unrepointed
call sites that had been missed by reading.

---

### 8B-legacy. CORPUS PINNING — every artifact names the tree it was mined from

An operator read `depth 4` off the SDD panel for days while the live corpus carried depth 9. Nothing
was capped and nothing was stale: the panel was faithfully rendering **another corpus's artifact**,
because the reader picked the highest-versioned `mined-library*.json` in a shared catalog and no
artifact said which tree it described. A correct, fresh mine already existed and was *shadowed* by a
higher-numbered file from a different project. The reporting layer cannot be trusted while a number
can arrive without provenance, so the following are **non-negotiable** and **supersede §9 assumption 3**
(“the corpus is a single fixed local tree”), which is now false — two corpora exist.

1. **Every generated artifact carries a corpus stamp.** `schema`, `version`, and `corpus` (the
   absolute root it was mined from) are written on the artifact itself, not inferred from its path or
   filename. A filename is not provenance — two corpora produce identically-named files.
2. **One publisher, and it refuses a mismatch.** Artifacts are written by a single publisher
   (`repo-dsl.js` → `publishLibrary`), which refuses to publish a library whose declared `corpus` is
   not the tree it is being published into, and writes the artifact **beside the corpus it describes**
   rather than into a shared catalog. Putting the artifact with its corpus is what makes the wrong-repo
   substitution structurally impossible rather than merely unlikely.
3. **A consumer refuses a non-matching artifact — it never falls back.** Resolution matches the
   selected corpus against the artifact's `corpus`. On no match the consumer returns an honest miss
   naming *what it looked for and where it looked*, and renders nothing. Serving another corpus's
   numbers is forbidden: a number without provenance is indistinguishable from a right one once it
   reaches a screen, which is precisely how this stayed invisible.
4. **An absent stamp is UNKNOWN, not WRONG.** An unstamped artifact is not condemned — it is
   unusable *for reporting*, and must be published through rule 2 to become usable. It is never
   silently adopted as the selection's answer.
5. **Version shadowing is explicit: highest `vN` wins, unversioned sorts lowest.** Among
   `mined-library(.v<N>)?.json` in one directory the greatest `N` is selected. **Version rank never
   overrides rule 3:** filter by corpus first, then take the highest `N` among the matches. Rank
   applied before provenance is the exact mechanism that shadowed a correct mine with a stale one.
6. **An artifact declares only what it carries.** The publisher asserts `counts.maxHierarchyDepth`
   equals the maximum `hierarchyDepth` actually present on the composites, and refuses to write when
   they disagree or when depth cannot be verified at all. **Silent under-reporting is banned**: a build
   that cannot walk the whole tree fails loudly or marks itself `complete: false` — it never emits a
   smaller plausible number for the panel to render as truth.

---

## 9. Assumptions & open questions

Load-bearing premises this PRD relies on but has not independently verified — surfaced so they are visible rather than silent.

1. **The ~2,804 figure is a candidate count, not a verified-collapse count.** `measure-middle-tier.js` reports WIDE-axis *cluster candidates*; only sites whose `fillOf` passes the byte-exact gate become real generator spans. The two numbers differ by construction and are not comparable — the authoritative landed figure is `en-index.json → generators` (currently 5,623 statements collapsed via 2,305 calls). Any claim about "how much is left" must come from the frozen classifier in §7, not from the candidate count.
2. **s1's live manifest is the current baseline; `results/gate.json` and the generator counts inside it are a stale snapshot.** This PRD's numbers (32.5% English, 5,623 collapsed, 2866/1063 generators) are read from the live `spec/en-index.json` and freshly-mined `catalog/mined-library.json` (s1 run 2026-08-30 09:29). `gate.json` still shows an older mine (173 leaf / 33 composite, 30.5%) and must be refreshed before it is cited (§6 front 4). **This risk MATERIALISED (2026-08-30).** Those exact calculators-corpus figures — 33 composite, 173 leaf, `maxHierarchyDepth 4` — reached the SDD panel and were read by an operator as the live corpus's vocabulary while the real mine stood at 1063/2866/depth 9. Documenting an artifact as stale does not stop it being served: nothing downstream reads this register. The structural fix is §8B; a note in an assumptions list is not a control. Live values continue to move while s1 iterates; the §7 *definitions* are what stay fixed.
3. ~~**The corpus is a single fixed local tree.**~~ **SUPERSEDED by §8B (2026-08-30) — this assumption is false.** Two corpora exist (`hydra-source` and the calculators tree), and the depth-4 incident was the direct consequence: with more than one corpus in play and no stamp pinning an artifact to its tree, a consumer had no way to tell whose numbers it was rendering. Corpus pinning is now a **rule** (§8B), not an assumption. What survives of the original: every path and byte total in §8/§7 is still relative to the §8 corpus root with the §8 SKIP set, and the metrics are still not portable to another tree without re-deriving `S` and the two byte totals.
4. **`S` (total body statements) is stable enough to be a denominator.** It is recomputed by `fnStmtCount` on each `write-en-files.js` run; a large refactor of the corpus would move it, so the statement-collapse ratio is only comparable between runs over the same corpus revision.

**~~Open question (highest-leverage)~~ — RESOLVED 2026-08-31.** The milestone target in §7 (`netStatementReduction ≥ 4,500`, `filesUsing ≥ 750`) was a first-cut number set in this document, and the instinct that it needed confirming against a measured ceiling was correct. It has now been measured: the ceiling is **753**, so `≥ 750` sat one to two files under a wall, and every remaining file is reachable only by degrading readability. The target is superseded by `filesUsing ≥ 715` — see the ceiling note in §7. `netStatementReduction ≥ 4,500` stands and is met at **6,920**.

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
