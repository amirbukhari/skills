#!/usr/bin/env node
"use strict";
/**
 * measure-callgraph.js — STEP 5 (MEASURE ONLY): does Amir's rule ("a function called
 * >=2x is a pattern → it gets a generator → its call site reads as pure English, recursing
 * into arguments that are themselves >=2x calls") actually get us to "no TypeScript visible"?
 *
 * This is a CALL-GRAPH analysis, not a statement-shape analysis.
 *   Pass 1 (all 1038 files): count every callee; collect names DEFINED in the corpus.
 *           A callee invoked >=2x is a PATTERN (a candidate generator).
 *   Pass 2 (production files): for each call site / statement, decide if it "BOTTOMS OUT
 *           IN ENGLISH": the callee is a pattern AND every argument is itself English-
 *           resolvable — a literal, an identifier / member path, or a call to another
 *           pattern whose args also resolve (RECURSIVE). Anything else — an inline object/
 *           array literal, an arrow callback, arithmetic, a ${}-template, a cast, or a call
 *           to a <2x function — is a NOVEL LEAF that leaves raw TypeScript at the call site.
 *
 * Reconstruction discipline: a pattern + its resolved (english) args rebuild the exact call
 * by construction (callee name + arg spans), so a "resolved" site is byte-exact recoverable.
 * Deterministic; zero model calls; nothing written.
 *   usage: node measure-callgraph.js [--top N]
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { useSF, canonStmt, keyOf, fnKey } = require("./engine/operations");
const DATA = require("./engine/data-english"); // STEP 6: object/array/template -> English (byte-exact)
const CR = require("./engine/corpus-root");
const holeKindsOf = (key) => (key.match(/‹(\w+)›/g) || []).map((h) => h.slice(1, -1));
const PURE_HOLE = new Set(["id", "str", "num"]); // an english param: noun / string value / number
const allPure = (key) => holeKindsOf(key).every((h) => PURE_HOLE.has(h));

const CORPUS = CR.sourceRoot();
const { SKIP } = require("./engine/walk-skip");   // the ONE canonical corpus walk-skip set
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
const isTestFile = (rel) => /\.(test|spec)\.ts$/.test(rel) || /(^|\/)(__tests__|tests?)(\/|$)/.test(rel);

// Builtin methods / globals — used ONLY to categorize patterns in the distribution report,
// never for the coverage math (which keys purely on call count).
const BUILTIN_METHODS = new Set([".map", ".filter", ".reduce", ".find", ".forEach", ".some", ".every", ".flatMap", ".sort", ".join", ".split", ".push", ".pop", ".shift", ".slice", ".splice", ".concat", ".includes", ".indexOf", ".keys", ".values", ".entries", ".toString", ".then", ".catch", ".finally", ".json", ".text", ".replace", ".match", ".trim", ".toLowerCase", ".toUpperCase", ".startsWith", ".endsWith", ".padStart", ".stringify", ".parse", ".hasOwnProperty", ".getTime", ".toISOString", ".add", ".has", ".get", ".set"]);
const BUILTIN_CTORS = new Set(["new Error", "new Date", "new Map", "new Set", "new Promise", "new Array"]);

const files = walk(CORPUS);
let SF = null;

function calleeKey(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return "." + e.name.text;
  return null;
}
function newKey(n) { return ts.isIdentifier(n.expression) ? "new " + n.expression.text : null; }

/* ---------------- pass 1: call counts + defined names ---------------- */
const callCount = new Map();
const defined = new Set();
const bump = (k) => { if (k) callCount.set(k, (callCount.get(k) || 0) + 1); };
for (const abs of files) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  SF = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) defined.add(n.name.text);
    if (ts.isMethodDeclaration(n) && n.name && ts.isIdentifier(n.name)) defined.add(n.name.text);
    if ((ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) && n.name && ts.isIdentifier(n.name)) defined.add(n.name.text);
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) defined.add(n.name.text);
    if (ts.isCallExpression(n)) bump(calleeKey(n));
    if (ts.isNewExpression(n)) bump(newKey(n));
    ts.forEachChild(n, visit);
  };
  visit(SF);
}
const isPattern = (k) => !!k && (callCount.get(k) || 0) >= 2;

