# §5E Archetype/word hybrid — the design

*[index](README.md) · **DIRECTION SETTLED, MECHANICS IN DESIGN.** The direction is Amir's eight
verbatim statements in §5D.0 and is not up for debate; this file is how they get built. Nothing here
is built **yet** — **correction 2026-08-31: two of the five are now built** (mechanic 5,
derive-and-check, §5.3; mechanic 1, the `.en`-first forward command, §3.6). What remains genuinely
open is mechanics only — §8, **three** items, each with a recommendation this lane will build
against unless redirected.*

**Non-negotiable design targets, from §5D.0:**

1. **AT-ARCH-1** — generate via archetype, re-mine, and the `.en` comes back **byte-identical** (§2).
2. **One word per file** — a file is accounted for by one top-level word whose rendered form **is**
   its recursive definition, **editable at every level**; opacity is forbidden (§6, §5D.4).
3. **Sentences are the generators** — a call is a sentence invoking a sentence; the sentence is
   **authoritative** over the payload (§3.2, §5).
4. **Review surface**, not compression, is the metric (§7 success criteria).
5. **Two stages** — deterministic mine, then scripted LLM naming; zero model calls in stage 1 (§5D.2).

---

## 1. What changed, and what it settles

**Amir, 2026-08-31, verbatim:**

> *"the architecture layer is supposed to be things like, this is the high level pattern like
> entities, this is what you call to make a new entity in that pattern, and it makes it and gets
> translated/built into the source codebase. then if I mine the codebase again I should see no change
> to the .en file because it backwards builds the .en file back into exactly what was written
> anyways"*

This is not a refinement of §5D. It changes what an archetype **is**:

| §5D as written | what Amir described |
|---|---|
| a **passive** shape the miner discovers in existing code | a **generative constructor** you invoke to author new code |
| one direction: `.ts` → recognize → `.en` | two directions: invoke → `.ts`, and mine → back to the *same* `.en` |
| success = the archetype's slots refill byte-exact | success = **re-mining the generated code returns the identical `.en`** |

It settles two of §Q-3's five unknowns outright (§3.1, §3.2 below), makes a third fall out for free
(§3.3), and — more valuable than any of them — replaces "make the archetype layer good" with **one
executable acceptance test**.

---

## 2. The north star — idempotence under re-mine

Byte-identity is not enough here, and the reason is precise. Let:

```
en₀ = A(p)                            an archetype invocation, as authored
ts  = compile(en₀)                    the TypeScript it builds
D′  = mine(SOURCE ∪ {ts})             re-mine, with the generated file now in the corpus
en₁ = render(ts, D′)                  re-derive the English from the generated code
```

**The gate:**

| id | assertion | what it constrains |
|---|---|---|
| **AT-ARCH-1** | `en₁ === en₀` | **IDEMPOTENCE — the new bar.** The re-mine must land on the *same words*. |
| **AT-ARCH-2** | `compile(en₁) === ts` | byte-identity — already required (R-REND-1), restated so the pair is visible. |
| **AT-ARCH-3** | one more turn — mine and render `compile(en₁)` again — still `=== en₁` | **fixpoint**, not a one-shot coincidence. |

**Why AT-ARCH-1 is strictly stronger than byte-identity, and not a restatement of it.**
Byte-identity constrains `compile ∘ render` on the **`.ts` side**. It says nothing about *which
words the renderer chose*. Two renders can both be perfectly byte-identical and disagree completely
about the `.en` — one emitting `«create Entity Invoice with columns …»`, the other emitting eleven
low-tier statement spans that happen to compile to the same bytes. **Nothing in the engine currently
gates that choice.** AT-ARCH-1 does, and it is the first requirement in this document that constrains
the `.en` as an artifact in its own right rather than as a means to reproduce the `.ts`.

