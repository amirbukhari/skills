# §R The requirements register

*PART III — THE REQUIREMENTS REGISTER · [index](README.md)*

**This is the build list.** Every requirement stated anywhere in this document appears here once,
as a single testable sentence with an ID, the check that decides it, and a pointer to the section
carrying the rationale. If a requirement is not in this register it is not a requirement — it is
explanation. If two sections disagree, the register is not the tie-breaker either: a disagreement
is an OPEN question (§Q), and it is listed there.

**How to read a row.** `MUST` / `MUST NOT` is binding. **Check** is how a second engineer decides
whether it holds — a command, an assertion, or a named test file. A check reading *"not yet
mechanized"* is an admission, not an excuse: the requirement stands and the check is missing work.

**Some of it now runs.** `npm run register` (`tools/repo-dsl/verify-register.js`) evaluates the rows
decidable by reading the tree — a constant's value, a symbol's presence, an artifact's contract
validity — and prints `HOLDS` / `FAILS` / `MANUAL` per row. `npm run register:json` emits the same
result as one JSON object for a caller. Exit 0 = all mechanized rows hold, 1 = at least one fails,
2 = the runner could not proceed.

Three things it deliberately does **not** do. It never counts a row it cannot evaluate as holding —
those are `MANUAL`, with the command that would decide them, and **`MANUAL` is not a pass**. It
never runs a mine or a round-trip as a side effect. And a row absent from the runner is not a row
that holds; it is one nobody has mechanized yet. As of 2026-08-31: 13 rows mechanized of ~100,
reporting **9 hold, 0 fail, 4 manual**.

**ID scheme.** `R-<AREA>-<n>`, stable. Areas: MECH (core mechanism) · MINE (mining parameters) ·
REND (rendering/compiling) · COMP (composition) · WIDE (middle tier) · ARCH (archetype hybrid) ·
LANG (language, names, productions) · PAY (payload) · ART (artifact contract) · PIN (corpus pinning)
· CFG (roots, config, wipability) · MEAS (measurement discipline) · TEST (test integrity).

---

## R-MECH — the core mechanism

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-MECH-1 | Pattern discovery **MUST** be LZW dictionary construction over the bottom-up AST node stream. Flat anti-unification / clone detection **MUST NOT** be the discovery mechanism. | The live `.en` compile path loads `generators-lzw.json` through `engine/enlzw.js` and no other generator vocabulary. **HOLDS — measured §Q-2.** | §2 P1, §4A, §5 |
| R-MECH-2 | Every non-leaf dictionary entry **MUST** be an existing entry **plus exactly one symbol** (`m[0]` + `m[1]`). | For each entry, `m[0]` resolves to an earlier entry and `m[1]` is a single symbol. | §5 step 3 |
| R-MECH-3 | The dictionary **MUST** be a DAG: no entry may transitively reference itself. | Promotion rejects a cycle; `hierarchyDepth` is finite for every entry. | §5B cycle safety |
| R-MECH-4 | Discovery, expansion and compilation **MUST** make **zero** model calls. | **Check corrected 2026-08-31 — it named nothing that exists.** It read `foldModelCalls === 0` and `buildModelCalls === 0` "in every published catalog"; those fields live only in `archive/`, so the most load-bearing requirement in the PRD pointed at no field on disk. Now **two halves**, both in `verify-register.js`'s `R-MECH-4` row: **(a)** a grep over the live tree (archive excluded) for any outbound-network or model-vendor call, and **(b)** `modelCalls === 0` on **every registered artifact present**, written by `AC.stamp` (defaulting to 0, refusing a non-numeric) into the **fingerprinted body**, so flipping the number by hand breaks the seal. Neither half suffices alone: (a) cannot see a call through an indirection, (b) cannot see a producer that lies about itself. *Shown to fail:* a planted `gate.json` declaring `modelCalls: 7` in a throwaway corpus flips the row to FAILS. | §2 P1 |
| R-MECH-5 | Every hole **MUST** record the exact source span it abstracted. | `fillOf(template, boundHoles) === ` the site's original bytes, at every admitted site. | §2 P1, §5A |
| R-MECH-6 | Tiers **MUST NOT** be hand-assigned labels; tier **is** dictionary depth. | ARCHETYPE→SKELETON→IDIOM→LEAF is derivable from `hierarchyDepth`, not stored as a tier field. | §2 P4, §5 |
| R-MECH-7 | The flat, holes-are-verbatim path is permitted **only** as a fallback for genuinely-unique one-offs that recur nowhere, and **MUST NOT** stand as a second producer beside the LZW path. | No live code path reads `generators.json`. **HOLDS — measured §Q-2, and more strongly than required: no flat producer exists at all.** `tier` is set to `"recursive"` at one place and `"flat"` nowhere, so the flat counters are a tripwire, not a metric (R-MECH-8). | §2 P4, §4A |
| R-MECH-8 | A retired layer **MUST NOT** be revived as a parallel producer, and the engine **MUST NOT** publish a number that no mine can move. | Every published count is produced by the mine, not by a stale manual run. **One violation found and removed 2026-08-31**: the render printed `flat-fallback 0 (0% fallback)`, which is structurally zero rather than measured (§Q-2). Compare R-ARCH-4 — the same defect in the archetype layer. | §5 (retired statement-idiom layer) |

