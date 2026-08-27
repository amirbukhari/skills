#!/usr/bin/env node
"use strict";
/**
 * verify-dsl — proves the surface layer is lossless.
 *
 * For each composition IR (tree.json):
 *   1. print(tree) -> DSL text, parse(DSL) -> tree'   ; assert tree' deep-equals tree   (IR round-trip)
 *   2. parse(printed DSL) -> expand           ; assert byte-identical to expand(tree)   (code round-trip)
 *   3. also parse the committed .calc file (the human-authored surface) and assert it
 *      expands byte-identical to the IR expansion — i.e. the surface a human edits and
 *      the JSON IR are two views of the same code.
 *
 * No network, no writes outside results/.
 * Usage: node verify-dsl.js
 */

const fs = require("fs");
const path = require("path");
const { printTree, parseText } = require("./dsl");
const { expand } = require("./expander");

const CASES = [
  { ir: "compositions/activeFeatureCostCalculator.json", calc: "surface/activeFeatureCostCalculator.calc" },
  { ir: "compositions/propertyVolumeV2CostCalculator.json", calc: "surface/propertyVolumeV2CostCalculator.calc" },
  { ir: "compositions/liftBuildingCostCalculator.json", calc: "surface/liftBuildingCostCalculator.calc" },
];

// Canonical (key-order-insensitive) equality: object key order is not semantic,
// so tree identity means same shape + same values, regardless of param order.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
  }
  return v;
}
function deepEq(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }

function main() {
  const report = [];
  let allOk = true;

  for (const c of CASES) {
    const irPath = path.join(__dirname, c.ir);
    const calcPath = path.join(__dirname, c.calc);
    const tree = JSON.parse(fs.readFileSync(irPath, "utf8"));

    // 1. IR -> DSL -> IR identity
    const dsl = printTree(tree);
    const back = parseText(dsl);
    const irRoundTrips = deepEq(back, tree);

    // 2. code identity (tree vs parsed-from-printed-DSL)
    const codeFromTree = expand(tree);
    const codeFromDsl = expand(back);
    const codeRoundTrips = codeFromTree === codeFromDsl;

    // 3. committed .calc file expands identically (surface == IR)
    let calcMatches = null, calcParsed = null;
    if (fs.existsSync(calcPath)) {
      const calcText = fs.readFileSync(calcPath, "utf8");
      calcParsed = parseText(calcText);
      calcMatches = deepEq(calcParsed, tree) && expand(calcParsed) === codeFromTree;
    }

    const ok = irRoundTrips && codeRoundTrips && (calcMatches === null || calcMatches);
    allOk = allOk && ok;
    report.push({ target: c.ir, irRoundTrips, codeRoundTrips, calcFilePresent: calcParsed !== null, calcMatches, ok });
  }

  fs.mkdirSync(path.join(__dirname, "results"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "results", "dsl-roundtrip.json"),
    JSON.stringify({ schema: "sdd-repo-dsl/dsl-roundtrip/1", allOk, cases: report }, null, 2) + "\n");

  console.log("=== DSL surface round-trip (IR <-> DSL, lossless) ===\n");
  for (const r of report) {
    console.log(`${r.target}`);
    console.log(`  IR round-trip (tree->DSL->tree identity):     ${r.irRoundTrips ? "OK" : "FAIL"}`);
    console.log(`  code round-trip (DSL->tree->expand identical): ${r.codeRoundTrips ? "OK" : "FAIL"}`);
    console.log(`  committed .calc expands to same code:          ${r.calcFilePresent ? (r.calcMatches ? "OK" : "FAIL") : "(no .calc)"}`);
    console.log("");
  }
  console.log(allOk ? "ALL LOSSLESS ✓" : "SOME CASES FAILED ✗");
  console.log("wrote results/dsl-roundtrip.json");
  if (!allOk) process.exit(1);
}

main();
