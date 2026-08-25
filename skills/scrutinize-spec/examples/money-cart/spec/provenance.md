# Provenance — which code is generated, from which module

Every generated path is claimed by exactly one module. Any source path under the
generated root that matches no claim below, and is not listed as a hand-written
exemption, is an **orphan** — the folder rubric caps the whole tree at 59 when
one exists, because regeneration would silently drop or diverge it.

## Generated root

```
../generated/
```

All build output lives under `generated/` (sibling to `spec/`, at
`examples/money-cart/generated/`). Nothing outside `generated/` is build output;
everything under it is.

## Claims

| Generated path | Owning module | Source |
|---|---|---|
| `generated/money.js` | `money` | `spec/modules/money/spec.md` (+ `constants.md`) |
| `generated/cart.js` | `cart` | `spec/modules/cart/spec.md` (+ `constants.md`) |

## Hand-written exemptions

None. There is no hand-written code under `generated/`. The build tools
(`tools/`) and the specs (`spec/`) are **not** under the generated root and are
not claimed here — they are the source and the compiler, not build output.

## Status

As of Stage 1 the generator does not exist yet, so `generated/` is empty (zero
generated paths) and the orphan set is provably empty. Stage 2 populates it; the
build manifest `.provenance.json` (Stage 3) records the content hashes that make
this table checkable in code.
