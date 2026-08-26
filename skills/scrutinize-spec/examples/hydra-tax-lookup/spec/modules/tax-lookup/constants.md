# Constants — `tax-lookup`

Every load-bearing literal the rules reference, enumerated. No unpopulated values.

| Constant | Value | Used by | Meaning |
|---|---|---|---|
| `BASE_ENTITY_NAME` | `"TaxByProvince"` | S3 | Repository name for base provincial tax rows. |
| `OVERRIDE_ENTITY_NAME` | `"TaxByProvinceOverride"` | S3 | Repository name for override rows. |
| `BASE_TABLE` | `taxes_by_province` | reference | Underlying table for base rows. |
| `OVERRIDE_TABLE` | `taxes_by_province_override` | reference | Underlying table for override rows. |
| `FROM_CLAUSE` | `effectiveFrom <= :date` | S1 | Lower-bound applicability clause (inclusive). |
| `UNTIL_CLAUSE` | `effectiveUntil IS NULL OR effectiveUntil >= :date` | S1 | Upper-bound applicability clause (inclusive, NULL = open). |
| `PROVINCE_CLAUSE` | `provinceId = :provinceId` | S2 | Province filter. |
| `DATE_FORMAT` | `YYYY-MM-DD` | S1 | ISO date string format (lexicographic == chronological). |
| `UNION_ORDER` | base-then-override | S3 | Concatenation order of the two sources. |
| `STATE_FILTERED` | `false` | S4 | Whether `hydraState` is filtered (it is not). |
| `EMPTY_RESULT` | `[]` | contract | Returned when no rows match. |

The generated code need not name these constants; it must reproduce the exact
clause semantics, entity names, and union order.
