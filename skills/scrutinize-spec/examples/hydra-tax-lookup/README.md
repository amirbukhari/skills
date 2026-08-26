# Example — `hydra-tax-lookup` (Phase 3 slice 2: a DB-touching surface)

The first **database-touching** proof: the generated function runs against a real
**TypeORM repository over an in-memory SQLite database**, and is proven against the
verbatim Hydra query. Target: the selection logic of `getAllTaxesForProvinceByDate`
from `billing-system/src/rentsync-api/invoicing/taxes.ts` — return every base and
override provincial-tax row that applies for a province on a given date.

- `getAllTaxesForProvinceByDate(dataSource, date, provinceId)` — S1 inclusive
  effective-date window, S2 province filter, S3 base-then-override union, S4 **no**
  `hydraState` filter (deleted rows that match are still returned — faithful to the
  source), S5 read-only repository-by-name access.

## The execution substrate (in-memory SQLite via TypeORM)

`tools/substrate.js` builds a `sqljs` `DataSource` with the two entities declared
via TypeORM's decorator-free **`EntitySchema`** API — so the whole path runs under
Node's native TS type-stripping (the `@Column` decorators the real entities use
would need `emitDecoratorMetadata`, which type-stripping does not emit). Fixtures
seed the tables; `verify.js` and `behavioral-diff.js` run the generated function
against the live DB.

## ⚠️ The SQLite ≠ Postgres boundary (reproduced, not papered over)

`tools/probe.js` reproduces, on this exact TypeORM stack, the gotcha flagged before
building the substrate:

| Column type | Postgres + TypeORM | in-memory SQLite (this substrate) |
|---|---|---|
| `decimal` `tax_rate` = `"13.005"` | returns exact **string** `"13.005"` | returns **number** `13.005` (lossy, wrong type) |
| `type: 'enum'` `hydra_state` | native enum | **rejected** by the sqljs driver — modelled as `varchar` here |
| `date` | ISO string | ISO string (faithful; lexical order = chronological) |

So this substrate is only honest for behaviour **inside its faithful envelope**.
This slice's behaviour (S1–S4) is pure selection over `date`/`provinceId`/window,
which is faithful — and the oracle therefore compares a **decimal-free projection**
(`provinceId`, `taxName`, `hydraState`, `effectiveFrom`, `effectiveUntil`), with
`tax_rate` explicitly excluded (S6). **Any slice whose behaviour depends on the
`decimal` value cannot be honestly validated on SQLite** — that needs Postgres (or a
decimal-preserving column transformer, which stores the value as TEXT and so changes
numeric `WHERE`/`ORDER BY` semantics — its own caveat). That is the next boundary.

## The proof (reproduce)

From `skills/scrutinize-spec/`:

```
node examples/hydra-tax-lookup/tools/probe.js            # reproduce the SQLite vs Postgres gotcha
node scripts/score.js examples/hydra-tax-lookup/.analysis/tax-lookup.json
node tools/sdd-build.js examples/hydra-tax-lookup --scrutinize-stub --min-score 85 --model claude-sonnet-4-5
node examples/hydra-tax-lookup/tools/verify.js
node examples/hydra-tax-lookup/tools/behavioral-diff.js
node tools/sdd-check.js examples/hydra-tax-lookup
```

| Check | Result |
|---|---|
| **Scrutinize score** (document mode) | **89.8**, `cappedBy: []` — no gate binds |
| Generation | claude CLI, **fixtures + reference withheld**, passed on **attempt 1** |
| **Fixtures** (over in-memory SQLite) | **6/6** — window, province, deleted-still-returned, boundary inclusivity, union order, empty |
| **Behavioral diff** vs verbatim Hydra reference | **2,048 comparisons, ZERO divergences** — all subsets of a 5-row base pool × 3-row override pool (256 DB states) × 4 query dates × 2 provinces, decimal-free projection |
| Drift (`sdd-check`) | in sync |

The CLI saw the spec but not the fixtures and not the reference, and generated a
TypeORM query that matches the real Hydra selection across every seeded state —
including the deliberately-unfiltered `deleted` rows and the inclusive date bounds.
The generated clause order differs from the reference (province-first vs
province-last); behaviour is identical.

## Honest limits of this proof

- **Selection only, decimal excluded.** The proof covers which rows are returned
  (S1–S4), not the `tax_rate` value — which SQLite misrepresents (S6). Billing-math
  slices that read/compare decimals are out of this substrate's envelope.
- **`EntitySchema`, not decorators.** The entity is declared decorator-free so the
  whole path runs on Node type-stripping. Generating the decorator-style entity
  classes themselves would need a decorator-capable toolchain (ts-node/tsc) — a
  separate concern from the query logic proven here.
- **Fixtures derived from the reference.** Expected values were computed from the
  verbatim reference (the oracle) and withheld from the generator; the 2,048-case
  sweep is the independent, denser check.