**It must be able to fail — this is not another R-ARCH-4.** R-ARCH-4 records that the archetype
layer's `byteIdentical: 100%` is a tautology, because `checkTiling` re-slices the source and rejoins
it. AT-ARCH-1 is not of that kind: `en₁` is computed from `ts` and `D′` alone and never sees `en₀`.
It is nonetheless **mutation-checked at authoring time** (R-TEST-3) with an explicit negative
control: **de-register the archetype, re-run, and assert `en₁ ≠ en₀`.** A test that cannot be made to
fail is not evidence, whatever it prints.

**What it catches that nothing else does.** These are the reasons to adopt it, and they are concrete:

1. **Arbitration instability.** A word mined *from the generated file itself* out-claims the
   archetype on the next pass, so the file silently stops rendering as an Entity. Byte-identity holds
   throughout; the `.en` degrades anyway.
2. **R-PAY-6 — word-id renumbering — mechanically, at last.** Payload ids are array indices
   renumbered by every re-mine. Under AT-ARCH-1 that renumbering *changes `en₁`* and the test goes
   red. **This is the same defect that blocks the Q-1 flip**, and Amir's criterion turns it from a
   documented hazard into a failing test. That alone justifies the gate.
3. **Canonicalizer drift** — a change that alters skeletons shifts the segmentation and the `.en`
   moves under a corpus nobody edited.
4. **Positional slot binding** — if slots bind by index rather than by name, adding a column
   reshuffles every downstream fill and `en₁` diverges.

---

## 3. The design that follows

### 3.1 An archetype **IS** a dictionary entry — §Q-3 unknown 2, RESOLVED

Not a template layer above the dictionary. The top of the same recursive hierarchy, exactly as §2 P4
says (*tier **is** dictionary depth*).

**The argument is forced by AT-ARCH-1, not chosen for elegance.** If the archetype lived above the
dictionary, then after a re-mine the renderer would hold two independent producers for the same
bytes — the dictionary, which mined the generated file, and the archetype layer, which recognizes it
— and `en₁` would depend on which one won. Making the archetype an *entry* means the re-mine has
nothing separate to rediscover: it matches an entry that is already there, and "widest word wins"
does the rest. **One producer, one gate (R-ARCH-3), applied to the layer itself.**

It also makes composition literal rather than analogical: an Entity is a word whose members are
column words, which are words. `hierarchyDepth` and `members[]` (R-COMP-4) need no new concept.

### 3.2 The dictionary **IS a grammar**; a call is a sentence invoking a sentence — §Q-3 unknown 1, RESOLVED

**Amir (§5D.0 statement 3):** *"its supposed to be code generators that call code generators but its
sentences."* My first draft of this section had a slot carry `memberId: "g_col_<hash>"` — a symbolic
reference with the English rendered beside it. **That is the shape he is ruling out**, and he is
right to: it makes the sentence a label on the call rather than the call itself.

**The reframe.** Read the mined dictionary as a **grammar**, and every piece already has a name:

| grammar | engine |
|---|---|
| **nonterminal** | a word / generator / dictionary entry |
| **production** (its RHS) | the sentence template that word renders as |
| **a nonterminal appearing in a RHS** | **the call** — one generator invoking another |
| **terminal** | a hole's verbatim bytes (identifiers, literals) |
| **the start symbol** | the archetype — the whole-file claim |
| **derivation depth** | `hierarchyDepth` (R-COMP-4) — emergent, per §2 P4 |

Under this reading, *"an Entity **has columns** […]"* is not prose describing a call; **the phrase
`has columns` is the call.** The grammatical connective is the invocation syntax, and the nested
sentence is the argument.

**So a slot is a nonterminal reference, spelled grammatically:**

```
Entity  →  "«Name» is an entity stored in «table»."  Columns  Relations
Columns →  "It has "  ColumnList  "."
Column  →  "an auto-generated id"                                  (alternative 1)
        |  "a «req» «name» («type»)"                               (alternative 2)
Relation →  "It belongs to a «Target» (join «fk»)."                (alternative 1)
        |  "It has many «Target»."                                 (alternative 2)
```

The record that backs it, additive to §5A/§5B:

