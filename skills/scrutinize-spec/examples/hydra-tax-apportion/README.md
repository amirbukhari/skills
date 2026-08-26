# Example — `hydra-tax-apportion` (Phase 3 slice 3: decimal-DEPENDENT, on Postgres)

The decimal-**dependent** counterpart to `hydra-tax-lookup`. Where that slice proved
decimal-*free* selection on in-memory SQLite and had to **exclude** `tax_rate` from
its oracle, this slice's behaviour **is** the rate (returned as an exact string) and
a value computed from it — so it runs on a **disposable Postgres** substrate, where
`decimal` columns read back as exact strings. Together the two slices are the hybrid:
route decimal-free logic to SQLite, decimal-dependent logic to Postgres.

Target (lifted from `billing-system`):
- `taxRateToMillionths` + `computeApportionedTaxMinorUnits` — **verbatim** from
  `src/hydra-api/massCredits/planning.ts` (exact-integer tax math: a decimal rate
  string → integer millionths → half-up on the integer product; money is never
  multiplied by a float).
- `computeApportionedProvincialTax(dataSource, date, provinceId, amountMinorUnits)`
  — reads the applicable **active** provincial rate (the effective-window + province
  filter used across `taxes.ts`) and applies the math, returning
  `{ taxRate: <exact string> | null, taxMinorUnits }`.

## The disposable Postgres substrate

`tools/pg-substrate.js` starts an **ephemeral** `postgres:16-alpine` container
(`docker run --rm` on a throwaway port bound to `127.0.0.1`, torn down in `stop()`),
runs TypeORM 0.3 against it (entities via decorator-free `EntitySchema`), and points
at **nothing real** — it never touches port 3309 or any production billing database.
It requires a usable docker daemon; spin-up + readiness poll + teardown are all in
the harness. On this substrate the `hydra_state` **enum** column (which the sqljs
driver rejected) is a real Postgres enum.

## ✅ The decimal reads back as an exact string (the SQLite lie does not occur)

`tools/pg-decimal-probe.js` is the anti-`probe.js`. On this exact TypeORM+Postgres
stack:

| `tax_rate` input | in-memory SQLite (`hydra-tax-lookup/tools/probe.js`) | disposable Postgres (here) |
|---|---|---|
| `"13.005"` | number `13.005` (lossy, wrong type) | **string `"13.005"`** |
| `"13.00"` | number `13` (scale lost) | **string `"13.00"`** |
| `"0.130000"` | number `0.13` | **string `"0.130000"`** (scale preserved) |
| `type: 'enum'` | rejected by driver | native enum |

So the oracle compares `taxRate` **as an exact string**, which is only honest on
Postgres.

## The proof (reproduce)

From `skills/scrutinize-spec/` (needs a usable docker daemon):

```
node examples/hydra-tax-apportion/tools/pg-decimal-probe.js     # decimals are exact strings on PG
node scripts/score.js examples/hydra-tax-apportion/.analysis/tax-apportion.json
node tools/sdd-build.js examples/hydra-tax-apportion --scrutinize-stub --min-score 85 --model claude-sonnet-4-5
node examples/hydra-tax-apportion/tools/verify.js
node examples/hydra-tax-apportion/tools/behavioral-diff.js
node tools/sdd-check.js examples/hydra-tax-apportion
```

| Check | Result |
|---|---|
| **Scrutinize score** | **90.5**, `cappedBy: []` — no gate binds |
| Generation | claude CLI, **fixtures + reference withheld**, passed on **attempt 1** |
| **Fixtures** | **20/20** — 13 pure (rate/amount → cents, half-up edge, truncation, `ValidationError`) + 7 DB (exact-string rate, scale preserved, most-recent-wins, deleted/expired/no-match → null, negative-rate throw) |
| **Behavioral diff** vs verbatim reference | **544 comparisons, ZERO divergences** — 160 pure (10 amounts × 16 rates incl. throwers) + 384 DB (all 32 subsets of a 5-row pool × 3 dates × 2 provinces × 2 amounts), `taxRate` compared as exact string |
| Decimal fidelity | `tax_rate` reads back as exact scale-preserved string on Postgres |
| Drift (`sdd-check`) | in sync |

The CLI saw the spec but not the fixtures and not the reference, and generated the
exact-integer math and the TypeORM query that match the real Hydra behaviour across
every case — including the `ValidationError` path and the exact-string rate.

## Honest limits of this proof

- **Requires docker.** The substrate spins a real ephemeral Postgres container; with
  no usable docker daemon the DB fixtures cannot run (the pure-math fixtures still do).
- **`EntitySchema`, not decorators.** As in the SQLite slice, the entity is declared
  decorator-free so the path runs on Node type-stripping; generating decorator-style
  entity classes is a separate toolchain concern.
- **Fixtures derived from the reference.** Expected values were computed from the
  verbatim reference and withheld from the generator; the 544-case sweep is the
  independent, denser check.
