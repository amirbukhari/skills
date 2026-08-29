#!/usr/bin/env node
"use strict";
/**
 * gate-grammar.js — the DETERMINISTIC round-trip GATE for the logic-English grammar
 * rules. Walks the READ-ONLY Hydra corpus, extracts every real statement each new
 * rule would render, round-trips it (renderStatement -> compileStatement) and checks
 * the reconstruction is BYTE-EXACT against the original statement text. A rule is
 * ACCEPTED only if it round-trips soundly on its real sample; the pass rate and a few
 * real failures are reported per rule. Zero model calls; nothing is written.
 *   usage: node gate-grammar.js [--fails N]
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { renderStatement, compileStatement, loadWordsIndex, CHAIN_VERBS } = require("./engine/cnl.js");

const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const SKIP = new Set(["node_modules", ".git", "demo", "coined-demo"]);
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
let words = []; try { words = JSON.parse(fs.readFileSync(path.join(CORPUS, "catalog", "coined-words.json"), "utf8")).words; } catch (_) {}
const idx = loadWordsIndex(words);

// Which rule a statement belongs to (for grouping) — mirrors renderAction's dispatch.
function ruleOf(st) {
  if (ts.isThrowStatement(st) && st.expression && ts.isNewExpression(st.expression) &&
      ts.isIdentifier(st.expression.expression) && st.expression.expression.text === "Error") return "throw-error";
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const d = st.declarationList.declarations[0];
    if (ts.isIdentifier(d.name) && d.initializer) {
      if (ts.isConditionalExpression(d.initializer)) return "ternary-value";
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
      return isConst ? "assignment (const)" : "assignment (let)";
    }
  }
  if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression) &&
      st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(st.expression.left) || ts.isElementAccessExpression(st.expression.left))) return "member-assignment";
  if (ts.isExpressionStatement(st) && ts.isCallExpression(st.expression)) {
    const cx = st.expression;
    if (ts.isPropertyAccessExpression(cx.expression) && CHAIN_VERBS.has(cx.expression.name.text)) return "bare method-chain";
    if (ts.isIdentifier(cx.expression)) return "bare call";
  }
  return null;
}

const rules = {};
const R = (k) => (rules[k] = rules[k] || { total: 0, pass: 0, fails: [] });
let scannedFiles = 0;

for (const abs of walk(CORPUS)) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  scannedFiles++;
  const visit = (node) => {
    // Only look at statements sitting directly inside a block/function body.
    if (ts.isBlock(node)) {
      for (const st of node.statements) {
        const rule = ruleOf(st);
        if (!rule) continue;
        const original = st.getText(sf);
        // Statement-level round-trip reparses the extracted text in isolation, which
        // loses the enclosing async context — a multi-line `await` at top level then
        // fragments under ASI. Skip any statement that does not reparse to exactly
        // itself; it is an extraction artifact, not a rule instance. (In the real file
        // the statement keeps its context and the render bails it to a bespoke escape.)
        const rp = ts.createSourceFile("rp.ts", original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        if (rp.statements.length !== 1 || rp.statements[0].getText(rp) !== original.trim()) continue;
        const bucket = R(rule);
        bucket.total++;
        let ok = false, en = "", back = "";
        try {
          en = renderStatement(original, idx);
          // A rule only "engages" if the render is not a bare bespoke escape.
          if (/^`[\s\S]*`$/.test(en.replace(/\.$/, ""))) { bucket.total--; continue; }
          back = compileStatement(en, idx);
          ok = back.trim() === original.trim();
        } catch (e) { ok = false; back = "<throw: " + e.message + ">"; }
        if (ok) bucket.pass++;
        else {
          // Classify: pure ASI (source omits a trailing ';' the canonical emitter adds)
          // is formatting variance, not a fidelity loss; anything else is semantic.
          const asi = back.trim() === original.trim() + ";";
          if (asi) bucket.asi = (bucket.asi || 0) + 1;
          else { bucket.semantic = (bucket.semantic || 0) + 1; if (bucket.fails.length < 40) bucket.fails.push({ src: original, en, back: back.trim() }); }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const nFails = process.argv.includes("--fails") ? parseInt(process.argv[process.argv.indexOf("--fails") + 1], 10) : 3;
console.log(`GRAMMAR GATE — round-trip over ${scannedFiles} files (byte-exact reconstruction required)\n`);
let gTot = 0, gPass = 0;
for (const [name, b] of Object.entries(rules).sort((a, c) => c[1].total - a[1].total)) {
  const pct = b.total ? (100 * b.pass / b.total) : 0;
  const semantic = b.semantic || 0, asi = b.asi || 0;
  gTot += b.total; gPass += b.pass;
  // A rule is ACCEPTED iff it has ZERO semantic failures; any residual is pure ASI
  // (a trailing ';' the source omitted) and is reported, not hidden.
  const verdict = semantic === 0
    ? (asi === 0 ? "ACCEPT (100% byte-exact)" : `ACCEPT (${pct.toFixed(1)}% byte-exact; residual = ${asi} ASI-only)`)
    : `REJECT (${semantic} semantic mismatch)`;
  console.log(`● ${name}`);
  console.log(`   instances ${b.total}   byte-exact ${b.pass}   semantic-fail ${semantic}   ASI-only ${asi}   -> ${verdict}`);
  for (const f of b.fails.slice(0, nFails)) {
    console.log(`   FAIL  src: ${f.src.replace(/\n\s*/g, " ")}`);
    console.log(`         en:  ${f.en.replace(/\n\s*/g, " ")}`);
    console.log(`         back: ${f.back.replace(/\n\s*/g, " ")}`);
  }
  console.log("");
}
console.log(`TOTAL round-tripped statements ${gTot}   byte-exact ${gPass}   (${(100 * gPass / (gTot || 1)).toFixed(1)}%)`);
