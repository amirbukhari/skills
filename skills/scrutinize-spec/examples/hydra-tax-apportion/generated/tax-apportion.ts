import type { DataSource } from "typeorm";

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const intVal = (x: any): number => {
  return parseInt(String(x ?? ''), 10);
};

const taxRateToMillionths = (rate: string): number => {
  const trimmed = String(rate ?? '0').trim();
  
  if (!(/^\d+(\.\d+)?$/.test(trimmed))) {
    throw new ValidationError(`A mass credit tax rate must be a non-negative decimal (got '${rate}').`);
  }
  
  const parts = trimmed.split('.');
  const whole = parts[0];
  const fraction = parts[1] ?? '';
  
  const paddedFraction = `${fraction}000000`.slice(0, 6);
  
  return intVal(whole + paddedFraction);
};

export const computeApportionedTaxMinorUnits = (
  amountMinorUnits: number,
  taxRate: string,
): number => {
  const rateMillionths = taxRateToMillionths(taxRate);
  const scaled = amountMinorUnits * rateMillionths;
  return Math.floor((scaled + 500000) / 1000000);
};

export const computeApportionedProvincialTax = async (
  dataSource: DataSource,
  date: string,
  provinceId: number,
  amountMinorUnits: number,
): Promise<{ taxRate: string | null; taxMinorUnits: number }> => {
  const repo = dataSource.getRepository("TaxByProvince");
  
  const qb = repo.createQueryBuilder("tbp");
  
  const row = await qb
    .where("tbp.provinceId = :provinceId", { provinceId })
    .andWhere("tbp.hydraState = :state", { state: "active" })
    .andWhere("tbp.effectiveFrom <= :date", { date })
    .andWhere("(tbp.effectiveUntil IS NULL OR tbp.effectiveUntil >= :date)", { date })
    .orderBy("tbp.effectiveFrom", "DESC")
    .addOrderBy("tbp.id", "DESC")
    .getOne();
  
  if (!row) {
    return { taxRate: null, taxMinorUnits: 0 };
  }
  
  const taxRate = row.taxRate;
  const taxMinorUnits = computeApportionedTaxMinorUnits(amountMinorUnits, taxRate);
  
  return { taxRate, taxMinorUnits };
};
