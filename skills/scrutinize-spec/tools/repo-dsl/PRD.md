# PRD — English-as-Source (the repo-DSL engine)

**Status:** in progress · grounded in the code under `scrutinize-spec/tools/repo-dsl/` as of 2026-08-30
**Home:** this file lives at `scrutinize-spec/tools/repo-dsl/PRD.md` — beside the engine and `README.md` it describes, not at the repo root (the root is a multi-skill monorepo; this feature is one tool inside it).
**Scope note:** written READ-ONLY while another session (s1) is actively editing the engine. Numbers below are read from committed catalog/result files and the live corpus manifest; where a result file is a stale snapshot it is flagged as such.

---

## 1. Problem & goal

We have a large real TypeScript corpus (Rentsync/Hydra: **1038 source files**; two layer-specific byte totals are given and reconciled in §4 — do not use a bare "corpus size" number). Most of it is not novel — it is the same shapes, the same procedures, the same data structures, re-typed with different names. Today that repetition sits on disk as raw code, over and over.

**The success definition, in plain terms:**

> **Repeated code — whether it repeats inside one file or across files — must never appear as raw code.** Recurring structure is mined *deterministically* into a **recursive dictionary of words (generators)**, and the English source is each file **re-emitted as a stream of those words**. Because bigger words are defined in terms of smaller words, the source is genuinely **shorter** (repeated structure → a single word reference) **and** losslessly `.en → .ts` **byte-identical**. The **whole repo stays the real, editable source** — you edit the English (`.en`), the `.ts` is derived.

**The core mechanism is LZW dictionary construction over the AST — this is the design, stated up front (§5).** Parse each source file to its AST; walk **bottom-up from the leaves**; run the **dictionary-building (encoding) half of LZW** over that node stream. LZW's defining property is that *every new dictionary entry is an existing entry plus one more symbol* — so the dictionary is **recursive by construction**: larger patterns are defined in terms of smaller patterns already in it. **Each dictionary entry is a word is a generator.** Because entries reference earlier entries, **generators reference generators automatically** — composition is *emergent* from LZW, not bolted on, and the ARCHETYPE→SKELETON→IDIOM→LEAF hierarchy is the emergent **dictionary depth**, not hand-labeled levels.

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
- Corpus coverage (`results/corpus-coverage.json`, same run): **41.4% of characters (compose-layer, over the 4.06 MB walk)** reproduced by pure composition over 1038 files. Residue is classified, nothing papered over: **A non-recurring shape = 1.88 MB** (the dominant bucket — genuinely one-off code), B free-text slot 172 KB, C comment/trivia 45 KB, D formatting variance 120 KB.
- ⚠️ `results/gate.json` is a **stale snapshot** (`corpusCoveragePct 30.5`, `leafGenerators 173`, `compositeGenerators 33`, depth 4). It predates the current mine; do not cite its generator counts as current. Threshold logic (`pass` at corpus ≥ 20) still holds.

### Layer B — English source of truth (`.en` files, `enfile.js`)
The `.ts` is rendered to an editable `.en` by swapping **only verified spans** into `«English»`: data leaves via `data-english.js` ("an object with a = `x`", "a list of …", `text: "…"`) and pure-logic simple statements via the `cnl.js` grammar ("Let `x` be …", "When <cond>, …", "Return …"). Everything else stays verbatim TS.

Live corpus manifest (`hydra-source/spec/en-index.json`, s1 run 2026-08-30; values move as s1 iterates — the metric *definitions* in §7 are what stay fixed):
- **1038 / 1038 files round-trip byte-identical** (`.en → .ts`). This is the gate, and it passes for the whole corpus.
- **English-of-bytes: 32.5%** (denominator = enfile-layer 3.40 MB) — split **3,920 logic-statement spans + 7,562 data spans**, plus the generator layer below. **1038 `.en` files** are written to `spec/files/<rel>.en`; the derived `.calc` IR is relocated to a gitignored `.cache/`.
- **Middle-tier generator layer (now partially wired):** `generators` block = **2,305 generator calls collapsing 5,623 statements**, for a **net statement reduction of 3,318** (`statementsCollapsed − calls`), across **564 / 1038 files**. This is the additive layer of §6 landing — it is no longer hypothetical.

### The middle-tier gap (now closing, not closed)
Layers A and B hold their byte gate; the open work is the **middle tier: multi-statement function/method bodies that recur *up to renaming***. It was the last un-mined tier; it is now partially captured (the 5,623 collapsed statements above) and the front is to finish it.

