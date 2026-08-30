"use strict";
/**
 * build-generators.js — mine the multi-line generator catalog (the additive middle-tier layer).
 *
 * Walks the corpus READ-ONLY, forms every window of K=2..MAXK consecutive straight-line
 * statements, and clusters by canonical key at TWO axes (narrow = operations.js op-level;
 * wide = generators.js member/ctor-abstracted). A key qualifies as a generator when it recurs
 * >=2x AND carries real skeleton (avg >= MIN_SKEL literal chars/stmt — rejects degenerate
 * `const x = <fn>` runs). Every site is validated byte-exact (fill === source slice); a key
 * with ANY non-exact site is rejected. Writes catalog/generators.json (regenerable).
 * Deterministic; zero model calls.
 *
 * Output schema: { builtFrom, minSkel, maxWin, generators: [ {id, level, k, key, gloss,
 * count, files, skelBytes} ] }. Render/compile load it by key (narrow-preferred) and by id.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const G = require("./engine/generators");
const ops = require("./engine/operations");

const CORPUS = process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source";
const OUT = path.join(CORPUS, "catalog", "generators.json");
const SKIP = new Set(["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "spec", "catalog", ".cache", "demo", "coined-demo", "tests"]);
const MAXWIN = 8, MINK = 2, MIN_SKEL = 12;

function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
const isSimple = (st) => G.isFoldable(st); // foldable = simple + control-flow (v2)

// each block -> its top-level statement array (so we can form consecutive windows)
function blocks(sf) { const out = []; const visit = (n) => { if (ts.isBlock(n) || ts.isSourceFile(n)) { if (n.statements.length) out.push([...n.statements]); } ts.forEachChild(n, visit); }; visit(sf); return out; }

// clusters: key -> {level,k, count, files:Set, badFill:bool, glossSample}
const clusters = new Map();
let windowsSeen = 0, fillChecks = 0, fillFails = 0;

function record(key, level, k, abs, gloss, fill, slice) {
  fillChecks++;
  const ok = fill === slice;
  if (!ok) fillFails++;
  let c = clusters.get(key);
  if (!c) { c = { level, k, count: 0, files: new Set(), bad: false, gloss }; clusters.set(key, c); }
  c.count++; c.files.add(abs); if (!ok) c.bad = true;
}

const files = walk(CORPUS);
for (const abs of files) {
  let src; try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
  const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const stmts of blocks(sf)) {
    // maximal runs of consecutive simple statements
    let i = 0;
    while (i < stmts.length) {
      if (!isSimple(stmts[i])) { i++; continue; }
      let j = i; while (j < stmts.length && isSimple(stmts[j])) j++;
      const run = stmts.slice(i, j);
      for (let K = MINK; K <= MAXWIN; K++) {
        for (let s = 0; s + K <= run.length; s++) {
          const win = run.slice(s, s + K);
          windowsSeen++;
          const slice = src.slice(win[0].getStart(sf), win[K - 1].getEnd());
          const gloss = G.glossForStatements(win, sf);
          for (const wide of [false, true]) {
            const wp = G.windowParts(win, sf, wide);
            if (!wp) continue;
            record(wp.key, wide ? "opw" : "op", K, abs, gloss, wp.fill, slice);
          }
        }
      }
      i = j;
    }
  }
}

// qualify
function idOf(key) { let h = 5381; for (let k = 0; k < key.length; k++) h = ((h * 33) ^ key.charCodeAt(k)) >>> 0; return "g" + h.toString(36); }
const generators = [];
let rejByCount = 0, rejBySkel = 0, rejByBad = 0;
for (const [key, c] of clusters) {
  if (c.count < 2) { rejByCount++; continue; }
  if (c.bad) { rejByBad++; continue; }
  const sk = G.skelBytes(key);
  if (sk < MIN_SKEL * c.k) { rejBySkel++; continue; }
  generators.push({ id: idOf(key), level: c.level, k: c.k, key, gloss: c.gloss, count: c.count, files: c.files.size, skelBytes: sk });
}
// stable order: by (level, K desc, count desc)
generators.sort((a, b) => (a.level < b.level ? -1 : a.level > b.level ? 1 : 0) || (b.k - a.k) || (b.count - a.count));

fs.writeFileSync(OUT, JSON.stringify({ builtFrom: path.basename(CORPUS), minSkel: MIN_SKEL, maxWin: MAXWIN, fileCount: files.length, generators }, null, 1));

const nNarrow = generators.filter((g) => g.level === "op").length;
const nWide = generators.filter((g) => g.level === "opw").length;
console.log("=== build-generators ===");
console.log("corpus files:", files.length, " windows scanned:", windowsSeen);
console.log("byte-exact fill checks:", fillChecks, " FAILURES:", fillFails, fillFails ? "  <-- CANON BUG" : "  (gate holds)");
console.log("clusters:", clusters.size, " rejected  by-count<2:", rejByCount, " by-skel:", rejBySkel, " by-bad-fill:", rejByBad);
console.log("GENERATORS:", generators.length, " (narrow:", nNarrow, " wide:", nWide, ")");
console.log("wrote", OUT);
console.log("\ntop 12 by (K, count):");
for (const g of [...generators].sort((a, b) => (b.k * b.count) - (a.k * a.count)).slice(0, 12))
  console.log(`  ${g.level} K=${g.k} x${g.count} (${g.files}f) skel=${g.skelBytes}  «${g.gloss}»`);
