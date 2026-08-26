#!/usr/bin/env node
/**
 * behavioral-diff — sweep many seeded DB states and query parameters, running the
 * spec-generated function and the verbatim Hydra reference against the SAME
 * in-memory database, and compare their decimal-free projections row for row.
 *
 * Both functions are read-only (S5), so each seeded state is queried by both
 * without reseeding between them. tax_rate is excluded from the comparison (S6) —
 * it is substrate-misrepresented and out of the oracle's envelope.
 *
 * Usage: node tools/behavioral-diff.js [path-to-generated-module]
 */

const path = require("path");
const sub = require("./substrate");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const ref = require(path.join(EXAMPLE_ROOT, "reference", "tax-lookup.reference.ts"));
const targetArg = process.argv[2];
const genPath = targetArg ? path.resolve(process.cwd(), targetArg) : path.join(EXAMPLE_ROOT, "generated", "tax-lookup.ts");
const gen = require(genPath);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// Row templates with windows straddling the query dates and both provinces/states.
const basePool = [
  { provinceId: 1, taxName: "b-open-2401", hydraState: "active", effectiveFrom: "2024-01-01", effectiveUntil: null },
  { provinceId: 1, taxName: "b-2020-window", hydraState: "active", effectiveFrom: "2020-01-01", effectiveUntil: "2020-12-31" },
  { provinceId: 1, taxName: "b-deleted-open", hydraState: "deleted", effectiveFrom: "2024-01-01", effectiveUntil: null },
  { provinceId: 2, taxName: "b-prov2", hydraState: "active", effectiveFrom: "2024-01-01", effectiveUntil: null },
  { provinceId: 1, taxName: "b-ends-0701", hydraState: "active", effectiveFrom: "2024-01-01", effectiveUntil: "2024-07-01" },
];
const overridePool = [
  { provinceId: 1, taxName: "o-from-0602", hydraState: "active", effectiveFrom: "2024-06-02", effectiveUntil: null },
  { provinceId: 1, taxName: "o-future", hydraState: "active", effectiveFrom: "2030-01-01", effectiveUntil: null },
  { provinceId: 2, taxName: "o-prov2-open", hydraState: "deleted", effectiveFrom: "2024-01-01", effectiveUntil: null },
];
const QUERY_DATES = ["2020-06-01", "2024-06-30", "2024-07-01", "2024-07-02"];
const QUERY_PROVINCES = [1, 2];

const subsetByMask = (pool, mask) => pool.filter((_, i) => mask & (1 << i));

async function main() {
  const ds = await sub.createDataSource();
  let comparisons = 0;
  const divergences = [];

  for (let bmask = 0; bmask < 1 << basePool.length; bmask++) {
    for (let omask = 0; omask < 1 << overridePool.length; omask++) {
      await sub.reset(ds);
      await sub.seed(ds, { base: subsetByMask(basePool, bmask), overrides: subsetByMask(overridePool, omask) });
      for (const date of QUERY_DATES) {
        for (const provinceId of QUERY_PROVINCES) {
          const r = sub.project(await ref.getAllTaxesForProvinceByDate(ds, date, provinceId));
          const g = sub.project(await gen.getAllTaxesForProvinceByDate(ds, date, provinceId));
          comparisons++;
          if (!deepEqual(r, g) && divergences.length < 20) {
            divergences.push(`b=${bmask} o=${omask} date=${date} prov=${provinceId}: ref=${JSON.stringify(r.map((x) => x.taxName))} gen=${JSON.stringify(g.map((x) => x.taxName))}`);
          }
        }
      }
    }
  }
  await ds.destroy();

  console.log(`behavioral-diff: ran ${comparisons} comparisons (spec-generated vs Hydra reference, in-memory SQLite)`);
  if (divergences.length) {
    console.error(`behavioral-diff: ${divergences.length}+ DIVERGENCES:`);
    for (const d of divergences) console.error("  " + d);
    process.exit(1);
  }
  console.log("behavioral-diff: IDENTICAL — zero divergences across the sweep (decimal-free projection, S6)");
}

main().catch((e) => {
  console.error("behavioral-diff: harness error:", e);
  process.exit(1);
});
