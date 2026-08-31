"use strict";
/* prose-render.js — render 3 real files as plain-language narrative. Read-only, no model. */
const fs = require("fs");
const path = require("path");
const P = require("./engine/prose.js");
const CR = require("./engine/corpus-root");

const ROOT = CR.corpusRoot();   // WRITE root: sen/
const SRC = CR.sourceRoot();    // READ root: the .ts
function readArch(rel) { return JSON.parse(fs.readFileSync(path.join(CR.senDir(), "archetypes", rel + ".arch.json"), "utf8")); }
function readBodies(rel) { try { return JSON.parse(fs.readFileSync(path.join(CR.senDir(), "skeletons", rel + ".skel.json"), "utf8")).bodies || []; } catch (_) { return []; } }
function readSrc(rel) { return fs.readFileSync(path.join(SRC, rel), "utf8"); }

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
