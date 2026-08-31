"use strict";
/**
 * wordlzw.js — the RECURSIVE WORD DICTIONARY (Amir's LZW-as-primary design).
 *
 * The live `.en` middle tier used to compile through a FLAT vocabulary (catalog/
 * generators.json): every generator a monolithic K-statement window whose holes are
 * verbatim TS, no generator able to reference another (PRD §4A — the defect). This
 * module replaces that with the dictionary-building half of LZW run over a stream of
 * per-statement CANONICAL SYMBOLS, so the vocabulary is a graph, not a list:
 *
 *   ALPHABET  = the distinct per-statement canonical keys (one statement -> one symbol).
 *               Each symbol already refills BYTE-EXACT via engine/generators.js parts.
 *   WORD      = an LZW dictionary entry. A length-1 word is a leaf (one statement key).
 *               A length-K word is `m:[prefixWordId, appendedLeafId]` — i.e. a
 *               GENERATOR THAT REFERENCES GENERATORS, by construction (LZW's prefix+symbol
 *               rule). `d` = the prefix-chain length -> the tier hierarchy
 *               (ARCHETYPE>SKELETON>IDIOM>LEAF) is the EMERGENT dictionary depth, not a label.
 *
 *   CANONICAL FIELD NAMES — the word-graph fields are the short forms `m` (members) and
 *   `d` (depth), plus `len`/`sym`, and NOTHING ELSE. They are deliberately abbreviated: the
 *   catalog is a ~0.67 MB machine-read artifact of thousands of words per axis, where `m`/`d`
 *   over `members`/`hierarchyDepth` is a real size win. The reader (engine/enlzw.js) and the
 *   serializer (build-lzw-generators.js) use these exact names; wordlzw-enlzw-fields.test.js
 *   pins writer and reader to them so the two halves can never drift apart again.
 *
 * BYTE-IDENTITY is preserved as a representational identity, not a new invariant:
 *   expandKey(word) === the exact flat window key that a monolithic window would emit
 *   (per-statement keys joined by the literal `‹gap›` marker). Since the flat key + the
 *   ordered hole texts already refill to the source slice (proven in engine/generators.js),
 *   refill(expandKey(word), holes) === sourceSlice. The gate is UNCHANGED; only the catalog
 *   representation becomes recursive. Deterministic; zero model calls.
 *
 * Exports: build(streams), segment(stream, model), promote(model, opts),
 *          expandKey(word, dict), expandSymbols(word, dict).
 */

const GAP = "‹gap›"; // the literal separator between consecutive statement symbols in a flat key

/* ---- LZW dictionary build over statement-symbol streams (prefix+symbol recursion) ---- */
/** streams: array of arrays of statement-symbol strings (one inner array per block).
 *  opts.passes (default 3): classic LZW creates a length-K word only AFTER its (K-1)-prefix
 *  was seen and extended, so patterns learned late under-cover early text. Re-encoding the
 *  corpus against the persistent, growing dict a few times lets prefixes catch up so longer
 *  recurring runs actually become words (the "patterns learned late apply everywhere" note). */
function build(streams, opts = {}) {
  const passes = opts.passes || 4;
  const idOfSym = new Map();  // symbol string -> symbolId (alphabet index)
  const symOfId = [];         // symbolId -> symbol string
  const symCounts = new Map();// symbol -> raw occurrences (LZW-independent)

  function sym(s) {
    if (!idOfSym.has(s)) { idOfSym.set(s, symOfId.length); symOfId.push(s); }
    symCounts.set(s, (symCounts.get(s) || 0) + 1);
    return idOfSym.get(s);
  }
  const symStreams = streams.map((st) => st.map(sym));

  const dict = [];            // wordId -> { id, symbols:[symbolId], key, prefixId, appended, len, freq }
  const byKey = new Map();    // seqKey (symbolId,csv) -> wordId
  const keyOf = (syms) => syms.join(",");
  function addEntry(symbols, prefixId, appended) {
    const id = dict.length;
    const e = { id, symbols, key: keyOf(symbols), prefixId, appended, len: symbols.length, freq: 0 };
    dict.push(e); byKey.set(e.key, id);
    return id;
  }
  // Seed the alphabet: one length-1 word per distinct statement symbol (first-seen order).
  for (let s = 0; s < symOfId.length; s++) addEntry([s], null, s);

  // Multi-pass LZW encode with one shared, growing dictionary across all blocks. Each pass
  // extends the longest current match and adds match+next, so successive passes grow deeper
  // words. freq here is encode-time only; promotion uses greedy usage (usageCounts) instead.
  for (let pass = 0; pass < passes; pass++) {
    for (const stream of symStreams) {
      if (!stream.length) continue;
      let w = [stream[0]];
      for (let i = 1; i < stream.length; i++) {
        const c = stream[i];
        const wc = keyOf(w.concat(c));
        if (byKey.has(wc)) { w.push(c); continue; }
        const wid = byKey.get(keyOf(w));
        dict[wid].freq++;
        addEntry(w.concat(c), wid, c);
        w = [c];
      }
      dict[byKey.get(keyOf(w))].freq++;
    }
  }
  return { dict, byKey, idOfSym, symOfId, symCounts, keyOf, symStreams };
}

