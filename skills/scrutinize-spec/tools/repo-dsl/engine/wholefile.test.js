"use strict";
/**
 * Engine tests for the whole-file mining pass. No test framework — run directly:
 *   node engine/wholefile.test.js
 * Exits non-zero on first failure.
 */

const { tokenize } = require("./fanout");
const wf = require("./wholefile");

let passed = 0;
function ok(cond, msg) { if (!cond) { console.error("FAIL:", msg); process.exit(1); } passed++; console.log("  ok:", msg); }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

function pf(rel, source) {
  const { tokens, gaps } = tokenize(rel, source);
  return { rel, source, tokens, gaps };
}

// Two structurally identical delegating calculators (differ only in names/consts).
const A = `import { BILLING_TYPE_A } from '@shared';
import { ISubscriptionCost } from '@cost';
import { ISubscriptionUsage } from '@usage';
import { buildingBillingTypeCostCalculator } from '../shared';

export const aCostCalculator = (
  usages: ISubscriptionUsage[],
): ISubscriptionCost[] => buildingBillingTypeCostCalculator(usages, BILLING_TYPE_A);
`;
const B = `import { BILLING_TYPE_B } from '@shared';
import { ISubscriptionCost } from '@cost';
import { ISubscriptionUsage } from '@usage';
import { buildingBillingTypeCostCalculator } from '../shared';

export const bCostCalculator = (
  usages: ISubscriptionUsage[],
): ISubscriptionCost[] => buildingBillingTypeCostCalculator(usages, BILLING_TYPE_B);
`;
// A structurally different (singleton) file.
const C = `export function loneCalculator(n: number): number {
  return n * 2;
}
`;
// Two files identical except a differing trailing comment (residue path).
const D1 = `const billingTypeId = BILLING_TYPE_D; // 15;
export function dCalculator(usages: IUsage[]): ICost[] {
  return getItems(usages, billingTypeId);
}
`;
const D2 = `const billingTypeId = BILLING_TYPE_E; // 14;
export function eCalculator(usages: IUsage[]): ICost[] {
  return getItems(usages, billingTypeId);
}
`;

console.log("(a) shape-identical files cluster + mint ONE byte-identical word:");
{
  const r = wf.mineWholeFile([pf("a.ts", A), pf("b.ts", B), pf("c.ts", C)], { minClusterSize: 2 });
  eq(r.words.length, 1, "exactly one word minted");
  eq(r.words[0].memberFiles.sort(), ["a.ts", "b.ts"], "word covers both shape-identical files");
  ok(r.words[0].allVerified, "all members byte-verify");
  ok(r.words[0].verify.every((v) => v.byteIdentical && v.residueChars === 0), "both members byte-identical, zero residue");
  ok(r.words[0].params.length >= 2, "params were extracted for the differing slots");
  // expand with each member's params reproduces the file exactly
  const w = r.words[0];
  for (const m of [pf("a.ts", A), pf("b.ts", B)]) {
    const vals = wf.extractParams({ params: w._paramsFull }, m);
    eq(wf.expandWord(w, vals), m.source, `expand(${m.rel}) == source`);
  }
}

console.log("(b) singletons do NOT auto-mint (they escalate):");
{
  const r = wf.mineWholeFile([pf("a.ts", A), pf("b.ts", B), pf("c.ts", C)], { minClusterSize: 2 });
  ok(r.singletons.includes("c.ts"), "c.ts is a singleton");
  ok(!r.words.some((w) => w.memberFiles.includes("c.ts")), "no minted word contains the singleton");
  eq(r.stats.escalationCandidates, 1, "one escalation candidate");
}

console.log("(c) residue is recorded explicitly, never hidden:");
{
  const r = wf.mineWholeFile([pf("d1.ts", D1), pf("d2.ts", D2)], { minClusterSize: 2 });
  eq(r.words.length, 1, "one word minted for the residue pair");
  ok(!r.words[0].allVerified, "word is NOT marked fully verified (has residue)");
  ok(r.words[0].verify.every((v) => v.residueClass === "C" && v.residueChars === 7), "each member: 7-byte class-C comment residue, recorded");
}

console.log("(d) re-running is deterministic (same input -> same words):");
{
  const inputs = () => [pf("a.ts", A), pf("b.ts", B), pf("c.ts", C), pf("d1.ts", D1), pf("d2.ts", D2)];
  const strip = (r) => r.words.map((w) => ({ members: w.memberFiles, params: w.params, verify: w.verify.map((v) => ({ f: v.file, bi: v.byteIdentical, rc: v.residueChars })) }));
  const r1 = wf.mineWholeFile(inputs(), { minClusterSize: 2 });
  const r2 = wf.mineWholeFile(inputs(), { minClusterSize: 2 });
  eq(strip(r1), strip(r2), "two runs produce identical words/params/verify");
  eq(r1.stats, r2.stats, "two runs produce identical stats");
}

console.log(`\nALL ${passed} assertions passed.`);
