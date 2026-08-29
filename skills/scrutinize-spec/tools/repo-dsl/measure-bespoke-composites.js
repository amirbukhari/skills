#!/usr/bin/env node
"use strict";
/**
 * measure-bespoke-composites.js — STEP 1 of the coverage push (MEASURE ONLY).
 *
 * Across the whole READ-ONLY Hydra corpus, quantify how much of the "bespoke /
 * 100% custom logic" bucket (statements the current grammar bails on, rendering
 * them as a bare `backtick` escape) is actually RECURRING composite structure vs
 * genuinely unique code.
 *
 * A statement is BESPOKE iff no current production engages it. We detect that in
 * the SAME way the engine bails: a statement whose isolated reparse fragments
 * (multi-line `await` losing async context) bails to bespoke in-context; every
 * other statement is bespoke iff renderStatement returns a bare backtick escape.
 *
 * Each bespoke statement is clustered by a STRUCTURAL SHAPE KEY computed from the
 * real in-context AST node (no reparse — so no fragmentation): callee/method NAMES
 * and operators are kept (they define the composite), while identifiers/literals
 * used as values/args are abstracted (id/str/num/obj/arr/fn/tmpl/call). Clusters
 * are ranked by frequency; we report what share of the bespoke bucket the top
 * recurring shapes cover. Zero model calls; nothing is written.
 *   usage: node measure-bespoke-composites.js [--top N]
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { renderStatement, loadWordsIndex } = require("./engine/cnl.js");

const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const SKIP = new Set(["node_modules", ".git", "demo", "coined-demo"]);
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
let words = []; try { words = JSON.parse(fs.readFileSync(path.join(CORPUS, "catalog", "coined-words.json"), "utf8")).words; } catch (_) {}
const idx = loadWordsIndex(words);

/* Coarse arg abstraction — keeps signatures from over-splitting on arg internals
 * while preserving the KIND of each argument (a query builder's (str, obj) stays
 * distinct from (fn)). */
function argShape(a) {
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return "str";
  if (ts.isTemplateExpression(a)) return "tmpl";
  if (ts.isNumericLiteral(a)) return "num";
  if (a.kind === ts.SyntaxKind.TrueKeyword || a.kind === ts.SyntaxKind.FalseKeyword) return "bool";
  if (a.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isObjectLiteralExpression(a)) return "obj";
  if (ts.isArrayLiteralExpression(a)) return "arr";
  if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) return "fn";
  if (ts.isIdentifier(a)) return "id";
  if (ts.isCallExpression(a) || ts.isAwaitExpression(a)) return "call";
  return "expr";
}

/* Structural shape of an expression. Keeps CALLEE names and METHOD names (the
 * recognizable spine of a composite) and operators; abstracts value atoms. */
function shape(node, sf, depth = 0) {
  if (!node || depth > 14) return "…";
  if (ts.isIdentifier(node)) return "id";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return "str";
  if (ts.isNumericLiteral(node)) return "num";
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return "bool";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (ts.isTemplateExpression(node)) return "tmpl";
  if (ts.isAwaitExpression(node)) return "await " + shape(node.expression, sf, depth + 1);
  if (ts.isParenthesizedExpression(node)) return "(" + shape(node.expression, sf, depth + 1) + ")";
  if (ts.isPropertyAccessExpression(node)) return shape(node.expression, sf, depth + 1) + "." + node.name.text;
  if (ts.isElementAccessExpression(node)) return shape(node.expression, sf, depth + 1) + "[]";
  if (ts.isCallExpression(node)) {
    const callee = ts.isIdentifier(node.expression) ? node.expression.text : shape(node.expression, sf, depth + 1);
    return callee + "(" + node.arguments.map(argShape).join(",") + ")";
  }
  if (ts.isNewExpression(node)) { const c = ts.isIdentifier(node.expression) ? node.expression.text : shape(node.expression, sf, depth + 1); return "new " + c + "(" + (node.arguments || []).map(argShape).join(",") + ")"; }
  if (ts.isConditionalExpression(node)) return shape(node.condition, sf, depth + 1) + " ? " + shape(node.whenTrue, sf, depth + 1) + " : " + shape(node.whenFalse, sf, depth + 1);
  if (ts.isBinaryExpression(node)) return shape(node.left, sf, depth + 1) + " " + node.operatorToken.getText(sf) + " " + shape(node.right, sf, depth + 1);
  if (ts.isPrefixUnaryExpression(node)) return "u" + shape(node.operand, sf, depth + 1);
  if (ts.isObjectLiteralExpression(node)) return "{obj}";
  if (ts.isArrayLiteralExpression(node)) return "[arr]";
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return "fn";
  if (ts.isAsExpression(node)) return shape(node.expression, sf, depth + 1) + " as T";
  if (ts.isNonNullExpression(node)) return shape(node.expression, sf, depth + 1) + "!";
  if (ts.isSpreadElement(node)) return "..." + shape(node.expression, sf, depth + 1);
  return ts.SyntaxKind[node.kind];
}

