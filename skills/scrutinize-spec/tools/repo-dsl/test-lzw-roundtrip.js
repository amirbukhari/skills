"use strict";
/** test-lzw-roundtrip.js — render every corpus .ts through the RECURSIVE word dictionary
 * (catalog/generators-lzw.json), compile back, assert byte-identical. Reports statement
 * collapse and the ACTUAL emitted composition depth (maxDepth>=2 => the live path composes).
 * Read-only over the corpus. */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const EN = require("./engine/enlzw");
const CORPUS = process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source";
const CAT = path.join(__dirname, "catalog", "generators-lzw.json");
const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", "spec", "catalog", ".cache", "demo", "coined-demo"]);
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }

const OPEN = "«", CLOSE = "»", GEN = "▶", PO = "⟪", PC = "⟫";
const PAY = require("./engine/payload"); // payloads are `lzw1` text, not base64(JSON)
const cat = EN.loadLzw(CAT);
const files = walk(CORPUS);

let ok = 0, bad = 0, badList = [];
let calls = 0, collapsed = 0, filesWithGen = 0, maxDepthEmitted = 0;
const depthHist = {};
const top = [];
for (const abs of files) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let spans; try { spans = EN.genSpans(sf, src, cat); } catch (e) { bad++; badList.push([path.relative(CORPUS, abs), "RENDER-EXC:" + e.message]); continue; }
  spans.sort((a, b) => a.start - b.start);
  // build .en (swap spans), then compile back
  let en = "", pos = 0, fileCollapsed = 0;
  for (const sp of spans) {
    if (sp.start < pos) continue;
    en += src.slice(pos, sp.start) + OPEN + GEN + " " + PO + PAY.encode(sp.payload) + PC + CLOSE;
    pos = sp.end; fileCollapsed += sp.stmts;
    if (sp.depth > maxDepthEmitted) maxDepthEmitted = sp.depth;
    depthHist[sp.depth] = (depthHist[sp.depth] || 0) + 1;
  }
  en += src.slice(pos);
  // compile
  let out = "", i = 0, compileErr = null;
  try {
    while (i < en.length) {
      const o = en.indexOf(OPEN, i);
      if (o < 0) { out += en.slice(i); break; }
      out += en.slice(i, o);
      const c = en.indexOf(CLOSE, o + 1);
      const chunk = en.slice(o + 1, c);
      const a = chunk.lastIndexOf(PO), bb = chunk.lastIndexOf(PC);
      const payload = PAY.decode(chunk.slice(a + 1, bb));
      out += EN.compileSpan(payload, cat);
      i = c + 1;
    }
  } catch (e) { compileErr = e.message; }
  if (compileErr) { bad++; badList.push([path.relative(CORPUS, abs), "COMPILE-EXC:" + compileErr]); continue; }
  if (out !== src) { bad++; badList.push([path.relative(CORPUS, abs), "BYTE-MISMATCH"]); continue; }
  ok++;
  if (spans.length) { filesWithGen++; calls += spans.length; collapsed += fileCollapsed; top.push({ f: path.relative(CORPUS, abs), calls: spans.length, collapsed: fileCollapsed }); }
}
console.log("=== LZW recursive-dictionary round-trip ===");
console.log("files:", files.length, " byte-identical:", ok, " FAILURES:", bad);
console.log("files using >=1 generator:", filesWithGen);
console.log("generator CALLS emitted:", calls, " statements collapsed:", collapsed);
console.log("net statement reduction (collapsed - calls):", collapsed - calls);
console.log("MAX composition depth actually emitted:", maxDepthEmitted, " (>=2 => live path composes)");
console.log("emitted-depth histogram:", JSON.stringify(depthHist));
if (bad) { console.log("\n-- failures (first 15) --"); for (const [f, w] of badList.slice(0, 15)) console.log("  ", w, f); }
console.log("\n-- top 10 files by statements collapsed --");
for (const t of top.sort((a, b) => b.collapsed - a.collapsed).slice(0, 10)) console.log(`   ${t.collapsed} stmts -> ${t.calls} calls   ${t.f}`);
