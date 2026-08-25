# Regenerate — how to build, and the command that proves it worked

`spec/` is the source; `generated/` is the build output. This file is the
build contract: the procedure, the blast radius, and the literal done-check.

## Build procedure

```
node ../tools/generate.js        # spec/ -> generated/   (pure function of spec/)
```

From `examples/money-cart/`:

```
node tools/generate.js
```

The generator reads every `spec/modules/<m>/spec.md` `spec-codegen` block plus
that module's `constants.md`, and writes one `generated/<m>.js` per module. It is
a deterministic renderer of the standards C4 value grammar and C5 intrinsics:
the same `spec/` produces byte-identical `generated/` on every run.

## Blast radius

- Editing a module's `spec-codegen` block or `constants.md` regenerates **only**
  that module's `generated/<m>.js` (and forces a rebuild of any module that
  `dependsOn` it, since its fixtures exercise the dependency).
- Editing `standards/` or `contracts/` may affect every module and forces a full
  rebuild.
- Editing anything under `generated/` by hand is a drift, not a source change —
  the drift check (below) is designed to catch exactly that.

## Done-check (the command that proves the build)

```
node tools/verify.js
```

`verify.js` loads every `generated/<m>.js` and runs every
`spec/modules/<m>/fixtures/*.json` pair against it. **The build is valid if and
only if every fixture passes** (standards: fixtures are the acceptance oracle).
Exit code 0 = all fixtures pass; non-zero = at least one failed, with the failing
case printed.

## Gated build (Stage 4)

```
node tools/build.js              # scrutinize -> gate -> generate -> verify
```

`build.js` refuses to generate unless the spec folder clears the scrutinize gate
(`scripts/score-folder.js` / `score.js`), so code is never produced from a spec
that has not earned the 95% one-shot bar.

> Tools referenced here (`generate.js`, `verify.js`, `build.js`) are delivered in
> Stages 2–4 of `ROADMAP.md`. This file is the contract they implement.
