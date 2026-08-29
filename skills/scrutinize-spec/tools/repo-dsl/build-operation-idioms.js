#!/usr/bin/env node
"use strict";
/**
 * build-operation-idioms.js — STEP 4: freeze the anti-unified operation templates and
 * whole-function shapes as NAMED idioms/archetypes, gated by byte-exact refill, and
 * export two read-only catalogs the panel can consume (like grammar.json).
 *
 * DISCOVERY + VERIFICATION are deterministic (engine/operations.js). The only model
 * touch is the human LABEL for a family (correctness-irrelevant); labels are assigned
 * here by frozen deterministic labelers so the build itself needs ZERO model calls.
 *
 * GATE: a named idiom CLAIMS only the sites that reconstruct byte-exact from
 * (template + that site's hole fills). Sites that miss (e.g. multi-line calls whose
 * inter-paren whitespace differs from the canonical skeleton) are BAILED, not counted —
 * the idiom is scoped to its round-tripping subset. Each idiom reports its byte-exact
 * rate (claimed / seen) transparently.
 *
 *   writes: <corpus>/catalog/operation-idioms.json , <corpus>/catalog/function-archetypes.json
 *   usage: node build-operation-idioms.js
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { useSF, canonStmt, keyOf, fillOf, holeTypes, fnKey, fnStmtCount } = require("./engine/operations");

const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const SKIP = new Set(["node_modules", ".git", "demo", "coined-demo"]);
function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
const isTestFile = (rel) => /\.(test|spec)\.ts$/.test(rel) || /(^|\/)(__tests__|tests?)(\/|$)/.test(rel);

/* ---- LABELERS (the only "model" touch: human names; correctness-irrelevant) ----
 * Ordered; first match wins. A statement template becomes a NAMED operation idiom iff
 * it matches a labeler AND clears MIN_SITES byte-exact sites. */
const OP_LABELERS = [
  [/^throw new Error\(‹args›\);$/, "throw an error"],
  [/^throw ‹id›;$/, "rethrow a value"],
  [/dispatch\(‹args›\);$/, "dispatch an action"],
  [/^const ‹id› = await getQueryBuilder\(‹args›\)‹chain›;$/, "await a filtered query (count/fetch)"],
  [/^const ‹id› = getQueryBuilder\(‹args›\)‹chain›;$/, "build & run a filtered query"],
  [/^const ‹id› = getQueryBuilder\(‹args›\);$/, "start a query builder"],
  [/^return getQueryBuilder\(‹args›\)‹chain›;$/, "return a filtered query"],
  [/getManager\(‹args›\)‹chain›;$/, "run a repository operation"],
  [/^const ‹id› = getManager\(‹args›\);$/, "get the entity manager"],
  [/^‹id›\.info\(‹args›\);$/, "log info"],
  [/^‹id›\.error\(‹args›\);$/, "log an error"],
  [/^‹id›\.warn\(‹args›\);$/, "log a warning"],
  [/^const ‹id› = await apiFetch\(‹args›\);$/, "fetch from the API"],
  [/^const ‹id› = await ‹id›\.json\(\) as ‹type›;$/, "parse a JSON response"],
  [/^const ‹id› = intVal\(‹args›\);$/, "parse an integer"],
  [/^const ‹id› = floatVal\(‹args›\);$/, "parse a float"],
  [/^const ‹id› = ‹id›\.map\(‹args›\);$/, "map a collection"],
  [/^const ‹id› = ‹id›\.filter\(‹args›\);$/, "filter a collection"],
  [/^const ‹id› = ‹id›\.reduce\(‹args›\);$/, "reduce a collection"],
  [/^const ‹id› = distinct\(‹args›\);$/, "de-duplicate a collection"],
  [/^‹id›\.body = ‹obj›;$/, "set the response body"],
  [/^‹id›\.body = ‹obj› as ‹type›;$/, "set the typed response body"],
  [/^return ‹obj› as ‹type›;$/, "return a typed object"],
  [/^return ‹obj›;$/, "return an object"],
  [/^return ‹arr›;$/, "return an array"],
  [/^return ‹id›;$/, "return a value"],
  [/^return;$/, "return (void)"],
  [/^const ‹id› = ‹str›;$/, "bind a string/template"],
  [/^const ‹id› = ‹obj›;$/, "build an object"],
  [/^const ‹id› = ‹obj› as ‹type›;$/, "build a typed object"],
];
const FN_LABELERS = [
  [/^IF\{ throw new Error\(‹args›\); \} return ‹id›;$/, "guard-and-return"],
  [/apiFetch\(‹args›\);.*\.json\(\) as ‹type›;.*dispatch\(‹args›\);/, "fetch, parse, dispatch"],
  [/getQueryBuilder\(‹args›\)‹chain›;.*return/, "build query and return"],
  [/getManager\(\)‹chain›; return ‹id›;$/, "fetch via repository and return"],
  [/‹id›\.reduce\(‹args›\); return ‹id›;$/, "reduce and return"],
  [/^const ‹id› = ‹id›\.[a-zA-Z.]*map\(‹args›\).*; return /, "map and return"],
];
const label = (labelers, key) => { for (const [re, name] of labelers) if (re.test(key)) return name; return null; };

