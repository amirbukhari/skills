# Proposal: readable English SENTENCES for composed `.en` spans

**Status:** investigation + proposal (nothing shipped). North star (Amir): a composed `.en`
span should read as *English sentences that convey what the code means*, not a per-line literal
gloss. This doc answers where the gloss comes from, shows real before/after prose, and proposes a
concrete mechanism with its cost and its effect on the byte-identity gate.

**Bottom line up front:** better prose is a **rendering change, not a mining change** — the full
AST (including the intent-bearing `throw` messages) is available at the moment the label is
generated, and the label is **display-only**, so the byte-identity gate is not at risk beyond a
one-line sentinel-sanitisation guard. The information needed for good prose is already in hand; we
are simply discarding it.

---

## 1. Where the gloss is generated, and what information survives

### Call chain (recursive span label)

```
write-en-files.js  (STEP 7 producer)
  └─ enfile.renderFileEn(source, index)
       ├─ Pass 0a: EL.genSpans(sf, source, index._lzw)   → chosen recursive spans {start,end,payload,depth,stmts}
       └─ for each span:  genLabel(start, end, source, stmts)          ← the label lives here
              └─ re-parses source.slice(start,end) into a fresh SourceFile
              └─ G.glossForStatements([...frag.statements], frag)      ← the shallow gloss
       emits:  «▶ <label> ⟪base64({a,w,h})⟫»
```

`compileFileEn` → `compileChunk` reads **only** the base64 payload between `⟪ ⟫`; the label
between `▶` and `⟪` is never read on the way back to `.ts`. (Confirmed in `enfile.js`:
`compileChunk` does `chunk.lastIndexOf(PAY_OPEN/PAY_CLOSE)` and `JSON.parse(base64)` — the label
is not touched.)

### How much semantic information is available at that point?

**All of it.** `genLabel` re-parses the *actual source slice*, so at gloss time the renderer holds
the complete AST: guard conditions, `throw` messages, call names, arguments, identifiers, the lot.
Nothing has been thrown away. `glossForStatements` simply *chooses* to summarise each statement
shallowly — first call name, or the bucket words `"guard"` / `"set a local"` / `"run a step"` —
and joins them with `", then "`.

The most valuable text is discarded outright. In this corpus the `throw new Error("…")` messages
**state the business rule in English**:

- `"One time fee invoices must all be partner billed or all be client billed…"`
- `"Cannot proceed, freshbooks clients do not match on provided subscriptions."`

`glossForStatements` renders both of those as the single word `guard`. **14.5 % of emitted spans
(469 / 3226) contain at least one such `throw`** — that is intent we already have, in English, and
drop on the floor.

### What the recursive *word* carries (the mining side)

A catalog word is `{len, d, sym}` (leaf) or `{len, d, m}` (composite) — pure structure, **no
name, no gloss**. So a *stable per-word domain phrase* ("reject mixed-billing invoices") does not
exist yet and would be a naming addition. But *per-site* prose built from the real code is fully
available at render time. This is the fork in the road:

| Want | Where it comes from | Kind of change |
|---|---|---|
| Prose from the actual code at each site | AST in `genLabel` (already there) | **rendering** |
| One stable domain name per word, reused everywhere | a `name` field on catalog words | **naming/mining** |

Scaffolding for the naming route already exists: `name-generators.js` does exactly this for the
**flat** catalog (worksheet → one LLM/human pass → `name` field; `enfile.js` flat path renders
`g.name || g.gloss`). It has simply never been pointed at the recursive catalog.

---

## 2. Real spans — emitted today vs. hand-written good English

Four spans of increasing depth, pulled from the live corpus.

### depth 2 — `packages/hydra-internal/src/dateTimeHelpers.ts`
**Emitted:** `get toLocaleDateString, then get test, then get test`
**Good:** *"Declare three date-helpers: `makeLocaleDateTimeString` (format a date as a US long-form
date and time), and `validateYearInput` / `validateMonthInput` (regex-test a trimmed string)."*
> Note: this span merges **three unrelated top-level functions**. Prose can name each, but the fact
> that they are one span at all is a *segmentation* artefact (see §3, caveat 2), not a prose bug.

### depth 5 — `src/billingRunner.ts`
**Emitted:** `get getArgsAsObject, then call info, then call connect, then set a local, then set a
local, then get intVal`
**Good:** *"Set up the billing run: read the CLI options and log them, connect the Redis client,
construct the Xero ledger and the Freshbooks payments module, then resolve the run id."*

