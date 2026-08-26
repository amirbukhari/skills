/**
 * BEHAVIORAL ORACLE — the selection logic of `getAllTaxesForProvinceByDate` from
 * `billing-system/src/rentsync-api/invoicing/taxes.ts` (lines ~144-164),
 * transcribed with two mechanical adaptations that do not change behaviour:
 *   - takes an explicit TypeORM `DataSource` instead of the module-global
 *     `getQueryBuilder(...)` (which resolves a connection by name);
 *   - the `memoize(...)` wrapper is dropped — it is a caching concern, not part of
 *     the query semantics.
 * The WHERE clauses, the union order (base then override), and the absence of any
 * `hydraState` filter (so 'deleted' rows are included) are preserved verbatim.
 */

import type { DataSource } from "typeorm";

export const getAllTaxesForProvinceByDate = async (
  dataSource: DataSource,
  date: string,
  provinceId: number
): Promise<Record<string, unknown>[]> => {
  const qbTaxByProvince = dataSource.getRepository("TaxByProvince").createQueryBuilder("tbp");
  const taxesForProvince = await qbTaxByProvince
    .where("tbp.effectiveFrom <= :date", { date })
    .andWhere("(tbp.effectiveUntil IS NULL OR tbp.effectiveUntil >= :date)", { date })
    .andWhere("tbp.provinceId = :provinceId", { provinceId })
    .getMany();

  const qbOverrides = dataSource.getRepository("TaxByProvinceOverride").createQueryBuilder("tbpo");
  const taxesForProvinceOverrides = await qbOverrides
    .where("tbpo.effectiveFrom <= :date", { date })
    .andWhere("(tbpo.effectiveUntil IS NULL OR tbpo.effectiveUntil >= :date)", { date })
    .andWhere("tbpo.provinceId = :provinceId", { provinceId })
    .getMany();

  return [...taxesForProvince, ...taxesForProvinceOverrides];
};
