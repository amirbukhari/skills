#!/usr/bin/env node
"use strict";
/**
 * COIN-A-WORD demo runner — proves the growth loop end to end on real hydra-source.
 * DEFINE -> REGISTER -> AUTHOR-with (tsc clean) -> READ-with (render + coverage delta)
 * -> ROUND-TRIP. Deterministic, zero model calls. Billing read-only; writes only
 * under hydra-source/. No commit.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { tokenize } = require("./engine/fanout.js");
const { coinWord, authorWith, readWith, matchStatement } = require("./engine/coin.js");
const CR = require("./engine/corpus-root");

const REPO = __dirname;
const CORPUS = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root: the .ts tree
const OUT = path.join(CORPUS, "coined-demo");
const CATALOG = path.join(CORPUS, "catalog", "coined-words.json");
fs.mkdirSync(OUT, { recursive: true });
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
const rel = (f) => path.relative(SRC, f);
const files = walk(SRC).sort().filter((f) => !f.includes("/demo/") && !f.startsWith(OUT));
const log = (...a) => console.log(...a);

/* ============================ 1. DEFINE ============================ */
log("=== 1. DEFINE — coin `isProduction` from the bespoke prod-gate expression ===");
const isProduction = coinWord({
  name: "isProduction",
  kind: "expression",
  example: "process.env.NODE_ENV === 'production'",
  call: "isProduction()",
  define: "export const isProduction = (): boolean => (process.env.NODE_ENV === 'production');",
  english: "we are running in the production environment",
  englishPhrase: "it is production",
});
log(`  name    : ${isProduction.name}`);
log(`  shape   : ${isProduction.shape}`);
log(`  define  : ${isProduction.define}`);
log(`  validated: example parses; fill(template,slots) === example (byte-exact refill)`);

/* also coin a STATEMENT word to demonstrate a byte-identical param round-trip */
const prodFlag = coinWord({
  name: "prodFlag", kind: "statement",
  example: "const isProduction = process.env.NODE_ENV === 'production';",
  params: [{ name: "flag", at: 0 }],
  english: "bind <flag> to whether we are in production",
});

/* ============================ 2. REGISTER ============================ */
log("\n=== 2. REGISTER — persist into the language catalog (deterministic) ===");
let catalog = { schema: "sdd-coined-words/1", words: [] };
if (fs.existsSync(CATALOG)) { try { catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8")); } catch (e) {} }
function register(word) {
  catalog.words = catalog.words.filter((w) => w.name !== word.name);
  catalog.words.push(word);
  catalog.words.sort((a, b) => a.name.localeCompare(b.name));
}
register(isProduction); register(prodFlag);
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1));
log(`  wrote ${rel(CATALOG)} — ${catalog.words.length} coined word(s): ${catalog.words.map((w) => w.name).join(", ")}`);

/* ============================ 3. AUTHOR-with ============================ */
log("\n=== 3. AUTHOR — write a NEW function in English that USES the coined word ===");
const sentence = [
  "define syncWhenProd(runSync):",
  "  guard on isProduction():",
  "    await runSync(); return",
  "  else warn 'Not in production environment: sync skipped.'",
].join("\n");
log("  English/DSL sentence:");
log(sentence.split("\n").map((l) => "    " + l).join("\n"));

// EMIT TypeScript. The `isProduction()` guard comes from authorWith(asCall); the
// rest is the skeleton the sentence names. The coined helper DEFINITION ships too,
// so the module is self-contained and typechecks.
const guardCall = authorWith(isProduction, {}, { asCall: true }); // -> "isProduction()"
const authored =
`${isProduction.define}

export const syncWhenProd = async (runSync: () => Promise<void>): Promise<void> => {
  if (${guardCall}) {
    await runSync();
    return;
  }
  console.warn('Not in production environment: sync skipped.');
};
`;
const demoFile = path.join(OUT, "syncWhenProd.ts");
// prepend a minimal ambient `process` decl so tsc is clean without node_modules @types
const tsSource = `declare const process: { env: { [k: string]: string | undefined } };\ndeclare const console: { warn(...a: unknown[]): void };\n\n${authored}`;
fs.writeFileSync(demoFile, tsSource);
log(`\n  emitted TS -> ${rel(demoFile)}:`);
log(authored.split("\n").map((l) => "    " + l).join("\n"));

