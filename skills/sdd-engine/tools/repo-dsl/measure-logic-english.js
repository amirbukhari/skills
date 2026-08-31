#!/usr/bin/env node
"use strict";
/**
 * measure-logic-english.js — the RE-RUNNABLE char-level metric for the logic-English
 * grammar. Fixed deterministic sample (5 logic archetypes x 6 files, spread by size).
 * Renders each file's functions through cnl.render and reports the fraction of
 * non-whitespace rendered characters that are ENGLISH (outside `backtick` escapes).
 * Baseline before any grammar growth: median ~23%. Read-only, no model calls.
 *   usage: node measure-logic-english.js [--examples N]
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const A = require("./engine/archetypes.js");
const { render, renderStatement, loadWordsIndex } = require("./engine/cnl.js");
const CR = require("./engine/corpus-root");

const CORPUS = CR.corpusRoot();   // WRITE root
const SRC = CR.sourceRoot();       // READ root: the .ts tree
const SKIP = new Set(["node_modules", ".git", "demo", "coined-demo"]);
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
let words = []; try { words = JSON.parse(fs.readFileSync(path.join(CORPUS, "catalog", "coined-words.json"), "utf8")).words; } catch (_) {}
const idx = loadWordsIndex(words);

const TARGET = ["AsyncFunctionModule", "PureModule", "DataAccessModule", "ServiceClass", "FunctionModule"];
const by = {};
for (const abs of walk(SRC)) { const rel = path.relative(SRC, abs); let src, f; try { src = fs.readFileSync(abs, "utf8"); f = A.analyzeFile(rel, src); } catch (_) { continue; } const a = A.classifyFile(f); if (TARGET.includes(a)) (by[a] = by[a] || []).push({ rel, src, chars: f.chars, arche: a }); }
const sample = [];
for (const a of TARGET) { const list = (by[a] || []).sort((x, y) => x.chars - y.chars); for (let k = 0; k < 6; k++) { const i = Math.floor(((k + 0.5) / 6) * list.length); if (list[i]) sample.push(list[i]); } }

function englishFrac(text) {
  let inside = 0, outside = 0, tick = false;
  for (const ch of text) { if (ch === "`") { tick = !tick; continue; } if (/\s/.test(ch)) continue; if (tick) inside++; else outside++; }
  return outside / (outside + inside || 1);
}
const fracs = [];
const perFile = [];
for (const s of sample) { let t; try { t = render(s.src, idx); } catch (e) { continue; } const fr = englishFrac(t); fracs.push(fr); perFile.push({ rel: s.rel, arche: s.arche, frac: fr, text: t }); }
fracs.sort((a, b) => a - b);
const med = fracs.length ? fracs[Math.floor(fracs.length / 2)] : 0;
const mean = fracs.reduce((a, b) => a + b, 0) / (fracs.length || 1);

console.log(`LOGIC-ENGLISH char-level metric over ${perFile.length} rendered files (of ${sample.length} sampled):`);
console.log(`   median ${(med * 100).toFixed(0)}%   mean ${(mean * 100).toFixed(0)}%   min ${(fracs[0] * 100 || 0).toFixed(0)}%   max ${(fracs[fracs.length - 1] * 100 || 0).toFixed(0)}%`);
const b = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
for (const f of fracs) { const p = f * 100; if (p < 20) b["0-20"]++; else if (p < 40) b["20-40"]++; else if (p < 60) b["40-60"]++; else if (p < 80) b["60-80"]++; else b["80-100"]++; }
console.log("   distribution:", JSON.stringify(b));

// STATEMENT-FRAME metric: the fraction of real statements that render with an English
// frame (Let/Set/Call/Return/When/For each/run/warn/log/map/...) versus a bare bespoke
// `backtick` escape. This is what the char metric cannot see — the connective grammar
// makes each statement a readable sentence even when its domain atoms stay verbatim.
// Also breaks out the three NEW-rule shapes (assignment / bare-call / method-chain),
// which were 100% bespoke before this grammar.
const FRAMED = /^(Let|Set|Call|Return|When|Otherwise|For each|run |warn |log |map |filter |reduce |find |sort |forEach |flatMap |some |every |stop)/;
let stTotal = 0, stFramed = 0, newTotal = 0, newFramed = 0;
const CHAIN = new Set(["map", "filter", "reduce", "find", "sort", "forEach", "flatMap", "some", "every"]);
function isNewShape(st) {
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const d = st.declarationList.declarations[0];
    if (ts.isIdentifier(d.name) && d.initializer) return true;
  }
  if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)) {
    const cx = st.expression;
    if (ts.isIdentifier(cx.expression)) return true;
    if (ts.isPropertyAccessExpression(cx.expression) && CHAIN.has(cx.expression.name.text)) return true;
  }
  return false;
}
for (const s of sample) {
  const sf = ts.createSourceFile("f.ts", s.src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isBlock(node)) for (const st of node.statements) {
      let en; try { en = renderStatement(st.getText(sf), idx).replace(/^\s+/, ""); } catch (_) { continue; }
      const framed = FRAMED.test(en);
      stTotal++; if (framed) stFramed++;
      if (isNewShape(st)) { newTotal++; if (framed) newFramed++; }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
console.log(`\nSTATEMENT-FRAME metric over ${stTotal} real statements:`);
console.log(`   English-framed ${stFramed} (${(100 * stFramed / (stTotal || 1)).toFixed(0)}%)   bespoke-escape ${stTotal - stFramed} (${(100 * (stTotal - stFramed) / (stTotal || 1)).toFixed(0)}%)`);
console.log(`   of the ${newTotal} new-rule statements (assign/call/chain — 0% framed before): ${newFramed} now framed (${(100 * newFramed / (newTotal || 1)).toFixed(0)}%)`);

const n = (process.argv.includes("--examples") ? parseInt(process.argv[process.argv.indexOf("--examples") + 1], 10) : 0) || 0;
if (n) { perFile.sort((a, b) => b.frac - a.frac); for (const e of perFile.slice(0, n)) { console.log("\n" + "=".repeat(80)); console.log(`${e.rel} [${e.arche}] english=${(e.frac * 100).toFixed(0)}%`); console.log("-".repeat(80)); console.log(e.text.split("\n").slice(0, 24).join("\n")); } }
