# Contract — `tax-lookup`

The generated module exports one async query function. It is written in TypeScript,
uses only TypeORM's runtime API on the passed `DataSource`, imports no entity
classes (S5), and performs no writes.

## Function

```ts
import type { DataSource } from "typeorm";

// Return every base and override tax row for `provinceId` that applies on `date`
// (S1 window, S2 province), base rows first then override rows (S3), with no
// hydraState filter (S4). Read-only (S5).
export const getAllTaxesForProvinceByDate: (
  dataSource: DataSource,
  date: string,        // ISO "YYYY-MM-DD"
  provinceId: number,
) => Promise<Record<string, unknown>[]>;
```

## Entities available on the DataSource

Registered by these **names** (use `dataSource.getRepository("<name>")`):

- `"TaxByProvince"` — table `taxes_by_province`. Columns: `id` (number, PK),
  `provinceId`, `taxName`, `taxRate`, `hydraState`, `effectiveFrom`,
  `effectiveUntil`.
- `"TaxByProvinceOverride"` — table `taxes_by_province_override`. Same columns plus
  `revenueTrackingCode`.

Property names on the entities are camelCase (`effectiveFrom`, `effectiveUntil`,
`provinceId`, `hydraState`); use them in query-builder clauses via the alias
(e.g. `"tbp.effectiveFrom <= :date"`).

## Guarantees

- **Window (S1):** a returned row satisfies `effectiveFrom <= date` and
  (`effectiveUntil IS NULL` or `effectiveUntil >= date`). Inclusive both ends.
- **Province (S2):** every returned row has `provinceId === provinceId`.
- **Union order (S3):** result is `[...baseMatches, ...overrideMatches]`; no
  explicit ordering is imposed within a source.
- **No state filter (S4):** `deleted` rows that satisfy S1+S2 are included.
- **Read-only (S5):** the database and the arguments are not mutated.
- **Shape:** each element is the full entity row object. `tax_rate` is present but
  is **out of behavioural scope** (S6) — fidelity is claimed only over
  `provinceId`, `taxName`, `hydraState`, `effectiveFrom`, `effectiveUntil`.

## Error / edge behaviour

- No matching rows → returns `[]`.
- The caller passes an initialised `DataSource` with both entities registered and a
  well-formed ISO `date` string and integer `provinceId`. Malformed arguments are
  out of scope (unguarded), matching the reference.
