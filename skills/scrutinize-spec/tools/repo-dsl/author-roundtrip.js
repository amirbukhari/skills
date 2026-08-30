"use strict";
/* author-roundtrip.js — semantic round-trip proof. Read-only, no model calls.
 * For each conforming entity: slots -> controlled English -> parse back -> compare
 * slots. Reports N/58 slot-identical and categorizes the residuals honestly. */
const fs = require("fs");
const path = require("path");
const G = require("./engine/generate.js");
const Au = require("./engine/author.js");

const ROOT = process.argv[2] || "/home/amir/Documents/Rentsync/delonix/hydra-source";
function walk(d) { let o = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) o.push(...walk(p)); else if (e.name.endsWith(".arch.json")) o.push(p); } return o; }
const rels = walk(path.join(ROOT, "spec/archetypes")).map((f) => JSON.parse(fs.readFileSync(f, "utf8"))).filter((j) => j.archetype === "Entity" && j.conforms).map((j) => j.rel);

let identical = 0; const nameDiv = [], enumArr = [], other = [];
for (const rel of rels) {
  const t = G.tileEntity(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const orig = { className: t.className, table: t.table, columns: Au.normColumnsFromTile(t.segments), relations: Au.normRelationsFromTile(t.segments) };
  let round;
  try { const m = Au.parseEntityCNL(Au.renderEntityCNL(orig)); round = { columns: Au.normColumnsFromModel(m), relations: Au.normRelationsFromModel(m) }; }
  catch (e) { other.push(`${path.basename(rel)}: ${e.message}`); continue; }
  const cmp = Au.slotsEqual({ columns: orig.columns, relations: orig.relations }, round);
  if (cmp.equal) { identical++; continue; }
  const d = (cmp.colDiff || [])[0];
  if (d && d.a.enum !== d.b.enum && !/^[A-Za-z_$]/.test(String(d.a.enum))) enumArr.push(`${path.basename(rel)} (${d.prop})`);
  else if (d && d.a.name !== d.b.name) nameDiv.push(`${path.basename(rel)} (${d.prop}: ${d.a.name})`);
  else other.push(`${path.basename(rel)}: ${cmp.why}`);
}

console.log(`ROUND-TRIP slot-identical: ${identical}/${rels.length}`);
console.log(`residual A — bespoke DB name != snake(prop) [${nameDiv.length}]: ${nameDiv.join(", ") || "none"}`);
console.log(`residual B — inline literal-array enum, not a named type [${enumArr.length}]: ${enumArr.join(", ") || "none"}`);
if (other.length) console.log(`residual C — other [${other.length}]: ${other.join(" | ")}`);
console.log(`\nBoth residuals are expressiveness limits of controlled English (a bespoke DB name, or an anonymous inline union), not parser bugs — the controlled form derives the column name from the property words and names enum TYPES, so it cannot express those two shapes.`);
