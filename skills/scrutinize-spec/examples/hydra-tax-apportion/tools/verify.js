#!/usr/bin/env node
/**
 * verify — run the tax-apportion fixtures against a generated implementation.
 * Pure-math fixtures (pure.json) run with no DB; DB fixtures (db.json) run against
 * the disposable Postgres substrate. A DB fixture compares the FULL result
 * `{ taxRate, taxMinorUnits }` — taxRate included and compared as an exact string,
 * which is the whole point of the Postgres substrate.
 *
 * Fixture case shapes:
 *   pure: { name, call: { fn, args }, expect | throws }
 *   db:   { name, seed, call: { date, provinceId, amountMinorUnits }, expect | throws }
 *
 * Usage: node tools/verify.js [path-to-generated-module]
 */

const fs = require("fs");
const path = require("path");
const pg = require("./pg-substrate");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(EXAMPLE_ROOT, "spec", "modules", "tax-apportion", "fixtures");

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

function checkOutcome(problems, c, threw, got) {
  if ("throws" in c) {
    if (!threw) problems.push(`expected a throw, got ${JSON.stringify(got)}`);
    else if (typeof c.throws === "string" && !String(threw.message).includes(c.throws)) {
      problems.push(`throw message ${JSON.stringify(threw.message)} lacks ${JSON.stringify(c.throws)}`);
    }
  } else if (threw) {
    problems.push(`unexpected throw: ${threw.message}`);
  } else if ("expect" in c && !deepEqual(got, c.expect)) {
    problems.push(`expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
  }
}

async function main() {
  const targetArg = process.argv[2];
  const targetPath = targetArg
    ? path.resolve(process.cwd(), targetArg)
    : path.join(EXAMPLE_ROOT, "generated", "tax-apportion.ts");
  if (!fs.existsSync(targetPath)) {
    console.error(`verify: target module not found: ${targetPath}`);
    process.exit(1);
  }
  const mod = require(targetPath);

  const allCases = [];
  for (const file of fs.readdirSync(FIXTURES_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    for (const c of JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"))) allCases.push({ file, ...c });
  }
  const pureCases = allCases.filter((c) => !c.seed);
  const dbCases = allCases.filter((c) => c.seed);

  let total = 0;
  let failed = 0;

  // pure cases
  for (const c of pureCases) {
    total++;
    const fn = mod[c.call.fn];
    const problems = [];
    if (typeof fn !== "function") { problems.push(`no exported ${c.call.fn}`); }
    else {
      let threw = null, got;
      try { got = fn(...c.call.args); } catch (e) { threw = e; }
      checkOutcome(problems, c, threw, got);
    }
    if (problems.length) { failed++; console.error(`  FAIL ${c.file} :: ${c.name} — ${problems.join("; ")}`); }
  }

  // db cases
  if (dbCases.length) {
    const fn = mod.computeApportionedProvincialTax;
    if (typeof fn !== "function") {
      console.error("verify: generated module does not export computeApportionedProvincialTax");
      process.exit(1);
    }
    const srv = await pg.startPostgres();
    try {
      const ds = await pg.createDataSource(srv.port);
      for (const c of dbCases) {
        total++;
        await pg.reset(ds);
        await pg.seed(ds, c.seed);
        const problems = [];
        let threw = null, got;
        try { got = await fn(ds, c.call.date, c.call.provinceId, c.call.amountMinorUnits); } catch (e) { threw = e; }
        checkOutcome(problems, c, threw, got);
        if (problems.length) { failed++; console.error(`  FAIL ${c.file} :: ${c.name} — ${problems.join("; ")}`); }
      }
      await ds.destroy();
    } finally {
      srv.stop();
    }
  }

  if (failed) {
    console.error(`verify: ${failed}/${total} fixture checks FAILED against ${path.relative(process.cwd(), targetPath)}`);
    process.exit(1);
  }
  console.log(`verify: ${total}/${total} fixture checks passed against ${path.relative(process.cwd(), targetPath)}`);
  console.log("verify: BUILD VALID — pure + DB fixtures passed (taxRate compared as exact string on Postgres)");
}

main().catch((e) => {
  console.error("verify: harness error:", e);
  process.exit(1);
});