// tsc CLEAN? Hermetic: empty typeRoots so no ambient @types leak in (self-contained
// via the file's own `declare` lines) — the CLEAN result is cwd-independent.
log("  running tsc --noEmit --strict (hermetic, empty typeRoots) …");
let tscResult;
const emptyTypes = path.join(OUT, ".empty-typeroots"); fs.mkdirSync(emptyTypes, { recursive: true });
try {
  execFileSync(process.execPath, [path.join(REPO, "node_modules/typescript/bin/tsc"),
    "--noEmit", "--strict", "--target", "ES2020", "--lib", "ES2020",
    "--typeRoots", emptyTypes, demoFile], { stdio: "pipe" });
  tscResult = "CLEAN (0 errors)";
} catch (e) { tscResult = "ERRORS:\n" + (e.stdout ? e.stdout.toString() : e.message); }
log(`  tsc: ${tscResult}`);

/* ============================ 4. READ-with ============================ */
log("\n=== 4. READ — the language now recognizes & names the shape in the corpus ===");
const sites = [];
for (const f of files) { const src = fs.readFileSync(f, "utf8"); for (const s of readWith(isProduction, src)) sites.push({ file: rel(f), start: s.start, src, text: s.text }); }
// attach line numbers
for (const s of sites) s.line = s.src.slice(0, s.start).split("\n").length;
log(`  isProduction() now names ${sites.length} occurrences that were anonymous expression bytes:`);
for (const s of sites) log(`    ${s.file}:${s.line}   ${s.text}`);

// RENDER one file: show a statement now naming isProduction instead of bespoke.
const showcase = sites.find((s) => /migrateLiftSubs/.test(s.file)) || sites[0];
if (showcase) {
  const lineText = showcase.src.split("\n")[showcase.line - 1];
  log(`\n  render-with-it — ${showcase.file}:${showcase.line}`);
  log(`    BEFORE (bespoke bytes):  ${lineText.trim()}`);
  log(`    AFTER  (named word)   :  ${lineText.replace(showcase.text, "«isProduction()»").trim()}`);
}

/* coverage delta: sites named that were previously unnamed expression interiors */
const coverageDelta = sites.length;
log(`\n  COVERAGE DELTA: +${coverageDelta} sites now expressible as the named word \`isProduction()\``);
log(`  (one coining names all ${coverageDelta} siblings — coverage grows by naming, deterministically)`);

/* ============================ 5. ROUND-TRIP ============================ */
log("\n=== 5. ROUND-TRIP — render -> author back -> byte-identical (statement word) ===");
const emitted = authorWith(prodFlag, { flag: "isProduction" });
const toks = tokenize("rt.ts", emitted).tokens;
const stmt = toks.find((t) => t.shape === prodFlag.shape);
const m = matchStatement(prodFlag, stmt);            // READ: recover the args
const reAuthored = authorWith(prodFlag, m.bind);     // WRITE back from recovered args
log(`  authored : ${emitted}`);
log(`  read bind: ${JSON.stringify(m.bind)}`);
log(`  re-authored: ${reAuthored}`);
log(`  byte-identical: ${emitted === reAuthored ? "YES ✓" : "NO ✗"}`);

// expression round-trip (semantic identity — whitespace-insensitive)
const exRT = authorWith(isProduction) === isProduction.example;
log(`  expression author == canonical example (byte-exact): ${exRT ? "YES ✓" : "NO ✗"}`);

/* ============================ summary ============================ */
const summary = {
  schema: "sdd-coin-demo/1", deterministic: true, modelCalls: 0,
  coined: catalog.words.map((w) => w.name),
  authoredFile: rel(demoFile), tsc: tscResult.startsWith("CLEAN") ? "clean" : "errors",
  readSites: sites.map((s) => `${s.file}:${s.line}`), coverageDelta,
  roundTrip: { statementByteIdentical: emitted === reAuthored, expressionByteExact: exRT },
};
fs.writeFileSync(path.join(OUT, "coin-demo-report.json"), JSON.stringify(summary, null, 1));
log(`\nwrote ${rel(path.join(OUT, "coin-demo-report.json"))}`);
log(`\nSUMMARY: coined ${summary.coined.length} word(s); tsc ${summary.tsc}; named ${coverageDelta} corpus sites; round-trip ${summary.roundTrip.statementByteIdentical && summary.roundTrip.expressionByteExact ? "byte-clean" : "CHECK"}.`);
