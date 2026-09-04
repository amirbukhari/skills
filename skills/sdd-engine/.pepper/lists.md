# Pepper lists

_Read-only mirror. Pepper owns these via her list tools; edits here are ignored._

## sdd-engine backlog — tasks

_**The goal (Amir, 2026-09-04): English you can WRITE that produces deterministic code.** The rule programme makes the English worth reading on the way there. Ranked work on `spec-driven-dev` (s2). Order IS priority.

**READ FIRST → sub-list [[standing policy — read before quoting ANY number]]** — binding: LESSON 1 ("could speak here" is not a work estimate) · LESSON 2 (a differential is necessary but NOT sufficient) · CLAIM TYPE (attribution-model vs rendering-path) · DEAD METRICS · VOCABULARY CAPPED · LADDER SOURCE + FROZEN BASELINE · METRICS ARE BLIND TO FALSE CLAUSES · METHOD · TOOL GAP. These supersede anything shorter here.

**LIVE LADDER** — HEAD `f1bb87c`, from the coverage test's own TOTAL row, the only valid metric: 33918 statements · site-specific **32211** · generic **1645** · unruled 62 · 43 passed, 9 failed. REAL **592**, NEITHER **360**. Series unmoved: elision 921 · one-char 117 · escape 15. Optional-chain credit 39 / 33 net new, REPORT-ONLY. Attribution of the 592: vocab 174 / unruled-kind 50 / BOTH 8 / NEITHER 360. byte-identity 1037/1037 FAILURES 0. Frozen baseline verified WITH A POSITIVE CONTROL (`git diff 017b732 -- …/engine/clause-quality.js` → 0 lines; same form on `one-char-credit.js` returned its full diff).

**Claim-type rule, one line:** *an attribution-model count says where a site's silence is ATTRIBUTABLE; it does not say that fixing that attribution will change the rendered clause — only a differential says that.* Every reach figure here except the improvement-site figures is an attribution-model count, and NONE is a WORK ESTIMATE until it has been through a differential. Bucket 7 is the proof: 9 attributed, 1 moved.

**Cap ~2000 chars.** ITEM writes DO report `truncated`. A LIST-description write does NOT — confirmed 2026-09-04: an over-long one cut mid-word silently. So measure before writing and READ BACK after. New standing policy goes in the sub-list. This list's `metadata` is unreadable by any tool — residue, not a source._

[~] R-PAY-6: content-addressed ids — SLICE 1 LANDED `99690e4`; slice 2 blocked on a payload.js dialect question _(s2)_
      **Sole remaining implementation cost of Amir's PIN ruling (Q-10).** Once ids are content-addressed, the existing throw at `enlzw.js:71-73` suffices and the post-re-mine failure stops being undetectable.

**SLICE 1 = `99690e4`, verified by me against the repo (positive control: `git diff HEAD~1` non-empty; working tree clean).**
- `engine/content-id.js` (new, 153 lines) + `engine/content-id.test.js` (new, 109 lines)
- **AND `ASSUMPTIONS.md` MODIFIED, +92 lines.** s2 reported "two new files, nothing existing changed" — that is FALSE as stated. Docs append, harmless in substance, but the claim was wrong. THE REPO WINS.

