# Roadmap — from spec *scrutinizer* to spec-driven-dev harness

## North star

Spec-driven development where the **spec folder is the real source code** and generated code is a **compiled build artifact**. The `spec/` tree is authored and scrutinized to the 95% one-shot bar; from it, code is regenerated; editing the spec is what causes the corresponding code to change.

```
spec/  ──scrutinize (gate)──▶  generate  ──▶  generated/   ──run fixtures──▶  pass/fail
  ▲                                                │
  └────────────────  edit spec, rebuild  ◀─────────┘
spec = source          code = build output
```

## The determinism question (settled here so every stage is honest)

The vision says code is "regenerated **deterministically**." There are two honest readings, and this roadmap commits to both, at two layers:

1. **Transform determinism (byte-level).** For a *constrained, structured* spec, generation is a pure function of the spec files: same `spec/` in → byte-identical `generated/` out, every run. We prove this with a hash/diff of two runs. This is the "compiler" analogy taken literally, and it is what Stages 2–3 build. It is achievable because the generator is a deterministic template/codegen over structured spec input — **not** a free-form LLM.
2. **Behavioral determinism (fixture-gated).** `references/folder-rubric.md` already states the generator-in-general is *not* byte-deterministic (an LLM emits different code each run). There, validity is defined as "**a regeneration is valid iff every fixture passes**." That gate still holds and is the bridge to an eventual LLM generator: the deterministic core we build is the reference implementation, and the fixtures are the oracle any generator (deterministic or LLM) must satisfy.

So: **the deterministic core is what we build and prove; the fixture gate is what makes the claim survive swapping in a non-deterministic generator later.** No stage hand-waves "deterministic."

> **Architecture decision (chosen default, Amir can redirect):** the deterministic core is a **constrained structured spec + template codegen**, dependency-free Node, not a general-purpose LLM generator and not a full expression-language DSL. The example domain is small and pure so byte-determinism is genuinely provable. An LLM generation path is explicitly out of scope for the core and remains fixture-gated future work. If Amir wants the first generator to *be* the LLM path (behavioral determinism only, no byte-level proof), that flips Stages 2–3 — flag it and I adjust.

## Example domain (the vertical slice)

A tiny, pure, fixture-checkable library — chosen so byte-deterministic generation is real, not aspirational:

- **`money`** module — integer-cents arithmetic, half-even rounding, USD formatting. No dependencies.
- **`cart`** module — line items → subtotal, tax, total. Depends on `money` via a contract.

Pure functions only, no I/O, no time, no randomness → the generated code is a pure function of the spec, and fixtures are trivially executable. Everything lives under `skills/scrutinize-spec/examples/money-cart/`:

```
examples/money-cart/
  spec/            the source (authored + scrutinized)   ← Stage 1
  generated/       build output (never hand-edited)       ← Stage 2
  tools/           generate.js, verify.js, build.js        ← Stages 2–4
  .provenance.json build manifest (spec→code hashes)       ← Stage 3
```

---

## Stage 0 — Baseline (DONE)

Scrutinizer scores specs deterministically in document mode (`score.js`, 13 dims) and folder mode (`score-folder.js`, 8 dims). `PRD.md` now matches the implementation and self-scores 90.5.

**Proof:** `node scripts/score.js <analysis.json>` and `score-folder.js` run and gate as documented.

---

## Stage 1 — A real folder-mode `spec/` tree

**Deliverable:** the canonical folder layout, fully populated, for the money+cart domain: `standards/`, `contracts/`, `modules/money/`, `modules/cart/` (each with `spec.md` carrying a machine-authoritative fenced ```spec-codegen``` JSON block + `constants.md` + `fixtures/*.json`), `unspecified.md`, `provenance.md`, `regenerate.md`. Plus the per-module and folder analysis JSONs.

**How I prove it works:**
- Each module scored by `scripts/score.js` → record `finalScore` per module.
- Folder scored by `scripts/score-folder.js` → honest `finalScore`, **no `orphan_code_detected`** (nothing generated yet, so provenance claims cover the empty set truthfully), **no `contract_cycle`** (money has no deps; cart→money is acyclic), `fixtureExecutability` real because fixtures are committed input/expected-output JSON.
- The fenced codegen block in each `spec.md` is valid JSON (parseable) — this is the seam Stage 2's generator consumes, so Stage 1 must leave it machine-readable.