```
{ id: "a_entity_<sha256-10>",     content-addressed, NOT an array index (R-PAY-6)
  kind: "archetype",
  nonterminal: "Entity",           the name the grammar and the human both use
  axis: "arch",
  production: [                    the RHS, in order: literals, slots, nested nonterminals
    { lit: "" }, { slot: "className", type: "id" },
    { lit: " is an entity stored in " }, { slot: "table", type: "str" }, { lit: "." },
    { nonterminal: "Columns",  arity: "one"  },
    { nonterminal: "Relations", arity: "zero-or-more" } ] }
```

Four choices, each forced rather than preferred:

- **A slot binds by NAME, never by position.** Positional binding breaks AT-ARCH-1 the moment a slot
  is added, and breaks it silently.
- **A nested nonterminal may have ALTERNATIVES.** The PaymentPlan case forces this: `an
  auto-generated id` and `a required amount (decimal)` are both `Column`, with different slot sets.
  A single `memberId` per slot cannot express that. Alternatives are ordered, and the **first whose
  fill is byte-exact at the site wins** — deterministic, no scoring.
- **Variadic arity is a grammar property (`zero-or-more`), not a new hole type.** `columns*` has no
  representation among R-WIDE-5's scalar hole types; as a grammar repetition it needs no new concept.
- **The id is DERIVED from the nonterminal, not the other way round.** `sha256` over the canonical
  production, exactly as skeleton names key on content (§5C). The id is an index for lookup; **the
  grammar is the definition.** This is what keeps the sentence primary and the reference secondary,
  and it is also the R-PAY-6 fix: a re-mine cannot renumber a content hash.

**The inverse direction must be a FUNCTION, and this is a new requirement.** Because the lifecycle
runs both ways (§5D.0 statement 4), the grammar must be unambiguous in **both** directions:

- forward — one sentence compiles to exactly one `.ts` (already true; deterministic, zero model calls);
- **backward — one `.ts` shape derives to exactly one sentence.** Two distinct sentences **MUST NOT**
  compile to the same TypeScript, or re-mining cannot know which to reproduce and AT-ARCH-1 fails on
  a coin-flip.

The PaymentPlan case shows this is not theoretical: `@OneToMany` is emitted *implied*, never named in
the sentence, so the backward map has to recognize a decorator the sentence never mentioned and
attribute it to `It has many Installments`. That is exactly where a second grammar rule producing the
same decorator would make the derivation ambiguous.

### 3.3 Arbitration needs no new rule — §Q-3 unknown 3, RESOLVED (it falls out)

R-WIDE-8 already orders candidates by **widest byte coverage** after discarding anything not
byte-exact at the site. An archetype covers the whole file, so it is the widest claim by
construction and wins without a special case. The tie-breaks below it (`freq`, narrow-beats-wide,
lowest id) never come into play at that level.

**This is a reason to prefer §3.1's design, not a lucky accident:** a template layer *above* the
dictionary would have needed a new arbitration rule between two producers, and that rule would be
the thing AT-ARCH-1 keeps catching.

### 3.4 The registry is **seeded, not emergent** — §Q-3 unknown 4, RESOLVED for the shape

Archetypes are **declared** and injected into the dictionary as pre-registered entries; the miner
**matches** them rather than inventing them.

Emergence cannot work for a generative tool, for a stateable reason: the first invocation of a new
archetype produces **one** instance. Asking the miner to rediscover the intended shape from one file
— and to land on exactly the segmentation the archetype meant, rather than some other byte-exact
tiling — is asking it to guess. `MIN_COUNT = 1` (R-MINE-1) makes a single occurrence *admissible*;
it does not make the segmentation *predictable*, and AT-ARCH-1 needs it to be predictable.

So: **hand-authored grammars survive, but only as the archetype's own declaration.** Slot *fills*
are mined. That is the hybrid line, and it is where §5D already pointed — a hand-authored grammar is
redundant wherever the miner succeeds, and the miner is silent about whole-file claims.

### 3.5 §5C and archetype composition are **ONE system** — §Q-3 unknown 5, RESOLVED

