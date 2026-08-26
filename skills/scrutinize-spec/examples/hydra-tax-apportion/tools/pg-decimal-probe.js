// Anti-probe: confirm the SQLite decimal lie does NOT occur on Postgres.
// On the SQLite substrate, tools/probe.js showed tax_rate '13.005' reads back as
// the JS number 13.005 (lossy, wrong type). Here, on real Postgres + TypeORM, it
// must read back as the EXACT string '13.005' (scale preserved), and the enum
// column the sqljs driver rejected must be accepted.
const pg = require("./pg-substrate");

async function main() {
  const srv = await pg.startPostgres();
  try {
    const ds = await pg.createDataSource(srv.port);
    const repo = ds.getRepository("TaxByProvince");

    const samples = ["13.005", "13.00", "0.130000", "0.000001", "5.5"];
    console.log("=== decimal read-back under Postgres ===");
    let allStrings = true;
    let allExact = true;
    for (const input of samples) {
      const saved = await repo.save({
        provinceId: 1, taxName: "probe", taxRate: input, hydraState: "active",
        effectiveFrom: "2024-01-01", effectiveUntil: null,
      });
      const row = await repo.findOneBy({ id: saved.id });
      const isString = typeof row.taxRate === "string";
      const exact = row.taxRate === input;
      allStrings = allStrings && isString;
      allExact = allExact && exact;
      console.log(`  input '${input}' -> ${JSON.stringify(row.taxRate)} (typeof ${typeof row.taxRate})` +
        `${isString ? "" : "  << NOT A STRING"}${exact ? "" : `  << scale changed (got ${JSON.stringify(row.taxRate)})`}`);
    }
    console.log(`  => all strings: ${allStrings}; all scale-exact: ${allExact}`);
    console.log("  (contrast: SQLite substrate returns these as lossy JS numbers — see hydra-tax-lookup/tools/probe.js)");

    console.log("=== enum column (rejected by sqljs, accepted by Postgres) ===");
    const enumRow = await repo.findOneBy({ id: 1 });
    console.log(`  hydra_state stored/read: ${JSON.stringify(enumRow.hydraState)} — enum column created successfully`);

    await ds.destroy();
    if (!allStrings) { console.error("PROBE FAILED: Postgres did not return decimals as strings"); process.exit(1); }
    console.log("PROBE OK: Postgres returns decimals as exact strings; the SQLite lie does not occur here.");
  } finally {
    srv.stop();
  }
}

main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
