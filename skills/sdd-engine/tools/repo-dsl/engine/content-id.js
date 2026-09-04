"use strict";
/**
 * content-id.js — R-PAY-6: a word id derived from THE PATTERN, not from mining order.
 *
 * AMIR'S RULING, VERBATIM (2026-09-04):
 *
 *   "You need to make deterministic ids based on the pattern and then that's how you relate to the
 *    word or phrase"
 *
 * WHAT IS BROKEN TODAY. `engine/wordlzw.js:62` and `:141` both allocate `const id = dict.length` —
 * a function of nothing but how many entries came first. Re-mine and every id moves. Every `.en`
 * cites ids (`⟪lzw1 n123⟨…`, 9,724 citations across 1,034 files), so a re-mine makes them decode
 * against the wrong words: a compile producing WRONG BYTES, not an error.
 *
 * THIS MODULE IS NOT A NEW SCHEME. `engine/artifact-contract.js:96` already keys `word-names.json`
 * "by content hash and never by word id", `w:`/`n:` + `sha256(sym)[0:16]` — 64 bits. Amir's design
 * is already implemented HERE, for names; it was simply never applied to payload ids. This applies
 * it, at the same width, and the width is not a free parameter — see below.
 *
 * WHAT THE ID IS A FUNCTION OF, stated exactly because the item required it to be NAMED:
 *
 *     the ORDERED LIST OF LEAF SKELETON STRINGS the word expands to, and nothing else.
 *
 * Not the entry's `key`. THAT IS THE TRAP, and the repo has already fallen into it once:
 * `key` is `symbols.join(",")` over symbolIds, and a symbolId is `idOfSym.set(s, symOfId.length)` —
 * first-seen order, the same defect one level down. `engine/pipeline.js:93` builds
 * `"g_" + e.len + "_" + sha256(e.key)[0:6]`, i.e. a hash of the order-dependent csv, which is
 * mining-order-dependent AND (measured below) too narrow. Hashing `key` reproduces the bug under a
 * new name.
 *
 * Not the TREE either. A composite word is stored as `m: [prefixId, appendedId]`, so a Merkle hash
 * over that pair would be cheaper — and would be a function of how the builder happened to
 * decompose the pattern, which is exactly the mining-order dependence being removed. The flat leaf
 * list is the pattern; the tree is one builder's route to it.
 *
 * WHAT IT COLLIDES ON — two risks, and only one of them is the hash.
 *
 * 1. SEPARATOR INJECTION, which NO HASH WIDTH FIXES. A leaf skeleton may contain any literal the
 *    source contained, so if elements were joined by a byte a skeleton can hold, the patterns
 *    [A, BC] and [AB, C] would hash IDENTICALLY — a collision manufactured by the ENCODING, not by
 *    chance, between two genuinely different patterns. Every element is therefore LENGTH-PREFIXED
 *    (`<codeUnitLength>:<skeleton>` — `s.length`, i.e. UTF-16 code units, NOT bytes, while sha256
 *    hashes the utf8 encoding; the mismatch is deliberate, because injectivity is the only property
 *    the guard needs and code-unit prefixing has it, while switching to a true byte length would
 *    move every id with a non-ASCII skeleton for no gain), which is injective regardless of content, so no joiner byte has
 *    to be trusted. `content-id.test.js` proves this with a constructed pair rather than asserting
 *    it, and shows the naive join collides on the same input.
 *
 * 2. TRUNCATION WIDTH. Measured on the shipped dictionary (`sen/catalog/generators-lzw.json`,
 *    126,348 narrow / 118,447 wide) rather than reasoned about:
 *
 *      24 bits (pipeline.js:93's width today)  narrow 436 collisions, wide 427  — LIVE TODAY
 *      40 bits (PRD §20 `sha256-10` as hex)    0 on this corpus; analytic risk 0.7% / 2.7%
 *      64 bits (artifact-contract.js:96)       0; analytic risk 4.3e-10
 *
 *    (436 is close to the analytic expectation n²/2m ≈ 476 at n=126,348, which is how the
 *    measurement and the theory check each other. A first pass of this probe reported "3" because
 *    it was counting its own capped EXAMPLE list rather than the collisions; the test counts them.)
 *
 *    THE REPO WINS OVER PRD §20 HERE. §20 does not state whether `sha256-10` means ten hex
 *    characters or ten bytes. If it means hex, 40 bits is not safe at this dictionary size, and for
 *    a payload reference a collision is a wrong-bytes compile rather than an error. 64 bits is the
 *    width this repo already ships for the same job, so that is the width used.
 *
 * WHAT THIS DOES NOT CLOSE — say it here so no caller mistakes it. Content-addressing closes
 * RENUMBERING: the same pattern, found again, gets the same id. It does NOT close
 * RE-SEGMENTATION: whether the same pattern is found again AT ALL. `buildSaturated` admits a window
 * only when it recurs corpus-wide (`wordlzw.js:152`) and `usageCounts` segments greedily-longest
 * over the grown dict, so editing ONE file can drop a pattern below the bar or let a longer one
 * supersede it. The word is then not renumbered — it is GONE, and no id scheme saves the `.en`.
 * That is the residual that Amir's PIN ruling (Q-10) turns into a LOUD failure: under these ids the
 * missing word's id is simply absent and `enlzw.js:71-73` already throws.
 *
 * ZERO I/O, zero model calls, no corpus write. It reads a `words` object and returns values.
 */