/* ---------------- resolvability (recursive, bottoms out in English?) ---------------- */
function isRef(n) { // an identifier / this / member path — an English noun
  if (!n) return false;
  if (ts.isIdentifier(n) || n.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isPropertyAccessExpression(n)) return isRef(n.expression);
  if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) return isRef(n.expression);
  if (ts.isElementAccessExpression(n)) return isRef(n.expression) && (ts.isStringLiteral(n.argumentExpression) || ts.isNumericLiteral(n.argumentExpression) || ts.isIdentifier(n.argumentExpression));
  return false;
}
const DEPTH = { max: 0 };
function resolves(n, depth) {
  if (!n) return false;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n)) return true;
  if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return true;
  if (isRef(n)) return true;
  if (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n) || ts.isNonNullExpression(n)) return resolves(n.expression, depth);
  if (ts.isCallExpression(n)) {
    const k = calleeKey(n);
    if (!isPattern(k)) return false;
    const recvOK = ts.isPropertyAccessExpression(n.expression) ? (isRef(n.expression.expression) || resolves(n.expression.expression, depth + 1)) : true;
    if (!recvOK) return false;
    DEPTH.max = Math.max(DEPTH.max, depth);
    return n.arguments.every((a) => resolves(a, depth + 1));
  }
  if (ts.isNewExpression(n)) {
    if (!isPattern(newKey(n))) return false;
    DEPTH.max = Math.max(DEPTH.max, depth);
    return (n.arguments || []).every((a) => resolves(a, depth + 1));
  }
  // STEP 6 — DATA-AS-ENGLISH: an object / array / ${}-template leaf bottoms out in English
  // iff (1) it renders byte-exact (canonical spacing — engine/data-english) AND (2) every
  // atomic value recursively resolves (literal / noun-path / pattern-call). Any raw value
  // (arithmetic, arrow, one-off call) leaves a `backtick` escape → NOT pure English.
  // DATA_ON toggles this layer so the per-category lift over the 38.1% baseline is measurable.
  if (DATA_ON) {
    if (ts.isObjectLiteralExpression(n)) {
      if (!DATA.dataByteExact(n, SF)) return false;
      return n.properties.every((p) =>
        ts.isShorthandPropertyAssignment(p) ? !p.objectAssignmentInitializer :
        ts.isPropertyAssignment(p) ? resolves(p.initializer, depth + 1) :
        ts.isSpreadAssignment(p) ? resolves(p.expression, depth + 1) : false);
    }
    if (ts.isArrayLiteralExpression(n)) {
      if (!DATA.dataByteExact(n, SF)) return false;
      return n.elements.every((e) => ts.isOmittedExpression(e) ? false : resolves(ts.isSpreadElement(e) ? e.expression : e, depth + 1));
    }
    if (ts.isTemplateExpression(n)) {
      if (!DATA.dataByteExact(n, SF)) return false;
      return n.templateSpans.every((s) => resolves(s.expression, depth + 1));
    }
  }
  return false; // arrow, binary, ternary, as-cast, <2x call, or non-canonical data leaf
}
let DATA_ON = true; // STEP 6 layer on/off (for baseline-vs-lift measurement)

/* classify the dominant NOVEL leaf blocking a statement (priority order) */
function blocker(n) {
  let found = null;
  const rank = { objlit: 1, arrlit: 1, arrow: 2, template: 3, binary: 4, ternary: 4, cast: 5, coldcall: 6, other: 7 };
  const set = (t) => { if (!found || rank[t] < rank[found]) found = t; };
  const visit = (x) => {
    if (!x) return;
    if (resolves(x, 0)) return; // this subtree is fine; don't descend
    if (ts.isObjectLiteralExpression(x)) return set("objlit");
    if (ts.isArrayLiteralExpression(x)) return set("arrlit");
    if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) return set("arrow");
    if (ts.isTemplateExpression(x)) return set("template");
    if (ts.isBinaryExpression(x)) { set("binary"); }
    if (ts.isConditionalExpression(x)) { set("ternary"); }
    if (ts.isAsExpression(x)) { set("cast"); }
    if (ts.isCallExpression(x) && !isPattern(calleeKey(x))) set("coldcall");
    ts.forEachChild(x, visit);
  };
  visit(n);
  return found || "other";
}

function stmtExpr(st) {
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) return { kind: "var", e: st.declarationList.declarations[0].initializer || "NONE" };
  if (ts.isExpressionStatement(st)) return { kind: "expr", e: st.expression };
  if (ts.isReturnStatement(st)) return { kind: "return", e: st.expression || "VOID" };
  if (ts.isThrowStatement(st)) return { kind: "throw", e: st.expression };
  return null;
}

