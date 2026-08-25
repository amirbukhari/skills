#!/usr/bin/env node
/**
 * The done-check for the money-cart build (regenerate.md).
 *
 * Loads every generated/<m>.js and runs every spec/modules/<m>/fixtures/*.json
 * input/expected pair against it. The build is valid IFF every fixture passes —
 * fixtures are the acceptance oracle that substitutes for compiler determinism.
 *
 * Usage:  node tools/verify.js [generatedDir]     (default: generated/)
 * Exit 0 = all fixtures pass; exit 1 = at least one failed (printed).
 */

const fs = require("fs");
const path = require("path");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const MODULES_DIR = path.join(EXAMPLE_ROOT, "spec", "modules");

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return deepEqual(ka, kb) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function main() {
  const genArg = process.argv[2];
  const genDir = genArg
    ? path.resolve(process.cwd(), genArg)
    : path.join(EXAMPLE_ROOT, "generated");

  const moduleNames = fs
    .readdirSync(MODULES_DIR)
    .filter((d) => fs.statSync(path.join(MODULES_DIR, d)).isDirectory())
    .sort();

  let total = 0;
  let failed = 0;

  for (const name of moduleNames) {
    const modPath = path.join(genDir, `${name}.js`);
    if (!fs.existsSync(modPath)) {
      console.error(`verify: missing generated module ${modPath} — run generate.js first`);
      process.exit(1);
    }
    const mod = require(modPath);
    const fixturesDir = path.join(MODULES_DIR, name, "fixtures");
    if (!fs.existsSync(fixturesDir)) continue;
    for (const file of fs.readdirSync(fixturesDir).sort()) {
      if (!file.endsWith(".json")) continue;
      const cases = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8"));
      for (const c of cases) {
        total++;
        const fn = mod[c.call.fn];
        if (typeof fn !== "function") {
          failed++;
          console.error(`  FAIL ${name}/${file} :: ${c.name} — no exported function ${c.call.fn}`);
          continue;
        }
        const got = fn(...c.call.args);
        if (deepEqual(got, c.expect)) {
          // quiet on pass
        } else {
          failed++;
          console.error(
            `  FAIL ${name}/${file} :: ${c.name} — ${c.call.fn}(${JSON.stringify(
              c.call.args
            ).slice(1, -1)}) => ${JSON.stringify(got)}, expected ${JSON.stringify(c.expect)}`
          );
        }
      }
    }
  }

  const passed = total - failed;
  console.log(`verify: ${passed}/${total} fixtures passed across ${moduleNames.length} module(s)`);
  if (failed > 0) {
    console.error(`verify: BUILD INVALID — ${failed} fixture(s) failed`);
    process.exit(1);
  }
  console.log("verify: BUILD VALID — every fixture passed");
}

main();
