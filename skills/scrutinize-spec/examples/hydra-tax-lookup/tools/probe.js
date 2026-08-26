// Probe: does TypeORM + sql.js run in-memory under Node native TS, and how does
// SQLite represent the Hydra column types that billing depends on?
require("reflect-metadata");
const { DataSource, EntitySchema } = require("typeorm");

// TaxByProvince as an EntitySchema (decorator-free, so Node type-stripping is fine).
// Faithful to the real entity's non-relational columns.
const TaxByProvince = new EntitySchema({
  name: "TaxByProvince",
  tableName: "taxes_by_province",
  columns: {
    id: { type: Number, primary: true, generated: true },
    provinceId: { name: "province_id", type: "int" },
    taxName: { name: "tax_name", type: "varchar" },
    taxRate: { name: "tax_rate", type: "decimal" }, // decimal — the gotcha vector
    hydraState: { name: "hydra_state", type: "varchar" }, // real entity uses enum; see enum probe below
    effectiveFrom: { name: "effective_from", type: "date" },
    effectiveUntil: { name: "effective_until", type: "date", nullable: true },
  },
});

async function main() {
  const ds = new DataSource({
    type: "sqljs",
    location: undefined,
    autoSave: false,
    synchronize: true,
    entities: [TaxByProvince],
  });
  await ds.initialize();
  const repo = ds.getRepository("TaxByProvince");

  const saved = await repo.save({
    provinceId: 1,
    taxName: "ON-HST",
    taxRate: "13.005", // exact decimal string, as Postgres/TypeORM would hold it
    hydraState: "active",
    effectiveFrom: "2024-01-01",
    effectiveUntil: null,
  });

  const row = await repo.findOneBy({ id: saved.id });
  console.log("=== decimal read-back under SQLite ===");
  console.log("  stored taxRate input: '13.005' (string)");
  console.log("  read taxRate value:", JSON.stringify(row.taxRate), "typeof:", typeof row.taxRate);
  console.log("  Postgres+TypeORM would return: '13.005' (string) — decimal is returned as text to preserve precision");
  console.log("  => MISMATCH:", typeof row.taxRate !== "string" ? "SQLite returns a NUMBER (lossy, wrong type)" : "match");

  // Precision probe: a value not exactly representable as float64
  const p = await repo.save({ provinceId: 2, taxName: "P2", taxRate: "0.1", hydraState: "active", effectiveFrom: "2024-01-01", effectiveUntil: null });
  const pr = await repo.findOneBy({ id: p.id });
  console.log("  precision probe taxRate '0.1' ->", JSON.stringify(pr.taxRate), typeof pr.taxRate);

  // date read-back
  console.log("=== date read-back ===");
  console.log("  effectiveFrom:", JSON.stringify(row.effectiveFrom), "typeof:", typeof row.effectiveFrom);

  await ds.destroy();

  // enum probe: real entity uses type:'enum'; does the sqlite driver accept it?
  console.log("=== enum-type probe (real entity uses type: 'enum') ===");
  try {
    const WithEnum = new EntitySchema({
      name: "WithEnum",
      tableName: "with_enum",
      columns: {
        id: { type: Number, primary: true, generated: true },
        state: { type: "enum", enum: ["active", "deleted"] },
      },
    });
    const ds2 = new DataSource({ type: "sqljs", autoSave: false, synchronize: true, entities: [WithEnum] });
    await ds2.initialize();
    console.log("  enum accepted by sqlite driver (unexpected)");
    await ds2.destroy();
  } catch (e) {
    console.log("  enum REJECTED by sqlite driver:", e.message.split("\n")[0]);
  }
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
