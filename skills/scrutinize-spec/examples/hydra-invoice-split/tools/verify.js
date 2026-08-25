#!/usr/bin/env node
/**
 * Fixture verifier for the hydra-invoice-split proof.
 *
 * Runs each spec/modules/<m>/fixtures/*.json case against a target module.
 * Unlike money-cart's verify.js (exact deep-equal only), this one supports
 * PROPERTY fixtures, because the real Hydra tests are property-based
 * (sum-preservation, length, bounds, cents-validity) rather than exact-output.
 *
 * Usage:  node tools/verify.js [targetModule.ts]
 *   default target: generated/invoice-split.ts
 * Exit 0 = all pass; 1 = at least one failure (printed).
 */

const fs = require("fs");
const path = require("path");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const MODULE_DIR = path.join(EXAMPLE_ROOT, "spec", "modules", "invoice-split");
const FIXTURES_DIR = path.join(MODULE_DIR, "fixtures");

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  return false;
}

function roundsToCents(v) {
  return Number(v.toFixed(2)) === v;
}

function checkProperty(prop, result) {
  const [key] = Object.keys(prop);
  const val = prop[key];
  const arr = Array.isArray(result) ? result : [result];
  switch (key) {
    case "sumEquals":
      return { ok: arr.reduce((a, b) => a + b, 0) === val, detail: `sum=${arr.reduce((a, b) => a + b, 0)} expected ${val}` };
    case "sumCloseTo": {
      const [target, decimals] = val;
      const sum = arr.reduce((a, b) => a + b, 0);
      return { ok: Math.abs(sum - target) < 0.5 * 10 ** -decimals, detail: `sum=${sum} expected ~${target}` };
    }
    case "length":
      return { ok: arr.length === val, detail: `length=${arr.length} expected ${val}` };
    case "allBetween":
      return { ok: arr.every((x) => x >= val[0] && x <= val[1]), detail: `some element outside [${val}]` };
    case "roundsToCents":
      return { ok: arr.every(roundsToCents) === val, detail: `some element not cents-valid` };
    default:
      return { ok: false, detail: `unknown property "${key}"` };
  }
}

function main() {
  const targetArg = process.argv[2];
  const targetPath = targetArg
    ? path.resolve(process.cwd(), targetArg)
    : path.join(EXAMPLE_ROOT, "generated", "invoice-split.ts");

  if (!fs.existsSync(targetPath)) {
    console.error(`verify: target module not found: ${targetPath}`);
    process.exit(1);
  }
  const mod = require(targetPath);

  let total = 0;
  let failed = 0;
  for (const file of fs.readdirSync(FIXTURES_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    const cases = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
    for (const c of cases) {
      total++;
      const fn = mod[c.call.fn];
      if (typeof fn !== "function") {
        failed++;
        console.error(`  FAIL ${file} :: ${c.name} — no exported ${c.call.fn}`);
        continue;
      }
      const got = fn(...c.call.args);
      const problems = [];
      if ("expect" in c && !deepEqual(got, c.expect)) {
        problems.push(`expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
      }
      for (const prop of c.properties || []) {
        const r = checkProperty(prop, got);
        if (!r.ok) problems.push(`property ${JSON.stringify(prop)} failed (${r.detail})`);
      }
      if (problems.length) {
        failed++;
        console.error(`  FAIL ${file} :: ${c.name} — ${problems.join("; ")}`);
      }
    }
  }

  const passed = total - failed;
  console.log(`verify: ${passed}/${total} fixture checks passed against ${path.relative(process.cwd(), targetPath)}`);
  if (failed > 0) {
    console.error(`verify: BUILD INVALID — ${failed} fixture(s) failed`);
    process.exit(1);
  }
  console.log("verify: BUILD VALID — every fixture (exact + property) passed");
}

main();
