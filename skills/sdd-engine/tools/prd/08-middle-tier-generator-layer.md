# 5A. The middle-tier generator layer — specified as a flow

*PART II — THE MECHANISM · [index](README.md)*

This is the one piece of *new* work, specified end-to-end so it can be built without guessing.

**Input.** The corpus `.ts` file set (the enfile-layer walk, §4). Each function/method body is canonicalized twice: once by the existing **narrow** axis (`operations.js` `fnKey`) and once by the **widened** axis (`measure-middle-tier.js` WIDE canon — member-access names, method names, and constructor names become typed holes `‹m›`/`‹ctor›`, on top of the narrow data/identifier holes). A body is a **middle-tier candidate** when its widened key recurs across the corpus with frequency **≥ `minCount` (2)** and it is not already claimed by an archetype slot.

**Generator record (schema).** Each promoted middle-tier generator is one catalog entry in `<corpus>/sen/catalog/mined-library.json → composites[]`, same envelope as existing composites, with these fields:
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