/**
 * SATURATED dictionary construction — the fixpoint the multi-pass LZW encode only approaches.
 * Adds EVERY window (len 1..maxWin) that recurs >= minCount as a prefix+symbol entry, so the
 * word set equals the exhaustive recurring-window set (flat-path parity) while keeping the
 * recursive invariant: a length-K entry = its length-(K-1) prefix entry + one appended leaf.
 * Because a K-window's recurrence <= its (K-1)-prefix's recurrence, the prefix is always also
 * kept, so `members` always resolve. dict[e].freq = raw window occurrence count. Deterministic.
 */
function buildSaturated(streams, opts = {}) {
  const maxWin = opts.maxWin || 8, minCount = opts.minCount || 2;
  const idOfSym = new Map(), symOfId = [], symCounts = new Map();
  function sym(s) { if (!idOfSym.has(s)) { idOfSym.set(s, symOfId.length); symOfId.push(s); } symCounts.set(s, (symCounts.get(s) || 0) + 1); return idOfSym.get(s); }
  const symStreams = streams.map((st) => st.map(sym));
  const keyOf = (syms) => syms.join(",");

  const dict = [], byKey = new Map();
  function add(symbols, prefixId, appended, freq) { const id = dict.length; const e = { id, symbols, key: keyOf(symbols), prefixId, appended, len: symbols.length, freq }; dict.push(e); byKey.set(e.key, id); return id; }
  // length-1 alphabet (kept-by-recurrence decided in promote via symCounts)
  for (let s = 0; s < symOfId.length; s++) add([s], null, s, symCounts.get(symOfId[s]) || 0);
  // lengths 2..maxWin: count windows of exactly length K, then add the recurring ones (prefix-first).
  for (let K = 2; K <= maxWin; K++) {
    const win = new Map(); // csv -> { count, symbols }
    for (const syms of symStreams) for (let s = 0; s + K <= syms.length; s++) {
      const seg = syms.slice(s, s + K), csv = keyOf(seg);
      let e = win.get(csv); if (!e) { e = { count: 0, symbols: seg }; win.set(csv, e); } e.count++;
    }
    for (const [, e] of win) {
      if (e.count < minCount) continue;
      const prefixId = byKey.get(keyOf(e.symbols.slice(0, K - 1)));
      if (prefixId == null) continue; // prefix didn't clear the bar (only if minCount>window-count, impossible)
      add(e.symbols, prefixId, e.symbols[K - 1], e.count);
    }
  }
  return { dict, byKey, idOfSym, symOfId, symCounts, keyOf, symStreams };
}

/** Greedy longest-match usage over the FULL grown dict (every entry, not just kept). Returns
 *  Map(wordId -> times emitted as the greedy-longest match) — the order-independent recurrence
 *  used for promotion, and it mirrors exactly how the renderer segments. */
function usageCounts(model) {
  const { dict, byKey, symStreams, keyOf } = model;
  const usage = new Map();
  for (const syms of symStreams) {
    let i = 0;
    while (i < syms.length) {
      let key = String(syms[i]), last = i, id = byKey.get(key);
      for (let j = i; j + 1 < syms.length; j++) {
        const nk = key + "," + syms[j + 1];
        if (!byKey.has(nk)) break;
        key = nk; last = j + 1; id = byKey.get(nk);
      }
      usage.set(id, (usage.get(id) || 0) + 1);
      i = last + 1;
    }
  }
  return usage;
}

/** Greedy longest-match segmentation of one symbol-stream against the PROMOTED dict.
 *  `kept` is the promoted-words map (id -> word) from promote(); only kept words are matched
 *  (kept words are downward-prefix-closed, so the greedy longest KEPT prefix is well-defined).
 *  Returns [{ wordId, from, to }] where [from,to] are inclusive statement indices; wordId is
 *  null for a statement whose symbol never recurred (residue -> verbatim TS at the caller). */
function segment(stream, model, kept) {
  const { idOfSym, byKey, keyOf } = model;
  const has = (id) => id != null && (!kept || kept[id] !== undefined);
  const syms = stream.map((s) => idOfSym.get(s));
  const segs = [];
  let i = 0;
  while (i < syms.length) {
    if (syms[i] == null) { segs.push({ wordId: null, from: i, to: i }); i++; continue; } // unknown symbol
    let key = String(syms[i]), last = i, lastId = byKey.get(key);
    if (!has(lastId)) { segs.push({ wordId: null, from: i, to: i }); i++; continue; }   // symbol never recurred
    for (let j = i; j + 1 < syms.length && syms[j + 1] != null; j++) {
      const nk = key + "," + syms[j + 1], nid = byKey.get(nk);
      if (!has(nid)) break;   // stop at the longest KEPT word
      key = nk; last = j + 1; lastId = nid;
    }
    segs.push({ wordId: lastId, from: i, to: last });
    i = last + 1;
  }
  return segs;
}

