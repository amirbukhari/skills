"use strict";
/** test-gen-roundtrip.js — render every corpus .ts to .en and compile back; assert byte-identical.
 * Reports statement collapse from the multi-line generator layer. Read-only. */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./engine/enfile");
const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", "spec", "catalog", ".cache", "demo", "coined-demo"]);
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }

const index = EN.loadIndex(CORPUS);
const files = walk(CORPUS);
let ok = 0, bad = 0, badList = [];
let genSpansTotal = 0, genStmtsCollapsed = 0, filesWithGen = 0;
let totalTsStmts = 0, totalEnStmtsApprox = 0;
const topFiles = [];
for (const abs of files) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
  let en, stats, back;
  try { const r = EN.renderFileEn(src, index); en = r.en; stats = r.stats; back = EN.compileFileEn(en, index); }
  catch (e) { bad++; badList.push([path.relative(CORPUS, abs), "EXC:" + e.message]); continue; }
  if (back !== src) { bad++; badList.push([path.relative(CORPUS, abs), "BYTE-MISMATCH"]); continue; }
  ok++;
  genSpansTotal += stats.genSpans; genStmtsCollapsed += stats.genStmtsCollapsed;
  if (stats.genSpans) { filesWithGen++; topFiles.push({ f: path.relative(CORPUS, abs), spans: stats.genSpans, collapsed: stats.genStmtsCollapsed }); }
}
console.log("=== gen round-trip ===");
console.log("files:", files.length, " byte-identical:", ok, " FAILURES:", bad);
console.log("files using >=1 generator:", filesWithGen);
console.log("generator CALLS emitted:", genSpansTotal, " statements collapsed into them:", genStmtsCollapsed);
console.log("net statement reduction (collapsed - calls):", genStmtsCollapsed - genSpansTotal);
if (bad) { console.log("\n-- failures (first 15) --"); for (const [f, w] of badList.slice(0, 15)) console.log("  ", w, f); }
console.log("\n-- top 12 files by statements collapsed --");
for (const t of topFiles.sort((a, b) => b.collapsed - a.collapsed).slice(0, 12)) console.log(`   ${t.collapsed} stmts -> ${t.spans} calls   ${t.f}`);