## R-MINE — mining parameters

**Values are SETTLED. Do not re-open without new measurement.** Values and their source of truth
are in §8.

**The CHECKS were not settled, and three of the four pointed at the wrong file — corrected
2026-08-31.** `MIN_COUNT`, `MAXWIN` and `MIN_SKEL` all live on one line,
`build-lzw-generators.js:59`. The measured values are unchanged (1, 8, 64); only the pointers moved.
This is the more dangerous kind of rot: a wrong value fails loudly, while a wrong pointer sends the
next reader to a retired file that answers a different question confidently. Verified by `grep -rn`
over the live tree and `archive/`, not by reading the prose.

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-MINE-1 | `MIN_COUNT` **MUST** be 1 — a word need not recur. | `build-lzw-generators.js:59` — `+(process.env.MIN_COUNT \|\| 1)`. **Cite corrected 2026-08-31**: this said `engine/compose.js`, which is retired to `archive/engine/compose.js:22` and defines `MIN_COUNT = 2`, so verifying at the old location read 2 and wrongly failed the row. The default is 1 and **HOLDS**; note it is env-overridable, so this binds the default, not every run. | §4B |
| R-MINE-2 | `MAXWIN` is 64, a **ceiling and not a tuned value**; it binds only `maxDepth`. | `build-lzw-generators.js:59` — `+(process.env.MAXWIN \|\| 64)`. **Cite corrected 2026-08-31**: `engine/enlzw.js` does not define `MAXWIN` at all; the only other definition in the tree is `archive/engine/patterns.js:69`, where it is **5**, belonging to the retired window miner. **HOLDS.** | §4B, §Q-6 |
| R-MINE-3 | `MIN_SKEL` **MUST** stay 8. | `build-lzw-generators.js:59` — `+(process.env.MIN_SKEL \|\| 8)`. **Cite corrected 2026-08-31**: `engine/enlzw.js` does not define it. **HOLDS.** | §4B |
| R-MINE-4 | `MIN_WORD_CHARS` is 4 — trivial punctuation tokens are not words. | **RETIRED 2026-08-31, not verifiable and not a live requirement.** The constant belonged to the flat composer, which R-MECH-7 records as having no live producer at all. Its only remaining definition is `archive/engine/compose.js:23`, and nothing live reads it. Kept as a row rather than deleted so the id is not silently reused. | §8 |
| R-MINE-5 | Imports and declarations **MUST** be foldable, gated identically to any other statement. | `isFoldable` admits them. | §4B |
| R-MINE-6 | The canonicalizer **MUST** roll a non-refillable sub-expression back to an opaque hole, and **MUST NOT** fail the whole skeleton. | A skeleton containing one bad sub-expression still promotes, with that span as a hole. | §4B |
| R-MINE-7 | **THE LIFT, amended 2026-08-31 (§5D.4).** The renderer **MUST** refuse a whole-run word that is **unnamed or unexpandable**. *It used to say "a file is never one word" — superseded by Amir's statement 6; a **named, drillable** file word is now the target (R-ARCH-15).* | No `.en` renders as a single **opaque** span; a whole-run word carries a name and an `explain` tree. | §4B, §5D.4 |
| R-MINE-8 | No span **MUST** straddle two or more units. A word means one thing. | Unit-boundary test (`engine/unit-boundary.test.js`). | §4B (Amir's call) |
| R-MINE-9 | Holes **MUST** stay verbatim TypeScript. | The hole taxonomy in §5C; no hole interior is paraphrased. | §4B, §5C |
| R-MINE-10 | Every un-collapsed body **MUST** be attributed **MINER**, **GATE** or **ARBITRATION**. A bare count is not actionable. | `measure-uncollapsed.js` emits the three-way split. | §4A |

## R-REND — rendering and compiling

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-REND-1 | `compileFileEn(renderFileEn(src)) === src` **MUST** hold for **every file, always**. This is the floor and it never regresses. | `en-index.json → gate.byteIdentical`; the round-trip tests. | §2 P3, §7.0 gate 1 |
| R-REND-2 | A span **MUST** be swapped to English only when it recompiles to its exact source bytes; anything unverified **MUST** stay verbatim TypeScript. | The per-span byte-exact gate at render time. | §2 P3 |
| R-REND-3 | Selected segments **MUST** tile `[0, len)` exactly, and no two selected spans may overlap. | `checkTiling`. | §5 the fold, §5A |
| R-REND-4 | A readability improvement that loses one byte of identity **MUST** be treated as a regression, not a trade. | Gate 1 is unconditional. | §7.0 |
| R-REND-5 | The `.en` **MUST** be written to `<CORPUS>/sen/files/<rel>.en`; derived `.calc` IR **MUST** go to a gitignored `.cache/`. | §5 on-disk layout; `engine/artifact-location.test.js`. | §5, §8B |
| R-REND-6 | **REWRITTEN 2026-08-31 (§5D.3 note 1).** The **sentence is authoritative**: a hand-edit to a clause's English **MUST** change the compiled TypeScript. The payload is a **derived index**, not the source of truth. *It used to say the compiler MUST NOT read the label region — "names are cosmetic by construction". That made Amir's hand-edit lifecycle (§5D.0 statement 4) a no-op, so it is cut.* | **Cut 1 shipped 2026-08-31 (derive-and-check).** `engine/enfile.js deriveGloss` re-derives the gloss from the payload and **throws** on disagreement, naming both sides; on by default in `enfile.test.js`, opt-in elsewhere (`SDD_DERIVE_CHECK=1`). Mutation-checked: with the check off the same hand-edit is silently ignored, and that is asserted. Measured: **1,037/1,037 real `.en` compile byte-identical with the check on** — zero false positives. **Cut 2 (the edit becomes *effective*, not just detected) needs the §5E.3.2 grammar parser and is not built.** | §5C, §10, §5E.5 |
| R-REND-7 | Measurement **MUST** run over the whole corpus with a published SKIP set; showcase or demo trees **MUST** be excluded, and per-module results **MUST** include failures. | `write-en-files.js SKIP`; §8 lists the set. | §3 |
| R-REND-8 | A body that is not named **MUST** read as an honest placeholder (e.g. "custom logic (N statements)") and **MUST NOT** be given invented prose. | The `prose.js` honesty rule. | §5 the loop, §5C |

## R-COMP — composition

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-COMP-1 | A generator's `template` **MAY** contain **generator-reference holes** whose fill is another generator invocation rather than verbatim TS. Composition is a first-class requirement, not an optimization. | Schema admits the hole kind. | §5B |
| R-COMP-2 | `expand(gen, params)` **MUST** resolve a generator-reference hole by recursively expanding the referenced generator, terminating at leaves. | `expand` on a depth-`n` composite reaches leaves. | §5B |
| R-COMP-3 | The **fully-expanded** result at a top-level `.en` span **MUST** equal the site's exact source bytes, so every nested level is implicitly gated. | Byte-exact gate applied to the final expansion. | §2 P3, §5B |
| R-COMP-4 | A composite record **MUST** carry its **ordered member ids** and its **depth** (longest path to a leaf, leaf = 0). The **spellings are `m` and `d`** in `generators-lzw.json` and `memberLeafIds` in `mined-library.json`. | `engine/wordlzw-enlzw-fields.test.js` (825 assertions) pins `["id","len","freq","m","d"]` and **forbids** `members`/`hierarchyDepth`. | §5B |
| R-COMP-5 | Each generator-reference hole **MUST** name a `memberId` and the ordered params to pass to it. | Schema. | §5B |
| R-COMP-6 | The manifest **MUST** expose `generators.composites`, `generators.maxDepth` and `generators.compositionEdges`, so **flatness is visible as a regression**. `maxDepth` (deepest span the **live path** emitted) **MUST** stay a distinct field from `dictionaryMaxDepth` (depth of the **mined dictionary**) — conflating them lets a deep dictionary report a renderer that never composed. | `en-index.json → generators`. **Was NOT met until 2026-08-31**: the producer wrote `maxCompositionDepth` and neither of the other two, so R-COMP-7 was comparing `undefined` (§Q-2). All four now emitted by `write-en-files.js`. | §5B |
| R-COMP-7 | `generators.maxDepth` on the **live** `.en` path **MUST** be ≥ 2 and rising. Depth 1 is the degenerate flat path. | `en-index.json → generators.maxDepth`. **Clears the bar on a composition fixture (depth 3, §Q-2); unmeasured on the real corpus — §Q-8.** | §2 P4, §7.3 |
| R-COMP-8 | Promotion **MUST** reject any composite whose `members` would introduce a cycle. | Cycle check at promotion. | §5B |
| R-COMP-9 | The `.en` pass **MUST** emit the **highest-tier** admitted generator for a span, and a composite **MUST** outrank its own members on a coverage tie. | §5A arbitration, extended. | §5B |

## R-WIDE — the middle-tier generator layer

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

## R-ARCH — the archetype/word hybrid

**Direction SETTLED by Amir; mechanics OPEN (§Q-3). Do not build on a guess.**

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-ARCH-1 | The archetype layer and the LZW word layer **MUST** work together as **one** mechanism, neither subordinate: the word layer supplies the vocabulary, the archetype layer supplies the file-level shape. | The hybrid design, once written. | §5D |
| R-ARCH-15 | A file **MUST** be accounted for by **one top-level word**, whose rendered form **IS** its recursive definition — words made of words down to leaves — and which is **editable at every level**. An opaque whole-file token is forbidden. | Per file: one top word; `explain` yields its full tree; a hand-edit at any depth changes the compiled `.ts`. | §5D.4 |
| R-ARCH-16 | **Review surface** — statements a human must read as **code** (the per-file residual) — **MUST** be reported per file and as a corpus total, beside byte-identity, and is the **headline** success metric. Compression is a mechanism and **MUST NOT** be reported as the goal. | The manifest carries `residualStatements` per file. | §5D.4, §7 |
| R-ARCH-2 | An archetype's slots **MUST** be filled by **mined words**, not by hand-authored sub-grammars, wherever the miner already succeeds. | Slot fills resolve to dictionary entries. | §5D |
| R-ARCH-3 | Everything an archetype emits **MUST** pass the **same** byte-exact gate as any other span, with **no silent fallback**: a slot that cannot refill exactly leaves its span as verbatim TypeScript, loudly. | One producer, one gate. | §5D constraint 1 |
| R-ARCH-4 | Archetype correctness **MUST** be measured by refilling slots from the dictionary and comparing to original bytes. A `byteIdentical: 100%` derived from `checkTiling` — which re-slices and rejoins the source — **MUST NOT** be cited as a generation check; it is a tautology. | A real generation check, not `rebuilt = segs.map(s => src.slice(s.a,s.b)).join("")`. | §5D constraint 2 |
| R-ARCH-5 | Where an archetype slot and a mined word claim overlapping bytes, one **deterministic** rule **MUST** decide. | Arbitration order, per R-WIDE-8's model. | §5D constraint 3 |
| R-ARCH-6 | **CORRECTED 2026-08-31 — the extractor was not broken; the requirement was a misreading.** An archetype extractor's slot bag is `result.slots`, and per-column identity is `.prop` (TS property) with `.parsed.name` (db column). *It used to say `extractEntity` "returns `className`, `table` and per-column `.name` as undefined" and MUST be fixed before anything relies on it — that describes a reader using top-level keys, which its own Check line admitted: "read the stored keys, not the returned ones." Measured against the §5D.1 reference case: `conforms: true`, `byteIdentical: true`, `className: "PaymentPlan"`, `table: "payment_plans"`, 5 columns, 2 relations — i.e. the panel's own "entity PaymentPlan, 5 cols, 2 rels".* | `engine/archetypes.test.js` — the reference-case block, one assertion per sentence clause. | §5D constraint 4 |
| R-ARCH-18 | A relation slot **MUST** carry every fill its sentence needs as a **named field** — `kind`, `target`, `inverse`, `join` — read from **all** decorators on the member, not just the first. | `engine/archetypes.test.js`: `relations[0].parsed.join === "account_id"`; a bare `@JoinTable()` yields `join === true`, distinguishing "implied name" from "no join". | §5E.2, §5E.4 |
| R-ARCH-13 | **AT-ARCH-1, now a live check and not only a test.** For an archetype-generated file, mining and re-rendering it **MUST** return the authoring sentence byte-identically, and the generating command **MUST** verify this **before writing** and refuse the write on any difference. | `engine/entity-sentence.test.js`: both legs plus the **fixpoint turn** (a normaliser that is not already at its fixpoint moves on turn two), and each refusal shown to fire. `new-archetype.js` exits 2 with `stage: "AT-ARCH-1"` and writes nothing. | §5E.2, §5E.3.6 |
| R-ARCH-14 | The archetype command **MUST** emit the `.en` **first** and derive the `.ts` from it — never the reverse — and **MUST** be drivable non-interactively (no prompts; one JSON document on stdout). | `new-archetype.js`: `.en` is written before the `.ts`, so a crash between the two leaves the English and never an orphan `.ts`; `--json`, `--stdin`, `--dry-run`; prose to stderr only. **Zero model calls** (R-MECH-4). | §5E.3.6 |
| R-ARCH-7 | Panel-quality **MUST** count only bytes on the round-tripping path. An archetype that reads beautifully and does not compile back byte-exactly contributes nothing. | §7.2 definition. | §5D constraint 5, §7.2 |
| R-ARCH-8 | Residual top-level code under an archetype **MUST** be reported, never absorbed to inflate conformance. | Conformance gate. | §5 tier 1 |

## R-LANG — language, names and productions

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-LANG-1 | A rendered clause **MUST** be produced by one **grammar**: a name is a nonterminal's **spelling**, a production is its **expansion** (§5E.3.5). Both layers persist as artifacts; it **MUST** be knowable which owns a site. | §5C's table, read as spelling + expansion of one nonterminal. | §5C, §5E.3.5 |
| R-LANG-2 | A name's key **MUST** be `sha256(canonical skeleton)[0:16]`, axis-prefixed — **never** the word's dictionary id, which is an artifact of mining order. | `engine/word-names.js`. | §5C, §8 |
| R-LANG-3 | Mining-parameter changes **MUST** orphan nothing; a canonicalizer change **MUST** orphan exactly the skeletons it altered. | Retune `MAXWIN`/`MIN_COUNT`/`MIN_SKEL` → zero orphans. | §5C |
| R-LANG-4 | A leaf **MUST** be named only where `spanProse` has nothing site-specific to say. A static name where a production could quote the real identifier and callee is a **regression**. | The admission rule, decidable per site. | §5C |
| R-LANG-5 | A name whose skeleton no longer exists **MUST** move to the `orphans` ledger and **MUST NEVER** be deleted. | `word-names.json → orphans`. | §5C |
| R-LANG-6 | Before generating a new name the authoring pass **MUST** match against orphans first. | Authoring pass order. | §5C |
| R-LANG-7 | A re-adoption **MUST** be written to the rename queue as a **proposal**, scored by token edit distance, and **MUST NEVER** be applied automatically. Auto-re-attachment is the drift bug in a new costume. | `<corpus>/.cache/spec-derived/name-queue.json` (`AC.pathFor("name-queue")` — the kind is registered and stamped, not hand-written); a human is the consumer. *Path corrected 2026-08-31: no `results/` directory exists anywhere; the kind is `home: "cache"`.* | §5C |
| R-LANG-8 | Rename-queue length **MUST** be reported beside byte-identity, as information — **never minimised** as a target. | §7.0 gate 4. | §5C, §7.0 |
| R-LANG-9 | Whether a hole is **word-like** (quoted verbatim into the clause) or **code-bearing** (left as code) **MUST** be a per-site predicate on the hole's contents evaluated at render time — **never** a policy attached to the hole's type. | The English-completeness scanner is the mechanical form of the predicate. | §5C, §7.0 gate 3 |
| R-LANG-10 | When a production cannot say something **true** about a site it **MUST** emit the vacuous clause and that site **MUST** be counted. A vacuous clause is retired by saying something true — **never** by rewording the placeholder to escape the frozen list. | §7.0 gate 2 + the frozen list. | §5C |
| R-LANG-11 | An LLM **MAY** produce **names and grammar surface only**, and every rename **MUST** be gated on byte-identity plus coverage invariance. Nothing correctness-relevant may come from a model. | `refine-language.js` rejects a rename that changes one output byte or lowers coverage. | §2 P2, §5D.2 |
| R-LANG-12 | The pipeline **MUST** have exactly two kinds of step: a **deterministic mine** (zero model calls) and a **scripted LLM naming stage**. The naming stage **MUST** be an invocable script in this repo — never ad hoc, never a chat transcript. | `npm run name` runs it end to end; `npm run mine` makes zero model calls. | §5D.2 |
| R-LANG-13 | The naming stage **MUST APPLY** names, gated mechanically (byte-identity + coverage invariance + grammar injectivity) — **not** emit a worksheet and wait for a human. *It used to be worksheet-only; superseded by §5D.0 statement 5.* Orphan **re-adoption** remains a proposal (R-LANG-7). | `name` writes `word-names.json`; the gate is the consumer. | §5D.2, §10 |
| R-LANG-14 | Every pipeline script **MUST** be callable non-interactively with structured output (JSON on stdout or a stamped artifact) so a UI can drive it unchanged. No blocking prompts. | Each `npm run` target runs headless in CI-shaped invocation. | §5D.2 |

## R-PAY — payload encoding

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-PAY-1 | Payloads **MUST** be plain readable UTF-8 text, never an opaque blob. The live form is `lzw1 <axis><wordId>⟨hole⟨hole…`. | `engine/payload.js`; `engine/dialect-guard.test.js`. | §7A.1 |
| R-PAY-2 | Any future encoding **MUST** be checked against the failure mode an opaque payload has: it **scales with success**, so improving the miner actively degrades the artifact. | Design review against that property. | §7A.2 |
| R-PAY-3 | Sentinel safety **MUST** be structural: an encoded payload **provably** contains none of `« » ⟪ ⟫ ▶ ⟨`, by escaping — never by an assumption about what the corpus happens to contain. | Escaping is total; the guard test asserts it. | §7A.3 |
| R-PAY-4 | `decode()` **MUST** be fail-closed: wrong tag, bad axis, missing id or unknown escape all throw, naming a stale superseded encoding specifically. | `engine/dialect-guard.test.js`. | §7A.4 |
| R-PAY-5 | Hole dedup via a shared fill table, and parameter hoisting, are **REJECTED**: both compress further and both replace visible source text with an indirection a reader must resolve by hand. Residual negative compression from gloss prose is honest and acceptable. | Neither is implemented. | §7A.5, §3 |
| R-PAY-6 | **A word id is not stable across a re-mine, and the payload references word ids.** A `.en` is therefore decodable only against the dictionary it was rendered with. The engine **MUST** close this either by (a) each `.en` naming the dictionary `fingerprint` it was rendered against, with `compileFileEn` **REFUSING** on mismatch, or (b) making ids content-addressed as skeleton names already are (strictly better, strictly more work). | Today's harm is bounded because the `.ts` is authoritative and a `.en` can always be re-rendered; the failure mode is a compile producing **wrong bytes, not an error**. | §1B.5, §8B |

## R-ART — the artifact contract

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

## R-PIN — corpus pinning

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-PIN-1 | Every generated artifact **MUST** carry a corpus stamp written **on the artifact**, never inferred from its path or filename. A filename is not provenance. | `corpus` header field. | §8C.1 |
| R-PIN-2 | There **MUST** be one publisher, and it **MUST** refuse to publish a library whose declared `corpus` is not the tree it is being published into. It writes the artifact **beside the corpus it describes**. | Publisher refusal. | §8C.2 |
| R-PIN-3 | A consumer **MUST** refuse a non-matching artifact and **MUST NEVER** fall back: it returns an honest miss naming what it looked for and where, and renders nothing. | `AC.load(kind, AC.pathFor(kind, selected), { corpus: selected })`. | §8C.3 |
| R-PIN-4 | An **absent** stamp is UNKNOWN, not WRONG: the artifact is unusable *for reporting* until republished, and **MUST NEVER** be silently adopted as an answer. | `allowUnstamped` is explicit, never default. | §8C.4 |
| R-PIN-5 | Version shadowing **MUST** filter by corpus **first**, then take the highest `vN` (unversioned sorts lowest). Version rank **MUST NEVER** override provenance. | Rank applied before provenance is exactly how a correct mine gets shadowed by a stale one. | §8C.5 |
| R-PIN-6 | An artifact **MUST** declare only what it carries: the publisher refuses when a summary count disagrees with the body or cannot be verified, and a build that cannot walk the whole tree **MUST** fail loudly or mark itself `complete: false`. Silent under-reporting is banned. | Publisher assertion. | §8C.6 |
| R-PIN-7 | A consumer **MUST** take its roots as **one selection**. There **MUST NOT** be a second independent setting for one fact — keeping two paths equal by discipline is not an invariant. | Resolution and validation take the same root from the same source. | §8C, §1B.1 |

## R-CFG — roots, configuration and wipability

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

## R-MEAS — measurement discipline

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

## R-TEST — test integrity

| ID | Requirement | Check | Why (§) |
|---|---|---|---|
| R-TEST-1 | Correctness **MUST** assert against real source through a round-trip: the oracle is the corpus itself, `compileFileEn(renderFileEn(src)) === src` over actual files on disk. | §10.1. | §10 |
| R-TEST-2 | A mined artifact **MAY** be an **input**, and **MUST NEVER** be the **oracle**. Grading the engine against a catalog the engine wrote proves only that the engine still agrees with itself. | §10.2. | §10 |
| R-TEST-3 | Every guard **MUST** be mutation-checked at authoring time — disable the assertion, confirm it goes red *with the message it promises*, restore, confirm green — and that **MUST** be stated in the merge request. | §10.3. | §10 |
| R-TEST-4 | Pinning an **inventory** is legitimate; pinning an **answer** is not. A drift guard pins the current inventory so each addition becomes a decision someone makes, and is updated in the same commit with a stated reason. | §10.4. | §10 |
| R-TEST-5 | Where a full-corpus assertion is too slow, a test **MUST** sample deterministically (a fixed, evenly-spread sample) rather than narrowing its oracle. A test that skips is honest; a test that narrows its oracle to pass is not. | §10.5. | §10 |


The register in Part III is the *what*. This part is the *where and how much*: the constants with
their sources of truth, the two protection levels an artifact can have, the executable artifact
contract, the provenance rules, and the two-root configuration model.
