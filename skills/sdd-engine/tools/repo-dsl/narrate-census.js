#!/usr/bin/env node
"use strict";
/**
 * narrate-census.js — READ-ONLY. Scans every .ts file in hydra-source and asks the
 * prose narrator, for each file, whether it produces real English or falls to the
 * "no prose renderer" fallback. NARRATED = an archetype renderer fired OR a
 * pure-surface SHAPE narrator fired (types / constants+enums / config). Un-narrated
 * files are grouped BY SHAPE so we know which shape to narrate next. Also verifies
 * 0 bespoke residual on the pure-surface shapes (no function bodies to hide).
 * Deterministic, zero model calls. No writes, no commit.
 */
const fs = require("fs");
const path = require("path");
const A = require("./engine/archetypes.js");
const P = require("./engine/prose.js");

const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const ARCH_RENDERERS = new Set(["Entity", "RouterModule", "ReduxModule", "IndexBarrel"]); // file-level archetype narrators
const SHAPE_LABEL = { types: "pure type/interface", constEnum: "constants/enums-only", config: "config objects" };

// Exclude this project's own SDD demo artifacts (demo/, coined-demo/) so the
// denominator matches the canonical corpus the archetype-index measured (1038).
const SKIP_DIR = new Set(["node_modules", ".git", "demo", "coined-demo"]);
function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
}

const files = walk(CORPUS).sort();
const narratedArche = new Map();     // archetype-renderer hits, by archetype
const narratedShape = new Map();     // shape-narrator hits, by shape label
const unShape = new Map();           // still-un-narrated, by "other"
const otherArche = new Map();
let barrelsNarrated = 0, shapeCallableResidual = 0, shapeFiles = 0;

for (const abs of files) {
  const rel = path.relative(CORPUS, abs);
  let src, info;
  try { src = fs.readFileSync(abs, "utf8"); info = A.analyzeFile(rel, src); } catch (e) { continue; }
  const arche = A.classifyFile(info);

  if (ARCH_RENDERERS.has(arche)) {
    narratedArche.set(arche, (narratedArche.get(arche) || 0) + 1);
    if (arche === "IndexBarrel") barrelsNarrated++;
    continue;
  }
  const shape = P.pureSurfaceShape(info, src); // strict: also requires 0 embedded function bodies
  if (shape) {
    const label = SHAPE_LABEL[shape];
    narratedShape.set(label, (narratedShape.get(label) || 0) + 1);
    // residual check: gate guarantees no function bodies -> 0 bespoke, by construction
    const surf = P.fileSurface(src);
    shapeFiles++;
    if (surf.callables > 0) shapeCallableResidual += surf.callables;
    // sanity: narrator must NOT emit the fallback
    const out = P.renderProse({ archetype: arche, rel }, { bodies: [], src, facts: info });
    if (/no prose renderer/.test(out)) { unShape.set("SHAPE-DISPATCH-FAILED", (unShape.get("SHAPE-DISPATCH-FAILED") || 0) + 1); }
    continue;
  }
  // still un-narrated. Files whose top-level shape looked pure-surface but that carry
  // function bodies (e.g. test files, configs with a fn value) land here honestly.
  const hadPureShape = P.pureSurfaceShape(info) != null; // structural-only, no src gate
  unShape.set(hadPureShape ? "other (has embedded function bodies)" : "other", (unShape.get(hadPureShape ? "other (has embedded function bodies)" : "other") || 0) + 1);
  otherArche.set(arche, (otherArche.get(arche) || 0) + 1);
}

const total = files.length;
const narratedArcheTotal = [...narratedArche.values()].reduce((a, b) => a + b, 0);
const narratedShapeTotal = [...narratedShape.values()].reduce((a, b) => a + b, 0);
const narratedTotal = narratedArcheTotal + narratedShapeTotal;
const unTotal = total - narratedTotal;
const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

console.log(`CORPUS: ${total} files scanned (.ts, excl. .d.ts, node_modules, and this project's demo/ dirs)\n`);

console.log(`NARRATED: ${narratedTotal} files (${(100 * narratedTotal / total).toFixed(1)}%)`);
console.log(`  via archetype narrators (${narratedArcheTotal}):`);
for (const [k, v] of sortDesc(narratedArche)) console.log(`     ${k.padEnd(20)} ${String(v).padStart(4)}`);
console.log(`  via pure-surface SHAPE narrators (${narratedShapeTotal}):`);
for (const [k, v] of sortDesc(narratedShape)) console.log(`     ${k.padEnd(20)} ${String(v).padStart(4)}`);

console.log(`\nUN-NARRATED (fall to "no prose renderer"): ${unTotal} files (${(100 * unTotal / total).toFixed(1)}%)`);
for (const [s, v] of sortDesc(unShape)) console.log(`   ${s.padEnd(22)} ${String(v).padStart(4)}`);
console.log(`   broken out by archetype (real logic — delivered by the skeleton/idiom tiers, not a file-level narrator):`);
for (const [k, v] of sortDesc(otherArche)) console.log(`      ${k.padEnd(20)} ${String(v).padStart(4)}`);

console.log(`\nBESPOKE-RESIDUAL CHECK on the ${shapeFiles} pure-surface files:`);
console.log(`   embedded callables found in value positions: ${shapeCallableResidual}`);
console.log(`   => ${shapeCallableResidual === 0 ? "0 bespoke residual — every pure-surface file is fully described." : shapeCallableResidual + " embedded callables (noted in-render; delivered by the skeleton tier)."}`);
console.log(`\nbarrels narrated: ${barrelsNarrated}   shape-narrated: ${narratedShapeTotal}   NEW narrated total: ${narratedTotal}`);