**Exit criterion:** folder scores honestly in the high 80s+ with no hard gate binding, and the codegen blocks parse. (Not required to hit 95 yet — orphan/fixture realism matters more than the last few points.)

---

## Stage 2 — Deterministic `spec → code` generator

**Deliverable:** `tools/generate.js` — dependency-free Node. Reads `spec/` (the fenced codegen blocks + `constants.md`) and emits `generated/money.js`, `generated/cart.js` as a **pure function of the spec**.

**How I prove it works:**
- **Byte-determinism:** run `generate.js` twice into two dirs; `diff -r` / sha256 shows identical output. Same spec → same bytes.
- **Behavioral correctness:** `tools/verify.js` loads `generated/` and runs every `fixtures/*.json` pair; all pass.
- **Spec-drives-code:** change one constant in `spec/modules/money/constants.md` (e.g. rounding mode), regenerate, show the generated code changed at exactly the expected point and fixtures reflect it.

**Exit criterion:** two-run hash-identical output + 100% fixtures pass, from an unedited spec.

---

## Stage 3 — Regeneration-on-edit, provenance & drift detection

**Deliverable:** provenance manifest (`.provenance.json`: each generated path ← its owning module + content hashes of spec inputs and generated output) and `generate.js --check` drift mode.

**How I prove it works (three drift scenarios):**
- **Stale build:** edit a spec constant, *don't* regenerate → `--check` reports "generated/ is stale vs spec" (spec-input hash changed).
- **Hand-edited artifact:** manually edit a `generated/` file → `--check` reports "artifact diverged from generator output" (output hash mismatch) — the drift that makes code-as-source-of-truth dangerous.
- **Orphan:** add a stray file in `generated/` claimed by no module → `--check` flags it, mirroring folder-mode's `orphan_code_detected` gate but at build time.
- Round-trip: edit spec → `regenerate` → provenance updates, fixtures pass, `--check` clean.

**Exit criterion:** all three drift scenarios detected; clean round-trip leaves `--check` green.

---

## Stage 4 — Scrutinize gate as the precondition for generation

**Deliverable:** `tools/build.js` — the pipeline `scrutinize → (gate) → generate → verify`. It runs the folder analysis through `score-folder.js` (and each module through `score.js`) and **refuses to generate** unless the gate passes a configured threshold.

**How I prove it works:**
- Degrade a module spec below the bar (e.g. delete its fixtures) → `build.js` **refuses**, printing the failing gate (`fixtures_not_executable` / `weakest_module:<name>`), and `generated/` is left untouched.
- Restore → `build.js` proceeds through generate + verify to green.
- Demonstrates the core inversion: **you cannot compile a spec that hasn't earned it.**

**Exit criterion:** build blocked on a sub-bar spec with the reason named; build succeeds end-to-end on a passing spec.

---

## Stage 5 — Consolidate into the skill (vision realized)

**Deliverable:** document the full loop as a "spec-driven-dev mode" in `SKILL.md`, so the skill orchestrates author → scrutinize → gate → generate → verify → (edit → rebuild). Update the skill `README.md` and `examples/` pointers. Reconcile the repo-root `README.md` (currently a mock placeholder).

**How I prove it works:** a single documented end-to-end walkthrough on `money-cart`: from a spec edit to regenerated, verified code, gate-enforced, drift-checked.

**Exit criterion:** a new user can follow the walkthrough and reproduce the whole loop with only Node + the skill.

---

## Decisions that genuinely need Amir (flagged, not blocking)

1. **Generator identity (Stages 2–3):** deterministic template codegen (byte-provable, chosen default) vs. LLM generation (behavioral/fixture determinism only). I proceed with the former; say the word to flip it.
2. **Where the demo lives:** under `skills/scrutinize-spec/examples/money-cart/` (chosen) vs. a top-level `spec-driven/` dir. Cosmetic; easy to move.
3. **Scope of the example domain:** money+cart is deliberately tiny to make determinism provable. If you'd rather the first slice generate something load-bearing (e.g. the scoring scripts themselves from a spec), that's a bigger, riskier slice — I'd tackle it after the tiny one proves the loop.

I will keep advancing stage by stage and commit each milestone locally, stopping only for a real fork (irreversible step, push/publish, or a decision above).
