#!/usr/bin/env node
/**
 * behavioral-diff — sweep a broad input space and compare the spec-generated
 * module against the verbatim Hydra reference, element for element. Covers all
 * five functions, and for the sorting functions checks THREE kinds of parity:
 *   1. return-value parity (deep-equal, or same thrown message)
 *   2. in-place-mutation parity (S4): the mutated input arrays match
 *   3. identity parity (S4): each returns the same array reference it sorted
 *
 * Usage: node tools/behavioral-diff.js [path-to-generated-module]
 *        (defaults to ../generated/subscription-brackets.ts)
 */

const path = require("path");

const EXAMPLE_ROOT = path.resolve(__dirname, "..");
const ref = require(path.join(EXAMPLE_ROOT, "reference", "subscription-brackets.reference.ts"));
const targetArg = process.argv[2];
const genPath = targetArg ? path.resolve(process.cwd(), targetArg) : path.join(EXAMPLE_ROOT, "generated", "subscription-brackets.ts");
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

const clone = (x) => JSON.parse(JSON.stringify(x));

// Run fn(input) capturing outcome; if input is an array we also report mutation.
function runCapture(fn, args) {
  try {
    const value = fn(...args);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, msg: e.message };
  }
}

let comparisons = 0;
const divergences = [];
function record(label, r, g, extra) {
  comparisons++;
  let same;
  if (r.ok !== g.ok) same = false;
  else if (r.ok) same = deepEqual(r.value, g.value);
  else same = r.msg === g.msg;
  if (same && extra) same = extra();
  if (!same && divergences.length < 20) {
    divergences.push(`${label}: ref=${JSON.stringify(r.ok ? r.value : "THROW:" + r.msg)} gen=${JSON.stringify(g.ok ? g.value : "THROW:" + g.msg)}`);
  }
}

const MAXVALS = ["0", "1", "5", "10", "12.5", "-3", "abc", null];
const vbp = (i, mv) => ({ id: i, maxValue: mv, basePrice: "1.00", costPerUnit: "0.10" });
const bare = (mv) => ({ maxValue: mv, basePrice: "1.00", costPerUnit: "0.10" });

// ---- comparer: all ordered pairs ----
for (let i = 0; i < MAXVALS.length; i++) {
  for (let j = 0; j < MAXVALS.length; j++) {
    const a = vbp(1, MAXVALS[i]);
    const b = vbp(2, MAXVALS[j]);
    record(`comparer(${MAXVALS[i]},${MAXVALS[j]})`, runCapture(ref.variablePriceSortComparer, [clone(a), clone(b)]), runCapture(gen.variablePriceSortComparer, [clone(a), clone(b)]));
  }
}

// ---- enumerate arrays of maxValues, lengths 0..4 (full cartesian over the pool) ----
function* enumerate(maxLen) {
  yield [];
  let level = [[]];
  for (let len = 1; len <= maxLen; len++) {
    const next = [];
    for (const prefix of level) {
      for (const mv of MAXVALS) next.push([...prefix, mv]);
    }
    for (const a of next) yield a;
    level = next;
  }
}

// Compare a sorting function with mutation + identity parity.
function compareSort(label, buildArgs, fnName) {
  for (const mvs of enumerate(4)) {
    const refArgs = buildArgs(mvs.map((mv, i) => vbp(i + 1, mv)));
    const genArgs = buildArgs(mvs.map((mv, i) => vbp(i + 1, mv)));
    // find the array the function will sort (for identity + mutation checks)
    const rArr = pickSortedArray(fnName, refArgs);
    const gArr = pickSortedArray(fnName, genArgs);
    const r = runCapture(ref[fnName], refArgs);
    const g = runCapture(gen[fnName], genArgs);
    record(`${label}[${mvs.join(",")}]`, r, g, () => {
      // mutation parity: the input array that was sorted matches
      if (!deepEqual(rArr(), gArr())) return false;
      // identity parity: when it returned an array that is the sorted input
      if (r.ok && g.ok) {
        const rId = r.value === rArr();
        const gId = g.value === gArr();
        if (rId !== gId) return false;
      }
      return true;
    });
  }
}

// Return a thunk yielding the array the given fn sorts, from its args.
function pickSortedArray(fnName, args) {
  const sub = args[0];
  if (fnName === "getSortedVariablePriceBrackets") return () => sub.baseSubscription.variableBasePrices;
  if (fnName === "getSortedVariablePriceOverrideBrackets") return () => sub.variableBasePriceOverrides;
  // getSortedPriceBracketsForSubscription: overrides if non-empty else base
  return () => (sub.variableBasePriceOverrides.length !== 0 ? sub.variableBasePriceOverrides : sub.baseSubscription.variableBasePrices);
}

compareSort("gspbs.override", (arr) => [{ baseSubscription: { variableBasePrices: [vbp(99, "7")] }, variableBasePriceOverrides: arr }], "getSortedPriceBracketsForSubscription");
compareSort("gspbs.base", (arr) => [{ baseSubscription: { variableBasePrices: arr }, variableBasePriceOverrides: [] }], "getSortedPriceBracketsForSubscription");
compareSort("gsvpb", (arr) => [{ baseSubscription: { variableBasePrices: arr } }], "getSortedVariablePriceBrackets");
compareSort("gsvpob", (arr) => [{ variableBasePriceOverrides: arr }], "getSortedVariablePriceOverrideBrackets");

// ---- assert-throw parity: inject one malformed element ----
const BAD = [
  { id: 1, maxValue: "5", basePrice: 5, costPerUnit: null }, // basePrice not string
  { id: 2, maxValue: 5, basePrice: "1", costPerUnit: null }, // maxValue not string|null
  { maxValue: "5", basePrice: "1", costPerUnit: null }, // missing id
  null, // non-object
];
for (const bad of BAD) {
  for (const fnName of ["getSortedVariablePriceBrackets", "getSortedVariablePriceOverrideBrackets"]) {
    const build = fnName === "getSortedVariablePriceBrackets"
      ? (a) => [{ baseSubscription: { variableBasePrices: a } }]
      : (a) => [{ variableBasePriceOverrides: a }];
    const arr1 = [vbp(1, "10"), clone(bad)];
    const arr2 = [vbp(1, "10"), clone(bad)];
    record(`${fnName}.bad(${JSON.stringify(bad)})`, runCapture(ref[fnName], build(arr1)), runCapture(gen[fnName], build(arr2)));
  }
}

// ---- appendRange: full cartesian over the pool, lengths 0..4 ----
for (const mvs of enumerate(4)) {
  const a1 = mvs.map(bare);
  const a2 = mvs.map(bare);
  record(`appendRange[${mvs.join(",")}]`, runCapture(ref.appendRangeToSortedPriceBracketsForSubscription, [a1]), runCapture(gen.appendRangeToSortedPriceBracketsForSubscription, [a2]));
}

console.log(`behavioral-diff: ran ${comparisons} comparisons (spec-generated vs Hydra reference)`);
if (divergences.length) {
  console.error(`behavioral-diff: ${divergences.length}+ DIVERGENCES:`);
  for (const d of divergences) console.error("  " + d);
  process.exit(1);
}
console.log("behavioral-diff: IDENTICAL — zero divergences across the sweep");