**Amir (§5D.0 statement 3) requires this, and §3.2's reframe delivers it.** §Q-3 asked "what replaces
per-site productions." The answer is **nothing replaces them, because they were never a separate
layer** — under the grammar reading they *are* the generators, at the statement tier.

§5C describes two layers and, read as a grammar, they are two halves of one object:

| §5C calls it | grammar calls it |
|---|---|
| a **skeleton name** (`catalog/word-names.json`, one per mined word) | the **nonterminal's spelling** |
| a **per-site production** (`spanProse`, one per statement kind) | the **production's RHS** |

A name without a production is a nonterminal with no expansion — which is exactly why §5C's admission
rule refuses most names: *"name a leaf only where `spanProse` has nothing site-specific to say."*
Read grammatically, that rule says **do not introduce a nonterminal whose only content is its own
name.** The same rule, stated in the same vocabulary as the archetype layer.

**What this collapses.** The tiers are not four systems, they are one grammar at four derivation
depths: `Archetype → Skeleton → Statement/Data → Leaf` is `start symbol → nonterminals →
nonterminals → terminals`. §5C's *"the central finding — productions reach further than names"*
becomes: **an expansion is worth more than a label**, which is true of grammars generally and is why
the finding held.

**One consequence to be explicit about.** §5C's two layers are currently *implemented* separately —
`word-names.json` is hand-authored data, `spanProse` is code. Unifying them conceptually does not
merge those two artifacts, and this proposal does **not** propose merging them. It proposes that they
be **specified** as one grammar so a slot reference and a statement clause are the same kind of thing.

### 3.6 The forward direction — what "you call to make a new entity" is

```
repo-dsl new Entity --name Invoice --table invoices --columns id:number,total:number
      │
      ├─ 1. resolve the archetype entry by name
      ├─ 2. bind slots; each variadic item is an invocation of the member word
      ├─ 3. EMIT THE .en FIRST — the invocation clause is the artifact             ← DECISION 2
      └─ 4. compile(.en) → .ts, written into SOURCE
then:    mine → render → AT-ARCH-1 must hold
```

Step 3 is the load-bearing one. Emitting the `.en` first and deriving the `.ts` from it makes
AT-ARCH-1 an identity the pipeline *maintains* rather than a coincidence it hopes for, and it matches
§1's thesis that the English is the source. Emitting `.ts` first and hoping the render finds its way
back to the same clause is the version that fails.

**SHIPPED 2026-08-31.** `new-archetype.js` is that command, over `engine/entity-sentence.js` — a
bidirectional grammar with a `parse` and a `render` that are inverses:

```
Entity   -> "«Name» is an entity stored in «table»." [Columns] [Relations]
Column   -> "an auto-generated id" | "a required «name» («type»)" | "an optional «name» («type»)"
Relation -> " It belongs to a «Target» (join «col»)." | " It has many «Target»."
```

Three things about it are load-bearing, not incidental:

1. **AT-ARCH-1 runs on every invocation, and a failure REFUSES the write.** The command emits
   nothing until it has put its own output back through the mine and got its own sentence back,
   byte for byte. The alternative — write now, discover at the next mine — is the drift class §8B
   exists to stop, one level up. Exit 2, reason in `error`, no file touched.
2. **Zero model calls** (R-MECH-4), matching §5D.1's panel: nothing about the deterministic pass
   asks a model anything.
3. **The interface is non-interactive by construction** — `--sentence` / `--sentence-file` /
   `--stdin` in, one JSON document on stdout under `--json` (prose to stderr), `--dry-run` to
   verify without writing. No prompts, so a UI can drive it unchanged.

**Two conventions the grammar fixes**, both read off Amir's own reference sentence rather than
invented: a **column** name is *spoken* (`account id` → `accountId`, `@Column({ name: 'account_id' })`),
while a **join column** is *verbatim* (`(join account_id)`). A column name is prose about a field; a
join column is a database identifier the reader must be able to match against a schema by eye.

