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

## 5D. The ARCHETYPE LAYER — a pattern/words hybrid (REQUIRED, mechanics still to be designed)

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