/* ---------------- pass 2: statement + call-site coverage over production ----------------
 * Alongside the EXPLICIT call-graph coverage, we cluster statement structure ACROSS files to
 * find LATENT reuse (Amir's point B): the same block / function SHAPE re-implemented in >=2
 * DISTINCT files with no shared callee symbol — a consolidation opportunity that a pure call-
 * graph misses. Keys are anti-unified op-templates (engine/operations.js), so a cluster's
 * members are byte-exact refillable by construction; a cluster is "pure" when every hole is an
 * english param (id/str/num) — meaning, once extracted to a generator, its call site is pure
 * English. (Conservative: op-level abstracts EVERY object/array/arrow to a hole even when it is
 * constant across the cluster and would really be baked into the generator body — so pure-latent
 * is a LOWER bound.) */
let prodStmts = 0, english = 0, englishBase = 0, callSites = 0, callResolved = 0;
const resid = {}; const bumpR = (t) => resid[t] = (resid[t] || 0) + 1;
const lift = {}; const bumpL = (t) => lift[t] = (lift[t] || 0) + 1; // residual→english, by category the data layer unblocked
const depthHist = {};
const englishIds = new Set();       // pure-English WITH the STEP 6 data layer
const englishBaseIds = new Set();   // pure-English from the explicit call-graph alone (STEP 5)
const allIds = new Set();       // every production simple statement (residual denominator)
const latent = new Map();       // structural cluster key -> {files:Set, occ, ids:Set, grain, pure}
function addCluster(key, file, ids, grain) {
  let c = latent.get(key);
  if (!c) { c = { files: new Set(), occ: 0, ids: new Set(), grain, pure: allPure(key) }; latent.set(key, c); }
  c.files.add(file); c.occ++; for (const id of ids) c.ids.add(id);
}
for (const abs of files) {
  const rel = path.relative(CORPUS, abs);
  if (isTestFile(rel)) continue;
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  SF = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  useSF(SF);
  const idOf = (st) => rel + "#" + st.getStart(SF);
  const collectSimpleIds = (node, ids) => {
    const one = (st) => {
      if (stmtExpr(st)) ids.push(idOf(st));
      if (ts.isIfStatement(st)) { blk(st.thenStatement); if (st.elseStatement) blk(st.elseStatement); }
      else if (ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)) blk(st.statement);
      else if (ts.isTryStatement(st)) { blk(st.tryBlock); if (st.catchClause) blk(st.catchClause.block); if (st.finallyBlock) blk(st.finallyBlock); }
      else if (ts.isSwitchStatement(st)) for (const cl of st.caseBlock.clauses) for (const s of cl.statements) one(s);
    };
    const blk = (n) => { if (ts.isBlock(n)) n.statements.forEach(one); else one(n); };
    blk(node);
  };
  const visit = (node) => {
    if (ts.isBlock(node)) {
      const simple = []; // consecutive simple statements, for block-grain windows
      for (const st of node.statements) {
        const se = stmtExpr(st);
        if (!se) continue;
        prodStmts++;
        const id = idOf(st); allIds.add(id);
        const trivial = se.e === "VOID" || se.e === "NONE";
        DATA_ON = false; DEPTH.max = 0; const okBase = trivial || resolves(se.e, 1); // explicit call-graph only (38.1% baseline)
        DATA_ON = true;  DEPTH.max = 0; const ok = trivial || resolves(se.e, 1);     // + data-as-english layer
        if (okBase) { englishBase++; englishBaseIds.add(id); }
        if (ok) {
          english++; englishIds.add(id); const d = trivial ? 0 : DEPTH.max; depthHist[d] = (depthHist[d] || 0) + 1;
          if (!okBase) { DATA_ON = false; bumpL(blocker(se.e)); DATA_ON = true; } // attribute the lift to what WAS blocking
        } else bumpR(blocker(se.e));
        const parts = canonStmt(st, "op");
        simple.push({ id, opKey: parts ? keyOf(parts) : ("«" + ts.SyntaxKind[st.kind] + "»") });
      }
      for (const w of [2, 3]) for (let i = 0; i + w <= simple.length; i++) {
        const win = simple.slice(i, i + w);
        addCluster("B" + w + ":" + win.map((s) => s.opKey).join(" | "), rel, win.map((s) => s.id), "block");
      }
    }
    const body = (ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) ? node.body : null;
    if (body && ts.isBlock(body)) {
      const ids = []; collectSimpleIds(body, ids);
      if (ids.length >= 2) addCluster("F:" + fnKey(body), rel, ids, "function");
    }
    if (ts.isCallExpression(node)) { callSites++; DEPTH.max = 0; if (resolves(node, 1)) callResolved++; }
    ts.forEachChild(node, visit);
  };
  visit(SF);
}

