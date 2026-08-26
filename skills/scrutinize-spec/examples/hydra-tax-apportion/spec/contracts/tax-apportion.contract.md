# Contract — `tax-apportion`

The generated module exports two functions, written in TypeScript, using only
language built-ins and TypeORM's runtime API on the passed `DataSource`. It imports
no entity classes (S5) and defines `ValidationError` and `intVal` inline (S6).

## Functions

```ts
import type { DataSource } from "typeorm";

// S2 + S3 — pure exact-integer apportioned tax. `taxRate` is a decimal string
// multiplier (e.g. "0.13"). Throws ValidationError (S2) on a non-decimal rate.
export const computeApportionedTaxMinorUnits: (
  amountMinorUnits: number,
  taxRate: string,
) => number;

// S1 + S4 — read the applicable active provincial rate for (date, provinceId) and
// apply the math to `amountMinorUnits`. Read-only (S5).
export const computeApportionedProvincialTax: (
  dataSource: DataSource,
  date: string,        // ISO "YYYY-MM-DD"
  provinceId: number,
  amountMinorUnits: number,
) => Promise<{ taxRate: string | null; taxMinorUnits: number }>;
```

## Entity available on the DataSource

Registered under the name `"TaxByProvince"` (table `taxes_by_province`) with
columns: `id` (number, PK), `provinceId`, `taxName`, `taxRate` (decimal, read back
as an **exact string** on Postgres), `hydraState` (enum `'active' | 'deleted'`),
`effectiveFrom`, `effectiveUntil`. Property names are camelCase; use them via the
query-builder alias (e.g. `"tbp.effectiveFrom <= :date"`).

## Guarantees

- **Selection (S1):** the returned row satisfies province, `hydraState = 'active'`,
  and the inclusive effective window; ties broken by `effectiveFrom DESC, id DESC`.
- **Exact-integer math (S2/S3):** millionths parsing and half-up-on-integer
  rounding exactly as specified; no float multiplication of money by a rate.
- **Return shape (S4):** `{ taxRate, taxMinorUnits }`; `taxRate` is the exact
  decimal string (scale preserved) or `null`; `taxMinorUnits` is `0` when no rate.
- **Validation (S2):** `computeApportionedTaxMinorUnits` throws `ValidationError`
  with the exact message on a non-decimal rate (including negatives).
- **Read-only (S5):** the database and arguments are not mutated.

## Error / edge behaviour

- No applicable row → `{ taxRate: null, taxMinorUnits: 0 }` (no throw).
- A malformed/negative rate string reaching `taxRateToMillionths` → `ValidationError`.
- Callers pass an initialised `DataSource`, an ISO `date`, an integer `provinceId`,
  and an integer `amountMinorUnits`. Malformed top-level arguments are out of scope.
