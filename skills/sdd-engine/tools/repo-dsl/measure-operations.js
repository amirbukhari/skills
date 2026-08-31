#!/usr/bin/env node
"use strict";
/**
 * measure-operations.js — STEP 3 (MEASURE ONLY): discover higher-level OPERATION
 * patterns by ANTI-UNIFICATION (least-general generalization), not hand-written family
 * regexes.
 *
 * METHOD
 *   For each statement we compute a generalized template by walking its AST and
 *   replacing whole node CLASSES with TYPED HOLES, keeping the shared skeleton verbatim.
 *   A hole records the exact source span it abstracted, so a template PLUS a site's hole
 *   fills reconstructs that site's ORIGINAL bytes. Two statements are the same pattern iff
 *   their templates (holes typed, not filled) are equal. This DISCOVERS families such as
 *   getQueryBuilder(‹args›)⟨chain⟩ automatically — every entity/alias/where/join/terminal
 *   folds into holes — instead of us naming the family up front.
 *
 *   The generalization AGGRESSIVENESS is a deterministic knob (level = struct | op):
 *     struct : abstract only ATOMS (identifiers, string/number literals, objects, arrows);
 *              keep every call/method name and argument arity.  (near-literal — this is
 *              why the querybuilder chain looked "rare": getCount vs getMany split it.)
 *     op     : additionally (1) fold each argument list into one ‹args› hole (drops arity),
 *              and (2) collapse a call-chain rooted at a bare function call — ROOT(args)
 *              .a().b()…term() — into ROOT(‹args›)⟨chain⟩, so the whole filter/join/
 *              aggregate tail (any terminal) is one hole. This is the OPERATION level.
 *   We report both, so the knob's effect (struct → op growth) is visible per family.
 *
 * VERIFY  Every clustered site must reproduce its source bytes from template + its own
 *   hole fills (fill(parts) === statement text). Sites whose connective bytes differ from
 *   the canonical skeleton (odd spacing) fail and are EXCLUDED; each pattern reports its
 *   byte-exact pass rate. Zero model calls (human labels below are cosmetic, correctness-
 *   irrelevant). Nothing is written.
 *     usage: node measure-operations.js [--top N] [--family getQueryBuilder]
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { useSF, canonStmt, keyOf, fillOf, fnKey, fnStmtCount } = require("./engine/operations");
const CR = require("./engine/corpus-root");

const CORPUS = CR.sourceRoot();
const { SKIP } = require("./engine/walk-skip");   // the ONE canonical corpus walk-skip set
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
const isTestFile = (rel) => /\.(test|spec)\.ts$/.test(rel) || /(^|\/)(__tests__|tests?)(\/|$)/.test(rel);

let SF = null; // current source file (set per file)

/* ================================ SCAN ================================ */
const FAM = process.argv.includes("--family") ? process.argv[process.argv.indexOf("--family") + 1] : null;
const topN = process.argv.includes("--top") ? parseInt(process.argv[process.argv.indexOf("--top") + 1], 10) : 20;

const opClusters = new Map();     // op-key -> {count, ok, ex:[]}
const structKeyByOp = new Map();  // op-key -> Set(struct-keys folded into it)
const fnClusters = new Map();     // fn-key -> {count, stmts, ex:[]}
let files = 0, prodStmts = 0, fns = 0;

