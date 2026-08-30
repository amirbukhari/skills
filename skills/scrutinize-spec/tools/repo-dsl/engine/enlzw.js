"use strict";
/**
 * enlzw.js — render/compile the multi-line generator layer through the RECURSIVE WORD
 * DICTIONARY (catalog/generators-lzw.json) instead of the flat generators.json (PRD §4A).
 *
 * RENDER: greedily segment each run of foldable statements against the word graph — longest
 * NARROW word first (byte-eliminating), WIDE only where narrow leaves a position (§5A
 * arbitration). A word of length L>=2 collapses L statements into one call; its payload is the
 * word id + the per-site hole texts. Byte-gated at emission: G.windowParts(win).fill === slice.
 * COMPILE: word id -> expandKey (recurse members -> leaf statement keys joined by ‹gap›) ->
 * G.refill(key, holes) === exact source bytes. maxDepth>=2 => the live path composes.
 * Deterministic; zero model calls.
 *
 * Exports: loadLzw(catalogPath), genSpans(sf, source, cat), compileSpan(payload, cat).
 */
const fs = require("fs");
const ts = require("typescript");
const G = require("./generators");
const W = require("./wordlzw");

function loadLzw(catalogPath) {
  const j = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  // rebuild an expand-friendly dict wrapper per axis: words{} keyed by id, symOfId not needed
  // (leaf words carry .sym directly), so expandSymbols recurses members -> leaf .sym.
  return j;
}

/* expand a word id in one axis to its flat window key (per-statement keys joined by ‹gap›). */
function expandKey(axis, id) {
  const w = axis.words[id];
  if (!w) throw new Error("enlzw: unknown word id " + id);
  if (w.len === 1) return w.sym;
  return expandKey(axis, w.m[0]) + W_GAP + expandKey(axis, w.m[1]);
}
const W_GAP = W.GAP;

/* ALL kept words starting at run position p over symbol strings syms[], walking the prefix+symbol
 * automaton (leaf then ext). Returns [{ id, len }] for len 1..Lmax (kept words are prefix-closed,
 * so lengths are contiguous). Empty if syms[p] never recurred. */
function wordsAt(axis, syms, p) {
  let cur = axis.leaf[syms[p]];
  if (cur === undefined) return [];
  const out = [{ id: cur, len: 1 }];
  let q = p;
  while (q + 1 < syms.length) {
    const nid = axis.ext[cur + "|" + syms[q + 1]];
    if (nid === undefined) break;
    cur = nid; q++; out.push({ id: nid, len: q - p + 1 });
  }
  return out;
}

/* per-file generator spans through the recursive dictionary.
 *
 * A control-flow statement is foldable at its OWN block's run (whole `if`/`for`/… -> one symbol)
 * AND its inner blocks are tiled as their own runs, so the same bytes can be claimed at two
 * granularities (outer word spanning the CF stmt vs inner words inside it). We therefore gather
 * EVERY byte-gated candidate word across all runs and pick the max-weight NON-OVERLAPPING set by
 * weighted-interval scheduling over byte ranges (weight = stmts-1 = net reduction). This is
 * globally net-optimal and subsumes per-run tiling; the nesting overlap is resolved, not dropped. */
function genSpans(sf, source, cat) {
  if (!cat) return [];
  const blocks = [];
  const collect = (n) => { if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length) blocks.push([...n.statements]); ts.forEachChild(n, collect); };
  collect(sf);

  // 1) gather all byte-gated candidate words (len>=2, both axes) across every run.
  const cands = []; // { start, end, weight, stmts, payload, depth }
  for (const stmts of blocks) {
    let i = 0;
    while (i < stmts.length) {
      if (!G.isFoldable(stmts[i])) { i++; continue; }
      let j = i; while (j < stmts.length && G.isFoldable(stmts[j])) j++;
      const run = stmts.slice(i, j);
      const nsym = run.map((st) => { const p = G.generalStmtParts(st, sf, false); return p ? G.keyOf(p) : null; });
      const wsym = run.map((st) => { const p = G.generalStmtParts(st, sf, true); return p ? G.keyOf(p) : null; });
      for (let p = 0; p < run.length; p++) {
        const push = (ws, axis, wide) => {
          for (const w of ws) {
            if (w.len < 2) continue;
            const win = run.slice(p, p + w.len);
            const start = win[0].getStart(sf), end = win[win.length - 1].getEnd();
            const wp = G.windowParts(win, sf, wide);
            if (wp && wp.fill === source.slice(start, end)) {
              cands.push({ start, end, weight: w.len - 1, stmts: w.len, wide, depth: cat[axis].words[w.id].d,
                payload: { a: wide ? "w" : "n", w: w.id, h: wp.holes } });
            }
          }
        };
        if (nsym[p] != null) push(wordsAt(cat.narrow, nsym, p), "narrow", false);
        if (wsym[p] != null) push(wordsAt(cat.wide, wsym, p), "wide", true);
      }
      i = j;
    }
  }
  if (!cands.length) return [];

  // 2) weighted-interval scheduling: max total weight over non-overlapping byte ranges.
  //    Sort by end; tie-break so the deterministic winner is stable (wider, then narrow axis).
  cands.sort((a, b) => a.end - b.end || a.start - b.start || (b.stmts - a.stmts) || (a.wide - b.wide));
  const ends = cands.map((c) => c.end);
  // p(i) = last index whose end <= cands[i].start (binary search)
  const prevIdx = cands.map((c) => {
    let lo = 0, hi = cands.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ends[m] <= c.start) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  });
  const M = cands.length;
  const dp = new Array(M + 1).fill(0);   // dp[i] = best weight using cands[0..i-1]
  for (let i = 1; i <= M; i++) {
    const c = cands[i - 1];
    const take = c.weight + dp[prevIdx[i - 1] + 1];
    dp[i] = Math.max(dp[i - 1], take);
  }
  // reconstruct chosen set
  const chosen = [];
  for (let i = M; i >= 1;) {
    const c = cands[i - 1];
    const take = c.weight + dp[prevIdx[i - 1] + 1];
    if (take >= dp[i - 1] && take === dp[i]) { chosen.push(c); i = prevIdx[i - 1] + 1; }
    else i--;
  }
  chosen.reverse();
  return chosen.map((c) => ({ start: c.start, end: c.end, payload: c.payload, stmts: c.stmts, depth: c.depth }));
}

/* compile one span payload back to exact source bytes. */
function compileSpan(payload, cat) {
  const axis = payload.a === "n" ? cat.narrow : cat.wide;
  const key = expandKey(axis, payload.w);
  return G.refill(key, payload.h);
}

module.exports = { loadLzw, genSpans, compileSpan, expandKey };
