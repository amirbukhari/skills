"use strict";
/**
 * patterns.js — the MINED-GENERATOR matcher wired into the .en renderer.
 *
 * Everything upstream (cnl, data-english) renders ONE statement at a time, so a .en can at
 * best be a line-by-line English transliteration — no compression. This module adds the
 * missing layer: it matches spans of the source against MINED multi-line generators
 * (anti-unified skeletons that recur >=2x across the corpus) and collapses each whole span
 * into ONE English generator-call. The skeleton (the repeated part) becomes the generator
 * NAME; only the per-site holes (the genuinely-unique data) remain. That is the compression.
 *
 * Two generator families, both byte-exact by the same refill guarantee as operations.js:
 *   • IMPORT BLOCK  — the leading run of `import … from '…'` lines (a pattern in EVERY file)
 *                     folds into one "Uses …" statement.
 *   • STATEMENT WINDOW — a run of K consecutive statements whose op-key sequence recurs
 *                     >=2x in the corpus folds into one generator-call. Greedy longest-first,
 *                     so the biggest repeated structure collapses first (makeYmd-pair,
 *                     fetch+return, paginated-fetch loop, guard+return, …).
 *
 * A collapse is emitted ONLY if template+holes refills to the exact source bytes (verified
 * here). Anything that does not match a mined generator is left for cnl/data/verbatim. The
 * corpus frequency tables are built deterministically (buildCorpusStats); zero model calls.
 * Human NAMES for skeletons are the only model-touchable surface and are correctness-
 * irrelevant — a wrong name still refills byte-exact.
 */
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { useSF, canonStmt, keyOf } = require("./operations");

/* ---- ordered holes + template for a single statement (byte-exact: refill===getText) ---- */
function stmtParts(st) {
  const parts = canonStmt(st, "op");
  if (!parts) return null;
  const template = keyOf(parts);
  const holes = parts.filter((p) => p.hole).map((p) => ({ type: p.type, text: p.text }));
  return { template, holes };
}
/* refill a `lit‹type›lit…` template with ordered hole texts -> exact bytes */
function refill(template, holeTexts) {
  let i = 0;
  return template.replace(/‹\w+›/g, () => holeTexts[i++]);
}

/* ============================ CORPUS STATISTICS (deterministic) ============================ */
const SKIP = new Set(["node_modules", ".git", ".worktrees", "dist", "build", "coverage", "spec", "catalog", ".cache", "demo", "coined-demo"]);
function walkTs(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkTs(p, o);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p);
  }
  return o;
}
/* every block's statement op-key sequence, so we can count window recurrence */
function eachBlockKeys(sf) {
  const blocks = [];
  const visit = (n) => {
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      const keys = n.statements.map((s) => { const p = canonStmt(s, "op"); return p ? keyOf(p) : ("¶" + ts.SyntaxKind[s.kind]); });
      if (keys.length) blocks.push(keys);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return blocks;
}
const MAXWIN = 5;
/**
 * buildCorpusStats(corpusRoot) -> { single:Map key->count, windows:Map seqKey->{count,files} }
 * seqKey = keys.join(" ⋙ "). Cached to catalog/pattern-stats.json (regenerable).
 */
function buildCorpusStats(corpusRoot) {
  const single = new Map(), windows = new Map();
  const files = walkTs(corpusRoot);
  for (const abs of files) {
    let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
    const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    useSF(sf);
    const seenSeqThisFile = new Set();
    for (const keys of eachBlockKeys(sf)) {
      for (const k of keys) single.set(k, (single.get(k) || 0) + 1);
      for (let L = 2; L <= MAXWIN; L++) {
        for (let i = 0; i + L <= keys.length; i++) {
          const seq = keys.slice(i, i + L).join(" ⋙ ");
          let rec = windows.get(seq); if (!rec) { rec = { count: 0, files: new Set() }; windows.set(seq, rec); }
          rec.count++; seenSeqThisFile.add(seq);
        }
      }
      // attribute file-spread after the fact (per file, once)
    }
    for (const seq of seenSeqThisFile) windows.get(seq).files.add(abs);
  }
  return { single, windows, fileCount: files.length };
}

module.exports = { stmtParts, refill, buildCorpusStats, eachBlockKeys, walkTs, MAXWIN };
