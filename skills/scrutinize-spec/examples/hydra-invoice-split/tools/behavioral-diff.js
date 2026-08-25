#!/usr/bin/env node
/**
 * The real Phase 1 proof: run the SPEC-GENERATED module and the verbatim Hydra
 * REFERENCE across a wide sweep of inputs and compare outputs elementwise. If
 * they never diverge, the spec (not the original source) drove a
 * behaviourally-identical implementation.
 *
 * Deterministic input sweep (no randomness — reproducible):
 *   - roundFloatToCents over a dense grid of floats x {nearest, up, down}
 *   - evenlySplitWithCorrection over many (total, count) pairs
 *
 * Usage: node tools/behavioral-diff.js
 * Exit 0 = zero divergences; 1 = at least one (first 20 printed).
 */

const path = require("path");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const gen = require(path.join(EXAMPLE_ROOT, "generated", "invoice-split.ts"));
const ref = require(path.join(EXAMPLE_ROOT, "reference", "invoice-split.reference.ts"));

function eqNum(a, b) {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}
function eqArr(a, b) {
  return a.length === b.length && a.every((x, i) => eqNum(x, b[i]));
}

const divergences = [];
let checks = 0;

// --- roundFloatToCents sweep ---
const algos = ["nearest", "up", "down"];
for (let cents = -50050; cents <= 50050; cents += 7) {
  const f = cents / 1000; // step 0.007 over [-50.05, 50.05], hits many x.xx5 cases
  for (const algo of algos) {
    checks++;
    const g = gen.roundFloatToCents(f, algo);
    const r = ref.roundFloatToCents(f, algo);
    if (!eqNum(g, r)) divergences.push(`roundFloatToCents(${f}, '${algo}') gen=${g} ref=${r}`);
  }
}

// --- evenlySplitWithCorrection sweep ---
for (let t = 0; t <= 20000; t += 1) {
  const total = t / 100; // 0.00 .. 200.00 in cents
  for (const count of [1, 2, 3, 4, 5, 7, 11, 13, 100]) {
    checks++;
    const g = gen.evenlySplitWithCorrection(total, count);
    const r = ref.evenlySplitWithCorrection(total, count);
    if (!eqArr(g, r)) {
      divergences.push(
        `evenlySplitWithCorrection(${total}, ${count}) gen=[${g}] ref=[${r}]`
      );
    }
  }
}

// A few negative totals (credits/refunds)
for (let t = -5000; t < 0; t += 1) {
  const total = t / 100;
  for (const count of [1, 2, 3, 7]) {
    checks++;
    const g = gen.evenlySplitWithCorrection(total, count);
    const r = ref.evenlySplitWithCorrection(total, count);
    if (!eqArr(g, r)) divergences.push(`evenlySplitWithCorrection(${total}, ${count}) gen=[${g}] ref=[${r}]`);
  }
}

console.log(`behavioral-diff: ran ${checks} comparisons (spec-generated vs Hydra reference)`);
if (divergences.length === 0) {
  console.log("behavioral-diff: IDENTICAL — zero divergences across the sweep");
  process.exit(0);
}
console.error(`behavioral-diff: ${divergences.length} DIVERGENCE(S) (showing up to 20):`);
for (const d of divergences.slice(0, 20)) console.error("  " + d);
process.exit(1);