/* ---------------- report ---------------- */
const topN = process.argv.includes("--top") ? parseInt(process.argv[process.argv.indexOf("--top") + 1], 10) : 25;
const patterns = [...callCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
const patternSites = patterns.reduce((a, [, c]) => a + c, 0);
const totalCalls = [...callCount.values()].reduce((a, c) => a + c, 0);
let corpusDef = 0, builtin = 0, external = 0;
for (const [k] of patterns) {
  if (k.startsWith("new ")) { BUILTIN_CTORS.has(k) ? builtin++ : (defined.has(k.slice(4)) ? corpusDef++ : external++); }
  else if (k.startsWith(".")) { BUILTIN_METHODS.has(k) ? builtin++ : (defined.has(k.slice(1)) ? corpusDef++ : external++); }
  else defined.has(k) ? corpusDef++ : external++;
}

console.log(`STEP 5 — CALL-GRAPH / "bottoms out in English" over ${files.length} files (read-only, 0 model calls)\n`);
console.log(`CALL GRAPH`);
console.log(`  distinct callees ............... ${callCount.size}   (total call sites ${totalCalls})`);
console.log(`  PATTERNS (callee invoked >=2x) . ${patterns.length}   accounting for ${patternSites} call sites (${(100 * patternSites / totalCalls).toFixed(1)}% of all calls)`);
console.log(`     corpus-defined ${corpusDef}   known-builtin ${builtin}   external/unresolved ${external}`);
console.log(`\nTOP ${topN} PATTERNS by call count:`);
for (const [k, c] of patterns.slice(0, topN)) { const cat = k.startsWith("new ") ? (BUILTIN_CTORS.has(k) ? "builtin" : defined.has(k.slice(4)) ? "corpus" : "external") : k.startsWith(".") ? (BUILTIN_METHODS.has(k) ? "builtin" : defined.has(k.slice(1)) ? "corpus" : "external") : (defined.has(k) ? "corpus" : "external"); console.log(`   ${String(c).padStart(5)}  ${k.padEnd(28)} [${cat}]`); }

console.log(`\nCOVERAGE — "does the call site bottom out in English?"`);
console.log(`  production simple statements ... ${prodStmts}`);
console.log(`  explicit call-graph only ....... ${englishBase}  (${(100 * englishBase / prodStmts).toFixed(1)}%)   [STEP 5]`);
console.log(`  + DATA-AS-ENGLISH layer ........ ${english}  (${(100 * english / prodStmts).toFixed(1)}%)   [STEP 6]  +${english - englishBase} stmts`);
console.log(`     lift by category the data layer unblocked (byte-exact + all atoms resolve):`);
const LIFTLBL = { objlit: "object literal → \"an object with …\"", arrlit: "array literal → \"a list of …\"", template: "${}-template → \"text: “…”\"", other: "other" };
for (const [t, n] of Object.entries(lift).sort((a, b) => b[1] - a[1])) console.log(`        +${String(n).padStart(4)}  ${LIFTLBL[t] || t}`);
console.log(`  all call sites .................. ${callSites}   fully resolve: ${callResolved} (${(100 * callResolved / callSites).toFixed(1)}%)`);
console.log(`  nesting depth of resolved statements:`);
for (const d of Object.keys(depthHist).map(Number).sort((a, b) => a - b)) console.log(`     depth ${d}: ${depthHist[d]}`);

const blocked = prodStmts - english;
console.log(`\nRESIDUAL — the ${blocked} statements that DON'T bottom out, by dominant novel leaf:`);
const LBL = { objlit: "inline object literal", arrlit: "inline array literal", arrow: "inline arrow/callback", template: "${}-string interpolation", binary: "arithmetic / binary expr", ternary: "ternary", cast: "as-Type cast", coldcall: "call to a <2x (one-off) fn", other: "other novel leaf" };
for (const [t, n] of Object.entries(resid).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${(100 * n / prodStmts).toFixed(1)}%  ${LBL[t] || t}`);

/* ================= LATENT cross-file patterns (point B) + COMBINED coverage ================= */
const xfile = [...latent.entries()]
  .map(([k, c]) => ({ ...c, key: k, filesN: c.files.size, score: c.occ * c.files.size }))
  .filter((c) => c.filesN >= 2)
  .sort((a, b) => b.score - a.score);
const crossFileIds = new Set(); for (const c of xfile) for (const id of c.ids) crossFileIds.add(id);
const pureLatentIds = new Set(); for (const c of xfile) if (c.pure) for (const id of c.ids) pureLatentIds.add(id);
const union = (a, b) => { const s = new Set(a); for (const x of b) s.add(x); return s; };
const consolidatable = union(englishIds, crossFileIds);
const step5combined = union(englishBaseIds, pureLatentIds); // explicit + latent, NO data layer (38.1% baseline)
const combinedPure = union(englishIds, pureLatentIds);       // + STEP 6 data layer
const fnX = xfile.filter((c) => c.grain === "function");
const blkX = xfile.filter((c) => c.grain === "block");
const pct = (n) => (100 * n / prodStmts).toFixed(1);

console.log(`\n${"=".repeat(78)}\nLATENT CROSS-FILE REUSE (point B) — same SHAPE re-implemented in >=2 distinct files,\nno shared function symbol; anti-unified op-templates, byte-exact refillable\n${"=".repeat(78)}`);
console.log(`  cross-file clusters (>=2 files) ...... ${xfile.length}   (function-grain ${fnX.length}, block-grain ${blkX.length})`);
console.log(`  of these, "pure" (holes all id/str/num → call site would be pure English) ... ${xfile.filter((c) => c.pure).length}`);
console.log(`  statements touched by some cross-file cluster ... ${crossFileIds.size} (${pct(crossFileIds.size)}% of prod stmts)`);

const short = (k) => { const s = k.replace(/^F:|^B\d+:/, ""); return s.length > 104 ? s.slice(0, 104) + "…" : s; };
console.log(`\nTOP 12 LATENT FUNCTION-SHAPE consolidation candidates (occ × files):`);
for (const c of fnX.slice(0, 12)) console.log(`  ${String(c.occ).padStart(4)} defs / ${String(c.filesN).padStart(3)} files ${c.pure ? "· pure" : "      "}  ${short(c.key)}`);
console.log(`\nTOP 12 LATENT BLOCK-SHAPE consolidation candidates (occ × files):`);
for (const c of blkX.slice(0, 12)) console.log(`  ${String(c.occ).padStart(4)} occ  / ${String(c.filesN).padStart(3)} files ${c.pure ? "· pure" : "      "}  ${short(c.key)}`);

console.log(`\n${"=".repeat(78)}\nCOMBINED COVERAGE — explicit call-graph patterns + latent cross-file patterns as generators\n${"=".repeat(78)}`);
console.log(`  production simple statements .......................... ${prodStmts}`);
console.log(`  (a) STEP 4 named-operation ........................... 33.6%`);
console.log(`  (b) STEP 5 explicit call-graph ....................... ${englishBase} (${pct(englishBase)}%)`);
console.log(`  (c) STEP 5 explicit ∪ pure-latent (prior baseline) ... ${step5combined.size} (${pct(step5combined.size)}%)`);
console.log(`  (d) STEP 6 explicit + data-as-english ................ ${english} (${pct(english)}%)   [+${pct(english - englishBase)} pts data]`);
console.log(`  (e) STEP 6 COMBINED (data ∪ pure-latent) — NEW ....... ${combinedPure.size} (${pct(combinedPure.size)}%)   [+${(+pct(combinedPure.size) - +pct(step5combined.size)).toFixed(1)} pts over the 38.1% baseline]`);
console.log(`  (f) CONSOLIDATABLE (english ∪ ANY cross-file shape) .. ${consolidatable.size} (${pct(consolidatable.size)}%)   ← dedup / generator-extraction reach`);
console.log(`\n  HONEST RESIDUAL — genuinely unique (not english, not in any cross-file pattern):`);
console.log(`     ${prodStmts - consolidatable.size} statements (${pct(prodStmts - consolidatable.size)}%) occur once, in one file — no generator can absorb them.`);