### depth 7 — `src/doRun.ts`
**Emitted:** `call info, then get getQueryBuilder, then get where, then await getMany, then call
info, then get map, then call info, then return the result`
**Good:** *"Load the client records whose account id is one of the new Freshbooks ids, then map each
new id back to its legacy account id — throwing if a client is missing — and return the legacy
ids."*

### depth 10 — `src/rentsync-api/billing/one-time-fee/clientOneTimeFee.ts` (the north-star span)
**Emitted:** `get distinct, then get distinct, then guard, then set a local, then guard, then set a
local, then get validateAndGetFreshbooksClientIdFromSubs, then guard, then await
getNewFreshbooksIdWithOldFreshbooksId, then guard, then call
updateInternalSubscriptionsTableFromLiftSubscriptions`
**Good:** *"Require every subscription to share one billing mode — all partner-billed or all
client-billed — and, when partner-billed, exactly one partner; resolve that partner, then map the
subscriptions to their new Freshbooks client id, failing if the clients don't match or no mapping
exists, and finally sync the internal subscriptions table."*
> Almost every clause of the good version is *already written in the code's own guard conditions and
> throw messages*. This span is the proof that render-time prose can reach real intent.

---

## 3. Proposed mechanism, cost, and gate impact

Two tiers, independently shippable. **Both keep the label display-only, so neither can move the
byte-identity gate by construction.** The only gate-adjacent concern for either is that a label
must never contain the scanner sentinels `« » ⟪ ⟫` (guillemets never occur in TypeScript, but a
`throw` *string* theoretically could) — a one-line strip/escape on the label text closes it. `▶`
must remain the label's first character. After any change: re-run the gate once
(`node write-en-files.js --no-write --out <tmp>`) and confirm **1037/1037** — non-negotiable.

### Tier 1 — richer deterministic render-time prose  *(recommended first)*

Replace `glossForStatements` (for the span label only) with a prose function that:
- groups by role — declarations ("compute `x`", "resolve `y` from `f`"), returns, and **guards** —
  instead of a flat `", then "` chain;
- for `if (cond) throw new Error("MSG")`, surfaces the **message** as the rule: *"failing if …"* /
  *"require …"*. This alone captures the intent of 14.5 % of spans verbatim from the source;
- humanises identifiers with the helpers **already written** in `engine/prose.js`
  (`words()`, `list()`, `a()` — deterministic, zero model).

- **Cost:** one new function (a span-prose renderer) reusing `prose.js`; no catalog change, no
  regeneration, no LLM. Roughly a day.
- **Gate impact:** none by construction (display-only) + the sentinel guard above. Deterministic,
  so the gate re-run is a formality, not a risk.
- **Ceiling:** excellent for sequential setup, guards, and returns (spans 5, 7, 10 above jump
  dramatically). It cannot invent a *domain name* for a shape whose intent isn't stated in the code.

### Tier 2 — domain names on recursive words  *(optional, higher ceiling, stable)*

Point the existing `name-generators.js` pattern at the recursive catalog: emit a worksheet of the
**1,074 distinct emitted words** (ranked by impact, each with its structural gloss + a real
snippet), take **one** LLM/human pass to author domain phrases, and apply them as a `name` field on
catalog words. The recursive render then prefers `word.name` and falls back to Tier-1 prose.

- **Cost:** one bounded LLM/human pass over 1,074 words (not 5,446 — only emitted words matter),
  re-authored only when new words appear (worksheet is drift-guardable). Adds a short `name` string
  to ~1,074 of the catalog's words — a small size bump on the 0.67 MB artifact.
- **Gate impact:** none — `name` is display-only, same sentinel caveat. No effect on compile.
- **Payoff:** stable, review-once prose that reads the same at every site; reaches intent for the
  spans Tier 1 can't (no in-code message to lean on).

### Recommendation

Ship **Tier 1** first — the biggest readability gain per unit effort, fully deterministic, no
catalog change, no LLM, gate untouched. Layer **Tier 2** on top for the residue where structure
alone can't convey domain meaning.

### Honest caveats

1. **Sentinel sanitisation is the entire gate surface.** As long as the label can't contain
   `« » ⟪ ⟫`, byte-identity is mathematically unaffected. Add the strip and re-run the gate once.
2. **Prose does not fix segmentation.** A span that merges unrelated functions (the depth-2 case)
   will still read as several things joined, because the word boundary is chosen by *compression*,
   not *meaning*. Aligning spans to semantic units (one function → one sentence) is a deeper change
   in `enlzw.genSpans` / the scheduler. It would still be byte-safe (every candidate span is
   byte-gated regardless), but it changes *which* spans emit and belongs in its own proposal — do
   not fold it into the prose work.