**The two things s2 named (its own, correctly stated):**
- **Function of:** the ordered list of leaf skeleton strings the word expands to, and nothing else. NOT the entry's `key` (`symbols.join(",")` over first-seen symbolIds — `pipeline.js:93`'s trap one level down). NOT the `m:[prefix,appended]` tree (a function of the builder's decomposition).
- **Collides on:** (a) separator injection — length-prefixed `<len>:<skeleton>`, no joiner byte trusted; (b) truncation width — 64 bits, matching `artifact-contract.js:96`.

**All three known traps CLEARED:** does not repeat `pipeline.js:93`; does apply `artifact-contract.js:96`'s shape (content hash, 16 hex = 64 bits); does defend separator injection with a test that shows the naive join collides on the same pair.

**Measured (s2's prose, NOT independently re-run by me — no sidecar shell exists on s2):** patterns injective, 126,348 narrow / 118,447 wide, all distinct. Collisions @64 = 0 both axes; @24 = 436 narrow / 427 wide (negative control asserts >0, so the 64-bit zero has something to compare against). `expandKey` unmoved across all 244,795 words. 15 assertions, 0 failed. Byte-identity 1037/1037 FAILURES 0.

**No corpus write, no artifact rewritten, no `.en` touched, no mine, no dialect change. Nothing pushed** — the one-push authorisation (017b732 → 0ddd904) is spent.
[ ] R-PAY-6 BLOCKER exposed by `99690e4`: payload.js constrains the word id to an INTEGER — a 16-hex id is an R-PAY-1 DIALEC
      **Found by s2 reading the encoder; named by NEITHER the PRD NOR the backlog scope.** This is the thing that decides whether R-PAY-6 slice 2 is a code change or a design ruling.

- `payload.js:228` — `if (!Number.isInteger(obj.w) || obj.w < 0) throw`
- `payload.js:269` — decodes the id by scanning **digits only** (`text[i] >= "0" && text[i] <= "9"`)

So `w:` cannot carry `3f2a…` as written. Options are s2's to enumerate and MEASURE, not mine to pick: widen the payload grammar to hex (a dialect change → R-PAY-1, every `.en` re-rendered), or keep an integer surface with a content-derived integer (64 bits does not fit a JS safe integer — 53 bits does; that is a WIDTH question with a collision table, not a preference).

**Do not choose by taste.** The precedent is `content-id.test.js` §3: measure the collision count at each candidate width on the shipped dictionary and let the number choose. If the answer is a dialect change, that is Amir's call, not s2's.
[ ] The §5E.3.2 grammar parser — SPEC DOES NOT EXIST YET; design pass returned TWO REFUSALS
      **DESIGN PASS DONE 2026-09-04 (commit 28100a9, ASSUMPTIONS.md only, engine untouched, verified independently). DO NOT START THE BUILD.**

**TWO REFUSALS, both evidenced:**
1. **This is BIGGER than R-PAY-6.** R-PAY-6's pieces all exist; this one needs **English to become a function of the GRAMMAR instead of a function of the compiled `.ts`** — a REWRITE of the render path across 126,348 dictionary entries under 1037/1037 byte-identity.
2. **§5E.3.2 DOES NOT SPECIFY ENOUGH TO BUILD FROM.** It is §3.2 of `tools/prd/20-archetype-hybrid-design.md` lines 113-180 and specifies a GRAMMAR, not a parser — the word "parser" never occurs in it. **"The §5E.3.2 grammar parser" is a name OTHER sections gave to work §5E.3.2 does not describe** (line 393, line 511 are forward references TO it). **Retitled accordingly.**

**The next real step is to WRITE the parser spec**, not to build one. The buildable slice today is the Entity round-trip (own item, re-ranked to the top).

**FULL DETAIL — all findings, line numbers, measurements and bounds — lives in the sub-list [[grammar-parser scope]]** (7 items: the two refusals, (a) hand-edit behaviour, (c) why a production parse is unavailable, (d) the bounded ambiguity result, (e) the smallest honest slice, baseline). **Read that before touching this.**

**Still blocked-ish:** should follow R-PAY-6 (imtmx2m46bcf9c4) — parsing onto renumbering ids buys a parser that invalidates itself.

**Sources:** `tools/prd/20-archetype-hybrid-design.md` §3.2 (=§5E.3.2); `ASSUMPTIONS.md` § "THE §5E.3.2 GRAMMAR PARSER — DESIGN AND SCOPE".
[ ] PHRASEBOOK (DEMOTED 2026-09-04, 286 → ≤42 genuine): vocabulary for RULED-BUT-DECLINING kinds (R-LANG-16)
      **DEMOTED from #1. The 286 that won it the top rank is not 286 of missing vocabulary.** Re-derived 2026-09-04 from `4ffd7cb`'s measured outcome, per family — and the order is NOT defended, it is corrected:

| family | sites | genuine vocabulary? |
|---|---|---|
| MATCHERS + ROUTE_VERBS | ~53 | **4** — 17 one-char artifact, 28 engine defects, 4 alias. MEASURED, closed. |
| array mutation + date + log | ~42 | plausibly all — **UNAUDITED for the one-char artifact** |
| query builder | ~44 | **0** — self-declared chain-collapse, not rows |
| promise (`then` 36, `catch` 8) | ~44 | **0** — self-declared continuation shape, explicitly NOT a `VERBS` row |

**So the workstream's genuine-vocabulary ceiling is ~42 of 286 (~15%), and even that 42 is unverified against the same `>= 2` threshold.** Three of the four families are not vocabulary work at all — they are one artifact, one defect class, and two new shapes.

**Rule 10's ~85–93 is not refuted, so it takes the #1 rank back.** **The one-char count is a measurement BLIND SPOT in the frozen predicate, not a quality score. It is RECORD-ONLY and must never rank or prioritise anything** — the same framing the `Block` cross-ref already carries: *"Both record-only. **Do NOT widen `>= 2`**."* So this item is **not** waiting on a "one-char column": that column cannot exist as a ranking input under the frozen measure, and the "ROOT FIX item above it" it pointed at names no item that exists in this file. Rank this item on the ~42 genuine-vocabulary ceiling itself, measured against the live ladder.

Current measured state: `CallExpression` declining distinct-site net **286 → 251**; overall residual `{frozen 1695, credited 921, net 774, noHead 146}`. Detail per family lives in the sub-list — read it before touching this.
[.] REFUSED WITH EVIDENCE 156e6d9 — my "54 not 53, 101 not 100" appears in NO measurement. No digit changed.
      **s2 REFUSED THIS AND WAS RIGHT. Recorded as a correct outcome, not a failure.**

**Neither of my figures appears in any measurement — and neither does the published one.** Re-measured over the same 1,037 files with the live walk:

| predicate | kinds | instances | 99% at |
|---|---|---|---|
| **A** `kind > LastToken` (`phrasebook-worklist.js:109`, the ONLY live predicate) | 95 | 274,091 | 51 |
| **B** A plus literals | 102 | 321,214 | 56 |
| **C** all but keywords/punct/Identifier | 102 | 321,214 | 56 |
| **D** no exclusion | 158 | 541,157 | 78 |
| published in §5D.3C | 100 | 307,009 | 53 |

**54 and 101 appear nowhere.**

**ROOT CAUSE: the table never named its predicate, and its prose contradicts itself.** The heading excludes tokens — that is predicate A — yet the published top eight lead with `StringLiteral` in third place, and `StringLiteral` IS a token. B and C reproduce the published eight **exactly and in order**, identifying the family; they still miss the counts.

**Residual gap logged as UNVERIFIABLE, not diagnosed:** probable corpus drift (`e87d526`; `Examples/` is gitignored, so the measured state cannot be recovered).

**NO DIGIT WAS CHANGED, and that was correct** — substituting one unreproducible triple for another is not a correction. The argument survives every predicate: 8 kinds reach 50%, 99% lands between 51 and 56 of 400.

**STANDING: nobody "fixes" this later by picking a number.** A digit moves here only if a predicate is NAMED and the count REPRODUCES.
[~] CLASS 3 FIX — the callee listed as one of its own inputs (58 sites, 37 files, `inputsOf`) _(s2)_
      **RANK 1.** From the 340-site census (imtn5amiw19b844, HEAD `9a5a4b1`).

`if (Number.isNaN(A))` → "stop early when `Number.isNaN` and `A` passes `isNaN`" — the callee is enumerated as one of its OWN inputs.

**SUPERSEDES the prose-wart item imtn5amiw44e453** — same class, one item now, not two. That item recorded **6**; the corpus-wide figure is **58**. The 6 was NOT WRONG, just LOCAL: `f1bb87c`'s differential reports what MOVED, not the size of the class. A fresh instance of LESSON 2.

**Scoring:** 58/58 quote an identifier that IS in the statement — invisible to every published figure, counted as SUCCESS inside the 32,211. Truth, not coverage.
[ ] CLASS 4 — a return named from one part of a compound expression (32 sites, enfile.js:1110)
      **RANK 2.** From the 340-site census (imtn5amiw19b844, HEAD `9a5a4b1`).

Of **106** returns on that rung, **74** are a plain call whose outermost callee IS the subject — correct. The other **32** are compound and name one part of it:

- `return (new Date(expiry)).getTime() < Date.now()` → "return get time"
- `return errorResponse && …` → "return is array"

**Scoring differs from C1–C3:** these carry NO quoted run at all, so they are already inside the **generic 1,645** — the metric sees them as THIN, not as WRONG.
[!] DESIGN QUESTION (record only — do NOT escalate now): what should stand for a whole try block? (190 of 230)
      From the 340-site census (imtn5amiw19b844, HEAD `9a5a4b1`). **s2 flagged this as a design question rather than a bug, and it is.**

One arbitrary call stands for a whole try block: `doRun.ts:119`, a **20-call** try block → "try `info`". **190 of 230** sites; the other 40 name the only call there is.

**Why it is NOT a bug fix:** the try block IS the described region, so this is an ARBITRARY PICK, not cross-region naming — and picking a *better* call does not fix it. Naming one call out of 20 cannot be made true by choosing differently.

**THE THING TO PUT TO AMIR when he next engages this lane.** Do not escalate on the silent lane.

**Scoring:** 225/225 quote an identifier that IS in the statement — counted as SUCCESS inside the 32,211.

**AMIR'S RULING 2026-09-04 BEARS ON THIS** (full entry on [[standing policy — read before quoting ANY number]]). His words: *"we do our naming of our patterns in a way that fits the grammer"*. **MY READING, not his:** a try block's name must be GRAMMAR-SHAPED — it must EXPAND to say something about its members, not stand in for them arbitrarily. That is the BEGINNING of an answer, not the answer. **This item stays OPEN — it is still his.**
[!] AMIR MUST DECIDE (record only — do NOT act, do NOT escalate): a rule that can render ARGUMENTS
      **A decision, not a task. Do NOT act on it; do NOT escalate it now.** s2's words: *"anything past `date` and `string` needs a rule that can render arguments — a different mechanism, and a decision rather than a task."*

**THE MEASURED CASE.** `CallExpression` renders exactly two things: the BASE, and — via `VERB_PREP` — an arrow callback whose body is an EXPRESSION. Every other argument is discarded. Census across all 188 vocabulary-blocked REAL sites, disjoint, summing exactly:

```
  88   content in NON-FUNCTION arguments the rule NEVER renders
  49   content in a BLOCK-BODIED callback, declined by design
  51   the base alone can carry the sentence
 ---
 188        (A1 n B = 0, measured)
```

**The 88 are the prize** — `mgr.save(entity)`, `qb.where("x = :y", {…})`, `list.push(item)`, `s.includes(needle)`. Unreachable by ANY vocabulary row, at any phrasing.

**WHY IT IS A RULING.** The rule's discipline is that it **declines rather than guesses** (§5C rule 3). Reaching past the base can render a clause that is **FALSE, not merely thin**: `getManager().save(entity)` → "the result of `getManager` saved", where the base is the MANAGER and the thing saved is the ARGUMENT — **22 of queryBuilder's 43**. An argument-rule trades the engine's core guarantee for reach. That trade is Amir's, not ours.

**CROSS-REF, same predicate, also unmade:** `imtmynumr2bb716` (116/117 one-char-quote sites, `isSiteSpecific`'s frozen `bare.length >= 2`) and `imtmzyv7lfb918b` (192 ReturnStatement sites already correct). Both record-only. **Do NOT widen `>= 2`** to make an argument-rule work.

Evidence: ASSUMPTIONS.md 2026-09-04; `node-kind-rules.js` §"THE CEILING ON VOCABULARY ROWS"; commit `08d5f9e`, comment only, verified BY CONSTRUCTION. Full figures in this item's `metadata`.
[.] REFUSED WITH EVIDENCE 2026-09-04 — RULE 10 on `Block`: earns 4 sites, not 68. Correctly declined, NOT a failure. _(s2)_
      **s2 measured Block before writing rule 10 and refused it. Docs-only commit `9025220` (verified: touches ASSUMPTIONS.md alone, engine untouched).**

Block's 68 REAL sites split:

| | sites | |
|---|---|---|
| gated by the parent `CallExpression` | **50 (74%)** | `.then` 29, `.forEach` 13, `.catch` 5, `.andWhere` 1, `.finally` 1, `.mockImplementation` 1 |
| escape artifact (new, 4th) | 11 | |
| IIFE — callee is an arrow, a different gap | 3 | |
| **reachable by a `Block` rule** | **4** | `return stringify`, `await info`, two `specify` clauses |

A `Block` rule would render a child that the parent refuses to use. **Block dead-ends BOTH ways:** 11 of the 18 ungated sites die against the frozen `isSiteSpecific` threshold (Amir's unmade ruling — not reachable); the other 50 die against something fixable, but the fix is the promise/arrayMutation VOCABULARY, not a Block rule. s2 routed around neither.

**Do not re-brief rule 10.** The structural finding it produced is now the high-priority driver-attribution item on this list.

REAL corpus figure corrected to **642** of the frozen 1,695 once all three artifacts are removed.

Floor at refusal, verified independently: frozen `isSiteSpecific` (`bare.length >= 2`) verbatim in both `statement-kind-coverage.test.js` and `phrasebook-worklist.js`; `VACUOUS` frozen at 13; `SAYS_NOTHING` intact; credit modules reach no assertion; no `SDD_DERIVE_CHECK`. Coverage TOTAL row 1,695, 42 passed / 10 failed; byte-identity 1037/1037, FAILURES 0.
[!] AMIR MUST DECIDE: no .en→.ts writer exists, two-root model has nowhere to put one
      s9's full-PRD read (244450c) found this is the highest-value UNFILED gap toward the flip (source-of-truth: .en authored, .ts derived). Only en→ts write today is one file (new-archetype.js:99). R-CFG-1 makes SOURCE never-written; §1B.5 wants the .ts generated AND committed — needs either a third root (the cut BUILD_ROOT) or an amendment to the two-root model. Note: Amir just settled Kraken on a 2-root model tonight (2026-09-01) for a DIFFERENT reason (Kraken's own root reconciliation) — don't assume that answers this; this is the engine's own flip mechanism, a separate question. Flag prominently in the morning.
[!] AMIR: whole-codebase-as-one-word is well-posed but needs a different mechanism + a real design call
      s11 investigated (8278506, docs only, no engine change). KEY FINDING: LZW mining does NOT extend to file level — measured 0 of 1034 adjacent file-pairs recur (99.8% of top-level words are already unique), even with a deliberately coarse alphabet. So a 'codebase word' can't be mined statistically like everything else in the engine — it needs a STRUCTURAL fold over the import graph instead, a genuinely different algorithm.
Measured risks: circular imports are real but NOT a blocker (19 cycles/170 files, Tarjan condensation gives a clean 886-node DAG). Naming collisions are modest, force a decision (204 of 2732 exported names collide across files, worst case 13x) — addressing must be path-qualified, cheap but needs settling before an artifact schema freezes. THE REAL BLOCKER: coverage — 332 .tsx modules aren't mined at all, 91 dangling/missing edges, so a codebase word today could only cover 1037 of 1369 real modules.
What's required to build this at all: (1) an import-graph artifact (doesn't exist, symbol→specifier only today) — safe/additive, s11's recommended first step, but sits behind the reserved Q-1 direction-of-truth decision; (2) a THIRD CHUNK KIND alongside atomic/structural, since a codebase chunk's children are references to other files, not inline concatenation — real design question, not decided; (3) a renderCorpus entry point (today's renderFile/renderFileNested are per-file by construction); (4) byte-identity itself needs redefining to cover file-set/path reproduction, which the current gate can't express.
All 3 findings are in ASSUMPTIONS.md. This is the actual endgame of the stated goal — needs Amir's real design input in the morning, not a lane decision.
[!] A5: re-mine idempotence has no corpus-wide gate (Amir's own statement-2 criterion, from s9's PRD read Tier A)
      Surfaced by s11 while handing off unclaimed Tier A items. Not a design call — a real gap: statement 2 of Amir's own stated criteria has no corpus-wide mechanized check. Needs someone to pick up (was handed to s7 verbally but may not have landed; confirm ownership before starting).
[ ] ENGINE DEFECT: the renderer drops `?.`, so ~72 optional-chain sites score generic while reading correctly
      **Now the LAST known scoring artifact**, after `4357715` credited the 921 `…`-elision sites (2026-09-04).

The renderer drops optional-chaining marks: `if (!responseJson?.response?.roles)` renders as `` `responseJson.response.roles` `` — correct, naming the right thing, and unmatchable against the source, so it scores GENERIC. ~72 sites.

`engine/elision-credit.js` deliberately does **not** credit this case — folding it in would make one figure answer two questions and neither cleanly. So these ~72 sites are still inside the 808 residual REAL count and should not be.

**The real question is render-or-measure, and it is a fork:** either the renderer stops dropping `?.` (changes emitted prose, and so touches byte-identity — expect 1037/1037 to be re-verified), or a second credit predicate recognises the drop (measurement only, no prose change). These have different risk. Decide which before implementing.

Sequence: do this AFTER the net-of-elision re-ranking, since it moves the same denominator.
[ ] PHRASEBOOK: statement-level call rule that names the RECEIVER, not the method
      **What.** A rule for a call used as a statement that reads out the receiver (`call `set` on `acc``) rather than the bare method (`call set`). s2 parked this deliberately at 04:00 on 2026-09-04 and recorded why in ASSUMPTIONS.md: it needs a lead-in choice the phrasebook cannot express today, and it declined to invent one for eight sites.

**Why it matters more than eight sites suggests.** This is R-LANG-24, and §5D.3G §11 measured its consequence: making a call name its receiver retired 14 of 20 authored leaf names and recovered **1,768 concrete identifiers** the names had been swallowing. It is also the rule §5D.3G §10 says should come *ahead of any further naming* — `‹id›.set(‹args›)` was named "set a configuration value" while one of its two sites is a cache write (`cacheProxy.set(...)`).

- the open part is the LEAD-IN, not the rule; decide it deliberately, in daylight, not at 4am
- ship alone; re-run `name-words.js retire` afterwards (§5D.3G §11) since a new rule can downgrade an existing name

**Pick it up from:** `tools/prd/28-rule-coverage-filter.md` §10 and §11 (R-LANG-24, the retire command and its refusal-to-lose-detail discipline); s2's ASSUMPTIONS.md item 2.
[ ] PHRASEBOOK (DEMOTED — 33 residual sites): the `const x = …` declaration family — VariableDeclaration / FirstStatement
      **DEMOTED 2026-09-04. The driver contradicts this item's original ranking, and the driver is right.**

This was ranked from §5D.3C's **stale instance table**, measured before any rule shipped. Measured against TODAY's tree by `tools/repo-dsl/engine/phrasebook-worklist.js`, the `VariableDeclaration` / `VariableDeclarationList` / `FirstStatement` family is **33 residual generic sites** — not the top-of-table item the instance count implied.

Corroborated by the coverage TOTAL row: `FirstStatement` reads 12,986 sites / 12,953 site-specific / **33 generic (0%)**. It is very nearly finished already.

Still worth doing eventually — 33 sites is 33 sites, and it is cheap — but it is not a headline item and must not be picked up ahead of the measurement fix or the vocabulary work above.

**Rank phrasebook work from the driver, never from the instance table again.**
[ ] PHRASEBOOK (DEMOTED HARD — 3 residual sites): `PropertyAssignment` rule
      **DEMOTED 2026-09-04. Near-worthless as measured. The driver contradicts this item outright, and the driver is right.**

This was ranked as a "top-8 node kind by instance count" from §5D.3C's **stale instance table**, measured before any rule shipped. Measured against TODAY's tree by `tools/repo-dsl/engine/phrasebook-worklist.js`, `PropertyAssignment` blocks **3 residual generic sites**.

Rules 1–8 (in particular the `ObjectLiteralExpression` rule, rule 2) already reach essentially all of them. Instance rank stopped being value rank the moment the first rule shipped — this item is the clearest demonstration of that, and it is exactly what the driver was built to catch.

**Do not write this rule** unless the driver's own output puts it back near the top. 3 sites does not pay for a rule plus its vocabulary plus the byte-identity risk.

Kept on the list rather than removed, as the worked example of instance-rank being wrong.
[ ] PHRASEBOOK CEILING: 146 residual generic sites have NO head expression to attribute — unreachable by any node-kind rule
      **Exposed by the driver, 2026-09-04.** Of the 1,729 residual generic sites, **146 report under NO-HEAD** — the statement kind has no single head expression the phrasebook could be asked to render (blocks, loops with bodies, and similar).

This is a real ceiling on the whole rules-1..N programme: no node-kind rule can ever reach these 146, so the phrasebook approach asymptotes with them outstanding. Worth knowing the number before more rules are written, and worth deciding what mechanism does reach them.

Note this is a smaller and better-defined problem than it looks: 146 of 1,729 is 8.4%. It is a design question, not urgent work — but it should be costed before anyone claims the phrasebook can finish.

**Pick it up from:** `headOf()` in `tools/repo-dsl/engine/phrasebook-worklist.js`, which enumerates the statement kinds that DO have a head; the NO-HEAD count is everything else.
[ ] FINDING (evidence, no work): rules 1–9 never reworded an already-correct site — credited is 921 at BOTH commits, per kin
      Recorded so the reasoning is not re-derived. From the elision measurement (`4357715`):

- Credited count is **921 at 72279c6 (before rule 2) and at e199d99 (after rule 9)** — and identical per kind: ThrowStatement 326, IfStatement 313, ExpressionStatement 282.
- The absolute drop is therefore identical (**−555**); only the percentage moves: **24.3% of the frozen figure, 40.7% of the workable one** — the frozen series understates progress by **1.67×**.
- Meaning: the programme has been **adding sentences where there were none**, not rewording good ones. This is the strongest available evidence that reading the driver's `says:` lines before ranking was correct rather than lucky.

Keep this in mind when judging any future rule: a rule that moves the frozen number by rewording already-credited prose would be a regression in disguise.
[ ] MEASUREMENT: `measure-english.js`'s 31.8% cannot move on phrasebook work — decide what the real English metric is
      **What.** The 31.8% "reads as English" baseline did not move by 0.0 across all eight phrasebook rules, and s2 established that it *structurally cannot*: `measure-english.js`'s own header says *"Label-region only. compileChunk never reads a label, so nothing here can move a byte."* It classifies BYTES; clause prose is not one of its inputs.

**Why this is work and not a footnote.** 31.8% has been cited as the phrasebook's scoreboard. It is measuring hole/skeleton coverage, not prose quality. Reporting a phrasebook delta against it will read as "eight rules achieved nothing", which is false — the same eight rules moved corpus generic 2,284 → 1,839 (−19.5%).

- name explicitly which metric scores WHICH work: byte coverage (mining/holes/skeletons) vs generic-mute (productions/phrasebook) vs review surface (mining, nesting, scheduling — R-ARCH-16)
- do not retire or redefine `measure-english.js`; add the mapping, per R-ARCH-16B's ruling that a metric is never replaced, only accompanied
- if 31.8% is the number Amir wants moved, the work order is hole/skeleton coverage, NOT the phrasebook — say so plainly rather than reporting a flat delta

**Pick it up from:** `engine/measure-english.js` (its own header); §R-ARCH-16B's two-metric ruling in `tools/prd/20-archetype-hybrid-design.md`; s2's 2026-09-04 report.
[ ] The rule-coverage filter — keep it current, and re-measure the 20 → N namable leaves before ANY model spend
      **What.** The filter that decides, before a model call is made, that a leaf a node-kind rule already renders is not worth naming. It is BUILT (`engine/rule-coverage.js`, wired into `name-words.js plan`). This item is to keep it true after rules 1–8 and re-measure.

**The measurement it rests on (§5D.3G §2, at `8882830`):** of 1,414 leaf skeletons — 1,112 rule-covered-constant, 274 rule-covered-varying (37,161 sites), **28 unreached-generic**. So 98% of the leaf tier is already rendered by code, and the leaf naming target collapsed from 1,414 to 28, then to **20** after the `ExportDeclaration` rule landed at `3df26f8`.

**Why it must be re-run now:** the filter's verdict is a CLAIM that no rule says it better, and eight rules have landed since. §5D.3G §11: *"a name authored when no rule reached its skeleton becomes a DOWNGRADE the moment one does."* So:
- re-run `name-words.js plan` so the rule annotations are current
- re-run `name-words.js retire` — it re-tests each authored name against TODAY's annotations, never touches a name whose skeleton is still unreached, measures the corpus before and after, and REFUSES to write if retiring would cost detail
- the pilot's lesson is the reason all of this exists: 80 leaves named in 2 calls, all four gate checks green, and it stripped **27,673 → 7,644 concrete identifiers across 982 files** (975 lost, 0 gained). It was reverted.
- `--include-rule-covered` exists to re-measure the claim, NOT for production use

**Pick it up from:** `tools/prd/28-rule-coverage-filter.md` (whole file — §1 criterion, §2 measurement, §5 plan, §9 gate check 4, §10 gate check 5, §11 retire).
[ ] AMIR HIMSELF: author a `.en` by hand and review the compiled `.ts` as a diff
      **What.** The one unticked bullet on Q-1 that no engine work can close: *"A human must actually author a `.en` and review the compiled `.ts` as a diff."* Still listed as open on the CLOSED question, deliberately.

**Why it cannot be delegated.** Everything measured so far is the machine checking itself: derive-and-check proves an edit is detected, `sentence-authority.test.js` proves the refusals fire, 1037/1037 proves the bytes round-trip. None of that establishes that a human writing English gets TypeScript they meant. That is a judgement, and it is Amir's.

- a good first specimen is the one already proved end-to-end: `src/hydra-api/redisJobs.ts.en`, hole-level rename
- the interesting failure is the one the machine cannot score: an edit that compiles cleanly and produces code the author did not intend
- `SDD_DERIVE_CHECK` is OFF by default outside tests; turn it ON for the exercise — and NEVER touch it to make anything pass

**Pick it up from:** Q-1, bullet 3, in `tools/prd/18-open-questions.md`; the measured hand-edit in §5E.5.3.
[ ] THE RESIDUAL: 7 files not collapsed to one word, and 52 verbatim statements
      **What.** R-ARCH-15 (one word per file) stands at **1030/1037 — 99.3%** after the stray-`;` absorption. The remaining 7 are accounted for individually, not a residue:

- **2 are empty files** (1 and 9 bytes, no statements at all). They cannot have a top word under this definition, so **the true ceiling is 1035, not 1037** — say so in any report rather than chasing 1037.
- **4 carry non-whitespace outside the span** — the leading-comment case. Amir, 2026-09-01: take the safe half of the fix, *leave the leading-comment half alone*, since it broke byte-identity and was correctly refused. **Do not re-attempt it without a ruling.**
- **1 has two `interface` declarations the dictionary holds no word for** — visible as a `no-word` row in `audit-rules.js`. This is the only one of the seven that is ordinary work.

**The 52 verbatim statements** are the rest of the residual §5D.4 names — the statements no word accounts for, which is what stands between the dictionary's measured depth 62 and one word per file. Note 3,249 of 5,731 spans are still at depth 1: most spans are shallow even though the dictionary is deep (Q-8).

**Constraint:** byte-identity is the floor, always, every file. The leading-comment attempt already proved this residual is where it gets tested.

**Pick it up from:** `tools/prd/34-last-files-and-grouping.md` §1 and §2; §5D.4 (the residual and its three moves); Q-8's depth-histogram paragraph in `tools/prd/18-open-questions.md`.
[ ] Explain or retire the 5 unexplained register rows: R-CFG-5, R-CFG-6, R-MECH-1, R-MINE-3, R-PAY-4
      **What.** Five rows in the requirements register carry no explanation — no stated rationale, no Check line that can be evaluated, or a Check whose producer does not emit what it names. Read each one, then do ONE of three things per row and record which: (a) write the missing rationale + an evaluable Check, (b) mark it a reading of current behaviour rather than a requirement (Q-6's category), or (c) retire it, with the superseded text QUOTED IN PLACE rather than deleted — that is this document's own convention throughout.

**HONEST GAP IN THIS ITEM:** `tools/prd/11-requirements-register.md` is 73KB on 8 very long lines and could not be read in one pass by the agent that wrote this backlog entry, so the five rows are named from Amir's brief and NOT quoted here. **Read the five rows yourself before starting.** Do not take this description as a summary of what they say.

**Two of the five have known context worth carrying in:**
- **R-MINE-3** — `MIN_SKEL` was amended 2026-09-03 from 8 to **1**. The old value had been measured against `netStatementReduction`, not review surface. At 1: review surface 1582 → 1086 top / 20999 → 20214 tree, byte-identity 1037/1037, 0 chunk names orphaned. `skelBytes()` strips holes BEFORE the floor, so `return ‹expr›;` measured 7 bytes and missed 8 by one. (`tools/prd/12-constants.md`, `build-lzw-generators.js:91`.)
- **R-PAY-4** — sits in the payload family with R-PAY-1 (the live `lzw1 <axis><wordId>⟨hole…` dialect) and R-PAY-6 (id renumbering, the named blocker). Check it against what `compileChunk` actually does today, not against the pre-derive-and-check wording.

**Q-6 is the precedent for the honest outcome.** It flags two requirements that are readings of current behaviour rather than requirements, *"flagged rather than silently promoted or cut"*. Any of these five may deserve the same treatment. A register row that cannot fail is not a requirement.

**Also relevant:** the register had duplicate ids once already (140 rows, 136 distinc
[ ] walkDir SKIP-set correctness fix — `engine/pipeline.js:26` walks 1,038 files against the enfile layer's 1,037
      **What.** `engine/pipeline.js:26`'s `walkDir` has **NO skip set**. It walks 1,038 files where the enfile layer walks 1,037, pulling in `coined-demo/syncWhenProd.ts`.

**Why it is a correctness bug and not a rounding error.** Two producers disagree about what the corpus IS. Every count in this project — 1037/1037 byte-identity, 1,037 files, the review-surface denominators — is stated against one of those two walks, and nothing currently forces them to agree. That is the §8B drift shape with the pipeline as the consumer. It violates PRD §4 and §6. Worth ~0.1pt.

**The fix:** use the enfile layer's SKIP set, which the PRD records as normative: `node_modules, .git, .worktrees, dist, build, coverage, sen, spec, catalog, .cache, demo, coined-demo` — **both `sen` and `spec` on purpose (§1B.2)**. Best done as one shared definition rather than a second copy, or this recurs.

**Report the COUNT, not the word "held":** expect 1037/1037 after the fix, and say the number.

**Pick it up from:** `engine/pipeline.js:26`; `write-en-files.js` `SKIP`; the "Enfile-layer walk SKIP set" row in `tools/prd/12-constants.md`; PRD §4 and §6.
[ ] Redraw the naming worksheet from the 3,667 rendered-but-unnamed chunks
      **What.** Regenerate the naming worksheet against the chunks that actually render today and still carry no name — reported as 3,667 rendered-but-unnamed.

**Why now.** The worksheet is the input to every naming decision below the leaf tier, and the ground under it has moved three times: R-LANG-22's target went **5,408 → 5,861 → 2,052 in one day**, which is why the register now REQUIRES the figure to carry its commit (pinned to `8882830`: 1,135 spans / 1,018 used words / 1,414 leaves + 638 shallow = 2,052). A worksheet drawn against a stale render names the wrong things.

- names are keyed to the **content hash of a leaf skeleton**, which comes from the dictionary, not the render — so banked naming work is NOT lost when the render moves. Say this in the report; it is the fact that keeps a moving target from looking like wasted effort.
- order is leaves-first: every composite is prefix + one leaf (0 violations across 115,832 / 126,338 entries), so the dependency relation is a TOTAL order. **`name-words-lzw.js:89` sorts by depth DESCENDING and enumerates only top-level emitted words — R-LANG-20 is FAILING as written.** Fix or supersede it here.
- the worksheet survives as the DRY RUN (`plan` / `--dry-run`); `--apply` is the flag that writes
- **Q-7 is open and touches this:** `name-words-lzw.js` writes its worksheet INTO THE ENGINE TREE, a straight violation of R-ART-1 (engine code + PRD only, no corpus-derived bytes). Either it belongs under `<corpus>/.cache/spec-derived/` or the PRD must say why not. Do not silently pick one — record the call.

**BANNED:** `author-names.js` / `name:author` — it defaults its output to `word-names.json` and would overwrite 3,820 chunk names with leaf-only names.

**Pick it up from:** Q-7 and Q-9 (the R-LANG-22 chain and the R-LANG-20 defect) in `tools/prd/18-open-questions.md`; `tools/prd/27-naming-pass-mechanics.md`; `name-words-lzw.js:89`.
[ ] The six `sdd-run` declaration drifts — test committed RED as `32e9a12`
      **What.** Six declaration drifts in `sdd-run`, with the test deliberately committed in a FAILING state at `32e9a12`.

**Why it was committed red, which is the part a newcomer will get wrong.** A red test that names the drift is the §8B artifact-contract discipline working: the spec named fields the producer never wrote, and the honest record of that is a failing assertion, not a skipped one. **Do NOT make it green by weakening, skipping, disabling or re-baselining the check** — that is forbidden outright. Make it green by fixing the six declarations, or bring the case to Amir if one of the six turns out to be the spec's error rather than the producer's.

- the shape to look for is §8B's: a consumer reading a field name the producer does not emit, so the comparison is against `undefined` — neither pass nor fail. Q-2 caught exactly this with `maxCompositionDepth` vs `generators.maxDepth`.
- fix each declaration one at a time and report the count green out of six

**Pick it up from:** commit `32e9a12` and its test; `tools/prd/13-artifact-contract.md` (§8B).
[ ] Exercise `engine/sdd-clean.test.js`'s temp-tree cases WITH AMIR PRESENT
      **What.** The `sen/` wipe gate is hardened and now has `engine/sdd-clean.test.js`, but its temp-tree cases have never been run with Amir at the keyboard.

**Why the audience is part of the work item.** The thing being tested is a DELETE path over artifacts that are SOURCE-PROTECTED and not reproducible by any re-mine — `word-names.json` (hand-authored names plus the `orphans` ledger, *"deleting it destroys work that no amount of re-mining brings back"*), `generators-lzw.json`, `mined-library.json` (the composition graph that was nearly lost once already), `coined-words.json`. A green test run alone is not the evidence that matters here; Amir watching the temp tree behave is.

- every case must run against a TEMP tree, never the real `sen/` and never the real corpus
- §8A: a cleanup that cannot tell protected artifacts from wipable ones must **stop and ask**, never delete a catalog
- `<CORPUS>/catalog/` and `<CORPUS>/sen/catalog/` are DIFFERENT TREES (Q-4, open) — **do not merge or conflate them**; `coined-words.json` is hand-curated and a wrong answer there loses work permanently
- the gate hardens from *"explicit flag"* to *"refuse"* at the flip (§1B.3), and the flip's trigger is when `compileChunk` reads sentences — so this gate's final form depends on the grammar-parser item above

**Pick it up from:** `engine/sdd-clean.test.js`; `tools/prd/12-constants.md` §8A; `tools/prd/14-two-roots.md` §1B.3; Q-4 in `tools/prd/18-open-questions.md`.
[!] OPEN QUESTION Q-5 (NOT WORK, unassigned): which gate threshold is normative — PRD's ≥20% or the code's --min 80?
      **This is recorded as an OPEN QUESTION, not as a task. Do not implement a resolution. Amir closes it.**

**The contradiction, both halves verifiable:**
- `tools/prd/12-constants.md:16` records the gate corpus-coverage threshold as **≥ 20%**, and then notes in the same row that *"the `--min` flag default in code is 80"*.
- `repo-dsl.js:250` defaults `--min` to **80**.
- The gate currently reads **41.4%** — which PASSES against 20 and FAILS against 80. So this is not academic: the two values disagree about whether the build is green right now.
- Separately, the worst-file threshold is recorded as **disabled (null)** — no per-file floor enforced (`<corpus>/.cache/spec-derived/gate.json → thresholds.perFile`, `repo-dsl gate --min-file` unset).

**What closing it requires (§Q-5, verbatim in intent):** one decision — the PRD value, the code default, or a deliberate *"coverage is not a gate any more"* — and then **the losing number DELETED rather than annotated**. *"A constant with two values is not a constant."*

**Why nobody should just pick one.** Whichever way it goes changes whether the gate is currently passing, and the earlier backlog item *"Reconcile mining-threshold inconsistencies"* is marked done while §Q-5 is still open in the PRD — so a previous pass reconciled something adjacent and left the actual ruling untaken. Do not repeat that. And note the neighbouring pair that is NOT this question and must not be "fixed" into it: `MIN_COUNT = 1` (word promotion, R-MINE-1) and `minCount ≥ 2` (middle-tier body candidacy, R-WIDE-3) are two different thresholds in two different modules, correctly (Q-6).

**Pick it up from:** Q-5 in `tools/prd/18-open-questions.md`; `tools/prd/12-constants.md:16`; `repo-dsl.js:250`.
[!] BANKED (Amir's ruling, unmade): 116 one-char-quote sites — the `isSiteSpecific` length >= 2 threshold

**RULED 2026-09-04 — no longer unmade.** The threshold stays FROZEN; the class is recorded as a measurement blind spot and is **not** a ranking input. See `ASSUMPTIONS.md` § "RULING 3" (commit `0619dd8`). Kept below as the record of how it was found.
      **A second scoring artifact, measured 2026-09-04 alongside `5dbcfc1`. Recorded here because it is NOT in ASSUMPTIONS.md — only in s2's transcript.**

`isSiteSpecific` requires a quoted run of length **>= 2**, so a site whose clause quotes exactly ONE character scores generic on the threshold alone, even though the clause already says the site's own words:

- ``return `0` ``  <<  `return 0;`
- ``return `1` ``  <<  `return 1;`
- ``get `A` from float val``  <<  `const A = floatVal(a.maxValue);`

**116 such sites, and they are DISJOINT from the 921 elision-credited — overlap measured: ZERO.** So this is 116 NEW sites, not a re-count of the elision credit. Same class as the elision credit, and the same discipline applies: reported BESIDE the frozen figure, never instead of it, feeding no assertion.

**Why this is blocked and not work:** the `>= 2` lives INSIDE the frozen `isSiteSpecific` predicate. Touching it moves the frozen metric's DEFINITION, which is Amir's alone and needs its own pass. Do not fold it into a phrasebook commit.

Frozen series unchanged: coverage test TOTAL row **1,729** generic, 42 passed / 10 failed; byte-identity **1037/1037**.
[!] BANKED (Amir's ruling, unmade — RECORD ONLY): TWO separate predicate questions — 117 one-char runs vs 325 zero-run sites

**RULED 2026-09-04 — QUESTION A is answered NO.** `bare.length >= 2` is not widened to `>= 1`, not now and not for anything. Recorded, not patched — `ASSUMPTIONS.md` § "RULING 3" (commit `0619dd8`).
      **CORRECTED 2026-09-04 by the census at `2f0e1e2`.** The earlier framing ("the same threshold question as the 117") was WRONG and is retracted. There are TWO questions and they reach DISJOINT sites.

**QUESTION A — widen `bare.length >= 2` to `>= 1`.** `>= 2` tests the LENGTH OF ONE QUOTED RUN, so it can only reach sites that HAVE a quoted run whose bare text is one character: the 117 one-char sites (banked at `imtmynumr2bb716`) plus the 11 Block sites. **It reaches NONE of the sites this item was filed for.**

**QUESTION B — a predicate that can score a clause quoting NOTHING.** Census buckets 1 and 3 — `return;` (145) and `return null/true/false/[]/{}` (180), **325 sites** — contain ZERO quoted runs, so the `bare.length` loop never executes and widening to `>= 1` or 0 changes nothing. Those clauses are already the COMPLETE TRUTH (`return;` -> "return"). Scoring them needs a DIFFERENT PREDICATE ENTIRELY — it changes what "site-specific" MEANS.

**The banked "192 ReturnStatement" figure is 190 — THE REPO WINS, and it is NOT a `>= 2` question at all.** 192 was a sampled classification of 259 sites on the 642 ladder; **190 is exhaustive at the attribution point = buckets 3 + 4 (180 + 10)**. It belongs to QUESTION B: no threshold value reaches it. Correct 192 -> 190 wherever it still appears.

**BUCKET 4 (10 sites, string-literal return) after `81d3e7b`: the count SURVIVES at 10 and they are STILL GENERIC — but the REASON CHANGED.** Four now read "return empty text" instead of "return some text": **the FALSITY IS FIXED. Do not re-do that work.** All that remains is that a quoteless clause cannot score site-specific — Question B again, not a rendering defect.

**No renderer work here.** 325 of the 369 are not work of ANY kind. **STILL BLOCKED** — both questions are Amir's rulings alone; neither Pepper nor s2 may take either.
[ ] CORRECTION (evidence, no work): statement-kind-coverage.test.js is NOT byte-frozen — changed in 4357715
      **A premise in the sweep briefs is false. Corrected here at the artifact, not from a summary.**

Briefs (including the one that spawned the 2026-09-04 sweep) state that `clause-quality.js` AND `statement-kind-coverage.test.js` are both byte-for-byte frozen. Reading `git diff 017b732..HEAD` on each file directly:

- `clause-quality.js` — **genuinely empty diff.** Byte-for-byte frozen across the whole unpushed range. Verified against a passing positive control (`enfile.js` non-empty in the same invocation range).
- `statement-kind-coverage.test.js` — **NOT empty.** Modified in the elision-credit commit `4357715`: adds `const EC = require("./elision-credit")`, adds `elided: 0` to `bump`'s record, counts `EC.creditsElision(...)` INSIDE the existing `else` beside `rec.generic++`, threads `elided` through `totals`, and prints a second block after the frozen TOTAL row.

**This is consistent with the 09:39 ruling, not a breach of it.** What the diff shows is the METRIC DEFINITION intact: `isSiteSpecific`'s body untouched, `generic` incremented on the identical condition, no assertion changed, the second figure printed after the frozen one and feeding nothing. The backlog description already records `4357715` as sanctioned on exactly those terms. Both commits under review here (`caf4fad`, `b1432e3`) leave the file empty-diff.

**The fix is to the WORDING of the freeze, not to any code.** Say "the metric definition in `statement-kind-coverage.test.js` is frozen — `isSiteSpecific`, the `generic` condition, and the assertions", not "the file is byte-for-byte frozen". `clause-quality.js` IS byte-for-byte and can keep the stronger wording.

Sent to s2 for confirmation of the reading, and specifically to confirm the `bare.length >= 2` literal is still exactly that. No code work implied. Lesson-2 case: the false premise came from a summary and survived several briefs.
[ ] MINOR DRIFT (record only, do NOT act): one-char quote sites read 117, the banked item says 116
      s2's run at 13:42 on 2026-09-04 (raw tool output, read from the transcript by the sweep) prints:

```
of the frozen, quoting ONE character ... 117   7.1% of frozen   (overlap with elision: 0)
```

The banked ruling item [[imtmynumr2bb716]] says **116** one-char-quote sites. One site of drift, direction unknown — most likely a site that moved into the class as `caf4fad`/`b1432e3` changed clauses around it.

**Record only.** Do NOT reconcile it by touching `isSiteSpecific`'s `bare.length >= 2` — that predicate is Amir's unmade ruling and stays frozen however much pressure accumulates. Reconcile the NUMBER in the banked item the next time the partition is re-run, and note which site joined the class.
[!] BLOCKED (Amir's ruling): `isSiteSpecific` tokeniser alternation hides backticked identifiers — 6 sites
      From the census at `2f0e1e2`. Six of bucket 6's twelve.

**The defect, measured (s2 ran the tokeniser on the literal clause).** `` /`[^`]+`|“[^”]+”/g `` is an **ORDERED alternation**. On a clause like ``“Missing `partnerId`s from `LiftPartner` table: …”`` the `“…”` branch matches FIRST and swallows the WHOLE clause — `match()` returns exactly one run, the entire string. Its bare text contains `…`, which is not in the source, so the clause scores generic. Meanwhile `partnerId` **IS** in the source: `generateOneTimeInvoiceForPartner.ts:30` writes ``\`partnerId\`s`` inside the template. The inner backticked run ALONE would score site-specific.

**The defect is in the METRIC'S TOKENISER, not in the renderer.** No renderer change would fix it, and the prose these sites already emit is good.

**THE TENSION, stated explicitly — this is why it is blocked.** The tokeniser decides WHAT COUNTS as a quoted run, and therefore what counts as site-specific. That makes it arguably part of the frozen metric definition, alongside `SAYS_NOTHING`, VACUOUS's 13 strings and `bare.length >= 2`. Fixing it would LOWER the generic count with no renderer change at all — precisely the shape the freeze exists to prevent: **a fall in the count must never be manufactured by redefining what counts.** That this particular redefinition is a genuine bug fix does not settle it. That judgement is Amir's, not mine and not s2's.

**Options for his ruling, not to be chosen here:** (a) fix the alternation in `clause-quality.js` on its OWN commit with the count movement declared up front; (b) leave the metric alone and account for the 6 in a report-only credit module, as with the other artifact classes; (c) leave it recorded and unfixed. **Do NOT let this be fixed this pass.**
[ ] CLASS 1 RESIDUAL — the 20 loops out of reach of the ruled ordering: while/do + non-dotted iterables
      The 20 loops `d909c2f` did NOT reach, and s2 correctly invented nothing for them. They still name a call from the loop BODY.

Two distinct causes:
- **`while` / `do` loops** — `over` is not computed at all on that path. A rule here would need a new mechanism, not an ordering change.
- **`for...of` over a non-dotted iterable**, e.g. `(unpublished || [])` — `dottedText` correctly DECLINES rather than guessing. Declining is right; the question is whether a narrow, truthful extraction exists for the parenthesised/defaulted form.

**Claim type: this 20 is a rendering-path count** (it is the measured residual of a real differential), but any *fix* reach is an attribution-model count until it has been through its own full-corpus differential. See [[standing policy — read before quoting ANY number]] LESSON 1 + CLAIM TYPE.

Discipline if picked up: full-corpus rendering-path differential, every changed clause read individually against its source, improvements and regressions reported SEPARATELY, decline on ambiguity. TRUTH OVER COVERAGE.
[ ] SILENT CLASS: a structural chunk's NAME is never compared — enfile.js:2420
      **The one silent class left on the hand-edit path, and the code names it.**

`enfile.js:2420-2423`: a **structural chunk returns BEFORE the derive check**, so **the NAME a structural chunk carries is NEVER compared to what the human wrote** — not even with `SDD_DERIVE_CHECK=1`.

Everything else on that path is either honoured (via `repairFromSentence`, `enfile.js:2278`) or refused loudly with file/written/derived quoted. Nothing is half-applied. **This is the exception: a rename of a structural chunk's name is silently no-oped.**

**Distinct from the heading ruling.** A structural HEADING-only edit is refused BY RULING (a heading is computed from its children; the edit stays expressible at the child — proved in `engine/sentence-authority.test.js` §9). **Do not "fix" that one.** This item is about the NAME, which is not compared at all.

**Do not touch `SDD_DERIVE_CHECK` while fixing this.**

**Detail:** [[grammar-parser scope]] item "(a) Hand-edit today".
[ ] RECORDED NOT FIXED (from c3d306d): 3 of 5 inline-literal sites declared a named type NO production carries
      **Exposed by the enum work at `c3d306d`, deliberately not fixed there. Not a sentence defect — a FILE defect.**

- Three of the five inline-literal enum sites declared a **named type that no production code carries**, so it was never mined.
- The sentence loses nothing: the round-trip is 58/58 either way. But the **FILE said something unmined** — a name with no referent.
- Related, and measured **unreachable today**: `enumTsType` **refuses** on a literal with no quoted member rather than defaulting to `"string"`. Population at the time of measurement: 5 of 5 all-quoted, so **0 sites** can reach the refusal.

**Work, if it is work:** decide whether a declared-but-unmined named type should be (a) mined, (b) removed from the file, or (c) left and documented. That is a ruling, not a bug fix — do not implement it on your own read. The refusal branch stays as-is; do NOT soften it to a `"string"` default (that would be weakening a check).
[ ] RECORDED, UNRESOLVED: `a_entity_<sha256-10>` has NO producer at all — its width is an intent, not a fact
      **Found while settling `<sha256-N>` for `fe12964` (2026-09-04). Recorded, deliberately not resolved.**

Nothing on disk emits an `a_` id. There is no producer anywhere in the tree, so `a_entity_<sha256-10>`'s width is a **design intent for unbuilt work**, not a measurable fact about shipped output.

**Why this matters and why it is not a bug:** the §20 producer table landed in `fe12964` covers every width that a real producer emits (`pipeline.js:93` → 6, `word-names.js:28` → 16, `content-id.js` → 16). This one has no row to check against code, so it cannot be verified or contradicted — and it must not be quietly "confirmed" by anyone reading §20 as though it were measured.

**Do not resolve by picking a width.** When an `a_` producer is actually built, the width becomes a real decision at that point. Until then this is a record, not work.

Distinct from the R-WIDE-4 fork (`g_<len>_<sha256-10>` MUST vs `pipeline.js:93` emitting 6), which IS live and IS Amir's — see needs-attention.

_57 done_

## CallExpression vocabulary — by family — tasks

_The MEASURED work order for [[sdd-engine backlog]], over `CallExpression`'s families. **RE-RANKED 2026-09-04 from the CORRECTED run (`caf4fad`), not hand-ordered** — the gate ("do not reorder before the corrected attribution run produces them") is discharged.

| # | family | sites | credited | 1-char | escape | **REAL** |
|---|---|---|---|---|---|---|
| 1 | promise | 45 | 0 | 0 | 0 | **45** |
| 2 | queryBuilder | 54 | 0 | 11 | 0 | **43** |
| 3 | (unclassified) | 100 | 37 | 10 | 11 | **42** |
| 4 | arrayMutation | 26 | 0 | 0 | 0 | **26** |
| 5 | matcher | 9 | 0 | 0 | 0 | **9** |
| 6 | date | 8 | 0 | 0 | 0 | **8** |
| 7 | log | 285 | 272 | 4 | 2 | **7** |
| 8 | string | 14 | 0 | 7 | 0 | **7** |
| 9 | routes | 19 | 0 | 18 | 0 | **1** |

Note `log`: 285 sites but only **7 REAL** — 272 already credited through elision. And `routes`: 19 sites, **1 REAL**. Ranking on frozen counts would have put both near the top. This is why the credit ladder exists.

**BUT READ THIS FIRST:** the whole family programme is now outranked by the WIRING DEFECT at the top of the parent list (~46 sites, no new rule, no new vocabulary) — everything except `promise`.

CONSTRAINTS: the live metric is the coverage test's own TOTAL row (**1,695**). Byte-identity is a COUNT — expect **1037/1037**, never the word "held". Do NOT measure against `measure-english.js`'s 31.8%: it classifies bytes in the LABEL region, clause prose is not an input, so it reports 0.0 on every rule and always will. Do NOT use 1,839 — retracted hand sum. `VACUOUS`, `SAYS_NOTHING`, the frozen `isSiteSpecific bare.length >= 2` and `SDD_DERIVE_CHECK` stay untouched; new figures feed NO assertion, gate or exit code.

GOTCHA that cost a run: a script copied into `/tmp/claude-1000/.../scratchpad/` cannot resolve the repo's `typescript` and dies `MODULE_NOT_FOUND`. Run from `tools/repo-dsl` with absolute `require` paths, or set `NODE_PATH` — do NOT npm install. Never run the FULL suite (it has OOM-killed this machine); `statement-kin_

[!] PRESSURE (record only, do NOT escalate): 11 of Block's 18 ungated sites die on the frozen threshold too
      **Third independent finding to dead-end against the same unmade ruling.** Of Block's 18 sites that are NOT gated by the parent `CallExpression`, **11 die against the frozen `isSiteSpecific` predicate** — the escape artifact, where the clause quotes the DECODED string while the statement holds the ESCAPED source:

```
clause:  specify “rounds an artefact reproduced from that button's own expression”
source:  it('rounds an artefact reproduced from that button\\'s own expression', () => {
```

Every one of them already reads correctly as English. Only **4** of the 68 were ever reachable by a Block rule.

That is now: the one-char sites, the route family, and these 11 — all blocked by the same `bare.length >= 2` threshold, all measured, and **RULED 2026-09-04: the threshold stays frozen and the one-char class is a recorded blind spot.** So they are not "awaiting a ruling" and are not actionable at all. Record-only; they rank nothing.

**The rule stands unchanged: the threshold is NOT to be widened, weakened or re-baselined to make anything pass.** The artifacts are counted BESIDE the frozen figure in separately named modules that feed no assertion — that is the whole discipline, and it is holding.

What this item is for: when Amir does pick the ruling up, the cost of leaving it unmade is enumerated here rather than re-derived.
[.] PAUSED WITH EVIDENCE 2026-09-04: promise 45 REAL, but a VERBS row yields ZERO improvements _(s2)_
      **Refused with proof — the system working, not a failure.** Commit `c016576`, comment-only, no renderer change (VERIFIED BY CONSTRUCTION: 86 insertions / 0 deletions across ASSUMPTIONS.md + node-kind-rules.js only).

**Re-measure survived.** The item's 45 was audited on a residual of 657; against the live ladder (REAL 606) it re-counts to **45 sites, 45 REAL, 0 credited/one-char/escape** — `.then` 36, `.catch` 8, `.finally` 1.

**IMPROVEMENT-SITES: ZERO**, not inferred — s2 built the row in a scratch copy and rendered all 45 both ways: **33 clauses change, none improves.** Three measured reasons:

1. **The base is not the value.** Contract is `base + " " + tail`, a noun phrase whose base IS the value — but `x.then(cb)` evaluates to *cb's* result, so "return the result of `calculate` then continued" is false. **12 of 45** are that test shape.
2. **Content sits in a block the phrasebook declines by design.** `ArrowFunction` returns null on a block body; **30 of the 34** gate-open sites have block-bodied callbacks, so `VERB_PREP` has nothing to append.
3. **The surface collides with the rule's own join word.** `verbs.join(" then ")` already spells sequencing, so any `then` phrase stutters — measured, not hypothetical.

**Ceiling is 34, not 45**: 11 refuse at an unknown link *below* the promise link (R-LANG-17 parent gate backwards).

**Needs a continuation SHAPE that can describe a block** — a different rule, gated behind the `Block` work refused in `9025220`. No pressure on `isSiteSpecific`: these clauses quote nothing, generic under any threshold.

Full record: `ASSUMPTIONS.md` §2026-09-04 + the comment at the `VERBS` table in `tools/repo-dsl/engine/node-kind-rules.js`. See metadata for the unreachable-link list.
[.] PAUSED WITH EVIDENCE 2026-09-04: queryBuilder 43 could-fire → ~1 improvement-site, and 22 render FALSE
      **Do NOT write queryBuilder vocabulary rows.** Measured across all 188 family sites (commit `08d5f9e`, comment only — verified BY CONSTRUCTION: 2 files, zero executable lines).

- **43 could-fire → ~1 improvement-site.** Lesson 1 applied: could-fire is not a work estimate.
- **36 of 43 blocked by argument content** the `CallExpression` rule never renders.
- **THE FALSITY FINDING — the reason never to do this, not merely to defer it.** `getManager().save(entity)` renders "the result of `getManager` saved": the base is the MANAGER, the thing saved is the ARGUMENT. The clause asserts something UNTRUE. That shape is **22 of 43** (`.save` 13, `.insert` 4, `.update` 5).
- `.orWhere`/`.andWhere` produce contentless repetition ("narrowed then widened then widened…") because the WHERE clauses are string arguments.

Exit is not a better row — it is **a rule that can render arguments**, filed as Amir's ruling on the parent list. See ASSUMPTIONS.md 2026-09-04 §"The vocabulary-row approach has a CEILING" and `tools/repo-dsl/engine/node-kind-rules.js` §"THE CEILING ON VOCABULARY ROWS".

Live remainder of this chapter: the `date` + `string` item, promoted to the top of the parent backlog.
[.] PAUSED WITH EVIDENCE 2026-09-04: arrayMutation 26 → 0, log 7 → 0, routes 1 → 0 improvement-sites
      **Do NOT write rows for these three families.** Measured across all 188 family sites (`08d5f9e`, comment only).

- **arrayMutation: 26 could-fire → 0 improvement-sites.** 25 of 26 blocked by argument content (`list.push(item)`); the single base-alone site *regresses*.
- **log: 7 could-fire → 0.** All 7 blocked by argument content.
- **routes: 1 could-fire → 0.** `Promise.all` renders "`Promise` for every route" — a method name colliding across families, which is a second way a row goes wrong.
- `.every`/`.includes`/`.comparedTo`/`.getAll` **trail off mid-phrase** ("return `documentNames` all satisfying") because `VERB_PREP` has nothing renderable to append.

A row here does not merely say less — see the falsity finding on the queryBuilder item: a row can make a clause FALSE. Lesson 1: 26/7/1 are could-fire counts, never work estimates.

The `date` (8 sites, zero arguments, base IS the value) and `string` (7) halves of the old brief are DIFFERENT IN KIND and stay live — promoted to the top of the parent backlog as their own item.

Evidence: ASSUMPTIONS.md 2026-09-04; `tools/repo-dsl/engine/node-kind-rules.js` §"THE CEILING ON VOCABULARY ROWS".
[.] PAUSED WITH EVIDENCE 2026-09-04: matcher 9 could-fire → 0 improvement-sites (was: declined by design)
      **Do NOT write matcher vocabulary rows.** The earlier read — "declined by design, needs new SHAPES" — is now measured: `toHaveBeenNthCalledWith` (4) + `mock*` (5) = **9 could-fire → 0 improvement-sites**.

- All 9 sit in bucket A1: the content is in NON-FUNCTION arguments the `CallExpression` rule never renders — `expect(x).toHaveBeenNthCalledWith(2, …)` is *entirely* arguments.
- The matcher rows **trail off mid-phrase** because `VERB_PREP` has nothing renderable to append.

So "needs new shapes" was right, and the shape it needs is the same one everything past `date`/`string` needs: **a rule that can render arguments** — filed as Amir's ruling on the parent list. Not vocabulary, and not a task until he rules.

Lesson 1: 9 is a could-fire count. The improvement-site re-measure is 0, and a re-measure of 0 that closes an item with no code change is a good result.

Evidence: ASSUMPTIONS.md 2026-09-04; `node-kind-rules.js` §"THE CEILING ON VOCABULARY ROWS". Commit `08d5f9e`, comment only, verified BY CONSTRUCTION.

_4 done_

## standing policy — read before quoting ANY number — reference

_Procedural memory for the sdd-engine lane. These were living in the parent list's `metadata`, which **no tool can read back** (`lists_view` never returns list metadata, and a metadata write replaces the whole object — so migrating blind would destroy it). They live here instead, where they are readable. Nothing here is work; it is what a future reader must know before touching a number or a renderer._

- LESSON 2 — a differential is NECESSARY BUT NOT SUFFICIENT; read the changed clauses individually
      **The rule:** A full-corpus differential tells you *how many* clauses moved. It does NOT tell you whether they moved the right way — nor how BIG the class is. Reading every changed clause against its source is what catches a cut that improves the sites you were looking at and regresses the ones you were not.

**The evidence (condGloss negation trap, `d41b064`, 2026-09-04):** the obvious guard — decline whenever the inner clause contains `" and "` / `" or "` — changed **25 clauses: 19 REGRESSIONS against 6 improvements.** `P.list` joins with `" and "`, so ``"`Array.isArray` and `ctx.request.body` passes `isArray`"`` is a SINGLE PREDICATE OVER A LIST, not a conjunction:

- before: ``when `Array.isArray` and `ctx.request.body` fails `isArray`, add created`` ← CORRECT
- after: `if a condition holds, add created` ← WORSE

All six known inversions were among the 25, so **every aggregate reads that cut as SUCCESS.** Only reading all 25 against their sources says otherwise.

**SECOND INSTANCE, 2026-09-04 — A DIFFERENTIAL ALSO UNDER-STATES A CLASS.** `f1bb87c`'s differential showed **6** sites of callee-listed-as-its-own-input; the corpus-wide census (`9a5a4b1`) measures **58 across 37 files**. The 6 was NOT wrong — it was LOCAL: **a differential reports what MOVED, not the size of the class.** Never quote a differential figure as a class size. See imtn62dqf7c2062.

**Corollary:** pairs with the CLAIM-TYPE rule. Together: an attribution count is not a work estimate, and a differential is neither a correctness proof nor a census.
- LESSON 1 — "could speak here" is NOT a work estimate
      **The rule:** a count of sites where a rule *could* render something is not a count of sites where rendering it would be an IMPROVEMENT. Re-measure as improvement-sites by full-corpus differential, diffed on clause text, with every change read individually.

**The evidence:** five re-measures moved a figure — 114→35 · 45→0 · 4+~3→**13** · 20→**43** · 12→**17/39**. **Two moved UP.** Direction is not predictable, so the re-measure cannot be skipped on the grounds that the estimate looks conservative.
- CLAIM TYPE — attribution-model counts vs rendering-path counts
      > "An attribution-model count says where a site's silence is ATTRIBUTABLE; it does not say that fixing that attribution will change the rendered clause. Only a differential says that."

**ATTRIBUTION-MODEL** = `phrasebook-worklist.js` walking `headOf` → `blockersOf`, calling `NKR.render` on the head DIRECTLY. That is: the whole family table, every worklist per-kind REAL row, the 174/50/8/360 partition, the ceiling census 88/49/51, and all seven census buckets.

**RENDERING-PATH** = a full-corpus differential through `spanActions`, the path that actually writes the `.en` files. That is every improvement-site figure (13, 43, 22, 20, 1, 61-refused, 33, 6, 0), plus byte-identity and the coverage TOTAL row.

**Every reach figure on the parent list except the improvement-site figures is an attribution-model count, and NONE may be treated as a WORK ESTIMATE until it has been through a differential.** Bucket 7 is the proof they diverge: the model said 9 sites were blocked on `BinaryExpression`'s vocabulary and was RIGHT that they were — but `spanActions` never asks that rule for an `if` condition, so the implied fix moved **1** clause, not 9. The 20 that did move arrived through `condGloss`, which the attribution model does not model at all. The family table's PAUSED entries already survive this test — do not disturb them.
- DEAD METRICS — never quote these numbers
      **`measure-english.js`'s 31.8% reads-as-English figure is structurally blind to phrasebook work.** It classifies BYTES IN THE LABEL REGION; clause prose is not one of its inputs, so it reports **0.0 delta on every rule and always will**. Never ask a session for a delta against it. The metric for phrasebook work is the **corpus GENERIC COUNT, read fresh from the coverage test's own TOTAL row**.

**Retracted or superseded generic counts — do not quote:** 1,839 · 1,756 · 1,729 · 1,695 · 1,659 · 1,654 · 2,284. Also retired: 1654/601/369 (superseded by 1645/592/360). Read the TOTAL row FRESH every time rather than carrying any of these.
- VOCABULARY PROGRAMME IS CAPPED — and a vocabulary row can make a clause FALSE
      **The cap:** the `CallExpression` rule renders exactly two things — the **BASE**, and via `VERB_PREP` an arrow callback whose body is an **EXPRESSION**. Everything else in the call is discarded. `ArrowFunction` declines block bodies by design (`if (!body || ts.isBlock(body)) return null`).

**Census across all 188 family sites, disjoint, overlap 0:** **88** have content in non-function ARGUMENTS the rule never renders · **49** in BLOCK-BODIED callbacks declined by design · **51** base-alone.

**THE CAP STANDS AND IS UNAFFECTED.** queryBuilder / arrayMutation / matcher / log / routes remain PAUSED WITH EVIDENCE on THINNESS — measured zero improvement-sites — a reason never to do the work, not a reason to defer it.

**FALSITY EXAMPLE RETIRED 2026-09-04 — CHECKED AND DISPROVED. Do not re-derive it.** This entry used to cite `getManager().save(entity)` → "the result of `getManager` saved" as proof a vocabulary row can render something FALSE, on 22 of queryBuilder's 43. **That clause does not exist anywhere on HEAD** (`9a5a4b1`): 1,025 statements mention queryBuilder/getManager/createQueryBuilder and exactly ONE renders "the result of `X`" — subscription.ts:65, which names the RIGHT subject. The real site, FreshbooksLedger.ts:103, renders "await `save` into `saveResult`" through the **VariableStatement** rung, not this rule. Argument discard IS real (1,549 chains drop a non-callback arg) but what they drop is SEPARATORS AND SEEDS, where the base IS the subject — **OMISSION, not MISNAMING.**
- LADDER SOURCE — the only valid metric source, and the FROZEN BASELINE
      **Only valid source for the generic count:** the coverage test's own **TOTAL row** (`statement-kind-coverage.test.js`), read FRESH. Nothing carried, ever.

**What is frozen is the METRIC DEFINITION, not the file:** `SAYS_NOTHING` and its strings · VACUOUS's 13 strings · `isSiteSpecific`'s `bare.length >= 2` · every existing assertion, gate and exit code · the published series. **Byte-for-byte in practice: `engine/clause-quality.js` ONLY.** `enfile.js` and `statement-kind-coverage.test.js` are NOT and never were — both have changed (`4ffd7cb`, `4357715`).

**The rule the freeze exists for:** *a fall in the count must never be manufactured by redefining what counts.* So the metric is NEVER redefined in the same commit as a drop in the count, and a renderer change goes on its own commit.

**Credit-module shape:** a separately named module whose `>= 2` is **written out rather than imported** (so the two can disagree), printing BESIDE the published series, feeding **no assertion, gate or exit code**.

**Guardrail reporting:** byte-identity is asserted before AND after every render-touching step and reported as a COUNT (`1037/1037 FAILURES 0`), never the word "held". If it ever leaves 1037/1037 — **STOP and report**; never adjust anything to recover it.
- TOOL GAP — list `metadata` is WRITE-ONLY in practice; do not put binding policy there
      **The defect:** `lists_view` never returns a LIST's `metadata`, and a metadata write REPLACES the whole object. So policy stored in list metadata cannot be read back, and cannot be safely added to — appending a key means overwriting the ones you cannot see. A split correctly REFUSED to do that on 2026-09-04 rather than destroy `vocabulary_closed` / `dead_metrics` / `lesson_1` / `claim_type_rule` / `ladder_source` irrecoverably.

**The fix, applied:** binding policy lives in THIS reference sub-list, where it is readable. The parent list's `metadata` may still hold those keys — treat it as unreadable residue, not a source. If it ever needs reconciling, that is a deliberate task with the content reconstructed from here, not a blind write.

**TRUNCATION — settled 2026-09-04, and the two conflicting reports reconcile:**

- **ITEM writes (title + description) DO report `truncated`.** Two splits confirmed it independently; one saw three of its own item writes flagged and trimmed until clean.
- **A LIST-description write does NOT.** Confirmed DIRECTLY on the main loop, not inferred: an over-long parent-description write returned only `descriptionSet: true`, and the read-back showed the stored text **cut mid-word** ("…has been "). The original warning was right about this case and wrong to generalise it to items.

**Operational rule, unchanged by the correction:** cap is ~2000 chars; measure before writing, and **READ BACK every description write** rather than trusting the response — that read-back is what caught the cut above. Prefer a short description that POINTS at the authority (a file §, a commit, an item) over a long one that carries it — e.g. the inversion census lives in `ASSUMPTIONS.md` § "THE INVERSION SWEEP" at `998c0ca`, and the item points there.

**Also:** `workshop_run` refuses any heredoc containing absolute paths, so lengths cannot be pre-measured there. Estimating length by eye ran ~30% low in practice — one split burned four writes that way.
- THE METRICS ARE BLIND TO FALSE CLAUSES — an inversion is counted as SUCCESS
      **Every figure we publish is blind to a clause that is confidently WRONG.**

**RUNNING TOTAL of confidently-wrong clauses found so far: 32 polarity (fixed in `f1bb87c`) + 340 naming (UNFIXED, census `9a5a4b1`) = 372** — every one of which was or is counted as a **SUCCESS** by the published figures. **Two sweeps, two classes, and both were invisible. NO ONE HAS YET ASKED WHAT OTHER CLASSES OF CONFIDENT WRONGNESS EXIST — that is an OPEN question, not a closed one.**

**Polarity (32, found at `998c0ca`, `isGuardThrow` enfile.js:971-976):** 26 INVERTED, 5 FALSE, 1 naming a subject absent from the condition. Breakdown corrected at `f1bb87c` from 25/5/2; **the 32 total did not move.**

**Naming (340, census `9a5a4b1`, see imtn5amiw19b844):** C1 loop subject from the loop body 60/65 · C2 one arbitrary call for a whole try block 190/230 · C3 callee listed as its own input 58 · C4 return named from part of a compound expression 32.

- **Not one is visible to any published figure.** Each QUOTES AN IDENTIFIER THAT IS IN THE STATEMENT, so `isSiteSpecific` scores it SITE-SPECIFIC — counted as **the good outcome**, inside the **32,211**. (C4 is the exception: no quoted run at all, so it sits in the generic **1,645** — read as THIN, not as WRONG.)
- Byte-identity, the five artifact credits, the coverage percentage and the REAL ladder are **ALL BLIND** to this. A rising site-specific count is not evidence of truth.
- **Corollary for any fix:** removing a false quote makes the numbers look WORSE (generic rises, site-specific falls). That movement is a TRUTHFUL CORRECTION, not a regression — never tune a cut to protect the count.

**METHOD NOTE** — its own entry: per-mechanism construction analysis found the 32 where incidental reading had found 4.
- METHOD — ask per mechanism CAN IT DO THIS BY CONSTRUCTION; do not sample first
      **The most productive method on this lane. Use it BEFORE any sampling.**

For a defect class, ask of EVERY mechanism that could produce it: *can it do this BY CONSTRUCTION?* A mechanism that provably cannot is CLEARED and needs no sampling; only the ones that CAN get enumerated.

- **The result that settled it** (inversion sweep `998c0ca` → fix `f1bb87c`): per-mechanism analysis found **32** defects. Reading clauses INCIDENTALLY while doing other work had found **4**. Thirteen mechanisms cleared by construction, ONE did not — and that one held **eight times** as many defects as incidental reading had found.
- **Enumerate exhaustively where the population is bounded.** The bad mechanism's 52 sites were all read against source, not sampled — which is also how the census's own breakdown was corrected from 25/5/2 to 26/5/1 at `f1bb87c`.
- **Say WHY for each clearance.** A clearance is a claim about construction and must be readable as one; "cleared" with no reason is not evidence.
- **CENSUS FIRST, fix in a LATER commit** — cleared-by-construction vs needs-checking vs defects found. **A CLEAN CENSUS IS A VALID, VALUABLE OUTCOME** and is never to be padded into work.
- **SECOND APPLICATION 2026-09-04:** the SUBJECT-FIDELITY sweep (imtn5amiw19b844) — clauses that name the WRONG THING. Same method, different defect class; its two known instances were both found BY ACCIDENT, which is exactly the signal that a per-mechanism sweep is owed.
- AMIR'S RULING 2026-09-04 — names must FIT THE GRAMMAR; the goal is the WRITE direction
      **HIS OWN WORDS, VERBATIM (2026-09-04, his spelling kept — do not fix it, do not paraphrase, do not relabel):**

> "I want to be able to type English and get deterministic code. If grammer rules is the answer then that's what we do. And we do our naming of our patterns in a way that fits the grammer then"

**Everything below is MY READING of that ruling, NOT his words.**

**1. NAMING IS SUBORDINATE TO GRAMMAR, not parallel to it.** A name is chosen so that it slots into a production — the spelling of a NONTERMINAL that the grammar expands — not as a finished string that replaces a rendered clause. This is already the PRD's stated shape (R-LANG-11: the model emits one lexical token per dictionary entry, the spelling of a nonterminal, and nothing else; R-LANG-15: a naming run must be structurally inert modulo names or it is refused). His ruling makes it the ORDERING PRINCIPLE rather than merely a constraint on the model's output format.

**2. IT EXPLAINS THE PILOT REGRESSION AND CHANGES WHAT TO DO ABOUT IT.** PRD Q-9 §5D.3F §2d: 80 leaves named, 80/80 accepted, gate PASSED; applying them stripped 72% of the corpus's concrete identifiers (27,673 → 7,644 across 982 files; 975 lost, 0 gained); reverted. The recorded cause is structural — a leaf NAME is hole-free, a RULE is hole-filled. Two readings, both recorded: **(a)** the recorded, weaker one — spend the model only where rules do not reach (the rule-coverage filter, imtmx2m4635f4c3); **(b)** the STRONGER claim that follows from his ruling — a name must be GRAMMAR-SHAPED, i.e. it must EXPAND rather than REPLACE. **(b) is NOT settled PRD text.**

**3. CHUNK NAMING IS THE LEVEL WHERE THIS BITES.** R-LANG-18/19 collapse a recurring run of similar statements under ONE named word for the whole chunk — the level the try-block question lives at (190 of 230, `enfile.js:1335`, item imtn62dqg5f9d5d). So this ruling is the BEGINNING of an answer to that question, not its closure: that item stays OPEN and stays his.
- AMIR'S RULING 2026-09-04 — R-PAY-6 ids are DETERMINISTIC and DERIVED FROM THE PATTERN
      **HIS OWN WORDS, VERBATIM (2026-09-04 — do not paraphrase, do not relabel, do not 'improve' the framing):**

> "You need to make deterministic ids based on the pattern and then that's how you relate to the word or phrase"

**Everything below this line is MY READING of that ruling, NOT HIS WORDS.**

- The id is **derived from the pattern itself** — content-addressed on the pattern's own structure — so a re-mine that finds the same pattern derives the SAME id.
- **Mining order stops being an input.** The array indices renumbered by every re-mine (the R-PAY-6 defect) cease to exist as a concept rather than being stabilised.
- The id is the **relation key** between the pattern and its word/phrase. "that's how you relate to the word or phrase" — the id is what the word/phrase hangs off, not a label handed to the word/phrase afterwards.

**What this changes on the backlog (MY READING).** R-PAY-6 (`imtmx2m46bcf9c4`) was *gated, undesigned* — the open design question inside it was what the id should be a FUNCTION OF. That question is now answered by Amir. The item becomes **designed by Amir, unimplemented**. Unchanged: its deps (A5/A1, `imtjiez8zf61af5`) and its GATES AMIR'S STATED GOAL block. Gone: the design hole.

**Still open, and MINE not his:** collision behaviour — two genuinely DIFFERENT patterns deriving the same id. His ruling does not speak to it. Whoever implements it must name what the id is a function of and what it collides on, not hand-wave it.

**Sits with** the sibling ruling item `imtn71hi9e03f35` (names must FIT THE GRAMMAR): naming is subordinate to grammar, and the id is subordinate to the pattern.
- WORKED EXAMPLE 2026-09-04 — MEASURE a metric BEFORE you assert it, and let the repo win
      **The policy: a metric must be MEASURED before it is written into an assertion.** An asserted metric you have not measured is either a red gate you cannot act on or, worse, a green one that measures the wrong thing.

**The worked example** (`bd89c64`, Entity round-trip). Leg 2 of the corpus check was SPECIFIED as `emitEntityCanonical(parse(s)) === ts` against the corpus file's own bytes. Measured first: **0 of 58 — and not one of the 58 was a grammar defect.** It compares CANONICAL output to NON-CANONICAL corpus bytes, so it measures how the corpus was TYPED (unmodelled imports, inline `export enum`s, blank lines, a redundant `@Column({ name })` the emitter correctly drops) — not whether the loop closes. Asserting it would have pinned 0/58 forever with nothing to fix.

**What was done instead — both halves matter:**
1. It was **printed as a number and labelled `REPORT ONLY`**, not deleted. The measurement is still visible; it just is not a gate.
2. **A checkable form of the SAME claim was asserted in its place** — the TypeScript leg of AT-ARCH-1 exactly as §3 already states it, corpus-wide. It catches every failure the specified leg would have caught and none of the noise it would have manufactured.

**THE REPO WINS OVER THE BRIEF.** The specified leg was wrong about this repo, and the correction was recorded loudly rather than the number being quietly reported as a failure or the assertion quietly weakened.

**Companion:** an argument in a code comment is not a measurement either — see the construction probe that disproved the parser's own injectivity comment, [[entity round-trip — build log]].

## PHRASEBOOK RULE PROGRAMME — to 99% of node instances — tasks

_**Amir, 2026-09-04: "Finish it."** The phrasebook rule set is a set that CAN be finished. This sub-list is the lane's spine until it is.

**THE BUDGET (PRD Q-9 §5D.3C):** **8 / 19 / 28** rules for **50 / 80 / 90%** of node INSTANCES; **53** for **99%**. The corpus exercises **100** of TypeScript's **~400** SyntaxKind values.

**THE MODEL (R-LANG-16, R-LANG-17):** rules are keyed to AST **NODE KINDS**, one rule per kind, cardinality a parameter, composing recursively; an **UNRULED KIND FALLS BACK to today's output**, so each rule ships ALONE and nothing regresses.

**THE HONEST CEILING — do not forget this mid-programme.** Of the **592 REAL mute sites** the attribution is **vocab 174 / UNRULED KIND 50 / BOTH 8 / NEITHER 360**. **NEW RULES REACH ONLY THE ~50.** And that 50 is an **ATTRIBUTION-MODEL count, NOT a work estimate**, until it has been through a rendering-path differential — bucket 7 said 9 and the real movement was **1**. The **174** are mostly the argument-rendering decision (88 sites, BLOCKED on Amir). The **360** have no head expression at all.

So: the budget is the map of the *kind space*; the 50 is the map of *this corpus's mute sites*. They are different measurements and must never be conflated in a brief.

**BINDING:** [[standing policy — read before quoting ANY number]] governs every number quoted out of this sub-list. TRUTH OVER COVERAGE always: a rule that raises the count by saying something vaguer or wronger is a REGRESSION even though the number improves. Refusing with evidence is a RESULT, not a failure.

**IF ANYTHING I SAY CONTRADICTS THE REPO, THE REPO WINS** — say so plainly rather than reconciling quietly._

[~] IN FLIGHT — PROMISE VOCABULARY (.then/.catch/.finally, attribution-model REAL 45) _(s2)_
      **Briefed to s2 2026-09-04 as the next item, chosen over PrefixUnaryExpression (attribution-model REAL 36).** Three reasons, in the brief: it is the larger attributed prize; it is on the **ruled-but-declining** side where the REAL 210 lives; and **R-LANG-16 requires the vocabulary regardless** (no second rule may be written for an already-ruled kind, and CallExpression is ruled).

**Scope:** CallExpression's promise family — `.then` 36, `.catch` 8, `.finally` 1. Attribution-model REAL 45, **NOT a work estimate**.

**Terms it was briefed under, same as a rule:** ONE commit · measured by a **FULL-CORPUS RENDERING-PATH DIFFERENTIAL**, never the attribution model · **every changed clause read individually against its source** (LESSON 2 — a differential is necessary but NOT sufficient) · regressions reported SEPARATELY from improvements · **NOT SHIPPED if net negative**.

**Pre-authorised:** a truthful DECLINE beats a better number. If a promise callback cannot be described truthfully, declining is the CORRECT outcome and is not counted against it.

**Warned explicitly:** the metrics are BLIND to false clauses — an inverted or false clause still quotes an identifier, so `isSiteSpecific` scores it site-specific and it counts as a SUCCESS (running total of confidently-wrong clauses: 372). So it must ask, PER MECHANISM, 'can this construction emit something FALSE' BEFORE it samples.

Also carried: Amir's grammar ruling (hole-filled output, rule beats name, name must be grammar-shaped).
[ ] CENSUS RESULT (evidence, no work) — the STEP 1 numbers, ALL ATTRIBUTION-MODEL unless stated
      **Landed `397cf9c`, VERIFIED by `git_diff 397cf9c~1`: ASSUMPTIONS.md ONLY, 152 insertions / 0 deletions, no engine file.** Measured on HEAD `d909c2f`.

**CENSUS (instance count, not attribution):** 101 structural kinds · 306,855 instances · 1,037 files. Method drops `*Keyword`/`*Token`/`Identifier`/`PrivateIdentifier`/`SourceFile`, KEEPS literals — reproduces the PRD's own. **Ladder 50/80/90/95% = 8 / 19 / 28 / 37: the PRD's four CONFIRMED.**

**TWO CENSUSES LIVE — NEVER CONFLATE.** `phrasebook-worklist.js:109` `isStructural` = `kind > LastToken` EXCLUDES literals: **94 kinds / 273,054, ladder 8/18/27/34/50**. Driver prints 95 only because `census(sf)` counts `SourceFile`. Different SETS, not a drift.

**⚠ EVERY FIGURE BELOW IS ATTRIBUTION-MODEL — NOT rendering-path, NOT A WORK ESTIMATE.** Bucket 7: attribution 9, rendering path moved 1.

**Unruled — of 92 unruled kinds exactly 8 block any residual generic site, 84 block none. Total REAL 62:** PrefixUnary 36 · New 15 · SpreadAssignment 4 · PropertyAssignment 3 · TypeOf 2 · Parameter 1 · Block 1 · PostfixUnary 0.

**Instance rank ≠ work rank.** The five largest unruled kinds (StringLiteral 28,260 · PropertyAssignment 23,326 · VariableDeclaration 13,261 · VariableDeclarationList 13,033 · FirstStatement 12,986) carry **0/3/0/0/0** attributable residual sites — `spanActions` already renders them.

**THE FINDING THAT REORDERS THE PROGRAMME — ruled-but-DECLINING is REAL 210, over 3× the whole unruled worklist, and needs VOCABULARY not rules (R-LANG-16):** CallExpression 182 (unclassified 47 · promise 45 = .then 36/.catch 8/.finally 1 · queryBuilder 43 · arrayMutation 26 · matcher 9 · log 7 · string 4 · routes 1) · Binary 20 · ObjectLiteral 4 · Conditional 2 · Arrow 1 · ElementAccess 1. Declines MEASURED per instance: Call 89.2% · Arrow 59.5% · Binary 22.8%.

**Byte-identity as a COUNT: 1037 / 1037 / FAILURES 0.**
[ ] ⚠ FIGURE CONFLICT — two different LIVE LADDERs on record; neither may be quoted until read FRESH
      **Found while landing `397cf9c` 2026-09-04. Do not carry either figure.**

- This backlog's LIVE LADDER (parent list description, HEAD `f1bb87c`): 33918 · site-specific **32211** · generic **1645** · unruled 62 · **43 passed, 9 failed**.
- s2's `397cf9c` ASSUMPTIONS entry, measured on HEAD `d909c2f`: 33918 · site-specific **32209** · generic **1647** · unruled 62 · **42 passed, 10 failed**.

Two statements sit on opposite sides, and the test tallies differ by one. **This is a STALE-FIGURE conflict, not a byte-identity failure** — byte-identity reads 1037 / 1037 / FAILURES 0 in both, so it is NOT a stop-and-report.

**Resolution, per LADDER SOURCE policy:** the only valid source is the coverage test's own **TOTAL row, read FRESH** — never a carried figure. s2 has been asked to read it fresh at the top of the promise-vocabulary turn (it must run the corpus for the differential anyway) and to report which HEAD it read on. **Update the parent list's LIVE LADDER from that fresh read, and delete this item.**

_2 done_

## R-PAY-6 scope — reference

_The measured scope of R-PAY-6 (`imtmx2m46bcf9c4`), from the live corpus at commit d581fb8. One entry per finding, because the parent item's description caps at ~2000 chars. Full prose in ASSUMPTIONS.md §"R-PAY-6 — DESIGN AND SCOPE, from the repo (2026-09-04)"._

- (a) The id allocator — `wordlzw.js:141` is the one that ships
      Two sites, one allocator, both `engine/wordlzw.js`:
- `:62` — `addEntry`, in `build`
- `:141` — `add`, in `buildSaturated`

`build-lzw-generators.js:153` calls `buildSaturated`, so **`:141` is the one that ships**.

Both are `const id = dict.length` — a function of **nothing but how many entries came first**. Pure mining-order position.

`verify-register.js:703,1931` already documents this in those words.
- (b) THE TRAP — do NOT hash the entry's `key`; it is not content
      **The single thing an implementation must not do.**

A dict entry is `{ id, symbols, key, prefixId, appended, len, freq }`. `key` is `symbols.join(",")` over **symbolIds**, and a symbolId comes from `idOfSym.set(s, symOfId.length)` — **first-seen order, the same defect one level down.**

So hashing `key` **reproduces the bug under a new name** — and **the repo already does this once**: `engine/pipeline.js:93` builds `"g_" + e.len + "_" + sha256(e.key)[0:6]`, a hash of the order-dependent csv.

**The real content is one dereference away**, present at the site:
`symbols.map(i => symOfId[i])` — each is `G.keyOf(parts)` (`engine/generators.js:23`), i.e. literals plus `‹type›` hole markers, **no index anywhere in it**.

**THAT ordered list of skeleton strings is "the pattern".**
- (c) TWO collision risks — separator injection, and truncation width
      Proposed form: `sha256(symbols.map(i => symOfId[i]).join(<sep>))`, truncated. Two risks, **only one of which is the hash**.

**1. SEPARATOR INJECTION — no hash width fixes this.** A skeleton may contain any literal from the source. If the joiner can occur inside a skeleton, `[A, BC]` and `[AB, C]` hash **identically** — a collision between genuinely different patterns produced by the ENCODING, not by chance. **Length-prefix it, or use a byte no skeleton can contain.** This is a build requirement.

**2. TRUNCATION WIDTH**, bounded from the shipped artifact (`counts.dictEntries`, `sen/catalog/generators-lzw.json`): narrow **126,348**, wide **118,447**. P(≥1 collision):

| width | n=126,348 | n=244,795 shared |
|---|---|---|
| 24 bits — `pipeline.js:93` today | **100%** | **100%** |
| 40 bits — §20 `sha256-10` as hex | 0.723% | 2.688% |
| 64 bits — `word-names.json` today | 4.3e-10 | 1.6e-9 |
| 80 bits — `sha256-10` as bytes | 6.6e-15 | 2.5e-14 |
- (c′) THE REPO WINS OVER PRD §20 — the safe 64-bit scheme already exists here
      **If §20's `sha256-10` means ten HEX CHARACTERS, the repo wins.** 40 bits is not safe at this dictionary size — 0.723% / 2.688% — and **for a payload reference a collision is a WRONG-BYTES COMPILE, not an error.** §20 does not state the unit. (Amending it is filed as `imtn7vzsl0760e6`.)

**The safe scheme is already implemented in this repo:**
`engine/artifact-contract.js:96` — `word-names.json`, *"hand-authored names, keyed by content hash and never by word id... key `w:`/`n:` + sha256(sym)[0:16]"* — **64 bits**.

**Amir's design is already implemented FOR NAMES; it was simply never applied to the payload ids.** The work is to apply an existing scheme, not to invent one.
- (d) Migration surface, measured — and it cuts BOTH ways
      Measured on the live corpus, not estimated. Payload marker is `⟪lzw1 <axis><id>⟨` (`enlzw.js:181,300`).

```
.en citing a word id ............... 1034 of 1037
total citations .................... 9724
distinct ids cited ................. 4643  (all narrow; wide cited 0 times)
.en naming a dictionary fingerprint ... 0
engine/tool files touching a word id .. 12  (17 read/write sites)
```

All 1,034 must be re-rendered or rewritten.

**BOTH WAYS — note this before anyone calls content-addressing the expensive option:** 0 of 1,037 `.en` name a fingerprint, so **R-PAY-6's option (a), fingerprint-stamped `.en` with a refusing compile, is an equally corpus-wide migration.** Content-addressing is NOT the more invasive of the two.
- (e) AT-ARCH-1 stays CHECKABLE — but loses the failing case §20 cites for it
      **It stays checkable and does NOT go vacuous — but it loses its cited justification, and that is a real cost.**

**Not vacuous:** `en₁` is computed from `ts` and `D′` alone and **never sees `en₀`** (§20 §2) — exactly what `R-ARCH-4`'s tautological `byteIdentical: 100%` lacked, since `checkTiling` re-slices the source and rejoins it and so could not fail. Nothing in this scheme makes `en₁` a function of `en₀`.

**But:** §20 lists four things AT-ARCH-1 catches, and **reason 2 IS R-PAY-6** — *"payload ids are array indices renumbered by every re-mine. Under AT-ARCH-1 that renumbering changes `en₁` and the test goes red. That alone justifies the gate."* **Fixing R-PAY-6 removes that red.**

The other three stay live: arbitration instability, canonicalizer drift, extractor bugs of the `parseRelationArgs` class.

**So the negative control becomes the ONLY proof the gate can fail — it matters MORE after this change, not less.** Filed as `imtn7vzsl4bece5`.
- THE HOLE, NAMED — closes RENUMBERING, not RE-SEGMENTATION
      Amir's line is right, and it closes **renumbering**: the same pattern, found again, gets the same id.

It does **not** close **re-segmentation**: whether the same pattern is found again **at all**.

`buildSaturated` admits a window only when `e.count >= createGate` over the **whole corpus** (`wordlzw.js:152`), and `usageCounts` then segments **greedily longest-match** over the full grown dict. Dictionary membership is therefore a function of corpus-wide recurrence:

**Add or edit ONE file and a pattern that cleared the bar may stop clearing it, or a longer pattern may supersede it.** The referenced word is then **not renumbered — it is GONE**, and no id scheme can save the `.en`.

§20's own **reason 3** — *"canonicalizer drift: a change that alters skeletons shifts the segmentation and the `.en` moves under a corpus nobody edited"* — is **untouched by this fix and survives it**.

**VERDICT: R-PAY-6 as designed is NECESSARY AND NOT SUFFICIENT for authoritative English.** Build it. **Do NOT call it "the fix that lets a hand-edited `.en` survive a re-mine".** That needs a second decision, which is Amir's: `imtn7vzsl0dca7e`.
- Provenance — commit d581fb8, verified record-only
      All figures above are measured from the live corpus unless labelled otherwise.

**Verified independently (not taken on the session's word), 2026-09-04:**
- `git diff d581fb8^` → **one file, `skills/sdd-engine/ASSUMPTIONS.md` only**. No engine file touched.
- `git diff -- engine/` → **empty**.
- `git diff` and `git diff --staged` → **empty** (working tree clean; d581fb8 is the tip).

**Byte-identity: 1037 files / 1037 byte-identical / FAILURES 0.**

Branch `spec-driven-dev`, **nothing pushed** — pushing is Amir's alone.

Full prose: ASSUMPTIONS.md §"R-PAY-6 — DESIGN AND SCOPE, from the repo (2026-09-04)".

## grammar-parser scope — reference

_Design findings for the §5E.3.2 "grammar parser" item, from the repo (2026-09-04, commit 28100a9, ASSUMPTIONS.md only, engine untouched, tree clean). TWO REFUSALS are the headline: (1) this is BIGGER than R-PAY-6; (2) §5E.3.2 DOES NOT SPECIFY ENOUGH TO BUILD FROM — it specifies a grammar, not a parser. Parent item: [[sdd-engine backlog]] imtmx2m460b8ef9._

- REFUSAL 1 — the general parser is BIGGER than R-PAY-6
      **R-PAY-6 is large but every piece of it EXISTS** (the 64-bit scheme is `artifact-contract.js:96`): a change of id derivation plus a corpus-wide re-render.

**The grammar parser is not like that.** It requires **English to become a function of the GRAMMAR instead of a function of the compiled `.ts`** — across a 126,348-entry dictionary, while holding 1037/1037 byte-identity. That is a REWRITE of the render path, not an addition to it.

- Nothing in the tree implements a production renderer on the `.en` path.
- §5E.3.2 does not describe that work.

**Conclusion:** what can be built now is the Entity slice (see the smallest-honest-slice item); what CANNOT be built from §5E.3.2 is the thing its name promises. Do not schedule the general parser from §5E.3.2 as written.

Source: `ASSUMPTIONS.md` § "THE §5E.3.2 GRAMMAR PARSER — DESIGN AND SCOPE" (commit 28100a9).
- REFUSAL 2 — §5E.3.2 contains NO parser specification; the item's own title is misleading
      **§5E.3.2 is §3.2 of `tools/prd/20-archetype-hybrid-design.md`, lines 113-180**, titled *"The dictionary IS a grammar; a call is a sentence invoking a sentence"*.

**What it DOES specify:**
- the dictionary-as-grammar reframe (nonterminal = word, production = template, terminal = hole bytes, start symbol = archetype, derivation depth = `hierarchyDepth`);
- a worked Entity/Columns/Column/Relation production set;
- four forced choices: slots bind **BY NAME**; nested nonterminals have **ordered alternatives** (first byte-exact fill wins); variadics are **grammar repetition**; the **id is derived from the production** (the R-PAY-6 link);
- the one constraint that matters: *"two distinct sentences MUST NOT compile to the same TypeScript."*

**What it does NOT contain: a parser specification.** The word "parser" does not occur in §3.2 at all. Every occurrence elsewhere in that document is a FORWARD REFERENCE *to* it — line 393: *"needs the §3.2 grammar parser, which is the larger job"*; line 511, same.

**So "the §5E.3.2 grammar parser" is a NAME OTHER SECTIONS GAVE to work §5E.3.2 does not describe.** §5E.3.2 supplies a constraint on the GRAMMAR, not a design for a parser.

**ACTION:** the parent backlog item should be RETITLED to say the spec does not exist yet — the design pass is "write the parser spec", not "build the §5E.3.2 parser".
- (a) Hand-edit today: detection at enfile.js:2540, honour-first via repairFromSentence:2278
      **Detection** — `enfile.js:2540`, inside `compileChunk`'s **generator branch**: recompile the payload, call `deriveGloss(obj, compiled, cat)`, compare to the written sentence.

**It TRIES TO HONOUR the edit first** — `repairFromSentence`, `enfile.js:2278`. The hole layer's reach is exactly **seven `return null`s**:

```
2288  no per-site holes                       -> nothing to invert
2295  a DIFFERENT NUMBER of quoted tokens
2301  an identifier swapped for a literal     (kind mismatch)
2304  the token came from the TEMPLATE
2306  one token, TWO FATES
2310  the difference is PROSE                 (subs.size === 0)
2316  the closed loop did not reproduce it    (reDerived !== written)
```

**HONOURED:** a same-count, same-kind, position-for-position **rename of a value the payload carries as a hole** (identifier, callee, literal), proved by re-deriving from the repaired payload to the human's exact sentence, byte-for-byte.

**REFUSED LOUDLY (file / written / derived all quoted):** added or reworked prose; restructuring; a changed COUNT of named things; renaming a TEMPLATE token — that is a **NEW WORD**, the miner's job, not the parser's.

**Nothing is silently discarded on this path and nothing is half-applied.**

**DISCREPANCY worth fixing in the prose:** the ASSUMPTIONS.md paragraph says "four explicit `return null`s" and then lists SEVEN. The code and the list are right; the count word is wrong.
- (c) Why a production parse is not available for ORDINARY WORDS
      **English is currently a function of the compiled TypeScript, not of the grammar.**

- `deriveGloss(payload, compiled, cat)` — `enfile.js:2143` — derives the sentence **FROM THE COMPILED TYPESCRIPT** (*"`compiled` is byte-for-byte the slice the renderer labelled"*).
- Dictionary productions are **LZW skeleton sequences**; the English is produced BESIDE them by `spanActions`' prose ladder, not BY them.

**Therefore a production parse requires ENGLISH TO BECOME A FUNCTION OF THE GRAMMAR** — a rewrite of the render path under 1037/1037 byte-identity, not an addition to it.

- `renderProduction` exists **only** at `refine-language.js:202` (a refinement TOOL) — **OFF the `.en` path**; nothing on `.en` calls it.

**The only mechanism the repo's structures support for ordinary words is match-against-rendered-candidates** — which is what `repairFromSentence` already is, in its degenerate positional one-substitution form. **Generalising it means enumerating 126,348 dictionary entries crossed with hole fills that are ARBITRARY SOURCE BYTES.** That space cannot be enumerated — which is precisely why the current code matches positionally.

**THE ARCHETYPE LAYER IS THE EXCEPTION:** `engine/entity-sentence.js` is a **SHIPPED 223-line hand-written recursive-descent parser** (one regex per production) whose `parse` and `render` **ARE INVERSES**. It is wired into `new-archetype.js` ONLY — `grep -rl entity-sentence` returns that, the module, and its test. **Never the `.en` compile path.**
- (d) AMBIGUITY: none found, and the negative is BOUNDED — measured over 58 corpus sentences
      **Measured, not reasoned about.** 75 files under `entities/`, **58 produce a sentence**:

```
render(parse(sentenceFromSource(ts))) === sentence :  53 / 58
failures                                          :   5
distinct entity sources rendering the SAME sentence:  0
```

**Ambiguity search, stated exactly:**
1. all 58 corpus sentences compared **pairwise** — **0 collisions**;
2. five construction probes at the plausibly-ambiguous places:
   - `It has many Address.` vs `It has many Addresses.` (the `s?` strip) — **both round-trip, to DIFFERENT models**;
   - `It has <columns>` vs `It has many <Target>` — disambiguated by an explicit `!/^many\b/` guard;
   - the Oxford comma — accepted **either way on parse**, **always emitted on render** (note in code at line 100).

**Result: NO AMBIGUITY FOUND in the Entity grammar**, on 58 real sentences plus 5 probes.

**THE BOUND, recorded explicitly:** this is a bounded negative about **ONE archetype**. It says **NOTHING** about a grammar for ordinary words — which **does not exist yet to test**.
- (e) SMALLEST HONEST SLICE — Entity round-trip, with a non-vacuous check at 53/58
      **Entity, and the CODE says so rather than a preference:** `entity-sentence.js` is the only module in the tree exporting a `parse` that inverts a `render`, and §5E.3.2's own worked production set is the Entity one.

**Subset (the part that already works):** head + `It extends` + column list + the four relation forms — **EXCLUDING inline enum literal lists**.

**The check, named:** a corpus-wide loop over the 58 entity sources asserting BOTH legs per file —

```
AT-ARCH-1 leg :  render(parse(sentenceFromSource(ts))) === sentenceFromSource(ts)
AT-ARCH-2 leg :  emitEntityCanonical(parse(s))         === ts   (byte-identical)
```

- denominator **PUBLISHED (58)**;
- existing negative controls KEPT — `entity-sentence.test.js` already carries the fixpoint turn and the de-register control; R-ARCH-13 already makes `new-archetype.js` exit 2 on failure.

**IT READS 53/58 TODAY on leg 1.** The slice is: make it 58/58 by fixing comma-splitting inside a bracketed enum (**length-delimited, not separator-split**), and publish the count.

**A check whose denominator is stated and whose current value is 53 CANNOT go vacuous the way `byteIdentical: 100%` did.** That is the whole point of choosing it.
- Baseline held: byte-identity 1037/1037, FAILURES 0, engine untouched
      Verified by this split against the repo, **not on the session's word** (2026-09-04):

- `git diff` — empty;
- `git diff --staged` — empty;
- `git diff -- engine/` — **empty**;
- `git diff 28100a9^` — **one file only**: `skills/sdd-engine/ASSUMPTIONS.md` (+161 lines, append-only at the tail);
- `git diff 28100a9` — empty, so the working tree IS that commit.

**Tree clean. Engine untouched. Commit 28100a9 is record-only.**

Reported baseline: **1037 files / 1037 byte-identical / FAILURES 0.**

**NOTHING IS PUSHED.** Branch `spec-driven-dev`. Pushing is Amir's alone.

## entity round-trip — build log — reference

_Detail for the Entity sentence round-trip work (parent item imtn88annc7947e). Commits bd89c64 / 2172f80 / 6eb2bf8 on `spec-driven-dev`, 2026-09-04, UNPUSHED. Verified independently by Ghost Pepper against the repo, not on s2's word. Parent item is kept SHORT and points here because item descriptions cap at ~2000 chars and truncate silently._

- VERIFICATION 2026-09-04 — PASSED, independently, not on s2's word
      Ghost Pepper verified the three commits directly against the repo (read-only `git diff` on s2, branch `spec-driven-dev`). **All checks passed.**

- **Three SEPARATE commits, not squashed**, proven by strict nesting of diffs against HEAD: `diff 6eb2bf8` → EMPTY (HEAD is `6eb2bf8`, tree clean); `diff 2172f80` → ONLY the one-line ASSUMPTIONS.md change (⇒ `6eb2bf8` is doc-only and separate); `diff bd89c64` → ASSUMPTIONS.md + `entity-sentence.js` but NOT the test file (⇒ `bd89c64` already contained the check, so `2172f80` is separate).
- `bd89c64` touched `engine/entity-sentence.test.js` (new §6, +104) + the ASSUMPTIONS.md COMMIT-1 section.
- `2172f80` touched `engine/entity-sentence.js` (+77/−2) + the ASSUMPTIONS.md COMMIT-2 section.
- `6eb2bf8` touched ONE LINE of ASSUMPTIONS.md: "four explicit `return null`s" → "seven".
- **Working tree clean:** `git diff` and `git diff --staged` both empty.
- **Only three files changed across all three commits**, confirmed by an UNSCOPED `diff bd89c64` plus `diff bd89c64^ -- tools/repo-dsl` and `diff bd89c64^ -- :!tools/repo-dsl` (the exclusion pathspec, so nothing outside `tools/repo-dsl` went unchecked).

**`engine/clause-quality.js` is UNCHANGED, and this was checked WITH A POSITIVE CONTROL.** `git diff bd89c64^ -- tools/repo-dsl/engine/clause-quality.js` returned 0 lines — but an empty result is indistinguishable from a path filter matching nothing, so the SAME command form was run first on `tools/repo-dsl/engine/entity-sentence.js`, a file known to have changed in `2172f80`, and it returned its full diff. The empty result is therefore genuine.
- A REAL AMBIGUITY, found by a CONSTRUCTION PROBE — §5E.3.2's one hard rule defended in practice
      **This is the item worth remembering from the whole build: s2's OWN injectivity comment was the thing that was wrong, and only a construction probe caught it.**

The comment asserted that a column phrase can never be cut into two phrases that BOTH parse. With the name group written `(.+?)` that is FALSE: the lazy group can swallow a whole trailing type group, so

```
a required a (int) and a required b (int)
```

has **TWO readings** — two columns, or ONE column named `a (int) and a required b`. **Measured: after the `splitTopLevel` scanner change the parser took the SECOND reading**, silently turning a valid non-Oxford two-column list into one absurd column — a behaviour the old regex split did NOT have. So the class fix introduced this, and the probe found it before it shipped.

**Fix:** the name group is now `([^()]+?)`. `spaced()` can never produce a parenthesis (db names have none), so excluding them costs nothing and makes the phrase GENUINELY unambiguous — which is exactly what the "parse whole, split on bare `and` only if that fails" fallback relies on. **Re-probed after the fix:** non-Oxford input yields two columns `a, b` and re-renders in the canonical Oxford form.

**RECORD IT AS THIS:** §5E.3.2's ONE HARD RULE — *two distinct sentences MUST NOT compile to the same TypeScript* — being defended in practice rather than argued in a comment. An injectivity argument in prose is not evidence; a construction probe is.
- SCOPE CORRECTION, THE REPO WINS — leg 2 measured 0/58 and was NOT asserted
      The check's leg 2 was specified as `emitEntityCanonical(parse(s)) === ts`, compared against the **corpus file's OWN BYTES**. Measured: **0 of 58 — and NOT ONE of the 58 is a grammar defect.**

Worked example, `entities/hydra/ApiValidator.ts`, differs by:
- an `import { Nullable }` the archetype does not model;
- an `export enum` declared INLINE in the file rather than imported from `./enums`;
- a blank line;
- `@Column({ name: 'status' })` where the name EQUALS the property, which the canonical emitter correctly drops.

That leg compares CANONICAL output to NON-CANONICAL corpus bytes: **it measures how the corpus was TYPED, not whether the loop closes.** Asserting it would pin 0/58 forever with nothing to fix.

**So it is printed as a number and deliberately NOT asserted**, labelled `REPORT ONLY` in the output. Asserted in its place is the checkable form of the same claim — the TypeScript leg of AT-ARCH-1 exactly as §3 already states it, run corpus-wide: emit the canonical `.ts`, re-mine it, require BOTH the sentence and the `.ts` at their fixpoint. It catches every failure the specified comparison would have caught (a model that drops a field emits a `.ts` that re-mines to a different sentence) and none of the noise it would have manufactured. Measured: it moves with the other legs, 53/58, same five files.

**This is a WORKED EXAMPLE of the standing policy that a metric must be MEASURED before it is ASSERTED** — see [[standing policy — read before quoting ANY number]].
- The numbers, as printed — and what did NOT move
      **COMMIT 1 `bd89c64`, the check, ARRIVED RED:**

```
  corpus entities: 75 files under entities/, 58 conform and produce a sentence
  DENOMINATOR 58
    render(parse(s)) === s                       53/58
    re-mine of the emitted .ts === s             53/58
    the emitted .ts is a fixpoint                53/58
    REPORT ONLY, not asserted -- emit === the corpus file's own bytes   0/58
entity-sentence.test.js: 17 passed, 3 failed        (exit 1)
```

The 17 refused files are refused by `extractEntity` BEFORE the grammar is reached — they are not Entities by the archetype's own definition, so counting them would measure the extractor, not the round trip. **58 is printed, not implied, and ASSERTED**, so shrinking the population fails rather than improving the fraction.

The five failures: `hydra/Charge.ts`, `hydra/InvoiceRaw.ts`, `hydra/OwnershipGroupLegacyTax.ts`, `hydra/TaxByProvince.ts`, `hydra/TaxByProvinceOverride.ts`.

**NEW NEGATIVE CONTROL the per-file legs are blind to:** no two entity sources may render the same sentence. A collision would mean the grammar had lost the field distinguishing them and every per-file leg would STILL be green. Asserted, measured **0**.

**COMMIT 2 `2172f80`:** sentence leg 53 → **56/58**; re-mine leg **53/58**; fixpoint leg **53/58**.

**WHAT DID NOT MOVE:** byte-identity `1037 files / 1037 byte-identical / FAILURES 0` before AND after both commits. `generate.test.js` 35 passed. Sections 1–5 of `entity-sentence.test.js` untouched and still passing. **NOTHING was wired into the `.en` path.** `engine/clause-quality.js` unchanged (positive control run).

**COMMIT 3 `6eb2bf8`:** doc-only, free.
- VERIFICATION 2026-09-04 (2) — `0571bdc` verified independently, WITH A POSITIVE CONTROL that first FAILED
      Verified by Ghost Pepper via read-only `git_diff` on s2, not on s2's word. `spec-driven-dev`, nothing pushed.

- **ONE commit, exactly.** `git diff 2172f80 -- tools/repo-dsl/engine` is byte-identical to `git diff 0571bdc~1 -- …`, so `0571bdc~1 == 2172f80`: `0571bdc` sits exactly one commit on top of the separator-class commit.
- **Working tree clean, and AT that commit.** `git diff`, `git diff --staged` and `git diff 0571bdc` all returned 0 lines.
- **Files touched — two, and only two:** `ASSUMPTIONS.md` (+57 doc lines) and `tools/repo-dsl/engine/entity-sentence.js` (+24/−1, the `flattened()` helper plus the one line in `modelFromExtraction`). The change inside `entity-sentence.js` is the MINING path; **the splitter is untouched**.
- **The check file `engine/entity-sentence.test.js` was NOT touched** — 0 lines under the same command form. The check and its asserted denominator of 58 stand exactly as `bd89c64` left them, which is what makes the 58/58 reading worth anything.
- **`engine/clause-quality.js` unchanged** — frozen baseline holds.

**THE POSITIVE CONTROL, AND IT CAUGHT A REAL TRAP.** First attempt used the path as printed in the diff header (`skills/sdd-engine/tools/…`) and returned EMPTY for `entity-sentence.js` — a file I had just watched change. The filter resolves relative to the SESSION CWD, not the repo root. Re-run as `tools/repo-dsl/engine/entity-sentence.js` returned the full diff. Only THEN was the same form run on `clause-quality.js` and the test file, so their empty results mean unchanged and not mis-typed path. Had I skipped the control I would have reported the frozen file clean on a filter that matched nothing.
- THE FIX 2026-09-04 — `flattened()` at the MINING end, where the value is lifted, and only there
      Sentence leg **56/58 → 58/58**. Defect 1 closed.

**The defect.** `modelFromExtraction` lifted `p.enum` VERBATIM out of the source. `Charge.hydraState` and `InvoiceRaw.rawInterfaceType` are inline enum literals written across several lines, so they carried newlines into the MINED sentence. `sentences()` collapses `\s+` by design — it has to, a sentence is a run of words — so the re-rendered sentence was single-spaced and could never equal the mined one. The failure was whitespace alone.

**The fix, one line.** `col.enum = flattened(p.enum); col.tsType = col.enum;` — applied WHERE THE VALUE IS LIFTED, and nowhere else.

**THE SPLITTER WAS NOT TOUCHED — record this explicitly.** The standing instruction was to fix at the mining end and NOT widen the parser, and it was honoured. Teaching the splitter to tolerate newlines would make the ACCEPTED language larger than the PRODUCED one, and that gap is where every regression in this grammar has come from.

**The parse direction needs no call at all.** `sentences()` has already collapsed the text before a column phrase is ever matched, so a value arriving from a sentence is flat by construction. No defensive second call was added.

**Full reading, denominator 58 asserted:**

```
    render(parse(s)) === s                 58/58   (was 56/58)
    re-mine of the emitted .ts === s       53/58   (unchanged)
    the emitted .ts is a fixpoint          53/58   (unchanged)
    REPORT ONLY, not asserted -- emit === the corpus file's own bytes   0/58
  entity-sentence.test.js: 18 passed, 2 failed
```

Byte-identity 1037 files / 1037 byte-identical / FAILURES 0, before AND after. `generate.test.js` 35 passed, 0 failed. Nothing wired into the `.en` path. Local only.
- WORKED EXAMPLE 2026-09-04 — BLAST RADIUS MEASURED BEFORE THE EDIT, and s2 then OVERTURNED ITS OWN PREDICTION
      Companion to [[standing policy — read before quoting ANY number]]'s *MEASURE a metric BEFORE you assert it*. This is the same discipline pointed at an EDIT rather than a metric.

**BEFORE the edit — reach counted, not guessed.** Across the 58 conforming entities, 40 columns carry an enum: **35 are a bare identifier**, **3 more are an inline literal already on one line**, and **exactly 2** hold a value whose whitespace `flattened()` would change — `Charge.hydraState` and `InvoiceRaw.rawInterfaceType`, the two files already named. Those 38 pass through byte-unchanged. The edit's reach was known to be 2 columns in 2 files before a line was written.

**AFTER the edit — the prediction was WRONG, and the measurement said so.** In `2172f80` s2 had reasoned the fix WOULD change the emitted bytes for those two files. A differential against the previous HEAD over all 58 entities, comparing mined sentence and emitted canonical `.ts` byte for byte:

```
  entities compared: 58
  mined sentence UNCHANGED by this commit:          56/58   (Charge, InvoiceRaw changed — intended)
  emitted canonical .ts UNCHANGED by this commit:   58/58
```

**58/58 on emit bytes, INCLUDING Charge and InvoiceRaw.** The old path already emitted from a COLLAPSED model: `sentences()` collapsed the newlines before `parseEntitySentence` ever saw them, so the emitted literal was flat on BOTH sides of this commit. The defect was confined to the mined sentence never matching its own re-render.

**s2's own words, worth keeping verbatim:** *"The emit path is untouched, and that is a measurement, not an argument."*

**The lesson:** a differential is what turns a reasoned expectation into a fact, in EITHER direction — it is as valuable when it refutes you as when it confirms you, and s2 published the refutation of its own claim rather than quietly dropping it.

