# Standards — provincial tax lookup

Load-bearing conventions for the `tax-lookup` module. Every rule fixes an exact
query behaviour against the TypeORM repositories.

## S1 — Applicability window

A tax row **applies on** a query `date` iff both hold:

- `effectiveFrom <= date`, and
- `effectiveUntil IS NULL OR effectiveUntil >= date`.

Dates are ISO `YYYY-MM-DD` strings and are compared as such (lexicographic order
on this format equals chronological order). The bounds are **inclusive** on both
ends. A row whose `effectiveUntil` is `NULL` is open-ended (applies to any date
`>= effectiveFrom`).

## S2 — Province filter

Only rows with `provinceId = :provinceId` are returned. No implicit province
fallback or default.

## S3 — Two sources, union order

There are two source tables, queried independently with the **same** S1+S2 filter:

1. `TaxByProvince` (base rates), then
2. `TaxByProvinceOverride` (overrides).

The result is the **concatenation** `[...base, ...overrides]` — base rows first,
then override rows. Within each source the rows keep the repository's natural
returned order; the module adds **no explicit `ORDER BY`** (matching the reference).

## S4 — No state filter (deliberate)

Rows are **not** filtered by `hydraState`. A row with `hydraState = 'deleted'`
that satisfies S1 and S2 **is returned**. This matches the reference exactly and
is intentional — do not add a `hydraState = 'active'` clause. (Other functions in
the source module do filter state; this one does not.)

## S5 — Access pattern (read-only)

The function receives an initialised TypeORM `DataSource` and reads via
`dataSource.getRepository("<EntityName>").createQueryBuilder("<alias>")`, using
the entity **names** (not imported classes) so the module needs no entity imports.
The function performs **no writes** — it does not insert, update, delete, or
otherwise mutate the database or its arguments.

## S6 — Decimal boundary (out of behavioural scope)

`tax_rate` is a Postgres `decimal`. In production (Postgres + TypeORM) it is
returned as an exact **string** to preserve precision. The in-memory SQLite
substrate used to execute fixtures returns it as a JS **number** (reproduced in
`tools/probe.js`), which is lossy and the wrong type. Therefore:

- The behavioural oracle compares only the **decimal-free projection** of each row
  (`provinceId`, `taxName`, `hydraState`, `effectiveFrom`, `effectiveUntil`). The
  `tax_rate` value is **out of scope** for fidelity claims on this substrate.
- Any behaviour that depends on the numeric value of `tax_rate` (arithmetic,
  numeric `WHERE`/`ORDER BY` on the rate) is **not** covered here and must not be
  validated against SQLite — it requires Postgres (or a decimal-preserving column
  transformer, with its own query-semantics caveats).

This module's behaviour (S1–S5) is purely selection over `date`, `provinceId`, and
the effective window, and is within the substrate's faithful envelope.
