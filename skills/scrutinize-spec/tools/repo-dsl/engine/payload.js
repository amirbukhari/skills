"use strict";
/* GENERATOR SPAN PAYLOAD CODEC — the readable dialect (`lzw1`).
 *
 * WHY THIS EXISTS. The payload used to be base64(JSON). Measured over the corpus that cost:
 *   base64 4/3 expansion .... 565,670 B  (10.7% of the .en, carrying zero information)
 *   JSON scaffolding ........ 308,434 B  (keys, quotes, brackets, escapes)
 *   hole text ............. 1,371,044 B  (REAL SOURCE — identifiers and literals from the .ts)
 * The third line is the point. Hole text is the code's own text, and base64 was turning a quarter
 * of the canonical human artifact (§1) into an opaque blob. Worse, it scaled the wrong way: every
 * newly mined word added another ~515 B of blob to the file Amir is supposed to read, so improving
 * reuse made his source WORSE. Negative compression was the symptom; opacity was the defect.
 *
 * FORMAT.  lzw1 <axis><wordId>⟨hole⟨hole...
 *   axis    "n" (narrow) or "w" (wide)
 *   wordId  decimal integer
 *   holes   in order, each INTRODUCED by ⟨, contents escaped (below), running to the next ⟨ or to
 *           the end of the payload. There is no closing bracket: ⟨ is 3 bytes in UTF-8 and the
 *           corpus carries 40,667 holes, so a closer nobody needs costs 122 KB of the artifact.
 *           Zero holes is the empty tail; `lzw1 n842⟨` is one empty hole. Both are unambiguous.
 * Example:  lzw1 n842⟨invoice.id⟨totalAmount
 *
 * SENTINEL SAFETY IS STRUCTURAL, NOT INCIDENTAL. The .en scanner finds a span by searching for the
 * « » sentinels, which works only if no payload can contain one. base64 gave that for free. Plain
 * text does not — so escaping provides it BY CONSTRUCTION. Every sentinel is escaped on the way in,
 * so an encoded payload provably contains none of « » ⟪ ⟫ ▶ ⟨ ⟩. This is deliberately not an
 * assumption about what TypeScript source happens to contain (no sentinel appears in the corpus
 * today, but that is luck, and luck is what the dialect work just finished removing).
 *
 * FAIL-CLOSED. decode() throws on anything it does not fully understand — wrong tag, bad axis,
 * missing id, unterminated hole, unknown escape. It never guesses. Guessing is how wrong bytes ship.
 */

const TAG = "lzw1";
const H_MARK = "⟨", ESC = "⟡";

/* Escape table. ESC must map first on encode so its own occurrences are not double-read. */
const ESCAPES = [
  [ESC, "0"], ["⟨", "1"], ["⟩", "2"], ["⟪", "3"],
  ["⟫", "4"], ["«", "5"], ["»", "6"], ["▶", "7"],
];
const ENC_MAP = new Map(ESCAPES.map(([ch, d]) => [ch, ESC + d]));
const DEC_MAP = new Map(ESCAPES.map(([ch, d]) => [d, ch]));
const NEEDS_ESC = /[⟡⟨⟩⟪⟫«»▶]/g;

function escapeHole(s) { return s.replace(NEEDS_ESC, (ch) => ENC_MAP.get(ch)); }

function unescapeHole(s) {
  let out = "", i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== ESC) { out += ch; i++; continue; }
    const d = s[i + 1];
    const lit = DEC_MAP.get(d);
    if (lit === undefined) throw new Error(`payload: unknown escape ${JSON.stringify(ESC + (d || ""))} in hole text`);
    out += lit; i += 2;
  }
  return out;
}

/* obj: { d:"lzw", a:"n"|"w", w:<int>, h:[string,...] } -> payload text */
function encode(obj) {
  if (obj.d !== undefined && obj.d !== "lzw") throw new Error(`payload: refusing to encode dialect ${JSON.stringify(obj.d)}`);
  const axis = obj.a;
  if (axis !== "n" && axis !== "w") throw new Error(`payload: axis must be "n" or "w", got ${JSON.stringify(axis)}`);
  if (!Number.isInteger(obj.w) || obj.w < 0) throw new Error(`payload: word id must be a non-negative integer, got ${JSON.stringify(obj.w)}`);
  const holes = obj.h || [];
  let out = TAG + " " + axis + obj.w;
  for (const h of holes) {
    if (typeof h !== "string") throw new Error(`payload: hole must be a string, got ${typeof h}`);
    out += H_MARK + escapeHole(h);
  }
  return out;
}

/* payload text -> { d:"lzw", a, w, h } . Throws on anything unrecognised. */
function decode(text) {
  if (typeof text !== "string") throw new Error("payload: expected payload text");
  if (!text.startsWith(TAG + " ")) {
    // A stale base64(JSON) payload is the one other thing that can legitimately appear here.
    // Name it exactly rather than failing with a parse error nobody can act on.
    if (/^[A-Za-z0-9+/=]+$/.test(text.trim()))
      throw new Error('payload: this .en carries a base64 generator payload, a dialect that no longer exists; re-render it: node write-en-files.js');
    throw new Error(`payload: unknown payload dialect — expected a "${TAG} " prefix. Re-render: node write-en-files.js`);
  }
  let i = TAG.length + 1;
  const axis = text[i];
  if (axis !== "n" && axis !== "w") throw new Error(`payload: axis must be "n" or "w", got ${JSON.stringify(axis)}`);
  i++;
  let digits = "";
  while (i < text.length && text[i] >= "0" && text[i] <= "9") { digits += text[i]; i++; }
  if (!digits) throw new Error("payload: generator payload carries no word id");
  const w = Number(digits);
  const h = [];
  if (i < text.length) {
    if (text[i] !== H_MARK) throw new Error(`payload: expected ${H_MARK} at offset ${i}, got ${JSON.stringify(text[i])}`);
    // Escaping guarantees no hole body contains H_MARK, so splitting on it is exact, not heuristic.
    for (const part of text.slice(i + 1).split(H_MARK)) h.push(unescapeHole(part));
  }
  return { d: "lzw", a: axis, w, h };
}

module.exports = { TAG, encode, decode, escapeHole, unescapeHole };