const crypto = require("crypto");

/* 16 hex characters = 64 bits, the same width and the same construction as
 * artifact-contract.js:96. Not a tunable: see the collision table above. */
const CID_HEX = 16;

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** patternOf(words, id) -> the ordered list of leaf skeleton strings. THE PATTERN.
 *  `memo` is optional and caller-owned so a whole-dictionary pass is linear rather than
 *  quadratic; it caches leaf-id lists, not strings, because the strings are large. */
function patternOf(words, id, memo) {
  const leafIds = leavesOf(words, String(id), memo || new Map());
  return leafIds.map((L) => words[L].sym);
}

function leavesOf(words, id, memo) {
  const hit = memo.get(id);
  if (hit) return hit;
  const w = words[id];
  if (!w) throw new Error("content-id: unknown word id " + JSON.stringify(id));
  let out;
  if (w.len === 1) out = [id];
  else out = leavesOf(words, String(w.m[0]), memo).concat(leavesOf(words, String(w.m[1]), memo));
  memo.set(id, out);
  return out;
}

/** contentOf(pattern) -> the exact bytes that get hashed. LENGTH-PREFIXED, so it is injective for
 *  any element content and no separator byte is trusted. Exported so a test can prove the
 *  injection case rather than assert it. */
function contentOf(pattern) {
  let out = "";
  for (const s of pattern) out += s.length + ":" + s;
  return out;
}

/** contentId(words, id) -> the 64-bit content-addressed id, as 16 lowercase hex characters. */
function contentId(words, id, memo) {
  return sha256(contentOf(patternOf(words, id, memo))).slice(0, CID_HEX);
}

/** rekeyAxis(axis) -> { words, map } — the same dictionary keyed by content id.
 *
 *  REFUSES on a collision rather than picking a winner. A collision here means two different
 *  patterns share an id, and every `.en` citing it would compile to whichever one the object
 *  happened to keep — the wrong-bytes compile this whole requirement exists to prevent. Measured
 *  zero at this width on the shipped dictionary; if it ever fires, the width is wrong and the
 *  answer is a wider id, never a tie-break. */
function rekeyAxis(axis) {
  const words = axis.words;
  const memo = new Map();
  const map = new Map();          // old positional id -> content id
  const out = Object.create(null);
  const owner = new Map();        // content id -> old id that claimed it

  for (const id of Object.keys(words)) map.set(id, contentId(words, id, memo));

  for (const id of Object.keys(words)) {
    const cid = map.get(id);
    const prev = owner.get(cid);
    if (prev !== undefined) {
      throw new Error(
        "content-id: CONTENT ID COLLISION at " + (CID_HEX * 4) + " bits — refusing to rekey\n" +
        "  id " + cid + "\n" +
        "  claimed by word " + prev + " and word " + id + "\n" +
        "  Two different patterns would share one id, so an .en citing it would compile to\n" +
        "  whichever survived — wrong bytes, not an error. Widen the id; never tie-break.");
    }
    owner.set(cid, id);
    const w = words[id];
    out[cid] = (w.len === 1)
      ? { len: 1, d: w.d, sym: w.sym }
      : { len: w.len, d: w.d, m: [map.get(String(w.m[0])), map.get(String(w.m[1]))] };
    if (w.freq !== undefined) out[cid].freq = w.freq;
    if (w.appended !== undefined && w.len === 1) out[cid].appended = w.appended;
  }
  return { words: out, map };
}

module.exports = { CID_HEX, patternOf, contentOf, contentId, rekeyAxis };