const MIN_OP_SITES = 20;   // an operation idiom must recur at least this many times (byte-exact)
const MIN_FN_SITES = 3;    // a function archetype must recur at least this many times

/* ------------------------------ scan ------------------------------ */
const opMap = new Map();  // template -> { count, ok, holeTypes, example }
const fnMap = new Map();  // fnKey -> { count, stmts, examples:Set }
let files = 0, prodStmts = 0, fns = 0;

for (const abs of walk(CORPUS)) {
  const rel = path.relative(CORPUS, abs);
  if (isTestFile(rel)) continue;
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  const SF = useSF(ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  files++;
  const visit = (node) => {
    if (ts.isBlock(node)) {
      for (const st of node.statements) {
        const parts = canonStmt(st, "op");
        if (parts) {
          prodStmts++;
          const key = keyOf(parts), text = st.getText(SF), ok = fillOf(parts) === text;
          const e = opMap.get(key) || { count: 0, ok: 0, holeTypes: holeTypes(parts), example: null };
          e.count++; if (ok) { e.ok++; if (!e.example && !/\n/.test(text) && text.length <= 140) e.example = text; }
          opMap.set(key, e);
        }
      }
    }
    const body = (ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) ? node.body : null;
    if (body && ts.isBlock(body) && body.statements.length >= 2) {
      fns++;
      const k = fnKey(body);
      const e = fnMap.get(k) || { count: 0, stmts: fnStmtCount(body), examples: new Set() };
      e.count++;
      const nm = node.name ? node.name.getText(SF) : (node.parent && node.parent.name ? node.parent.name.getText(SF) : "(anon)");
      if (e.examples.size < 4) e.examples.add(nm);
      fnMap.set(k, e);
    }
    ts.forEachChild(node, visit);
  };
  visit(SF);
}

/* ------------------------------ freeze named idioms ------------------------------ */
const idioms = [];
for (const [template, v] of opMap) {
  const name = label(OP_LABELERS, template);
  if (!name || v.ok < MIN_OP_SITES) continue;
  const rate = +(100 * v.ok / v.count).toFixed(1);
  idioms.push({
    id: "op_" + String(idioms.length + 1).padStart(3, "0"),
    name, template, holes: v.holeTypes,
    sitesSeen: v.count, sitesClaimed: v.ok,
    claimedByteExact: 100,            // claimed sites reconstruct byte-exact BY CONSTRUCTION
    seenRefillPct: rate,              // fraction of all seen instances that round-trip (rest bail)
    scopedToSingleLine: rate < 99.5,  // true => multi-line instances bail to novel, not claimed
    example: v.example || null,
  });
}
idioms.sort((a, b) => b.sitesClaimed - a.sitesClaimed).forEach((it, i) => { it.id = "op_" + String(i + 1).padStart(3, "0"); });

const archetypes = [];
for (const [key, v] of fnMap) {
  const name = label(FN_LABELERS, key);
  if (!name || v.count < MIN_FN_SITES) continue;
  archetypes.push({
    id: "fn_" + String(archetypes.length + 1).padStart(3, "0"),
    name, skeleton: key, controlFlow: (key.match(/\b(IF|ELSE|LOOP|TRY|CATCH|SWITCH)\b/g) || []).length ? "branching" : "straight-line",
    operationSequence: key.split(/ (?=IF\{|ELSE\{|LOOP\{|TRY\{|CATCH\{|\})|(?<=\}) /).map((s) => s.trim()).filter(Boolean),
    functions: v.count, bodyStatements: v.stmts, examples: [...v.examples],
  });
}
archetypes.sort((a, b) => b.functions - a.functions).forEach((a, i) => { a.id = "fn_" + String(i + 1).padStart(3, "0"); });

/* ------------------------------ measures ------------------------------ */
const namedOpStmts = idioms.reduce((a, it) => a + it.sitesClaimed, 0);
const namedFnCount = archetypes.reduce((a, x) => a + x.functions, 0);
const recurringStmts = [...opMap.values()].filter((v) => v.count >= 2).reduce((a, v) => a + v.count, 0);

const opCatalog = {
  schema: "sdd-operation-idioms/1", project: CORPUS, generatedBy: "build-operation-idioms.js (deterministic anti-unification)",
  foldModelCalls: 0, buildModelCalls: 0, labelSource: "frozen deterministic labelers (human-authored names; correctness-irrelevant)",
  method: "least-general generalization at the 'op' level; each idiom claims only byte-exact refill sites (template + hole fills === source); non-round-tripping sites are bailed.",
  productionSimpleStatements: prodStmts,
  namedOperationStatements: namedOpStmts,
  namedOperationPct: +(100 * namedOpStmts / (prodStmts || 1)).toFixed(1),
  recurringTemplatePct: +(100 * recurringStmts / (prodStmts || 1)).toFixed(1),
  idiomCount: idioms.length, idioms,
};
const fnCatalog = {
  schema: "sdd-function-archetypes/1", project: CORPUS, generatedBy: "build-operation-idioms.js (deterministic)",
  foldModelCalls: 0, buildModelCalls: 0, labelSource: "frozen deterministic labelers",
  method: "whole functions keyed by control-flow skeleton + per-statement operation key; a named archetype recurs >= " + MIN_FN_SITES + " functions.",
  functionsScanned: fns,
  namedArchetypeFunctions: namedFnCount,
  namedArchetypePct: +(100 * namedFnCount / (fns || 1)).toFixed(1),
  archetypeCount: archetypes.length, archetypes,
};
fs.writeFileSync(path.join(CORPUS, "catalog", "operation-idioms.json"), JSON.stringify(opCatalog, null, 2));
fs.writeFileSync(path.join(CORPUS, "catalog", "function-archetypes.json"), JSON.stringify(fnCatalog, null, 2));

/* ------------------------------ report ------------------------------ */
console.log(`STEP 4 — NAMED OPERATION IDIOMS (${idioms.length}) over ${files} production files, 0 model calls\n`);
for (const it of idioms) console.log(`  ${it.id}  [${it.sitesClaimed} sites · ${it.byteExactRate}% exact]  "${it.name}"  ${it.template.length > 66 ? it.template.slice(0, 66) + "…" : it.template}`);
console.log(`\nNAMED FUNCTION ARCHETYPES (${archetypes.length}):`);
for (const a of archetypes) console.log(`  ${a.id}  [${a.functions} fns · ~${a.bodyStatements} stmts]  "${a.name}"  e.g. ${a.examples.slice(0, 3).join(", ")}`);
console.log(`\n=== NEW MEASURES ===`);
console.log(`  production lines that are a NAMED operation : ${namedOpStmts}/${prodStmts} = ${opCatalog.namedOperationPct}%   (vs ${opCatalog.recurringTemplatePct}% merely in a recurring template)`);
console.log(`  functions that are a NAMED archetype        : ${namedFnCount}/${fns} = ${fnCatalog.namedArchetypePct}%`);
console.log(`\n  wrote ${path.join(CORPUS, "catalog", "operation-idioms.json")}`);
console.log(`  wrote ${path.join(CORPUS, "catalog", "function-archetypes.json")}`);
