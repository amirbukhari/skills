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
const AC = require("./engine/artifact-contract");
const path = require("path");
const { ts, parse, skeletonize, idFor, slotsAreTyped } = require("./lib/skeleton");

function parseArgs(argv) {
  const a = { corpus: null, minCount: 2, out: path.join(AC.corpusRoot(), "spec", "catalog", "patterns.json") };
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

// MID granularity: interior sub-trees between a single statement and a whole
// declaration — recursed OUT OF the composites, not the top level. These are the
// mid-tier bricks a hierarchical library needs (block bodies, closures, reshapes).
const MID_KINDS = new Set([
  ts.SyntaxKind.Block,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
]);
const MID_MIN_NODES = 10; // bigger than a leaf brick
const MID_MAX_NODES = 200; // smaller than a whole big calculator

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
  const mid = new Map();
  const composite = new Map();

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const sf = parse(file, src);
    const rel = path.relative(cfg.corpus, file);

    // composite: top-level declarations. Then RECURSE their interiors for mid
    // patterns (depth > 0 within a top-level decl) — this is the recursive
    // re-mining that makes a genuine small -> mid -> large hierarchy possible.
    sf.statements.forEach((st) => {
      if (isComposite(st)) record(composite, "composite", st, rel);
      (function walk(n, depth) {
        if (depth > 0 && MID_KINDS.has(n.kind)) {
          const nc = skeletonize(n).nodeCount;
          if (nc >= MID_MIN_NODES && nc <= MID_MAX_NODES) record(mid, "mid", n, rel);
        }
        ts.forEachChild(n, (c) => walk(c, depth + 1));
      })(st, 0);
    });

    // small: walk the whole tree, record nodes of SMALL_KINDS
    (function walk(n) {
      if (SMALL_KINDS.has(n.kind)) record(small, "small", n, rel);
      ts.forEachChild(n, walk);
    })(sf);
  }

  const finalize = (map, opts = {}) =>
    [...map.values()]
      .filter((e) => e.count >= cfg.minCount && (!opts.crossFile || e.files.size >= 2))
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
  // Mid patterns must span >= 2 FILES to count as a real mid-tier repeat (not
  // one file's internal duplication).
  const midPatterns = finalize(mid, { crossFile: true });
  const compositePatterns = finalize(composite);

  // HIERARCHY EDGES: a pattern P is CONTAINED in pattern Q iff P's skeleton is a
  // substring of Q's (skeletons are nested strings, so a sub-tree's skeleton is
  // literally a substring of its ancestor's). This yields real small -> mid ->
  // large containment, computed deterministically from the skeletons.
  const containedIn = (child, parents) =>
    parents.filter((p) => p.id !== child.id && p.skeleton.includes(child.skeleton)).map((p) => p.id);
  for (const m of midPatterns) {
    m.childSmallPatterns = smallPatterns.filter((s) => s.id !== m.id && m.skeleton.includes(s.skeleton)).map((s) => s.id);
    m.parentCompositePatterns = containedIn(m, compositePatterns);
  }
  for (const c of compositePatterns) {
    c.childMidPatterns = midPatterns.filter((m) => c.skeleton.includes(m.skeleton)).map((m) => m.id);
  }
  const midsWithParents = midPatterns.filter((m) => m.parentCompositePatterns.length).length;

  // Trim skeletons off the persisted records except where needed (keep file lean-ish);
  // hierarchy already computed. Keep skeleton on composites+mids for downstream tooling.

  const catalog = {
    schema: "sdd-repo-dsl/patterns/2",
    corpus: path.relative(path.resolve(__dirname, "..", ".."), cfg.corpus),
    minCount: cfg.minCount,
    fileCount: files.length,
    tiers: ["small", "mid", "composite"],
    counts: {
      smallRecurring: smallPatterns.length,
      midRecurring: midPatterns.length,
      compositeRecurring: compositePatterns.length,
      leafTypedClean: smallPatterns.filter((p) => p.typedLeafClean).length,
      midWithCompositeParent: midsWithParents,
    },
    smallPatterns,
    midPatterns,
    compositePatterns,
  };

  fs.mkdirSync(path.dirname(cfg.out), { recursive: true });
  fs.writeFileSync(cfg.out, JSON.stringify(catalog, null, 2) + "\n");

  console.log(`miner: ${files.length} files -> ${smallPatterns.length} small + ${midPatterns.length} mid + ${compositePatterns.length} composite recurring patterns (min-count ${cfg.minCount})`);
  console.log(`miner: ${midsWithParents}/${midPatterns.length} mid patterns are contained in a composite (small->mid->large hierarchy edges present)`);
  console.log(`miner: ${catalog.counts.leafTypedClean}/${smallPatterns.length} small patterns are typed-leaf-clean (no prose slot)`);
  console.log(`miner: wrote ${path.relative(process.cwd(), cfg.out)}`);
}

main();
