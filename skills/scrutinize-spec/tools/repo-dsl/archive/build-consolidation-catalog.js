#!/usr/bin/env node
"use strict";
/**
 * build-consolidation-catalog.js — STEP 6 export. Freezes the STEP 5 LATENT cross-file
 * clusters (the same anti-unified op-templates measure-callgraph.js discovers) into a
 * read-only catalog the review panel can render as "these N files inline the SAME pattern
 * → extract ONE generator." A cluster is a block/function SHAPE that recurs across >=2
 * DISTINCT files with no shared function symbol; its template is byte-exact refillable, so
 * a generator built from it reproduces every site's original bytes.
 *
 * Deterministic; zero model calls for the MATH. The English `name` per pattern is the only
 * human touch (a fixed regex→label table below, correctness-irrelevant). Writes
 * catalog/consolidation-candidates.json under hydra-source (a data dir). Nothing else.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { useSF, canonStmt, keyOf, fnKey } = require("./engine/operations");

const CORPUS = "/home/amir/Documents/Rentsync/delonix/hydra-source";
const OUT = path.join(CORPUS, "catalog", "consolidation-candidates.json");
const SKIP = new Set(["node_modules", ".git", "demo", "coined-demo"]);
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; };
const isTestFile = (rel) => /\.(test|spec)\.ts$/.test(rel) || /(^|\/)(__tests__|tests?)(\/|$)/.test(rel);
const holeKindsOf = (key) => (key.match(/‹(\w+)›/g) || []).map((h) => h.slice(1, -1));
const allPure = (key) => holeKindsOf(key).every((h) => ["id", "str", "num"].includes(h));

/* English names — a fixed table (the only human touch; math never depends on it). First
 * matching rule wins; unmatched clusters get a shape-derived generic descriptor. */
const LABELERS = [
  [/^F:IF\{ throw new Error/, "guard-clause: throw-if-invalid then return"],
  [/getQueryBuilder\(‹args›\)‹chain›/, "typeorm query-builder usage"],
  [/getManager\(‹args›\);.*\.find(One)?\(‹args›\)/, "load entity via getManager().find"],
  [/typedApiFetch\(‹args›\).*\.json\(\)/, "api fetch then parse json"],
  [/apiFetch\(‹args›\).*\.json\(\).*dispatch/, "fetch → parse → dispatch"],
  [/intVal\(‹args›\); \| const ‹id› = intVal/, "parse a pair of int fields"],
  [/makeYmd\(‹args›\); \| const ‹id› = makeYmd/, "build a pair of yyyy-mm-dd dates"],
  [/getMonthStart\(‹args›\); \| const ‹id› = getMonthEnd/, "compute month start/end range"],
  [/‹id›\.error\(‹args›\); \| throw new Error/, "log error then throw"],
  [/^B\d+:dispatch\(‹args›\); \| dispatch/, "dispatch a sequence of actions"],
  [/costSummaries\.map/, "map/filter over cost summaries"],
  [/\.reduce\(‹args›\); return ‹id›/, "reduce a collection then return it"],
  [/this\.queryParams = ‹obj›; return this/, "builder setter (fluent this)"],
  [/^F:const ‹id› = ‹str›; return ‹id›/, "assign a literal then return it"],
];
function label(grain, key) {
  for (const [re, name] of LABELERS) if (re.test(key)) return name;
  const holes = holeKindsOf(key);
  return `${grain === "function" ? "function" : "block"} shape (${holes.length} hole${holes.length === 1 ? "" : "s"})`;
}

/* ------- cluster function-shapes + block-shapes across the corpus ------- */
const latent = new Map(); // key -> {grain, files:Set, occ, pure, example}
function add(key, grain, file, exampleText) {
  let c = latent.get(key);
  if (!c) { c = { key, grain, files: new Set(), occ: 0, pure: allPure(key), example: null }; latent.set(key, c); }
  c.files.add(file); c.occ++;
  if (!c.example && exampleText) c.example = exampleText.replace(/\s+/g, " ").trim().slice(0, 180);
}
let SF = null;
for (const abs of walk(CORPUS)) {
  const rel = path.relative(CORPUS, abs);
  if (isTestFile(rel)) continue;
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
  SF = useSF(ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  const visit = (node) => {
    if (ts.isBlock(node)) {
      const simple = [];
      for (const st of node.statements) { const p = canonStmt(st, "op"); if (p) simple.push({ key: keyOf(p), text: st.getText(SF) }); }
      for (const w of [2, 3]) for (let i = 0; i + w <= simple.length; i++) {
        const win = simple.slice(i, i + w);
        add("B" + w + ":" + win.map((s) => s.key).join(" | "), "block", rel, win.map((s) => s.text).join(" "));
      }
    }
    const body = (ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) ? node.body : null;
    if (body && ts.isBlock(body) && body.statements.length >= 2) add("F:" + fnKey(body), "function", rel, body.getText(SF));
    ts.forEachChild(node, visit);
  };
  visit(SF);
}

/* ------- select cross-file candidates, rank, label, export ------- */
const xfile = [...latent.values()].filter((c) => c.files.size >= 2 && c.occ >= 3);
xfile.sort((a, b) => (b.occ * b.files.size) - (a.occ * a.files.size));
const TOP = 200;
const candidates = xfile.slice(0, TOP).map((c, i) => ({
  id: `${c.grain === "function" ? "fn" : "blk"}-${String(i + 1).padStart(3, "0")}`,
  name: label(c.grain, c.key),
  grain: c.grain,
  occurrences: c.occ,
  filesSpanned: c.files.size,
  consolidationScore: c.occ * c.files.size,
  callSiteReadsPureEnglish: c.pure,       // would the extracted generator's call site be pure English?
  generatorTemplate: c.key.replace(/^F:|^B\d+:/, ""), // byte-exact anti-unified skeleton (typed holes)
  files: [...c.files].sort(),
  example: c.example,
}));

const out = {
  step: 6,
  kind: "latent-cross-file-consolidation-candidates",
  buildModelCalls: 0,
  foldModelCalls: 0,
  note: "Structural block/function shapes re-implemented in >=2 distinct files with no shared function symbol. " +
        "Each generatorTemplate is byte-exact refillable (template + a site's hole fills === that site's source). " +
        "Ranked by occurrences × files. English `name` is a fixed human label; the clustering math is deterministic.",
  totalCrossFileClusters: [...latent.values()].filter((c) => c.files.size >= 2).length,
  clustersWithOcc3Plus: xfile.length,
  functionGrain: candidates.filter((c) => c.grain === "function").length,
  blockGrain: candidates.filter((c) => c.grain === "block").length,
  emitted: candidates.length,
  candidates,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`wrote ${OUT}`);
console.log(`  total >=2-file clusters ${out.totalCrossFileClusters}   (>=3 occ: ${out.clustersWithOcc3Plus})   emitted top ${out.emitted}`);
console.log(`  function-grain ${out.functionGrain}   block-grain ${out.blockGrain}\n`);
console.log(`TOP 10 consolidation candidates:`);
for (const c of candidates.slice(0, 10)) console.log(`  [${String(c.occurrences).padStart(3)}× / ${String(c.filesSpanned).padStart(2)} files] ${c.name}${c.callSiteReadsPureEnglish ? " · pure" : ""}\n        ${c.generatorTemplate.slice(0, 100)}`);
