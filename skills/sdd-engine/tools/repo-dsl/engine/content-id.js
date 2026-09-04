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

/* THE ID THE PAYLOAD CAN ACTUALLY CARRY — 53 bits, decimal.
 *
 * WHY NOT THE 64-BIT HEX ID ABOVE. `contentId` is the content address; it is NOT a payload id, and
 * putting it on the payload path would be an R-PAY-1 DIALECT CHANGE. Measured, not read:
 *
 *   payload.js:233   `out = TAG + " " + axis + obj.w`     interpolates a NUMBER
 *   payload.js:272   scans `text[i] >= "0" && text[i] <= "9"`   DIGITS only
 *   word-names.js:100,103   `leavesOf(axis, +id)` and `id: +id`
 *
 *   +"126347"    -> 126347      exact
 *   +"3f2a1b9c"  -> NaN         silently, at both word-names sites
 *
 * So the decimal leg survives every shipped consumer unchanged and the hex leg does not. THAT is
 * what makes hex the dialect change — not the width.
 *
 * WHY 53 IS THE EXACT NUMBER AND NOT A ROUND ONE. An unsigned 53-bit integer spans [0, 2**53 - 1],
 * and `Number.MAX_SAFE_INTEGER` IS 2**53 - 1. The widest id this construction can emit is exactly
 * the largest value `payload.js` accepts — the guard's ceiling and the id space coincide with no
 * slack and no unreachable region on either side.
 *
 * THE PRICE, MEASURED ON THE SHIPPED DICTIONARY rather than argued:
 *
 *     axis     words    distinct content   @24 bits   @53 bits   @64 bits
 *     narrow   126348   126348             436 coll   0 coll     0 coll
 *     wide     118447   118447             427 coll   0 coll     0 coll
 *
 * E[collisions] at 53 bits is 8.86e-7 (narrow) and 7.79e-7 (wide) — about one collision per
 * million corpora of this size. The @24 column is the NEGATIVE CONTROL: it reproduces the 436/427
 * this file's own table already records, so the zero at 53 bits is a measurement that could have
 * come back non-zero, not a tautology.
 *
 * Derived from the SAME bytes as `contentId` — the top 53 bits of its 64 — so the two can never
 * disagree about what a word's content is, and a test can assert that relationship directly. */
const CID_BITS = 53;

function contentIdDecimal(words, id, memo) {
  const hex = contentId(words, id, memo);
  const n = BigInt("0x" + hex) >> BigInt(CID_HEX * 4 - CID_BITS);
  const out = Number(n);
  /* Cannot fire by construction — 53 bits cannot exceed 2**53 - 1. Present because "cannot fire by
   * construction" is exactly the claim this project has been wrong about before, and the cost of
   * being wrong here is a silently rounded id. */
  if (!Number.isSafeInteger(out)) throw new Error("content-id: 53-bit reduction produced an unsafe integer for id " + JSON.stringify(id));
  return out;
}

/* The fields rekeyAxis KNOWS. Anything outside these is REFUSED, never dropped.
 *
 * WHY A REFUSAL AND NOT A WHITELIST-AND-CARRY-ON. The first version of this function rebuilt each
 * entry from a whitelist, so a field the miner adds later would vanish with no error anywhere —
 * the same defect class as payload.js rounding a 64-bit id to a different number and reporting
 * success. Measured on the shipped dictionary the entry-level exposure is ZERO (narrow: 121561
 * `d,len,m` + 4787 `d,len,sym`; wide: 116125 + 2322; `freq` and `appended` do not occur at all),
 * so this check is green today AND CAN FAIL — which is the only kind worth having. */
const LEAF_FIELDS = new Set(["len", "d", "sym"]);
const COMP_FIELDS = new Set(["len", "d", "m"]);
const OPTIONAL_FIELDS = new Set(["freq", "appended"]);   // carried through when present

/* The axis-level fields. `words`, `leaf` and `ext` are id-bearing and are REKEYED; the rest are
 * scalars and counters the caller owns. An axis field outside this set is REFUSED for the same
 * reason: it might carry ids, and leaving it positional beside a content-keyed dictionary is a
 * dangling pointer that no metric would see. */
const AXIS_REKEYED = new Set(["words", "leaf", "ext"]);
const AXIS_PASSTHROUGH = new Set(["axis", "minCount", "minSkel", "counts"]);

/** rekeyAxis(axis) -> { words, leaf, ext, map } — the same dictionary keyed by content id.
 *
 *  REFUSES on a collision rather than picking a winner. A collision here means two different
 *  patterns share an id, and every `.en` citing it would compile to whichever one the object
 *  happened to keep — the wrong-bytes compile this whole requirement exists to prevent. Measured
 *  zero at this width on the shipped dictionary; if it ever fires, the width is wrong and the
 *  answer is a wider id, never a tie-break.
 *
 *  `leaf` AND `ext` ARE REKEYED TOO, AND THAT IS NOT COSMETIC. `build-lzw-generators.js:158-168`
 *  writes `leaf[sym] -> wordId` and `ext[prefixWordId + "|" + appendedSym] -> wordId`, and
 *  `enlzw.js:106` and `:111` walk exactly those two tables — they are the renderer's greedy
 *  automaton, not a mining accelerator. An earlier version of this function returned `{words, map}`
 *  only, so a caller writing `{...axis, ...rekeyAxis(axis)}` would have got a content-keyed `words`
 *  beside a POSITIONAL `leaf`/`ext`: every automaton lookup would miss, silently, on all 126348
 *  narrow and 118447 wide entries. Returning them rekeyed is what makes the result renderable. */
