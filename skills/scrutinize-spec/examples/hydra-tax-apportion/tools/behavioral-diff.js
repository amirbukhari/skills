#!/usr/bin/env node
/**
 * behavioral-diff — compare the spec-generated module against the verbatim Hydra
 * reference across two sweeps:
 *   PURE: computeApportionedTaxMinorUnits over many (amount, rate) pairs, incl.
 *         rates that must throw ValidationError.
 *   DB:   computeApportionedProvincialTax over many seeded DB states × queries,
 *         comparing the full { taxRate, taxMinorUnits } (taxRate as exact string).
 *
 * Usage: node tools/behavioral-diff.js [path-to-generated-module]
 */

const path = require("path");
const pg = require("./pg-substrate");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const ref = require(path.join(EXAMPLE_ROOT, "reference", "tax-apportion.reference.ts"));
const targetArg = process.argv[2];
const genPath = targetArg ? path.resolve(process.cwd(), targetArg) : path.join(EXAMPLE_ROOT, "generated", "tax-apportion.ts");
const gen = require(genPath);

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

const divergences = [];
let comparisons = 0;
function compare(label, r, g) {
  comparisons++;
  let same;
  if (r.ok !== g.ok) same = false;
  else if (r.ok) same = deepEqual(r.value, g.value);
  else same = r.msg === g.msg;
  if (!same && divergences.length < 20) {
    divergences.push(`${label}: ref=${JSON.stringify(r.ok ? r.value : "THROW:" + r.msg)} gen=${JSON.stringify(g.ok ? g.value : "THROW:" + g.msg)}`);
  }
}
function capSync(fn, args) {
  try { return { ok: true, value: fn(...args) }; } catch (e) { return { ok: false, msg: e.message }; }
}
async function capAsync(fn, args) {
  try { return { ok: true, value: await fn(...args) }; } catch (e) { return { ok: false, msg: e.message }; }
}

const RATES = ["0", "0.13", "0.130000", "0.05", "0.15", "1", "13", "0.000001", "0.999999", "0.5", "0.135", "0.1234567", "2.5", "-0.13", "abc", ""];
const AMOUNTS = [0, 1, 15, 99, 100, 10000, 123456, 7, 250, 5000];

async function main() {
  // PURE sweep (no DB)
  for (const amount of AMOUNTS) {
    for (const rate of RATES) {
      compare(`pure(${amount},'${rate}')`, capSync(ref.computeApportionedTaxMinorUnits, [amount, rate]), capSync(gen.computeApportionedTaxMinorUnits, [amount, rate]));
    }
  }

  // DB sweep
  const basePool = [
    { provinceId: 1, taxName: "b1", taxRate: "0.13", hydraState: "active", effectiveFrom: "2024-01-01", effectiveUntil: null },
    { provinceId: 1, taxName: "b2", taxRate: "0.10", hydraState: "active", effectiveFrom: "2024-06-01", effectiveUntil: null },
    { provinceId: 1, taxName: "b3-del", taxRate: "0.99", hydraState: "deleted", effectiveFrom: "2024-01-01", effectiveUntil: null },
    { provinceId: 2, taxName: "b4", taxRate: "0.05", hydraState: "active", effectiveFrom: "2024-01-01", effectiveUntil: null },
    { provinceId: 1, taxName: "b5-exp", taxRate: "0.07", hydraState: "active", effectiveFrom: "2020-01-01", effectiveUntil: "2020-12-31" },
  ];
  const DATES = ["2020-06-01", "2024-05-01", "2024-07-01"];
  const PROVS = [1, 2];
  const AMTS = [10000, 15];
  const subset = (mask) => basePool.filter((_, i) => mask & (1 << i));

  const srv = await pg.startPostgres();
  try {
    const ds = await pg.createDataSource(srv.port);
    for (let mask = 0; mask < 1 << basePool.length; mask++) {
      await pg.reset(ds);
      await pg.seed(ds, { base: subset(mask) });
      for (const date of DATES) {
        for (const provinceId of PROVS) {
          for (const amt of AMTS) {
            const r = await capAsync(ref.computeApportionedProvincialTax, [ds, date, provinceId, amt]);
            const g = await capAsync(gen.computeApportionedProvincialTax, [ds, date, provinceId, amt]);
            compare(`db(mask=${mask},${date},p${provinceId},${amt})`, r, g);
          }
        }
      }
    }
    await ds.destroy();
  } finally {
    srv.stop();
  }

  console.log(`behavioral-diff: ran ${comparisons} comparisons (spec-generated vs Hydra reference; pure + Postgres DB)`);
  if (divergences.length) {
    console.error(`behavioral-diff: ${divergences.length}+ DIVERGENCES:`);
    for (const d of divergences) console.error("  " + d);
    process.exit(1);
  }
  console.log("behavioral-diff: IDENTICAL — zero divergences (taxRate compared as exact string)");
}

main().catch((e) => { console.error("behavioral-diff: harness error:", e); process.exit(1); });