/* Structural shape of a whole statement. */
function stmtShape(st, sf) {
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const d = st.declarationList.declarations[0];
    const kw = (st.declarationList.flags & ts.NodeFlags.Const) ? "const" : "let";
    const t = d.type ? ": T" : "";
    return `${kw} id${t} = ` + (d.initializer ? shape(d.initializer, sf) : "∅");
  }
  if (ts.isExpressionStatement(st)) return shape(st.expression, sf);
  if (ts.isReturnStatement(st)) return "return " + (st.expression ? shape(st.expression, sf) : "");
  if (ts.isThrowStatement(st)) return "throw " + (st.expression ? shape(st.expression, sf) : "");
  return ts.SyntaxKind[st.kind];
}

const isTestFile = (rel) => /\.(test|spec)\.ts$/.test(rel) || /(^|\/)(__tests__|tests?)(\/|$)/.test(rel);

/* Is this shape a data literal (object/array/template/plain destructure — arguably
 * not a "composite" worth an English frame) or a genuine composite (a call, await,
 * method-chain, ternary or conditional — the real logic frontier)? */
function categoryOf(key) {
  const rhs = key.replace(/^(const|let)( id)?(: T)? = /, "").replace(/^return /, "").replace(/^throw /, "");
  if (/^(\{obj\}|\[arr\]|tmpl|str|num|bool|null|id)( as T)?$/.test(rhs)) return "data";
  if (/\?.*:/.test(rhs)) return "composite"; // ternary
  if (/\(|await|\.\w/.test(rhs)) return "composite"; // call / await / member-or-method chain
  return "other";
}

const clusters = new Map(); // shapeKey -> { count, prod, ex: [text...] }
let scannedFiles = 0, totalStmts = 0, bespoke = 0, fragmentBespoke = 0;
let prodStmts = 0, prodBespoke = 0;

for (const abs of walk(CORPUS)) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  const rel = path.relative(CORPUS, abs);
  const testFile = isTestFile(rel);
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  scannedFiles++;
  const visit = (node) => {
    if (ts.isBlock(node)) {
      for (const st of node.statements) {
        // Only simple statements can be bespoke leaves; control-flow (if/for/while/
        // switch/try) is framed by When/For each and is not part of the bucket.
        if (!(ts.isVariableStatement(st) || ts.isExpressionStatement(st) || ts.isReturnStatement(st) || ts.isThrowStatement(st))) { ts.forEachChild(node, visit); return; }
        totalStmts++; if (!testFile) prodStmts++;
        const text = st.getText(sf);
        let isBespoke;
        const rp = ts.createSourceFile("rp.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        if (rp.statements.length === 1 && rp.statements[0].getText(rp) === text.trim()) {
          let en = ""; try { en = renderStatement(text, idx); } catch (_) { en = ""; }
          isBespoke = en === "" || /^`[\s\S]*`$/.test(en.replace(/\.$/, ""));
        } else {
          // Isolated reparse fragments (multi-line await) -> engine bails in-context.
          isBespoke = true; fragmentBespoke++;
        }
        if (!isBespoke) continue;
        bespoke++; if (!testFile) prodBespoke++;
        let key; try { key = stmtShape(st, sf); } catch (_) { key = "<shape-error>"; }
        const c = clusters.get(key) || { count: 0, prod: 0, ex: [] };
        c.count++; if (!testFile) c.prod++;
        if (!testFile && c.ex.length < 2) c.ex.push(text.replace(/\s+/g, " ").trim().slice(0, 160));
        clusters.set(key, c);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const topN = process.argv.includes("--top") ? parseInt(process.argv[process.argv.indexOf("--top") + 1], 10) : 20;

function report(label, countOf, bespokeTotal, stmtTotal, showExamples) {
  const ranked = [...clusters.entries()].map(([key, v]) => ({ key, count: countOf(v), ex: v.ex, cat: categoryOf(key) })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  const recurring = ranked.filter((r) => r.count >= 2);
  const recurringStmts = recurring.reduce((a, r) => a + r.count, 0);
  const singletons = ranked.filter((r) => r.count === 1).length;
  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
  console.log(`Simple statements ................ ${stmtTotal}`);
  console.log(`Bespoke bucket (grammar bails) ... ${bespokeTotal}  (${(100 * bespokeTotal / (stmtTotal || 1)).toFixed(1)}% of simple statements)`);
  console.log(`Distinct structural shapes ....... ${ranked.length}`);
  console.log(`   recurring (>=2) ... ${recurring.length} shapes / ${recurringStmts} stmts (${(100 * recurringStmts / (bespokeTotal || 1)).toFixed(1)}% of bespoke)   unique ... ${singletons} stmts (${(100 * singletons / (bespokeTotal || 1)).toFixed(1)}%)`);
  const compos = recurring.filter((r) => r.cat === "composite"); const compStmts = compos.reduce((a, r) => a + r.count, 0);
  const data = recurring.filter((r) => r.cat === "data"); const dataStmts = data.reduce((a, r) => a + r.count, 0);
  console.log(`   of the recurring: COMPOSITE (call/chain/await/ternary) ${compStmts} stmts (${(100 * compStmts / (bespokeTotal || 1)).toFixed(1)}% of bespoke)   DATA-literal ${dataStmts} stmts (${(100 * dataStmts / (bespokeTotal || 1)).toFixed(1)}%)`);
  let cum = 0; const marks = {};
  for (let i = 0; i < ranked.length; i++) { cum += ranked[i].count; if ([5, 10, 15, 20].includes(i + 1)) marks[i + 1] = cum; }
  console.log(`   cumulative coverage:` + [5, 10, 15, 20].map((k) => marks[k] != null ? ` top${k}=${(100 * marks[k] / (bespokeTotal || 1)).toFixed(0)}%` : "").join(""));
  if (showExamples) {
    console.log(`\n   TOP ${topN} RECURRING SHAPES (● composite, ○ data):`);
    for (let i = 0; i < Math.min(topN, ranked.length); i++) {
      const r = ranked[i]; if (r.count < 2) break;
      console.log(`\n   ${String(i + 1).padStart(2)}. [${r.count}x] ${r.cat === "composite" ? "●" : r.cat === "data" ? "○" : "·"}  ${r.key}`);
      for (const e of r.ex.slice(0, 2)) console.log(`         e.g. ${e}`);
    }
  }
  return ranked;
}

console.log(`BESPOKE-COMPOSITE MEASUREMENT over ${scannedFiles} files (read-only, zero model calls)`);
console.log(`multi-line/await statements the engine bails in-context: ${fragmentBespoke}`);
report("ALL FILES (production + test)", (v) => v.count, bespoke, totalStmts, false);
report("PRODUCTION ONLY (test/spec files excluded) — the real logic frontier", (v) => v.prod, prodBespoke, prodStmts, true);

// --grep <substr>: sum production shapes whose key contains substr (for pinning a
// specific named family, e.g. a querybuilder chain or all ternaries).
const gi = process.argv.indexOf("--grep");
if (gi > -1) {
  const needle = process.argv[gi + 1];
  const hits = [...clusters.entries()].map(([key, v]) => ({ key, prod: v.prod, ex: v.ex })).filter((r) => r.prod > 0 && r.key.includes(needle)).sort((a, b) => b.prod - a.prod);
  const sum = hits.reduce((a, r) => a + r.prod, 0);
  console.log(`\nGREP "${needle}" across production bespoke shapes: ${hits.length} shapes / ${sum} statements`);
  for (const r of hits.slice(0, 15)) { console.log(`   [${r.prod}x] ${r.key}`); if (r.ex[0]) console.log(`        e.g. ${r.ex[0]}`); }
}
