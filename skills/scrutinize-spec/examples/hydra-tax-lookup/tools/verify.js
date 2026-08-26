#!/usr/bin/env node
/**
 * verify — run the tax-lookup fixtures against a generated implementation, using
 * the in-memory SQLite + TypeORM substrate. Each fixture seeds the two tables,
 * runs the function for (date, provinceId), and compares the decimal-free
 * projection (S6) of the returned rows to the expected list. Exit 0 iff all pass.
 *
 * Usage: node tools/verify.js [path-to-generated-module]
 *        (defaults to ../generated/tax-lookup.ts)
 */

const fs = require("fs");
const path = require("path");
const sub = require("./substrate");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(EXAMPLE_ROOT, "spec", "modules", "tax-lookup", "fixtures");

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

async function main() {
  const targetArg = process.argv[2];
  const targetPath = targetArg
    ? path.resolve(process.cwd(), targetArg)
    : path.join(EXAMPLE_ROOT, "generated", "tax-lookup.ts");
  if (!fs.existsSync(targetPath)) {
    console.error(`verify: target module not found: ${targetPath}`);
    process.exit(1);
  }
  const mod = require(targetPath);
  const fn = mod.getAllTaxesForProvinceByDate;
  if (typeof fn !== "function") {
    console.error("verify: generated module does not export getAllTaxesForProvinceByDate");
    process.exit(1);
  }

  const ds = await sub.createDataSource();
  let total = 0;
  let failed = 0;
  for (const file of fs.readdirSync(FIXTURES_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    const cases = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
    for (const c of cases) {
      total++;
      await sub.reset(ds);
      await sub.seed(ds, c.seed);
      let got;
      try {
        got = sub.project(await fn(ds, c.call.date, c.call.provinceId));
      } catch (e) {
        failed++;
        console.error(`  FAIL ${file} :: ${c.name} — threw: ${e.message}`);
        continue;
      }
      if (!deepEqual(got, c.expect)) {
        failed++;
        console.error(`  FAIL ${file} :: ${c.name}\n    expected ${JSON.stringify(c.expect)}\n    got      ${JSON.stringify(got)}`);
      }
    }
  }
  await ds.destroy();

  if (failed) {
    console.error(`verify: ${failed}/${total} fixture checks FAILED against ${path.relative(process.cwd(), targetPath)}`);
    process.exit(1);
  }
  console.log(`verify: ${total}/${total} fixture checks passed against ${path.relative(process.cwd(), targetPath)}`);
  console.log("verify: BUILD VALID — every fixture passed (decimal-free projection, S6)");
}

main().catch((e) => {
  console.error("verify: harness error:", e);
  process.exit(1);
});
