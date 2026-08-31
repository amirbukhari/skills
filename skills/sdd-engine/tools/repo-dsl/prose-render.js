"use strict";
/* prose-render.js — render 3 real files as plain-language narrative. Read-only, no model. */
const fs = require("fs");
const path = require("path");
const P = require("./engine/prose.js");

const ROOT = "/home/amir/Documents/Rentsync/delonix/hydra-source";
function readArch(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, "spec/archetypes", rel + ".arch.json"), "utf8")); }
function readBodies(rel) { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "spec/skeletons", rel + ".skel.json"), "utf8")).bodies || []; } catch (_) { return []; } }
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

const targets = [
  "src/entities/hydra/BillingAccount.ts",
  "src/routers/accounts.ts",
  "src/hydra-ui/src/redux/features/accounts/accountsSlice.ts",
];

for (const rel of targets) {
  const arch = readArch(rel);
  const bodies = readBodies(rel);
  const src = readSrc(rel);
  console.log("\n" + "=".repeat(88));
  console.log(`${rel}   [archetype: ${arch.archetype}]`);
  console.log("=".repeat(88));
  console.log(P.renderProse(arch, { bodies, src }));
}

console.log("\n" + "-".repeat(88));
console.log(P.LLM_UPGRADE_NOTE);
