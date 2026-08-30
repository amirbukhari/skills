#!/usr/bin/env node
"use strict";
/**
 * decompose — the DETERMINISTIC .calc author (no LLM).
 *
 * Given a real source file, structurally match it against the whole-file DOMAIN
 * words (delegatingCost / volumeCosting), extract the typed params from fixed
 * anchor points, build the composition tree, and render the readable .calc via
 * dsl.printTree. Then the caller expands + byte-verifies. Nothing here calls a
 * model — the "decomposition" is the anchored structural match the mine already
 * proves these shapes have.
 *
 * A module is only CLAIMED for a word when parse(printTree(tree)) round-trips
 * and expand(tree) reproduces the source (byte-identical, or byte-identical
 * modulo classifiable residue the caller reports). If no word matches, the file
 * is left to residue — decompose returns null.
 *
 *   node decompose.js <source.ts>            # print the .calc (or "no match")
 *   const { decompose } = require("./decompose")
 */

const fs = require("fs");
const dsl = require("./dsl");
const { expand } = require("./expander");

/** symbol -> module specifier (with quotes) from the file's import lines. */
function importMap(src) {
  const map = {};
  const re = /import\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])\s*;/g;
  let m;
  while ((m = re.exec(src))) {
    const mod = m[2];
    for (const sym of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      // handle `A as B` -> key on the local name B
      const local = sym.includes(" as ") ? sym.split(/\s+as\s+/)[1].trim() : sym;
      map[local] = mod;
    }
  }
  return map;
}

/** delegatingCost: `export const NAME = (\n usages: ELEM[],\n): COST[] => FN(usages, CONST);` */
function matchDelegating(src) {
  const re = /export const (\w+) = \(\s*usages:\s*(\w+)\[\],\s*\):\s*(\w+)\[\]\s*=>\s*(\w+)\(usages,\s*(\w+)\);/;
  const m = src.match(re);
  if (!m) return null;
  const [, exportName, elemType, costType, delegateFn, billingConst] = m;
  const imp = importMap(src);
  return {
    word: "delegatingCost",
    composite: "makeDelegatingCostCalculatorFn",
    params: {
      exportName, elemType, costType, delegateFn, billingTypeConst: billingConst,
      importElemFrom: imp[elemType], importCostFrom: imp[costType],
      importBillingFrom: imp[billingConst], importSharedFrom: imp[delegateFn],
    },
  };
}

/** volumeCosting: export function NAME(usages: ELEM[]): COST[] { ... FN(subscriptions, billingTypeId) } */
function matchVolumeCosting(src) {
  const sig = src.match(/export function (\w+)\(usages:\s*(\w+)\[\]\):\s*(\w+)\[\]\s*\{/);
  const bt = src.match(/const billingTypeId = (BILLING_TYPE_\w+);/);
  const fn = src.match(/const result:\s*\w+\[\]\s*=\s*(\w+)\(subscriptions,\s*billingTypeId\);/);
  if (!sig || !bt || !fn) return null;
  const [, exportName, elemType, costType] = sig;
  const billingConst = bt[1];
  const sharedFn = fn[1];
  const imp = importMap(src);
  return {
    word: "volumeCosting",
    composite: "makeVolumeCostingCalculatorFn",
    params: {
      exportName, elemType, costType, sharedFn, billingTypeConst: billingConst,
      importElemFrom: imp[elemType], importCostFrom: imp[costType],
      importBillingFrom: imp[billingConst], importSharedFrom: imp[sharedFn],
    },
  };
}

const MATCHERS = [matchDelegating, matchVolumeCosting];

/** Return { word, tree, calc } for the first domain word that structurally
 *  matches, or null. Throws only on an internal inconsistency (bad tree). */
function decompose(src) {
  for (const match of MATCHERS) {
    const hit = match(src);
    if (!hit) continue;
    // every derived import must have been found in the source
    if (Object.values(hit.params).some((v) => v === undefined)) continue;
    const tree = { composite: hit.composite, params: hit.params };
    const calc = dsl.printTree(tree); // deterministic canonical surface
    // sanity: the surface must round-trip to the SAME expansion (param key
    // order is irrelevant; the emitted code is what must be faithful).
    const back = dsl.parseText(calc);
    if (back.composite !== tree.composite) continue;
    if (expand(back) !== expand(tree)) continue;
    return { word: hit.word, tree: back, calc };
  }
  return null;
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: decompose.js <source.ts>"); process.exit(1); }
  const src = fs.readFileSync(file, "utf8");
  const d = decompose(src);
  if (!d) { console.log("no domain-word match (residue)"); return; }
  process.stdout.write(d.calc);
}

if (require.main === module) main();
module.exports = { decompose, importMap };
