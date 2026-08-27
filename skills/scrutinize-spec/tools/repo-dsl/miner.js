#!/usr/bin/env node
"use strict";
/**
 * miner — the AST/structural miner for the SDD CODE stage.
 *
 * Reads a corpus of .ts files (read-only) and mines recurring structural
 * patterns at BOTH granularities the concept requires:
 *
 *   SMALL      individual statements + import declarations + notable
 *              sub-expressions (call / arrow / member shapes). The smallest
 *              recurring structural bricks. -> OPAQUE ids (p_xxxxxxxx).
 *   COMPOSITE  whole exported declarations (a calculator function/const) and
 *              whole-file shapes. The large feature shapes. -> also carry an
 *              opaque skeleton id, but the generator library gives THESE the
 *              readable names (makeX / wireY); readable names expand into trees
 *              of the small ids.
 *
 * A pattern is "recurring" iff it appears in >= MIN_COUNT places across the
 * corpus. For each we record: id, granularity, count, the concrete files, the
 * typed slot kinds (proving the params are small/typed, never prose), and a
 * flag `typedLeafClean` = every occurrence's slots are small+typed.
 *
 * Output: catalog/patterns.json  (committed; the shared vocabulary the
 * generator library and the coverage report both read).
 *
 * Usage: node miner.js <corpusDir> [--min-count N] [--out catalog/patterns.json]
 */

const fs = require("fs");
const path = require("path");
const { ts, parse, skeletonize, idFor, slotsAreTyped } = require("./lib/skeleton");

function parseArgs(argv) {
  const a = { corpus: null, minCount: 2, out: path.join(__dirname, "catalog", "patterns.json") };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--min-count") a.minCount = parseInt(rest[++i], 10);
    else if (t === "--out") a.out = path.resolve(process.cwd(), rest[++i]);
    else if (!a.corpus) a.corpus = path.resolve(process.cwd(), t);
    else throw new Error(`unexpected arg: ${t}`);
  }
  if (!a.corpus) throw new Error("usage: miner.js <corpusDir> [--min-count N] [--out file]");
  return a;
}

function listTsFiles(dir) {
  const out = [];
  (function rec(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
    }
  })(dir);
  return out.sort();
}

// SMALL granularity: which node kinds count as small recurring bricks.
const SMALL_KINDS = new Set([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.PropertyAccessExpression,
]);

// COMPOSITE granularity: whole exported/top-level declarations.
function isComposite(node) {
  if (ts.isFunctionDeclaration(node)) return true;
  if (ts.isVariableStatement(node)) {
    // const X = (..) => .. or const X = <arr>  at top level
    return node.parent && ts.isSourceFile(node.parent);
  }
  return false;
}

function record(map, gran, node, file) {
  const { skeleton, slots, nodeCount } = skeletonize(node);
  const id = idFor(skeleton);
  let e = map.get(id);
  if (!e) {
    e = { id, granularity: gran, skeleton, nodeCount, count: 0, files: new Set(), slotKinds: null, typedLeafClean: true, sample: null };
    map.set(id, e);
  }
  e.count++;
  e.files.add(file);
  const kinds = slots.map((s) => s.kind);
  if (!e.slotKinds) e.slotKinds = kinds;
  if (!slotsAreTyped(slots)) e.typedLeafClean = false;
  if (!e.sample) e.sample = { file, slotValues: slots.map((s) => s.text) };
  return id;
}

function main() {
  const cfg = parseArgs(process.argv);
  const files = listTsFiles(cfg.corpus);
  const small = new Map();
  const composite = new Map();

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const sf = parse(file, src);
    const rel = path.relative(cfg.corpus, file);

    // composite: top-level declarations
    sf.statements.forEach((st) => { if (isComposite(st)) record(composite, "composite", st, rel); });

    // small: walk the whole tree, record nodes of SMALL_KINDS
    (function walk(n) {
      if (SMALL_KINDS.has(n.kind)) record(small, "small", n, rel);
      ts.forEachChild(n, walk);
    })(sf);
  }

  const finalize = (map) =>
    [...map.values()]
      .filter((e) => e.count >= cfg.minCount)
      .map((e) => ({
        id: e.id,
        granularity: e.granularity,
        count: e.count,
        nodeCount: e.nodeCount,
        fileCount: e.files.size,
        files: [...e.files].sort(),
        slotKinds: e.slotKinds,
        typedLeafClean: e.typedLeafClean,
        sampleSlotValues: e.sample.slotValues,
        skeleton: e.skeleton,
      }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  const smallPatterns = finalize(small);
  const compositePatterns = finalize(composite);

  const catalog = {
    schema: "sdd-repo-dsl/patterns/1",
    corpus: path.relative(path.resolve(__dirname, "..", ".."), cfg.corpus),
    minCount: cfg.minCount,
    fileCount: files.length,
    counts: {
      smallRecurring: smallPatterns.length,
      compositeRecurring: compositePatterns.length,
      leafTypedClean: smallPatterns.filter((p) => p.typedLeafClean).length,
    },
    smallPatterns,
    compositePatterns,
  };

  fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
  fs.writeFileSync(cfg.out, JSON.stringify(catalog, null, 2) + "\n");

  console.log(`miner: ${files.length} files -> ${smallPatterns.length} small + ${compositePatterns.length} composite recurring patterns (min-count ${cfg.minCount})`);
  console.log(`miner: ${catalog.counts.leafTypedClean}/${smallPatterns.length} small patterns are typed-leaf-clean (no prose slot)`);
  console.log(`miner: wrote ${path.relative(process.cwd(), cfg.out)}`);
}

main();
