#!/usr/bin/env node
"use strict";
/**
 * roots.js — print where the engine is pointed and WHICH LAYER decided it.
 *
 * The first thing to run when anything looks wrong. Every "the engine measured the wrong tree"
 * incident in this project was a root question, and the answer was never visible without reading
 * code. `npm run roots` makes it one command. It resolves through engine/corpus-root.js, so what
 * it prints is what every tool will use — it cannot drift from the real answer.
 */
const CR = require("./engine/corpus-root");
const fs = require("fs");
const path = require("path");

let bad = 0;
console.log("");
for (const name of CR.names()) {
  const spec = CR.specOf(name);
  let line;
  try {
    const picked = CR.select(name, {});
    const abs = CR.root(name);
    const n = fs.existsSync(abs) ? fs.readdirSync(abs).length : 0;
    line = `  ${name.toUpperCase().padEnd(7)} ${abs}\n` +
           `          set by: ${picked.layer}   (${n} entries on disk)\n` +
           `          role:   ${spec.role}`;
  } catch (e) { bad++; line = `  ${name.toUpperCase().padEnd(7)} REFUSED\n${e.message.split("\n").slice(0, 4).map((l) => "          " + l.trim()).join("\n")}`; }
  console.log(line + "\n");
}

if (!bad) {
  const AC = require("./engine/artifact-contract");
  const corpus = CR.corpusRoot();
  console.log(`  ${CR.LAYOUT.sen}/ tree     ${path.join(corpus, CR.LAYOUT.sen)}`);
  console.log(`  artifacts   ${path.join(corpus, AC.HOMES.tracked)}`);
  for (const kind of AC.kindsOf()) {
    const p = AC.pathFor(kind, corpus);
    let state = "ABSENT";
    try { AC.load(kind, p); state = "ok"; }
    catch (e) { state = fs.existsSync(p) ? "PRESENT but FAILS the contract: " + (e.expected ? `expected ${e.expected}, got ${e.got}` : e.message.split("\n")[0]) : "ABSENT"; }
    console.log(`    ${kind.padEnd(17)} ${state}`);
  }
  console.log("");
  console.log(`  SOURCE is read-only input and is never written or wiped.`);
  console.log(`  Repoint either root by editing ONE line in ${path.relative(process.cwd(), CR.ENV_FILE)}.`);
  console.log("");
}
process.exit(bad ? 1 : 0);