for (const abs of walk(CORPUS)) {
  const rel = path.relative(CORPUS, abs);
  if (isTestFile(rel)) continue;
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  SF = useSF(ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  files++;
  const visit = (node) => {
    if (ts.isBlock(node)) {
      for (const st of node.statements) {
        const op = canonStmt(st, "op");
        if (op) {
          prodStmts++;
          const opKey = keyOf(op);
          const ok = fillOf(op) === st.getText(SF);
          const c = opClusters.get(opKey) || { count: 0, ok: 0, ex: [] };
          c.count++; if (ok) c.ok++;
          if (c.ex.length < 2 && ok) c.ex.push(st.getText(SF).replace(/\s+/g, " ").trim().slice(0, 150));
          opClusters.set(opKey, c);
          const struct = canonStmt(st, "struct");
          if (struct) { const s = structKeyByOp.get(opKey) || new Set(); s.add(keyOf(struct)); structKeyByOp.set(opKey, s); }
        }
      }
    }
    // function-grain clustering (arrow / function / method with a block body)
    const body = (ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) ? node.body : null;
    if (body && ts.isBlock(body) && body.statements.length >= 2) {
      fns++;
      const k = fnKey(body);
      const c = fnClusters.get(k) || { count: 0, stmts: fnStmtCount(body), ex: [] };
      c.count++;
      if (c.ex.length < 3) { const nm = node.name ? node.name.getText(SF) : (node.parent && node.parent.name ? node.parent.name.getText(SF) : "(anon)"); if (!c.ex.includes(nm)) c.ex.push(nm); }
      fnClusters.set(k, c);
    }
    ts.forEachChild(node, visit);
  };
  visit(SF);
}

/* ================================ REPORT ================================ */
if (FAM) {
  const hits = [...opClusters.entries()].filter(([k]) => k.includes(FAM + "(")).sort((a, b) => b[1].count - a[1].count);
  const sum = hits.reduce((a, [, v]) => a + v.count, 0);
  const structFrag = new Set(); for (const [k] of hits) for (const s of (structKeyByOp.get(k) || [])) structFrag.add(s);
  console.log(`\nFAMILY "${FAM}" — anti-unified knob demo:`);
  console.log(`   op-level: ${hits.length} template(s) / ${sum} sites   (struct-level would split these into ${structFrag.size} near-literal shapes)`);
  for (const [k, v] of hits.slice(0, 8)) { console.log(`   [${v.count}x  ${v.ok}/${v.count} byte-exact]  ${k}`); if (v.ex[0]) console.log(`        e.g. ${v.ex[0]}`); }
  return;
}

const opRanked = [...opClusters.entries()].map(([k, v]) => ({ k, ...v, structFrag: (structKeyByOp.get(k) || new Set()).size })).sort((a, b) => b.count - a.count);
const opRecurring = opRanked.filter((r) => r.count >= 2);
const opRecStmts = opRecurring.reduce((a, r) => a + r.count, 0);
console.log(`STEP 3 — OPERATION PATTERNS via anti-unification over ${files} production files (read-only, 0 model calls)\n`);
console.log(`Production simple statements .......... ${prodStmts}`);
console.log(`Distinct OPERATION templates (op) .... ${opRanked.length}`);
console.log(`   recurring (>=2 sites) ............. ${opRecurring.length} templates covering ${opRecStmts} statements (${(100 * opRecStmts / (prodStmts || 1)).toFixed(1)}%)`);
let cum = 0; const marks = {};
for (let i = 0; i < opRanked.length; i++) { cum += opRanked[i].count; if ([10, 20, 30, 50].includes(i + 1)) marks[i + 1] = cum; }
console.log(`   cumulative coverage:` + [10, 20, 30, 50].map((k) => marks[k] != null ? ` top${k}=${(100 * marks[k] / (prodStmts || 1)).toFixed(0)}%` : "").join(""));
const okAll = opRanked.reduce((a, r) => a + r.ok, 0);
console.log(`   byte-exact refill (template+fills == source): ${okAll}/${prodStmts} (${(100 * okAll / (prodStmts || 1)).toFixed(1)}%)`);

console.log(`\nTOP ${topN} OPERATION TEMPLATES (count · byte-exact · struct-shapes-folded):`);
for (let i = 0; i < Math.min(topN, opRanked.length); i++) {
  const r = opRanked[i]; if (r.count < 2) break;
  console.log(`\n${String(i + 1).padStart(2)}. [${r.count}x · ${r.ok}/${r.count} exact · folds ${r.structFrag} struct-shapes]  ${r.k.length > 120 ? r.k.slice(0, 120) + "…" : r.k}`);
  for (const e of r.ex.slice(0, 1)) console.log(`      e.g. ${e}`);
}

// function-grain layer
const fnRanked = [...fnClusters.entries()].map(([k, v]) => ({ k, ...v })).sort((a, b) => b.count - a.count);
const fnRecurring = fnRanked.filter((r) => r.count >= 2);
const fnRecCount = fnRecurring.reduce((a, r) => a + r.count, 0);
let fcum = 0; const fmarks = {};
for (let i = 0; i < fnRanked.length; i++) { fcum += fnRanked[i].count; if ([10, 20, 50, 100].includes(i + 1)) fmarks[i + 1] = fcum; }
console.log(`\n${"=".repeat(78)}\nFUNCTION-GRAIN LAYER — whole functions by (control-flow skeleton + per-statement operation key)\n${"=".repeat(78)}`);
console.log(`Functions (>=2 body statements) ...... ${fns}`);
console.log(`Distinct function shapes ............. ${fnRanked.length}`);
console.log(`   recurring (>=2 functions) ........ ${fnRecurring.length} shapes covering ${fnRecCount} functions (${(100 * fnRecCount / (fns || 1)).toFixed(1)}%)`);
console.log(`   cumulative coverage:` + [10, 20, 50, 100].map((k) => fmarks[k] != null ? ` top${k}=${(100 * fmarks[k] / (fns || 1)).toFixed(0)}%` : "").join(""));
console.log(`\nTOP 15 FUNCTION SHAPES (count · body-stmts · example fn names):`);
for (let i = 0; i < Math.min(15, fnRanked.length); i++) {
  const r = fnRanked[i]; if (r.count < 2) break;
  console.log(`\n${String(i + 1).padStart(2)}. [${r.count}x · ~${r.stmts} stmts]  ${r.ex.join(", ")}`);
  console.log(`      ${r.k.length > 150 ? r.k.slice(0, 150) + "…" : r.k}`);
}
