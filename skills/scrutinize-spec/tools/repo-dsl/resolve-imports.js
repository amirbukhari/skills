#!/usr/bin/env node
"use strict";
/**
 * resolve-imports — mine a symbol -> module-specifier resolution map from the
 * ACTUAL import statements across the corpus, so the DSL surface can DROP import
 * params and re-derive them at expansion time (byte-identically).
 *
 * A symbol resolves to a canonical specifier iff one specifier string strictly
 * dominates (appears more often than any other) among that symbol's imports.
 * On a tie the symbol is UNRESOLVED (canonical: null) — the surface then keeps
 * that import visible rather than guessing. Dropping is still only ever applied
 * by the printer when the stored value === canonical, so expansion stays exact.
 *
 * Writes catalog/import-resolution.json.
 * Usage: node resolve-imports.js [corpusDir]
 */

const fs = require("fs");
const path = require("path");
const { ts, parse } = require("./lib/skeleton");

const DEFAULT_CORPUS = "/home/amir/Documents/Rentsync/billing-system/src/rentsync-api/calculators";

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function main() {
  const corpus = process.argv[2] || DEFAULT_CORPUS;
  const files = walk(corpus, []);
  // symbol -> Map(specifierText -> count)
  const counts = new Map();

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const sf = parse(file, src);
    sf.forEachChild(function visit(node) {
      if (ts.isImportDeclaration(node) && node.importClause && node.importClause.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings)) {
        const spec = node.moduleSpecifier.getText(sf); // includes the original quotes
        for (const el of node.importClause.namedBindings.elements) {
          const name = el.name.getText(sf);
          if (!counts.has(name)) counts.set(name, new Map());
          const m = counts.get(name);
          m.set(spec, (m.get(spec) || 0) + 1);
        }
      }
      node.forEachChild(visit);
    });
  }

  const map = {};
  for (const [name, m] of counts) {
    const entries = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const dominates = entries.length === 1 || entries[0][1] > entries[1][1];
    map[name] = {
      canonical: dominates ? entries[0][0] : null,
      specifiers: Object.fromEntries(entries),
    };
  }

  const out = { schema: "sdd-repo-dsl/import-resolution/1", corpus, symbols: map };
  fs.mkdirSync(path.join(__dirname, "catalog"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "catalog", "import-resolution.json"), JSON.stringify(out, null, 2) + "\n");

  const probe = ["ISubscriptionUsage", "ISubscriptionCost", "getVolumeCostingItems",
    "buildingBillingTypeCostCalculator", "BILLING_TYPE_ACTIVE_FEATURE",
    "BILLING_TYPE_PROPERTY_VOLUME_V2", "BILLING_TYPE_LIFT_BUILDING"];
  console.log(`mined ${files.length} files, ${Object.keys(map).length} imported symbols\n`);
  for (const s of probe) {
    const e = map[s];
    if (!e) { console.log(`${s}: (not imported anywhere)`); continue; }
    console.log(`${s}: canonical=${e.canonical || "AMBIGUOUS(none)"}`);
    for (const [spec, n] of Object.entries(e.specifiers)) console.log(`    ${n}x  ${spec}`);
  }
  console.log(`\nwrote catalog/import-resolution.json`);
}

main();