`engine/entity-sentence.test.js` pins the loop on the PaymentPlan reference sentence in both
directions plus the **fixpoint turn** — a renderer that normalises can match once by luck and drift
on the next turn, so turn two is asserted identical too — and it proves each refusal actually fires
(§10.3).

---

## 4. Sanity-check against the real case — the PaymentPlan sentence, clause by clause

§5D.1 quotes the `Author → Compile` panel's input verbatim. A design that cannot consume *that exact
sentence* is not a design, so here it is walked against §3.2's grammar.

| clause | production | binds |
|---|---|---|
| *"PaymentPlan is an entity stored in payment_plans."* | `Entity` head | `className = PaymentPlan` (atom, id), `table = payment_plans` (atom, str) |
| *"It has …"* | `Columns → "It has " ColumnList "."` | one invocation, variadic member |
| *"an auto-generated id"* | `Column` **alternative 1** | *(no slots)* |
| *"a required account id (int)"* | `Column` **alternative 2** | `req = required`, `name = account id`, `type = int` |
| *"a required amount (decimal)"* | alt 2 | `decimal` |
| *"an optional note (varchar)"* | alt 2 | `req = optional` |
| *"a required status (enum EPaymentPlanStatus)"* | alt 2, `type` = enum form | `EPaymentPlanStatus` |
| *"It belongs to a BillingAccount (join account_id)."* | `Relation` **alt 1** | `target = BillingAccount`, `fk = account_id` |
| *"It has many Installments."* | `Relation` **alt 2** | `target = Installments` |

The grammar consumes it with nothing left over, and the panel's own report — *"entity PaymentPlan,
5 cols, 2 rels"* — is a direct count of the variadic fills (5 `Column`, 2 `Relation`). That is the
check passing.

**Two things it forces, which prose alone had not surfaced:**

**(a) A variadic slot MUST reference a nonterminal with ALTERNATIVES.** *"an auto-generated id"*
carries no type and no nullability; *"a required amount (decimal)"* carries both. They are the same
nonterminal with different expansions. My first draft bound a variadic slot to a single
`memberId: "g_col_<hash>"`, which **cannot express this** — one id names one expansion. §3.2's
ordered-alternatives form is the fix, and this example is why it is in the design rather than a
nicety.

**(b) The grammar MUST be injective in BOTH directions.** The compiler emits an `@OneToMany` the
sentence never names — it is *implied* by *"It has many Installments"*. So the backward map has to
attribute a decorator to a clause that does not mention it. That is only well-defined if:

- no two distinct sentences compile to the same TypeScript, **and**
- every TypeScript shape derives to exactly one sentence.

If a second production could also emit `@OneToMany`, re-mining a compiled file cannot know which
clause produced it, and **AT-ARCH-1 fails on a coin-flip** — not rarely, but nondeterministically,
which is worse. **Injectivity is therefore a gate, not a style rule**, and the cheap mechanical form
is: for every pair of productions on an axis, assert their compiled outputs differ. Proposed as
R-ARCH-17.

**MEASURED against the real extractor, 2026-08-31.** §4 above was written from the sentence alone;
it has now been checked against `extractEntity`'s actual output on the compiled PaymentPlan. Both
predictions held, one was sharper than expected:

- **(a) alternatives are real, not hypothetical.** `columns[0]` (the auto-generated id) comes back as
  `decorator: "PrimaryGeneratedColumn"` with **no `parsed.type` at all**, while `columns[2]` carries
  `type: "decimal", nullable: "false"`. Two shapes, one nonterminal — a single `memberId` per slot
  could not have expressed it.
- **(b) the implied `@OneToMany` is NOT invisible to the miner**, which is better news than §4b
  assumed. It is extracted as `relations[1]` with `kind: "OneToMany", target: "Installment"`, so the
  backward map has a real slot to attribute it to and the 2-relation count matches the sentence's two
  relation clauses 1:1. Injectivity is still required — two productions emitting the same decorator
  would still be ambiguous — but the reference case does not violate it.
