"use strict";
/**
 * STAGE 2 — LZW PATTERN MINING.
 *
 * An LZW-style dictionary builder run over the shape-token streams of the WHOLE
 * corpus. The incrementally grown dictionary IS the pattern set:
 *
 *  - The alphabet (length-1 entries) is seeded from every distinct shape.
 *  - Encoding each file the classic LZW way (emit the longest dictionary match,
 *    then add match+nextSymbol as a new entry) grows multi-symbol entries. Each
 *    new entry references an earlier entry (`prefixId`) plus one appended symbol,
 *    so entries form a natural hierarchy: small subsequence ⊂ mid ⊂ large.
 *  - Frequencies are kept (how often each entry is emitted).
 *
 * A second pass, segment(), re-encodes each stream greedily against the FINAL
 * dictionary (so patterns learned late apply everywhere) and returns, for every
 * file, the list of segments (entryId + the token indices it spans) plus an
 * order-independent per-entry usage count used for promotion downstream.
 *
 * Exports: build(streams) and segment(stream, model).
 */

/** streams: array of arrays of shape-strings. */
function build(streams) {
  const idOfShape = new Map(); // shape -> symbolId
  const shapeOfId = [];        // symbolId -> shape
  const shapeCounts = new Map(); // shape -> raw occurrences (LZW-independent)

  function sym(shape) {
    if (!idOfShape.has(shape)) { idOfShape.set(shape, shapeOfId.length); shapeOfId.push(shape); }
    shapeCounts.set(shape, (shapeCounts.get(shape) || 0) + 1);
    return idOfShape.get(shape);
  }

  // First materialize the alphabet & raw counts (so every single shape is an entry).
  const symStreams = streams.map((s) => s.map(sym));

  const dict = [];                 // entryId -> entry
  const byKey = new Map();         // seqKey -> entryId
  const keyOf = (syms) => syms.join(",");
  function addEntry(symbols, prefixId, appended) {
    const id = dict.length;
    const e = { id, symbols, key: keyOf(symbols), prefixId, appended, len: symbols.length, freq: 0 };
    dict.push(e); byKey.set(e.key, id);
    return id;
  }
  // Seed alphabet entries (length 1) in first-seen order.
  for (let s = 0; s < shapeOfId.length; s++) addEntry([s], null, s);

  // Classic LZW encode with a shared, growing dictionary across all files.
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

  return { dict, byKey, idOfShape, shapeOfId, shapeCounts, keyOf };
}

/** Greedy longest-match segmentation of one shape-stream against the final dict. */
function segment(stream, model) {
  const { idOfShape, byKey, keyOf } = model;
  const syms = stream.map((sh) => idOfShape.get(sh));
  const segs = [];
  let i = 0;
  while (i < syms.length) {
    // extend while the running key is a known entry
    let j = i, key = String(syms[i]), lastGood = i;
    while (j + 1 < syms.length && byKey.has(key + "," + syms[j + 1])) { key += "," + syms[j + 1]; j++; lastGood = j; }
    const entryId = byKey.get(keyOf(syms.slice(i, lastGood + 1)));
    const tokenIndices = [];
    for (let k = i; k <= lastGood; k++) tokenIndices.push(k);
    segs.push({ entryId, tokenIndices });
    i = lastGood + 1;
  }
  return segs;
}

module.exports = { build, segment };
