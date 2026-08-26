import type { DataSource } from "typeorm";

export const getAllTaxesForProvinceByDate = async (
  dataSource: DataSource,
  date: string,
  provinceId: number,
): Promise<Record<string, unknown>[]> => {
  const baseRepo = dataSource.getRepository("TaxByProvince");
  const baseResults = await baseRepo
    .createQueryBuilder("tbp")
    .where("tbp.provinceId = :provinceId", { provinceId })
    .andWhere("tbp.effectiveFrom <= :date", { date })
    .andWhere("(tbp.effectiveUntil IS NULL OR tbp.effectiveUntil >= :date)", { date })
    .getMany();

  const overrideRepo = dataSource.getRepository("TaxByProvinceOverride");
  const overrideResults = await overrideRepo
    .createQueryBuilder("tbpo")
    .where("tbpo.provinceId = :provinceId", { provinceId })
    .andWhere("tbpo.effectiveFrom <= :date", { date })
    .andWhere("(tbpo.effectiveUntil IS NULL OR tbpo.effectiveUntil >= :date)", { date })
    .getMany();

  return [...baseResults, ...overrideResults];
};