- **The gap was somewhere else, and it was worse.** The `@JoinColumn({ name: "account_id" })` fill
  was **dropped entirely** (§7 prerequisite 1). The sentence names it; the slots did not hold it.
  Fixed and pinned.

**One residual honesty note.** *"a required account id (int)"* → property name. `account id` with a
space must map to `accountId`, and `account_id` in the join clause must map to the same column. That
canonicalization is a **function the grammar owns**, and it must be **injective too** (`account id`,
`accountId` and `account_id` must not all be renderable, or the re-mine cannot pick one). Named here
rather than assumed; it is the smallest concrete instance of (b).

---

## 5. The second collision — the payload vs the sentence · **RESOLVED, direction settled**

This is the most consequential finding in the pass, and it is now decided rather than proposed.

**The conflict.** R-PAY-1's live dialect is `lzw1 <axis><wordId>⟨hole⟨hole…` and R-REND-6 said the
compiler *"MUST NOT read a span's label region"* — *"names are cosmetic by construction"*. Together
they describe exactly the architecture Amir rejected in statement 3: **a symbolic reference with
English glued on top.** And they make statement 4 impossible: if the compiler reads only the payload,
**hand-editing the `.en` does nothing.**

**The resolution (§5D.3 note 1, §10).** The **sentence is authoritative**; the payload is a derived
index. R-REND-6 is rewritten. What that costs, concretely:

1. **`compileChunk` must parse, not `lastIndexOf`.** Today it locates a payload by scanning for
   sentinels and ignores everything else in the chunk. It must instead **derive** the payload from
   the clause through the grammar, and use the stored payload only to *check* that derivation.
2. **The check is the safety net the old rule provided, kept in a louder form.** Derive from the
   sentence; compare to the stored payload; **disagreement throws**, naming the clause. A stale
   payload after a hand-edit is then a named error, not a silently ignored edit.
3. **This is what makes a hand-edit safe rather than merely possible.** An edit the grammar cannot
   parse fails at compile with the clause quoted, instead of compiling the old code and looking like
   it worked — which is the current behaviour and the worst of the options.
4. **R-PAY-1's dialect survives unchanged.** Nothing about the encoding is wrong; what changes is
   which artifact is the source and which is the cache.

### 5.3 Derive-and-check — SHIPPED 2026-08-31

**What it does:** re-derives the gloss from the payload — by calling the same `namedLabel` /
`genLabel` the renderer used, on the bytes `compileSpan` produces — and **throws** if it differs from
the gloss written in the file, naming both sides.

**What it deliberately does NOT do:** make the edit *effective*. A hand-edit is now **detected**, not
honoured. Honouring it needs the §3.2 grammar parser, which is the larger job. What this closes is
the **silent no-op**, which was the worst of the three behaviours — worse than refusing, and worse
than obeying.

**Why derive the gloss instead of parsing it.** The cheap check — *"every backticked token in the
gloss must be one of the payload's hole fills"* — was **measured on the fixture and is wrong**: 32/40
spans pass, and all 8 failures are the same benign shape, a gloss saying `` `this.rows` `` where the
hole holds `rows` and `this.` came from the template. A check that fires on 20% of correct spans is
worse than no check. Deriving has **no false positives by construction**: the renderer wrote the
gloss with the same two functions the check re-derives it with.

**A finding that narrows R-REND-6.** The **per-statement CNL path already reads its own prose** —
editing `` `x` `` in `«Let `x` be …»` changes the compiled output today. The silent no-op was
specific to **generator spans**, where `compileChunk` located the payload with `lastIndexOf` and
ignored every other byte. R-REND-6's defect was narrower than the requirement's wording implied.

**Measured, both directions (§10.3 mutation discipline):**

| | result |
|---|---|
| real corpus, check ON | **1,037/1,037 byte-identical, zero false positives** |
| hand-edit a generator gloss, check **OFF** | compiles **the un-edited code** and looks like it worked — the defect, now pinned by an assertion |
| same edit, check **ON** | throws `SENTENCE AND PAYLOAD DISAGREE`, printing written vs derived |

