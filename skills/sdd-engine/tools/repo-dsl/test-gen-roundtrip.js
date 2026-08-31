"use strict";
/** test-gen-roundtrip.js — render every corpus .ts to .en and compile back; assert byte-identical.
 * Reports statement collapse from the multi-line generator layer. Read-only. */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./engine/enfile");
const CR = require("./engine/corpus-root");
const CORPUS = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root: the .ts tree
const { SKIP } = require("./engine/walk-skip");   // the ONE canonical corpus walk-skip set
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }

const index = EN.loadIndex(CORPUS);
const files = walk(SRC);
let ok = 0, bad = 0, badList = [];
let genSpansTotal = 0, genStmtsCollapsed = 0, filesWithGen = 0;
let totalTsStmts = 0, totalEnStmtsApprox = 0;
const topFiles = [];
for (const abs of files) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
  let en, stats, back;
  try { const r = EN.renderFileEn(src, index); en = r.en; stats = r.stats; back = EN.compileFileEn(en, index); }
  catch (e) { bad++; badList.push([path.relative(SRC, abs), "EXC:" + e.message]); continue; }
  if (back !== src) { bad++; badList.push([path.relative(SRC, abs), "BYTE-MISMATCH"]); continue; }
  ok++;
  genSpansTotal += stats.genSpans; genStmtsCollapsed += stats.genStmtsCollapsed;
  if (stats.genSpans) { filesWithGen++; topFiles.push({ f: path.relative(SRC, abs), spans: stats.genSpans, collapsed: stats.genStmtsCollapsed }); }
}
console.log("=== gen round-trip ===");
console.log("files:", files.length, " byte-identical:", ok, " FAILURES:", bad);
console.log("files using >=1 generator:", filesWithGen);
console.log("generator CALLS emitted:", genSpansTotal, " statements collapsed into them:", genStmtsCollapsed);
console.log("net statement reduction (collapsed - calls):", genStmtsCollapsed - genSpansTotal);
if (bad) { console.log("\n-- failures (first 15) --"); for (const [f, w] of badList.slice(0, 15)) console.log("  ", w, f); }
console.log("\n-- top 12 files by statements collapsed --");
for (const t of topFiles.sort((a, b) => b.collapsed - a.collapsed).slice(0, 12)) console.log(`   ${t.collapsed} stmts -> ${t.spans} calls   ${t.f}`);

/* ---------- EXIT CODE — a test that cannot fail is not a test ----------
 * This script is named `test-*`, is listed in run-tests.js SLOW_TIER, is cited by README.md and
 * SKILL.md as the byte-identity gate, and is what verify-register.js points a §R row at. It
 * counted `bad`, printed "FAILURES: N" as prose, and then exited 0 — so every caller above it
 * read success. PRD R-REND-1 calls byte-identity "the floor and it never regresses"; a floor
 * that reports 0 while broken is not a floor. Same defect, and the same fix, as the four
 * scripts in commit 391bb25. */
if (bad) {
  console.error(`\nBYTE-IDENTITY FLOOR BREACHED — ${ok}/${files.length} files round-trip; ${bad} failed.`);
  console.error(`  PRD R-REND-1: this is the floor and it never regresses. Refusing to report success.`);
  process.exit(1);
}