- The miner captures **(top) file archetypes** — Entity, RouterModule, ReduxModule, DtoBuilder (`archetypes.js`, conformance-gated) — and **(bottom) tiny statement/data idioms** (data-as-English leaves; single-statement cnl grammar). The middle tier sits between them.
- **Why it was hard:** the narrow anti-unifier (`operations.js`) abstracts data and literals (`str`/`num`/`obj`/`arr`/`fn` holes) and **bare identifiers** (`id` hole), but **pins member-access names, method names, constructor names, and chain-root call names as skeleton literals**. Two procedures identical except for which property/method/field they touch produce *different* narrow keys and never cluster. The widened axis (`measure-middle-tier.js`, member/method/ctor names → holes, α-equivalence up to renaming) is what lets them cluster; the specification of that layer is §5A.
- **Where it is not yet complete:** per-module expansion (`verify-expand`) still fails to round-trip on some modules — `flatFeeCostCalculator` → 100% byte-identical pass, but `activeFeatureCostCalculator` → 91.9% coverage, **not** byte-identical; `BooleanFieldValidator` → 0%, fail. The whole-file `.en` layer stays 1038/1038 byte-identical regardless because any span that does not verify is left as raw TS — those un-verified spans are exactly the remaining middle-tier residue that keeps English-of-bytes at 32.5% rather than higher.

### The current `.en` is LARGER than the `.ts` — but that is the flat-path defect, not a law (corrected)
Measured today (s1, 2026-08-30): the current `.en` is **4.32 MB vs 3.40 MB of `.ts` source** (both enfile-layer totals — the same 3.40 MB denominator used in §7; the 4.06 MB compose-layer figure is a *different, broader* walk, see §4 top). So today the `.en` is **1.27× larger** than the code.

**Why — and the correction.** An earlier draft concluded from this that "physical byte compression is capped ~4.5% under the byte-exact gate." **That conclusion is wrong in general — it holds only for the FLAT anti-unification path** the live compiler currently runs, where every per-site-unique token (names, types, member/method names, URLs, field keys) re-emits verbatim into a hole and nothing cross-references. **The intended LZW design is lossless *and* compressing:** repeated *structure* is replaced by a single recursive word reference, so a file that reuses a depth-3 word does not re-emit that structure at all — it emits one short symbol. The `.en` is inflated *because* the live path is flat (base64 payloads bigger than the code they replace — see the worked example in §4A notes), **not** because byte-exactness forbids compression. Under real LZW, `.en` size drops with dictionary depth. Byte-identity is preserved either way; compression is what the correct mechanism adds on top.

### The fix is ADDITIVE, not a replacement
Identifiers and types are *already* generalized by the narrow axes; what was missing is **member/method/constructor generalization**. The plan is not to widen the existing axis in place (that would weaken byte-elimination on the narrow tier) but to add a **second, coexisting layer** (fully specified in §5A): keep the narrow-axis generators for byte-elimination on structural clones, *and* add member/ctor-generalized procedure generators that claim spans currently emitted verbatim. `measure-middle-tier.js` first sized the candidate pool at **~2,804 WIDE-axis recurring statements**; the layer has since begun landing and now collapses **5,623 statements via 2,305 calls** (candidates and byte-exact-verified collapses are different counts — see Assumptions, §8).

Honest one-liner: **byte-identity is solved and universal; the `.en` is larger than the code *today because the live path is flat*, not by law — the correct LZW mechanism compresses losslessly via recursive word reuse; the win is real compression AND fewer statements to read, and the front (§4A, §5) is to replace flat clone detection with LZW dictionary construction.**

### 4A. The ROOT DEFECT — the live path uses flat anti-unification, not LZW dictionary construction
This is the core deviation the whole feature drifted into, measured this session. **The intended mechanism (LZW recursive dictionary, §1/§5) was replaced by flat clone detection, and that single substitution is why there is no composition and no compression.**

