/**
 * Execution substrate — in-memory SQLite (sql.js) via TypeORM 0.3.
 *
 * This is the fixtures-as-oracle backend for a DB-touching slice: the generated
 * query function runs against a real TypeORM repository over an in-memory SQLite
 * database. Entities are declared with the decorator-free `EntitySchema` API so
 * the whole path runs under Node's native TS type-stripping (TypeORM's `@Column`
 * decorators would need `emitDecoratorMetadata`, which type-stripping does not do).
 *
 * FIDELITY BOUNDARY (see README): SQLite is NOT a faithful mirror of Hydra's
 * Postgres schema. Two gaps, both reproduced in tools/probe.js:
 *   - `decimal` columns (e.g. tax_rate) read back as JS **numbers** here, whereas
 *     Postgres+TypeORM returns exact **strings**. So this substrate is only valid
 *     for behaviour that does NOT depend on decimal values. tax_rate is therefore
 *     excluded from the oracle projection below.
 *   - `type: 'enum'` is rejected by the sqljs driver, so hydra_state is modelled
 *     as varchar here (the real entity uses a Postgres enum).
 */

require("reflect-metadata");
const { DataSource, EntitySchema } = require("typeorm");

const commonColumns = {
  id: { type: Number, primary: true, generated: true },
  provinceId: { name: "province_id", type: "int" },
  taxName: { name: "tax_name", type: "varchar" },
  taxRate: { name: "tax_rate", type: "decimal" }, // decimal boundary — excluded from the oracle
  hydraState: { name: "hydra_state", type: "varchar" }, // real entity: Postgres enum
  effectiveFrom: { name: "effective_from", type: "date" },
  effectiveUntil: { name: "effective_until", type: "date", nullable: true },
};

const TaxByProvince = new EntitySchema({
  name: "TaxByProvince",
  tableName: "taxes_by_province",
  columns: { ...commonColumns },
});

const TaxByProvinceOverride = new EntitySchema({
  name: "TaxByProvinceOverride",
  tableName: "taxes_by_province_override",
  columns: {
    ...commonColumns,
    revenueTrackingCode: { name: "revenue_tracking_code", type: "varchar" },
  },
});

async function createDataSource() {
  const ds = new DataSource({
    type: "sqljs",
    location: undefined,
    autoSave: false,
    synchronize: true,
    entities: [TaxByProvince, TaxByProvinceOverride],
  });
  await ds.initialize();
  return ds;
}

async function reset(ds) {
  await ds.getRepository("TaxByProvinceOverride").clear();
  await ds.getRepository("TaxByProvince").clear();
}

/** Seed { base: [...], overrides: [...] } and return nothing (ids autogenerate). */
async function seed(ds, data) {
  const withRate = (r) => ({ taxRate: "1.00", ...r });
  if (data.base && data.base.length) await ds.getRepository("TaxByProvince").save(data.base.map(withRate));
  if (data.overrides && data.overrides.length) {
    await ds.getRepository("TaxByProvinceOverride").save(data.overrides.map((r) => ({ revenueTrackingCode: "RTC", ...withRate(r) })));
  }
}

/**
 * Decimal-free projection used as the oracle. tax_rate is deliberately dropped —
 * it is substrate-misrepresented (see boundary above), so comparing it would be a
 * lie about billing math, not a proof.
 */
function projectRow(r) {
  return {
    provinceId: r.provinceId,
    taxName: r.taxName,
    hydraState: r.hydraState,
    effectiveFrom: r.effectiveFrom,
    effectiveUntil: r.effectiveUntil,
  };
}
const project = (rows) => rows.map(projectRow);

module.exports = { createDataSource, reset, seed, project, projectRow, TaxByProvince, TaxByProvinceOverride };
