# Example — `money-cart` (spec-driven-dev vertical slice)

The worked example for the roadmap in `../../ROADMAP.md`: a spec folder that is
the **source of truth**, from which code is regenerated as a build artifact.

Domain: a tiny, pure library — a `money` module (integer-cents arithmetic,
banker's rounding, USD formatting) and a `cart` module (line items → subtotal,
tax, total) that depends on `money` through a contract. Chosen deliberately so
that deterministic, byte-reproducible generation is genuinely provable.

## Layout

```
spec/                 the source (authored + scrutinized)          [Stage 1 ✓]
  standards/conventions.md   C1–C6: cents, purity, the codegen grammar + intrinsics
  contracts/money.contract.md  money's public interface (cart depends on it)
  modules/money/  spec.md (spec-codegen block) + constants.md + fixtures/
  modules/cart/   spec.md (spec-codegen block) + constants.md + fixtures/
  unspecified.md   what the generator is free to choose (not contractual)
  provenance.md    which generated path comes from which module
  regenerate.md    build procedure, blast radius, done-check command
generated/            build output — pure function of spec/          [Stage 2]
tools/                generate.js, verify.js, build.js               [Stages 2–4]
.analysis/            committed analysis JSON fed to the scoring scripts
```

## The source-of-truth seam

Each `modules/<m>/spec.md` contains a fenced ` ```spec-codegen ` JSON block. That
block — plus the module's `constants.md` — is what the Stage 2 generator reads to
emit `generated/<m>.js`. Editing the block or a constant is what changes the code.
The value grammar and intrinsic catalogue those blocks draw on are defined once,
procedurally, in `standards/conventions.md` (C4, C5), and inherited by every
module.

## Current score (Stage 1)

Run from `examples/money-cart/`:

```
node ../../scripts/score.js .analysis/money.json     # money  -> 88.9
node ../../scripts/score.js .analysis/cart.json      # cart   -> 87.9
node ../../scripts/score-folder.js .analysis/folder.json
# -> finalScore 87.9, cappedBy ["weakest_module:cart"], contractCycles []
```

No structural gate binds — no orphan code (`generated/` is empty until Stage 2),
no contract cycle (`cart → money` is acyclic, computed in code), and fixtures are
committed as executable input/expected-output pairs. The only cap is the numeric
weakest-module one. Raising the last few points is Stage 5 polish; Stages 2–4
first make the folder actually *build*.