- **Wrong mechanism.** The live `.en → .ts` compiler (`enfile.js` + `engine/generators.js`) discovers patterns by **anti-unification / clone detection**: it canonicalizes each statement/body to a skeleton-with-holes and groups identical skeletons. This finds flat clones but **never builds a recursive dictionary** — no entry is ever defined as "a previous entry plus one symbol," so nothing references anything else. LZW dictionary construction over the bottom-up AST stream (§2.1) is not what runs.
- **Result: a flat vocabulary.** `catalog/generators.json` holds **3,532 leaf generators**; `level` is only `op` (2,133) / `opw` (1,399) — operation / operation-widened, **not** the four tiers. Records have **no** `builtFrom`/`memberIds`/`children` field; a generator structurally cannot reference another.
- **Verified flat, not merely unwired:** 0 of 3,532 skeletons contain a nested generator marker (`▶`/`⟪`/`«`), and across **2,648 decoded call-sites** in the `.en`, **0 holes contain a nested generator span** — every hole is **verbatim raw TypeScript**. Every generator expands directly to TS in one step. (Worked example: one `opw` generator's `.en` span is 268 B of base64 standing for 136 B of TS — bigger than the code, because with no recursion the unique tokens all re-emit verbatim.)
- **The intended design is partially realized — on the abandoned path — and MUST be protected.** The compose-layer catalog (`catalog/mined-library.json`, the `.calc` word-tiling path) already exhibits the LZW property: `compositeGenerators ≈ 1063`, `builtFromComposites ≈ 323`, **`maxHierarchyDepth 9`** — composites defined in terms of composites, i.e. a recursive dictionary. This is the closest thing to the intended mechanism in the tree; the `.en` **no longer reads it**, so it was nearly lost as "dead code." It is **SOURCE-PROTECTED** (§8A): never delete it.
- **The fix (required, not optional):** replace flat anti-unification with **LZW dictionary construction over the bottom-up AST node stream** so that generators reference generators emergently, then point `.en` compilation at that recursive dictionary (expanding nested word references recursively, byte-exact at the fully-expanded leaf). The compose-layer engine (`compose.js`, `lzw.js`, `mined-library.json`) is the seed to build on, not to discard. Until then, `.en` collapse is single-level and forfeits both cross-pattern reuse and real compression.

---

## 5. Architecture

**The core pipeline — LZW dictionary construction over the AST (the intended design).** This is the mechanism the rest of the system exists to serve:
1. **Parse → AST.** Each source file is parsed to its TypeScript AST.
2. **Linearize bottom-up.** The AST is walked leaves-first into a node-symbol stream (`engine/fanout.js`), so structure is encoded before the constructs that contain it.
3. **LZW encode → recursive dictionary.** The encoding half of LZW runs over that stream (`engine/lzw.js`, `engine/compose.js`): every new dictionary entry is an existing entry **plus one symbol**, so the dictionary is recursive — bigger words are literally defined as smaller words. **Each entry = a word = a generator**, and because entries cite earlier entries, **generators reference generators for free** (the composition of §2.4). Dictionary depth *is* the ARCHETYPE→SKELETON→IDIOM→LEAF hierarchy — emergent, not labeled.
4. **Re-emit as a word stream.** The file's `.en` is the file rewritten as references to those words; repeated structure becomes a single reference, so the source is **shorter and lossless** (LZW inverts exactly, and the fully-expanded result is gated byte-exact, §2.3).

⚠️ **What actually runs today is not this (§4A):** the live path substitutes flat anti-unification for steps 3–4, yielding 3,532 non-recursive leaf generators. The pipeline above is the required target; the tiers below describe its emergent structure.

**Tiers (top → bottom) — realized as composition (§2.4, §5B), not as labels.** A file is described at the coarsest tier that conforms, and each tier expands *through* the tier below it (a higher generator's fill invokes a lower generator, down to leaves):
1. **Archetype** (`archetypes.js`) — the file *is* a word: a fixed architectural template with big typed slots (Entity = `@Entity` + columns\* + relations\*; RouterModule = `Router(prefix)` + routes\*). Conformance-gated: residual top-level code is *reported*, never absorbed to inflate the number.
2. **Skeleton / operation-idiom** (`operations.js`, `build-operation-idioms.js`) — recurring statement/procedure shapes via anti-unification, **assembled from tier-3 idioms**. *(Middle tier — partially built; flow in §5A, composition requirement in §5B.)*
3. **Statement + data idiom** (`cnl.js`, `data-english.js`) — single statements and data leaves rendered as controlled English.
4. **Leaf / literal** — opaque atoms and genuinely-novel bytes, verbatim (the base case of the composition recursion).

⚠️ **Live-path caveat (§4A):** these tiers are realized as real composition only in the compose-layer catalog (depth 9). The catalog the live `.en` compiles through today (`generators.json`) is **flat** — the tiers above are the required target, not the current live state.

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

## 6. Open technical fronts

**0. THE CORE FRONT — replace flat anti-unification with LZW dictionary construction (§4A).** This supersedes and subsumes fronts 1–4 below: they were framed around the flat generator layer, which is itself the defect. The required work, as explicit requirements:
   - **Pattern discovery MUST be LZW dictionary construction over the bottom-up AST node stream** (§5 core pipeline), *not* flat anti-unification / clone detection.
   - **Generators MUST be able to reference other generators** (recursive words, `members[]`/`hierarchyDepth`); the flat, holes-are-verbatim-TS path is retained **only as a fallback for genuinely-unique one-offs** that recur nowhere.
   - **Byte-identity is preserved** — LZW losslessness is exactly what makes real compression compatible with the byte-exact gate (§2.3).
   - **Success is real (lossless) compression via recursive word reuse + statement-collapse** (§7), not line-by-line translation.
   Build on the compose-layer seed (`compose.js`, `lzw.js`, `mined-library.json`, depth 9) — SOURCE-PROTECTED (§8A) — not on `generators.json`. Then point `enfile.js` at the recursive dictionary and expand nested word references recursively.

1. **Finish the member/ctor-generalized procedure layer (specified in §5A).** The additive widened axis has begun landing (5,623 statements collapsed); the remaining work is to promote the rest of the WIDE-axis recurring bodies. The `type`-name hole is admitted only when the type is not load-bearing for refill — concretely, when replacing it with a `‹type›` hole still yields a byte-exact `fillOf` at every site (the same gate as every other hole), never on a subjective judgement. Hard constraint unchanged: every widened generator must **refill byte-exact** at every site.
2. **Widen renderer consumption of the middle-tier generators.** `enfile.js` now emits generator spans (§5A wiring contract) but only for 564 / 1038 files; the front is to raise `generators.filesUsing` toward the target in §7 by promoting more admitted generators, still span-gated.
3. **Whole-repo statement reduction, not per-file coverage.** Cross-file repetition carries the leverage (composites built from composites, depth 9). Drive down `netStatementReduction`-eligible residue across the whole corpus (the §7 metric), not a per-file average.
4. **Close the composition gap — point `.en` compilation at the composing layer (§4A, §5B).** Either wire `enfile.js` to expand compose-layer composites recursively, or rebuild the middle-tier generators as composites carrying `members[]`/`hierarchyDepth`. Success = the live `.en` path compiles through generators-calling-generators (manifest `generators.maxDepth ≥ 2`), not the flat `generators.json`. This is the highest-value front — the capability already exists on the abandoned path and is being lost.
5. **Measurement discipline.** Keep the measure-first scripts (`measure-bytes.js`, `measure-middle-tier.js`, `measure-windows.js`, `measure-operations.js`, `measure-callgraph.js`) as the source of truth; refresh the stale `gate.json` snapshot so the gate reflects the current library.

---

## 7. Success metrics

The metrics are **real lossless compression AND statement/readability collapse** — not prose length. Under the intended LZW mechanism (§2.1) byte-size compression is a legitimate goal, not a forbidden one; the flat-path "capped ~4.5%" framing is corrected and retired (§3, §4A). Today the `.en` is *larger* than the `.ts` (a flat-path symptom), so the compression metric currently reads negative and must cross zero. Every metric below is computed by one committed command and reads one field, so "done" is a number, not a judgement.

**The one measurement command.** `node write-en-files.js` regenerates `hydra-source/spec/en-index.json`. All three metrics read that file. (`node measure-middle-tier.js` supplies the residual-candidate count for the classifier below.) No metric is computed by eye.

**Frozen definitions.**
- **Total statements `S`** = the sum of function/method body statements over the enfile-layer walk (§4), as counted by `fnStmtCount` in `operations.js`. This is the fixed denominator.
- **`statement-collapse ratio` = `generators.netStatementReduction ÷ S`**, where `netStatementReduction = statementsCollapsed − calls` (both fields of `en-index.json → generators`). It is the fraction of all body statements removed from the reader's view by being folded into a generator call. Today: `netStatementReduction = 3,318`.
- **`un-collapsed repeated structure`** is decidable and frozen to one classifier: a function/method body is *un-collapsed repeated structure* iff (a) its **WIDE-axis canonical key** (`measure-middle-tier.js` WIDE canon) recurs across the corpus with frequency **≥ `minCount` (2)**, (b) it is **not** covered by a generator span in that file's `.en`, and (c) it is **not** claimed by an archetype slot. The metric is the **count of files containing ≥ 1 such body**; `→ 0` means every recurring-up-to-renaming body has been promoted or is provably non-refillable. Membership is a pure function of the two canonical keys and the `.en` — two engineers get the same answer.

| Metric | Formula / source field | Today | Milestone target |
|---|---|---|---|
| **Byte-identity** | `en-index.json → gate.byteIdentical` | **1038 / 1038** | **1038 / 1038** (the floor — never regresses) |
| **Statement-collapse ratio** | `generators.netStatementReduction ÷ S` | net reduction **3,318** (`calls 2,305`, `statementsCollapsed 5,623`, `filesUsing 564/1038`) | **netStatementReduction ≥ 4,500 and filesUsing ≥ 750 / 1038**, byte-identity held at 1038/1038 |
| **Files with un-collapsed repeated structure** | count from the frozen classifier above (`measure-middle-tier.js` WIDE recurrence ≥ 2, minus generator+archetype coverage) | many (layer partially wired) | **0** |
| **Composition depth (live `.en` path)** | `en-index.json → generators.maxDepth` (longest generator-calls-generator chain the live compile actually expands, §5B) | **1 (flat — `generators.json` has 0 composition edges; §4A)** | **≥ 2**, rising toward the compose-layer's depth 9 |
| **Real (lossless) compression ratio** | `1 − (.en bytes ÷ .ts bytes)` over the enfile-layer walk — LZW makes this positive without breaking byte-identity (§2.1) | **−27% (`.en` 4.32 MB > `.ts` 3.40 MB — inflation from the flat path, §4A)** | **positive and rising** — `.en` smaller than `.ts`, growing with dictionary depth |

**Explicitly not a metric:** English-% (a by-product — a rise from paraphrasing unique code would be a regression in disguise). **Byte size IS a metric now (corrected):** real lossless compression via recursive word reuse is a goal, not forbidden — the earlier "not a target / capped ~4.5%" framing applied only to the flat path (§3, §4A). Byte-identity is the floor and never regresses; the progress signals are *real compression turning positive*, *composition depth ≥ 2*, *statement-collapse up*, and *files-with-un-collapsed-repeated-structure → 0*.

---

## 8. Constants

Every threshold the implementation depends on, with its literal value and source of truth.

| Constant | Value | Where |
|---|---|---|
| `minCount` (LZW / widened-axis recurrence threshold) | **2** | `engine/compose.js` `MIN_COUNT`; `repo-dsl.js` `--min-count` default 2 |
| `MIN_WORD_CHARS` (ignore trivial punctuation tokens as words) | **4** | `engine/compose.js` `MIN_WORD_CHARS` |
| Gate corpus-coverage threshold | **≥ 20%** (the run of record; the `--min` flag default in code is 80) | `results/gate.json → thresholds.corpus`; `repo-dsl gate --min` |
| Gate worst-file threshold | **disabled (null)** — no per-file floor is enforced | `results/gate.json → thresholds.perFile` = `null`; `repo-dsl gate --min-file` unset |
| Statement-collapse milestone target | **netStatementReduction ≥ 4,500; filesUsing ≥ 750 / 1038** | §7 (this document) |
| Byte-identity target | **1038 / 1038** | §7 |
| Enfile-layer walk SKIP set | `node_modules, .git, .worktrees, dist, build, coverage, spec, catalog, .cache, demo, coined-demo` | `write-en-files.js` `SKIP` |
| Corpus root | `/home/amir/Documents/Rentsync/delonix/hydra-source` | `write-en-files.js`, `measure-middle-tier.js` `CORPUS` |
| Composition depth target (live `.en`) | **`generators.maxDepth ≥ 2`** | §7 |

### 8A. SOURCE-PROTECTED artifacts (never wipable-derived)

The composition capability was nearly lost by being treated as deletable derived output. The following are **SOURCE-PROTECTED**: they are the mined vocabulary the English source *depends on to compile and to compose*, and must **never** be classified as regenerable-cache, gitignored-away, or deleted in any cleanup — even though a mine can rebuild them, deleting them without a full re-mine breaks `.en → .ts`:

- **`catalog/generators.json`** — the live `.en` generator vocabulary (compile-time; §4A).
- **`catalog/mined-library.json`** (the compose-layer composites — `compositeGenerators`, `builtFromComposites`, `maxHierarchyDepth 9`) — the **composition graph** (§4A, §5B). This is the artifact that was nearly lost; protect it explicitly.
- **`word-library.json` / coined-word catalog** and **`catalog/english-idioms.json`** — read-time coined-phrase and narration vocabularies.

Only `.calc` IR, coverage/index reports, and naming worksheets are wipable-derived (§5 on-disk layout). A cleanup that cannot tell these apart must **stop and ask**, never delete a catalog.

### 8B. CORPUS PINNING — every artifact names the tree it was mined from

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

**Open question (highest-leverage):** the milestone target in §7 (`netStatementReduction ≥ 4,500`, `filesUsing ≥ 750`) is a first-cut number set in this document — it should be confirmed against a measured ceiling (how many of the WIDE-axis candidates actually refill byte-exact) before it is treated as the definition of "done" for the phase.

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
