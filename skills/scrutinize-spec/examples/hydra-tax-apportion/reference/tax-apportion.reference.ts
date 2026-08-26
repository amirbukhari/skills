/**
 * BEHAVIORAL ORACLE for the decimal-DEPENDENT slice.
 *
 * The two exact-integer functions are VERBATIM lifts from
 * `billing-system/src/hydra-api/massCredits/planning.ts`:
 *   - `taxRateToMillionths`            (lines ~238-247)
 *   - `computeApportionedTaxMinorUnits` (lines ~261-267)
 * with their two imports inlined by their exact upstream definitions:
 *   - `intVal`  from `@jamesgmarks/utilities`  (= parseInt(`${x ?? ''}`, 10))
 *   - `ValidationError` from `src/errors/customErrors.ts` (a plain Error subclass)
 *
 * `computeApportionedProvincialTax` is the thin DB wrapper under test: it reads the
 * applicable active provincial rate (the effective-window + province filter used
 * across `taxes.ts`) and applies the verbatim math to it. It DEPENDS on the decimal
 * `tax_rate` being read back as its exact string — which real Postgres provides and
 * in-memory SQLite does not (that is why this slice needs the Postgres substrate).
 */

import type { DataSource } from "typeorm";

class ValidationError extends Error {}

const intVal = (x: unknown): number => parseInt(`${x !== null && x !== undefined ? x : ""}`, 10);

// --- verbatim: taxRateToMillionths ---
const taxRateToMillionths = (taxRate: string): number => {
  const trimmed = `${taxRate ?? "0"}`.trim();

  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new ValidationError(`A mass credit tax rate must be a non-negative decimal (got '${taxRate}').`);
  }

  const [whole, fraction = ""] = trimmed.split(".");
  return intVal(`${whole}${`${fraction}000000`.slice(0, 6)}`);
};

// --- verbatim: computeApportionedTaxMinorUnits ---
export const computeApportionedTaxMinorUnits = (amountMinorUnits: number, taxRate: string): number => {
  const rateMillionths = taxRateToMillionths(taxRate);
  const scaled = amountMinorUnits * rateMillionths;

  // Half-up on the exact integer product, so the cent never depends on a float's last bit.
  return Math.floor((scaled + 500_000) / 1_000_000);
};

// --- DB wrapper under test ---
export const computeApportionedProvincialTax = async (
  dataSource: DataSource,
  date: string,
  provinceId: number,
  amountMinorUnits: number
): Promise<{ taxRate: string | null; taxMinorUnits: number }> => {
  const rows = await dataSource
    .getRepository("TaxByProvince")
    .createQueryBuilder("tbp")
    .where("tbp.provinceId = :provinceId", { provinceId })
    .andWhere("tbp.hydraState = :active", { active: "active" })
    .andWhere("tbp.effectiveFrom <= :date", { date })
    .andWhere("(tbp.effectiveUntil IS NULL OR tbp.effectiveUntil >= :date)", { date })
    .orderBy("tbp.effectiveFrom", "DESC")
    .addOrderBy("tbp.id", "DESC")
    .getMany();

  const row = rows[0];
  if (!row) {
    return { taxRate: null, taxMinorUnits: 0 };
  }
  return {
    taxRate: (row as { taxRate: string }).taxRate,
    taxMinorUnits: computeApportionedTaxMinorUnits(amountMinorUnits, (row as { taxRate: string }).taxRate),
  };
};
