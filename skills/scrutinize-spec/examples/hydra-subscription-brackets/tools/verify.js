#!/usr/bin/env node
/**
 * verify — run the module's fixtures against a generated implementation.
 *
 * Each fixture case is { name, call: { fn, args }, ... } with either:
 *   - "expect": <value>        deep-equal the return value
 *   - "throws": true|"substr"  the call must throw (message must include substr)
 * A case may carry both a `throws` and nothing else, or an `expect` and nothing
 * else. Exit 0 iff every check passes.
 *
 * Usage: node tools/verify.js [path-to-generated-module]
 *        (defaults to ../generated/subscription-brackets.ts)
 */

const fs = require("fs");
const path = require("path");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(EXAMPLE_ROOT, "spec", "modules", "subscription-brackets", "fixtures");

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

function main() {
  const targetArg = process.argv[2];
  const targetPath = targetArg
    ? path.resolve(process.cwd(), targetArg)
    : path.join(EXAMPLE_ROOT, "generated", "subscription-brackets.ts");

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
      const problems = [];
      let threw = null;
      let got;
      try {
        got = fn(...c.call.args);
      } catch (e) {
        threw = e;
      }
      if ("throws" in c) {
        if (!threw) problems.push(`expected a throw, but returned ${JSON.stringify(got)}`);
        else if (typeof c.throws === "string" && !String(threw.message).includes(c.throws)) {
          problems.push(`throw message ${JSON.stringify(threw.message)} does not include ${JSON.stringify(c.throws)}`);
        }
      } else if (threw) {
        problems.push(`unexpected throw: ${threw.message}`);
      }
      if ("expect" in c && !threw && !deepEqual(got, c.expect)) {
        problems.push(`expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
      }
      if (problems.length) {
        failed++;
        console.error(`  FAIL ${file} :: ${c.name} — ${problems.join("; ")}`);
      }
    }
  }

  if (failed) {
    console.error(`verify: ${failed}/${total} fixture checks FAILED against ${path.relative(process.cwd(), targetPath)}`);
    process.exit(1);
  }
  console.log(`verify: ${total}/${total} fixture checks passed against ${path.relative(process.cwd(), targetPath)}`);
  console.log("verify: BUILD VALID — every fixture (exact + throws) passed");
}

main();
