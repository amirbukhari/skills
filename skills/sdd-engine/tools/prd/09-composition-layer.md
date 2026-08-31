# 5B. The composition layer — specified as a requirement

*PART II — THE MECHANISM · [index](README.md)*

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