function rekeyAxis(axis) {
  for (const k of Object.keys(axis)) {
    if (AXIS_REKEYED.has(k) || AXIS_PASSTHROUGH.has(k)) continue;
    throw new Error(
      "content-id: UNKNOWN AXIS FIELD " + JSON.stringify(k) + " — refusing to rekey\n" +
      "  rekeys: " + [...AXIS_REKEYED].join(", ") + "\n" +
      "  passes through (caller's): " + [...AXIS_PASSTHROUGH].join(", ") + "\n" +
      "  If this field carries word ids it must be remapped; if it does not, add it above.\n" +
      "  Dropping it silently is how a positional id survives beside a content-keyed dictionary.");
  }

  const words = axis.words;
  const memo = new Map();
  const map = new Map();          // old positional id -> content id
  const out = Object.create(null);
  const owner = new Map();        // content id -> old id that claimed it

  /* THE DECIMAL LEG, NOT THE HEX ONE (R-PAY-6 ruling). This used `contentId` — 16 hex characters —
   * and that produced an artifact NOTHING COULD RENDER. Measured on a three-word dictionary:
   *
   *     rekeyAxis id             "6e94fde0d8e094da"
   *     +id  (word-names.js:100,103)   NaN
   *     payload.encode                 refuses: word id must be a non-negative integer
   *
   * The payload refusal is loud, so this would have been caught; the `+id` NaN would not have been.
   * A 53-bit decimal id passes both untouched, which is why the decimal leg is not a dialect
   * change and the hex leg is. `contentIdDecimal` is the top 53 bits of the SAME 64-bit content
   * address, so nothing about what a word's content IS has changed here — only its surface. */
  for (const id of Object.keys(words)) map.set(id, String(contentIdDecimal(words, id, memo)));

  for (const id of Object.keys(words)) {
    const cid = map.get(id);
    const prev = owner.get(cid);
    if (prev !== undefined) {
      throw new Error(
        "content-id: CONTENT ID COLLISION at " + CID_BITS + " bits — refusing to rekey\n" +
        "  id " + cid + "\n" +
        "  claimed by word " + prev + " and word " + id + "\n" +
        "  Two different patterns would share one id, so an .en citing it would compile to\n" +
        "  whichever survived — wrong bytes, not an error. Widen the id; never tie-break.");
    }
    owner.set(cid, id);

    const w = words[id];
    const isLeaf = w.len === 1;
    const known = isLeaf ? LEAF_FIELDS : COMP_FIELDS;
    for (const k of Object.keys(w)) {
      if (known.has(k) || OPTIONAL_FIELDS.has(k)) continue;
      throw new Error(
        "content-id: UNKNOWN ENTRY FIELD " + JSON.stringify(k) + " on word " + id +
        " (len " + w.len + ") — refusing to rekey\n" +
        "  known for this branch: " + [...known].join(", ") + "\n" +
        "  optional, carried when present: " + [...OPTIONAL_FIELDS].join(", ") + "\n" +
        "  Rebuilding the entry would DROP it with no error. Add it above, deliberately.");
    }
    if (!isLeaf && w.appended !== undefined) {
      throw new Error(
        "content-id: `appended` on a COMPOSITE word " + id + " (len " + w.len + ") — refusing\n" +
        "  The earlier whitelist dropped this case silently. It does not occur on the shipped\n" +
        "  dictionary (measured 0 on both axes); if it ever does, decide what it means first.");
    }

    out[cid] = isLeaf
      ? { len: 1, d: w.d, sym: w.sym }
      : { len: w.len, d: w.d, m: [map.get(String(w.m[0])), map.get(String(w.m[1]))] };
    if (w.freq !== undefined) out[cid].freq = w.freq;
    if (w.appended !== undefined) out[cid].appended = w.appended;
  }

  /* `leaf[sym] -> wordId`. Keys are skeletons and do not move; only the values are ids. */
  const leaf = Object.create(null);
  if (axis.leaf) {
    for (const sym of Object.keys(axis.leaf)) {
      const cid = map.get(String(axis.leaf[sym]));
      if (cid === undefined) throw new Error(
        "content-id: leaf[" + JSON.stringify(sym) + "] cites word " + axis.leaf[sym] +
        ", which is not in this axis's dictionary — refusing to rekey a dangling edge");
      leaf[sym] = cid;
    }
  }

  /* `ext["<prefixWordId>|<appendedSym>"] -> wordId`. BOTH halves move: the value is an id, and the
   * key EMBEDS one. Split at the FIRST "|" — an appended skeleton may itself contain "|" (`a || b`
   * is a real skeleton), while an id never does, in either the positional or the hex spelling. */
  const ext = Object.create(null);
  if (axis.ext) {
    for (const key of Object.keys(axis.ext)) {
      const bar = key.indexOf("|");
      if (bar < 0) throw new Error(
        "content-id: ext key " + JSON.stringify(key) + " has no \"|\" — refusing to rekey a key " +
        "whose shape build-lzw-generators.js:168 does not produce");
      const pre = map.get(key.slice(0, bar));
      const val = map.get(String(axis.ext[key]));
      if (pre === undefined) throw new Error(
        "content-id: ext key " + JSON.stringify(key) + " cites prefix word " + key.slice(0, bar) +
        ", which is not in this axis's dictionary — refusing to rekey a dangling edge");
      if (val === undefined) throw new Error(
        "content-id: ext[" + JSON.stringify(key) + "] cites word " + axis.ext[key] +
        ", which is not in this axis's dictionary — refusing to rekey a dangling edge");
      ext[pre + "|" + key.slice(bar + 1)] = val;
    }
  }

  return { words: out, leaf, ext, map };
}

module.exports = { CID_HEX, CID_BITS, patternOf, contentOf, contentId, contentIdDecimal, rekeyAxis };