Off by default outside the tests (`SDD_DERIVE_CHECK=1` / `{deriveCheck:true}`) because it costs one
parse per generator span on the round-trip hot path; **on** in `enfile.test.js`, which is where a
drifted gloss would otherwise slip through.

**What is still open here is mechanics only** (§Q-3): whether the payload stays in the `.en` at all
once it is derivable, or moves to a sidecar cache. Keeping it in the `.en` costs bytes and buys a
self-contained artifact; moving it out makes the `.en` pure English and adds a file that can go
stale. **Recommendation: keep it in the `.en`** — a self-contained artifact matches §7A's rule that
the payload must be readable rather than opaque, and a sidecar reintroduces the drift class §8B
exists to kill.

---

## 6. THE LIFT — **RESOLVED by Amir's statements 6 and 7**

This section previously asked Amir to amend R-MINE-7 and marked the design **blocked** on it. **He
answered it directly**, and the answer went further than the amendment I proposed:

> *"with the LZW pattern you can turn the whole codebase into 1 word, each file can become 1 word.
> dont tell me that you cant do this."* — and *"each file isnt actually its word. its the words that
> make up that word. so that it can be editable."*

R-MINE-7 said *"a file is never one word."* Its purpose was that a reader must not get *"one opaque
reference instead of the file's structure"* — and statement 7 satisfies that purpose more completely
than the prohibition did: the file word's **structure is its content**. The rule was written against
opacity and had generalized into a ban on collapse.

| | what the `.en` shows |
|---|---|
| a mined whole-file word, sealed | `«g_412_a1b2c3»` — one token, structure invisible. **Still forbidden.** |
| a whole-file **archetype**, per statement 7 | its recursive definition — `Entity «PaymentPlan» …` unfolding into named column and relation words, each editable, repeated substructure cited once. **This is the target.** |

**Amended R-MINE-7 (applied, §5D.4):** refuse a whole-run word that renders as an **unexpanded opaque
reference**; require one whose recursive definition is present and editable. Recorded as R-ARCH-15.

**The gap that remains is not permission, it is THE RESIDUAL** — statements no word accounts for.
§5D.4 names it and gives the three moves that clear it; it is now the headline metric (R-ARCH-16),
not an excuse.

---

## 7. Prerequisites — things that must be true before any of this is built

1. **~~R-ARCH-6 — `extractEntity` is broken~~ — MEASURED FALSE, and one real defect found instead
   (2026-08-31).** Run against the §5D.1 reference case, `extractEntity` returns `conforms: true`,
   `byteIdentical: true`, `className: "PaymentPlan"`, `table: "payment_plans"`, **5 columns and 2
   relations** — exactly the panel's own *"entity PaymentPlan, 5 cols, 2 rels"*. The requirement
   described a reader using top-level keys instead of `result.slots`, which its own Check line
   admitted. **This prerequisite is cleared.**

   **But the run surfaced a genuine defect that byte-identity cannot see.** A relation slot carried
   only the *first* relation decorator, so for

   ```
   @ManyToOne(() => BillingAccount)
   @JoinColumn({ name: "account_id" })
   account!: BillingAccount;
   ```

   the join column name `account_id` was **dropped entirely** — no field held it. The reference
   sentence is *"It belongs to a BillingAccount (join account_id)"*, so **re-mining a compiled entity
   could not reproduce its own sentence**: the fill did not exist. Byte-identity stayed green the
   whole time, because the member's bytes are re-emitted verbatim from the span — **the loss is in
   the slots, not in the text.**

   **This is AT-ARCH-1's first real catch, before AT-ARCH-1 was even built.** It is the exact failure
   class §2 argued idempotence-under-re-mine would find and byte-identity would not, and it was
   sitting in the extractor the whole time. Fixed by `parseRelationArgs` (named `kind`, `target`,
   `inverse`, `join`, reading **every** decorator on the member) and pinned by a regression block in
   `engine/archetypes.test.js` with **one assertion per clause of the reference sentence**, so a
   dropped fill fails by name instead of surfacing later as an unexplained `.en` diff. Proposed as
   **R-ARCH-18**.
