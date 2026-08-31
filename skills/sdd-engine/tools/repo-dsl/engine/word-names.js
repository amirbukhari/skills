"use strict";
/**
 * word-names.js — the NAMING layer for the recursive word dictionary (PRD §2.2, §5).
 *
 * A name is attached to a LEAF word by a CONTENT HASH of its canonical skeleton (`w.sym`), never
 * by word id. Ids are array indices into catalog/generators-lzw.json and move on every re-mine
 * (measured: the same skeleton was w5375 -> w31664 -> w57615 -> w63536 across one session). An
 * id-keyed name would silently re-attach to a DIFFERENT word — the producer/consumer drift bug
 * this whole effort exists to kill. A hash-keyed name simply stops matching, and an unmatched
 * word falls back to spanProse, which is the safe failure.
 *
 * Measured stability of sha256(sym)[0:16] against real catalogs:
 *   vs MAXWIN 16    (canon unchanged) .... 8922/8922 leaves keep their hash — 100.0%, 0 collisions
 *   vs MIN_COUNT 2  (canon unchanged) .... 2576/2576 leaves keep their hash — 100.0%, 0 collisions
 *   vs 8ae62a3      (canon CHANGED)  .... 5982/6596 leaves keep their hash —  90.7%, 0 collisions
 * i.e. mining-parameter changes orphan NOTHING; only a real canon change orphans, and only the
 * skeletons it actually altered.
 *
 * COSMETIC BY CONSTRUCTION (PRD §2.2): every export here feeds the label region between ▶ and ⟪.
 * enfile.compileChunk locates the payload with lastIndexOf(PAY_OPEN) and decodes ONLY that; the
 * label is never an input to compilation. A wrong or missing name therefore changes prose and
 * cannot change bytes. That is a structural property of the reader, not a promise made by a test.
 */
const fs = require("fs");
const crypto = require("crypto");
const AC = require("./artifact-contract");

const HASH_LEN = 16;

/* the name key for one leaf skeleton. Axis-prefixed: the narrow and wide axes generalize
 * differently, so the same text under two axes is genuinely two different words. */
function hashOf(axisName, sym) {
  return axisName[0] + ":" + crypto.createHash("sha256").update(sym, "utf8").digest("hex").slice(0, HASH_LEN);
}

/* Flatten a word to its ordered leaf skeletons. w.m = [prefixId, appendedId] is always binary and
 * left-leaning (LZW entries are prefix + one symbol, PRD §2.1), so this is a chain walk, not a
 * tree walk — a depth-4 word yields exactly 5 leaves in source order. */
function leavesOf(axis, id, out) {
  out = out || [];
  const w = axis.words[id];
  if (!w) return out;
  if (w.len === 1) { out.push(w.sym); return out; }
  leavesOf(axis, w.m[0], out);
  leavesOf(axis, w.m[1], out);
  return out;
}

/* Contract-checked (PRD §8B). ABSENT is a state — names are optional, and an unnamed corpus is
 * the honest default — so a missing file returns empty AND SAYS SO on stderr. PRESENT-BUT-WRONG is
 * a bug and throws: incident 5 was exactly a v0-shaped file read as v1, returning null for all 48
 * names while reporting nothing. */
function load(p) {
  const r = AC.load("word-names", p, { optional: true });
  if (!r.ok) { console.error("[word-names] " + r.reason); return { names: {}, orphans: {} }; }
  return { names: r.value.names || {}, orphans: r.value.orphans || {} };
}

/* Compose one span's sentence from its members' names. Returns null when NO member is named, so
 * the caller falls back to spanProse wholesale; where only some members are named the unnamed
 * ones are handed back as nulls and the caller fills them per-clause. Runs of the same name
 * collapse ("re-export everything from A, B and C" rather than saying it three times). */
function clausesFor(cat, payload, names) {
  const axis = payload.a === "n" ? cat.narrow : cat.wide;
  const axisName = payload.a === "n" ? "narrow" : "wide";
  const syms = leavesOf(axis, payload.w);
  if (!syms.length) return null;
  let any = false;
  const out = syms.map((sym) => {
    const rec = names[hashOf(axisName, sym)];
    if (rec && rec.en) { any = true; return rec.en; }
    return null;
  });
  return any ? out : null;
}

module.exports = { HASH_LEN, hashOf, leavesOf, load, clausesFor };
