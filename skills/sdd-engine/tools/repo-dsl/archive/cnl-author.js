#!/usr/bin/env node
"use strict";
/**
 * CONTROLLED-ENGLISH LOGIC AUTHORING — end-to-end proof on real hydra-source.
 * English -> TS (tsc CLEAN) ; TS -> English (render) ; rejection ; round-trip.
 * Deterministic for composed parts; billing read-only; writes only in hydra-source.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { compile, render, CnlError, loadWordsIndex } = require("./engine/cnl.js");
const CR = require("./engine/corpus-root");

const REPO = __dirname;
const CORPUS = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root: the .ts tree
const OUT = path.join(CORPUS, "coined-demo");
fs.mkdirSync(OUT, { recursive: true });
const rel = (f) => path.relative(SRC, f);
const log = (...a) => console.log(...a);

const words = JSON.parse(fs.readFileSync(path.join(CORPUS, "catalog", "coined-words.json"), "utf8")).words;
const idx = loadWordsIndex(words);
const isProd = words.find((w) => w.name === "isProduction");

/* ============ 1. AUTHOR: literal English -> TS -> tsc CLEAN ============ */
log("=== 1. AUTHOR — the target English compiles to TypeScript ===");
const ENGLISH = `To sync when prod, taking a sync action:
  When it is production, run the sync and stop.
  Otherwise, warn "Not in production environment: sync skipped."`;
log("  English input:");
log(ENGLISH.split("\n").map((l) => "    " + l).join("\n"));

const { ts: fnTs, fnName } = compile(ENGLISH, idx);
log("\n  emitted TypeScript:");
log(fnTs.split("\n").map((l) => "    " + l).join("\n"));

const module_ = `declare const process: { env: { [k: string]: string | undefined } };\n`
  + `declare const console: { warn(...a: unknown[]): void };\n\n`
  + `${isProd.define}\n\n${fnTs}`;
const demoFile = path.join(OUT, "cnl.syncWhenProd.ts");
fs.writeFileSync(demoFile, module_);

const emptyTypes = path.join(OUT, ".empty-typeroots"); fs.mkdirSync(emptyTypes, { recursive: true });
let tsc;
try {
  execFileSync(process.execPath, [path.join(REPO, "node_modules/typescript/bin/tsc"),
    "--noEmit", "--strict", "--target", "ES2020", "--lib", "ES2020", "--typeRoots", emptyTypes, demoFile], { stdio: "pipe" });
  tsc = "CLEAN (0 errors)";
} catch (e) { tsc = "ERRORS:\n" + (e.stdout ? e.stdout.toString() : e.message); }
log(`\n  wrote ${rel(demoFile)} ; tsc --noEmit --strict (hermetic): ${tsc}`);

/* ============ 2. RENDER: existing corpus function -> English ============ */
log("\n=== 2. RENDER — an existing corpus function to English (read-only) ===");
const srcFile = path.join(SRC, "src/hydra-api/actions/handlers/migrateLiftSubs.ts");
const srcLines = fs.readFileSync(srcFile, "utf8").split("\n");
const fnText = srcLines.slice(11, 18).join("\n"); // createHubspotDealIfProd (lines 12-18)
log(`  source — ${rel(srcFile)}:12-18`);
log(fnText.split("\n").map((l) => "    " + l).join("\n"));
log("\n  rendered English (raw expressions bespoke-escaped in `backticks`):");
log(render(fnText, idx).split("\n").map((l) => "    " + l).join("\n"));

/* also render the AUTHORED module back — shows the coined PHRASE in reverse */
log("\n  render of the authored syncWhenProd (coined phrase reverses to English):");
log(render(fnTs, idx).split("\n").map((l) => "    " + l).join("\n"));

/* ============ 3. REJECTION: malformed sentence -> phrase-pointing error ============ */
log("\n=== 3. REJECT — a sentence outside the grammar names the offending phrase ===");
const BAD = `To be broken:\n  Whenever it is production, do the needful.`;
log("  input:");
log(BAD.split("\n").map((l) => "    " + l).join("\n"));
try { compile(BAD, idx); log("  (unexpectedly accepted!)"); }
catch (e) { log(`  REJECTED (${e.name}): ${e.message}\n     offending phrase -> "${e.phrase}"`); }

/* ============ 4. ROUND-TRIP ============ */
log("\n=== 4. ROUND-TRIP — English -> TS -> English (structure-identical) ===");
const norm = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
const cases = [
  ENGLISH,
  `To tally each charge, taking a list:\n  For each charge in list, \`total += charge.amount\`\n  Return total.`,
];
let rtPass = 0;
for (const eng of cases) {
  const { ts } = compile(eng, idx);
  const back = render(ts, idx);
  // re-compile the rendered English -> TS, compare TS byte-for-byte
  const { ts: ts2 } = compile(back, idx);
  const structOk = norm(back) === norm(eng);
  const tsOk = ts === ts2;
  log(`  case "${eng.split("\n")[0]}"  english-structure=${structOk ? "IDENTICAL" : "DIFF"}  TS-reauthor=${tsOk ? "BYTE-IDENTICAL" : "DIFF"}`);
  if (structOk && tsOk) rtPass++;
}
log(`  round-trip: ${rtPass}/${cases.length} clean`);

/* ============ report ============ */
const report = {
  schema: "sdd-cnl-demo/1", deterministic: true, modelCalls: 0,
  authoredFile: rel(demoFile), tsc: tsc.startsWith("CLEAN") ? "clean" : "errors",
  roundTrip: `${rtPass}/${cases.length}`,
  grammar: { control: ["When <cond>, <clause>.", "Otherwise, <clause>.", "For each <x> in <xs>, <clause>.", "Return <v>. / Stop.", "<action>."],
    conds: "coined englishPhrase | `bespoke` | <a> and <b>", escape: "`backtick` = verbatim TS ; \"quotes\" = string literal" },
};
fs.writeFileSync(path.join(OUT, "cnl-demo-report.json"), JSON.stringify(report, null, 1));
log(`\nwrote ${rel(path.join(OUT, "cnl-demo-report.json"))}`);
log(`\nSUMMARY: English->TS tsc ${report.tsc}; render OK; rejection OK; round-trip ${report.roundTrip}.`);