/* ---- expansion: word -> ordered leaf symbol strings -> flat window key (byte-exact) ---- */
/** Ordered list of the leaf statement-symbol strings this word expands to (recurses members). */
function expandSymbols(word, dict) {
  if (word.len === 1) return [dict.symOfId[word.appended]];
  return expandSymbols(dict.words[word.m[0]], dict).concat(
         expandSymbols(dict.words[word.m[1]], dict));
}
/** The flat window key: statement symbols joined by the literal `‹gap›` marker.
 *  Identical to what engine/generators.js windowParts produces for the same run. */
function expandKey(word, dict) { return expandSymbols(word, dict).join(GAP); }

/* ---- promotion: pick which words become catalog generators (recur >= minCount) ---- */
/**
 * promote(model, { minCount, minSkelPerStmt, skelBytesOf }) -> {
 *   words: { [wordId]: {id, len, freq, sym?, m?, d} },  // the graph (canonical fields m/d)
 *   symOfId, byKey, idOfSym, keptKeys
 * }
 * A word is kept iff len===1 && recurs (a reusable leaf) OR len>=2 && freq>=minCount and
 * its prefix is kept (so members always resolve). skelBytesOf(flatKey) gates degenerate runs.
 */
function promote(model, opts = {}) {
  const minCount = opts.minCount || 2;
  const minSkelPerStmt = opts.minSkelPerStmt != null ? opts.minSkelPerStmt : 12;
  const skelBytesOf = opts.skelBytesOf || ((k) => k.replace(/‹\w+›/g, "").length);
  const { dict, symOfId, symCounts, byKey, idOfSym } = model;
  // saturated: keep by raw window frequency (dict[e].freq); lazy-LZW: keep by greedy usage.
  const saturated = !!opts.saturated;
  const usage = saturated ? null : usageCounts(model);
  const cntOf = (e) => (saturated ? e.freq : (usage.get(e.id) || 0));

  const kept = new Set();
  const depthOf = new Map();
  const freqOf = (e) => (e.len === 1 ? (symCounts.get(symOfId[e.appended]) || 0) : cntOf(e));

  // Force-keep a word and its whole prefix chain + appended leaf (so members always resolve
  // and every ext edge along the chain exists for the renderer's greedy automaton).
  function keepChain(e) {
    if (kept.has(e.id)) return depthOf.get(e.id);
    let d;
    if (e.len === 1) { d = 0; kept.add(e.id); depthOf.set(e.id, d); }
    else { const pd = keepChain(dict[e.prefixId]); keepChain(dict[e.appended]); d = pd + 1; kept.add(e.id); depthOf.set(e.id, d); }
    return d;
  }

  // Pass 1: seed leaves that recur on their own (composition bases + single-stmt residue floor).
  for (const e of dict) if (e.len === 1 && (symCounts.get(symOfId[e.appended]) || 0) >= minCount) keepChain(e);
  // Pass 2: keep composites that are actually USED >= minCount as a greedy-longest match and
  // carry real skeleton; force-keep their prefix chain even if a prefix is individually rarer.
  for (const e of dict) {
    if (e.len < 2) continue;
    if (cntOf(e) < minCount) continue;
    const flatKey = expandSymbolsRaw(e, dict, symOfId).join(GAP);
    if (skelBytesOf(flatKey) < minSkelPerStmt * e.len) continue;
    keepChain(e);
  }

  const words = {};
  for (const id of kept) {
    const e = dict[id];
    if (e.len === 1) words[id] = { id, len: 1, freq: freqOf(e), sym: symOfId[e.appended], appended: e.appended, d: 0 };
    else words[id] = { id, len: e.len, freq: freqOf(e), m: [e.prefixId, e.appended], d: depthOf.get(id) };
  }
  return { words, symOfId, byKey, idOfSym, keptKeys: byKey, minCount };
}
// expand without the promoted-words wrapper (used inside promote, before words{} is closed)
function expandSymbolsRaw(e, dict, symOfId) {
  if (e.len === 1) return [symOfId[e.appended]];
  return expandSymbolsRaw(dict[e.prefixId], dict, symOfId).concat(expandSymbolsRaw(dict[e.appended], dict, symOfId));
}

module.exports = { build, buildSaturated, segment, promote, usageCounts, expandKey, expandSymbols, expandSymbolsRaw, GAP };