2. **R-PAY-6 must be closed, or AT-ARCH-1 fails on day one** — not as a subtle regression but
   immediately, because every re-mine renumbers the ids the payload cites. §3.2's content-addressed
   ids are the fix; adopting them for archetypes does not fix it for ordinary words, which is the
   larger job.
3. **R-ARCH-4's real generation check.** Archetype correctness is still measured by refilling slots
   from the dictionary and comparing to original bytes — never by `checkTiling`, which re-slices.
   AT-ARCH-1 does not replace it; it sits on top of it.

---

## 8. What is still open — **MECHANICS ONLY**

The direction is settled (§5D.0, eight verbatim statements). Nothing below is a question about
*whether*; each is a question about *how*, and each has a recommendation I will build against unless
told otherwise.

| # | open mechanic | recommendation |
|---|---|---|
| **1** | ~~Does the archetype command emit `.en` first or `.ts` first?~~ | **DONE 2026-08-31 — `.en` first, shipped.** `new-archetype.js` + `engine/entity-sentence.js`; AT-ARCH-1 is checked on every invocation, not in a test only, and a file that cannot be re-mined to its own sentence is **refused, not written**. See §3.6. |
| **2** | Does the derived payload stay inside the `.en` or move to a sidecar cache? | **Stay in the `.en`** (§5). A sidecar reintroduces the §8B drift class. |
| **3** | Is AT-ARCH-1 a gate or a report, at first? | **Gate.** A mining-parameter change that shifts an archetype file's `.en` should fail the build. Real cost, correct default. |
| **4** | Is the archetype vocabulary hand-declared, or does the miner propose new archetypes? | **Hand-declared** (§3.4), with mined *fills*. Proposal can come later; it is not on the critical path. |
| **5** | ~~How far does `compileChunk` move toward full sentence parsing in the first cut?~~ | **DONE 2026-08-31 — derive-and-check shipped.** See §5.3 below for what it does, what it deliberately does not, and the measurement. Cut 2 (making the edit *effective*) is still open and needs §3.2's grammar parser. |

**Resolved, no longer open:** THE LIFT amendment (§6, statements 6–7); whether the sentence or the
payload is authoritative (§5, statement 4); whether §5C and archetype composition are one system
(§3.5, statement 3); whether naming is LLM-assisted and scripted (§5D.2, statement 5).

## 9. Requirements this pass adds

Added to §R as part of this pass (R-ARCH-15, R-ARCH-16, R-LANG-12..14 and the R-MINE-7 amendment are
**already written into the register**; **R-ARCH-13 and R-ARCH-14 landed 2026-08-31 with mechanic 1**).
R-ARCH-9..12 and R-ARCH-17 land when the remaining mechanics settle:

- **R-ARCH-9** — an archetype **MUST** be a dictionary entry, not a layer above the dictionary.
- **R-ARCH-10** — archetype and slot ids **MUST** be content-addressed, never mining-order indices.
- **R-ARCH-11** — slots **MUST** bind by name; positional binding is forbidden.
- **R-ARCH-12** — a variadic slot's fill **MUST** be an ordered list of invocations of a declared
  member word.
- **R-ARCH-13** — **AT-ARCH-1**: for every archetype-generated file, re-mining and re-rendering
  **MUST** reproduce the byte-identical `.en`. Mutation-checked with a de-registration negative
  control.
- **R-ARCH-14** — the archetype command **MUST** emit the `.en` and derive the `.ts` from it
  *(pending DECISION 2)*.
- **R-ARCH-17** — for every pair of productions on an axis, their compiled outputs **MUST** differ
  (grammar injectivity, §4b). Identifier canonicalization **MUST** be injective too.
- **R-MINE-7** — **amended and applied** (§6): refuse an opaque whole-run word; require a
  compositional one.
- **R-ARCH-15 / R-ARCH-16 / R-LANG-12..14** — in the register already.
