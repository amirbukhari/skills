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
  /* The dialect's own string quotes. These are NOT sentinels — nothing scanning the .en looks for
   * them — they are escaped so that the ENGLISH HOLE discriminator below can be structural rather
   * than lucky. A raw hole whose text happens to be `“x”` would otherwise decode to `'x'`: wrong
   * bytes, silently. Measured 0 occurrences across 150,313 corpus holes, which is exactly the kind
   * of luck this module's header says the dialect work removed. */
  ["“", "8"], ["”", "9"],
];
const ENC_MAP = new Map(ESCAPES.map(([ch, d]) => [ch, ESC + d]));
const DEC_MAP = new Map(ESCAPES.map(([ch, d]) => [d, ch]));
const NEEDS_ESC = /[⟡⟨⟩⟪⟫«»▶“”]/g;

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

/* =========================== ENGLISH-ENCODED HOLES (tier 1) ===========================
 *
 * WHY. A hole's text is RAW SOURCE, and holes are on the page Amir reads (§1). `engine/the-goal.test.js`
 * counts surviving TypeScript on that page and 74.4% of it sits inside `⟪…⟫` payloads, so a payload
 * carrying raw bytes is the single largest reason a rendered .en still reads as code. This is the
 * narrowest possible first cut at it: a hole whose ENTIRE text is a single-quoted string literal is
 * written in the dialect's own quotes instead.
 *
 *   raw       'invoice.id'          on the page as   'invoice.id'
 *   encoded   “invoice.id”          on the page as   “invoice.id”
 *
 * It is TYPELESS ON PURPOSE, and that is the whole reason the change is 40 lines rather than a
 * redesign. A hole's type IS recoverable — `expandKey(axis, w)` yields the template and its `‹type›`
 * markers pair positionally with `h` (measured: 150,313 of 150,313, 0 unknown ids, 0 arity
 * mismatches). But needing it here would make `decode` depend on the catalog, and then a file
 * rendered WITH a catalog and compiled WITHOUT one produces wrong bytes. "Is this text exactly a
 * single-quoted literal" is decidable from the text alone, so encode and decode stay symmetric and
 * this file keeps its only dependency: itself.
 *
 * A pleasant consequence of being typeless: it catches string-valued holes of EVERY type, not just
 * `str`. Measured 8,330 holes — 7,209 `str` and 1,121 `args` — which a type-directed rule aimed at
 * `str` would have missed by 13%.
 *
 * WHAT IT IS WORTH, honestly. Those holes carry 8,356 constructs; 35 survive the change, because a
 * `;` or `,` INSIDE the string is still a `;` or `,` on the page (`'en-US,en;q=0.9'`). True
 * reduction 8,321 of a 138,387 headline — 6.0%. It is a first cut, not a fix.
 *
 * BYTE-IDENTITY IS BY CONSTRUCTION, TWICE.
 *   1. The per-hole gate is INLINE in `encode`: the English form is used only if it decodes back to
 *      the exact raw bytes. A hole that fails falls back to raw ON ITS OWN, so the worst case is no
 *      improvement, never a wrong byte. Same construction as `dataByteExact` one level down.
 *   2. The discriminator runs on the ESCAPED hole text, BEFORE `unescapeHole`. So the wrapper quotes
 *      an encoder wrote are literal `“ ”` in that stream, while a raw hole's own curly quote is
 *      `⟡8`/`⟡9` and cannot be mistaken for a wrapper. Ambiguity is removed by the escape table
 *      rather than by an assumption about what the corpus contains.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Double-quoted (213) and backtick/template (480) string holes are
 * left raw: `'x'` and `"x"` would both render `“x”`, so the original quote character would not be
 * recoverable and byte-identity would fail. Encoding only the single-quoted form keeps the inversion
 * total. Widening this to guess the quote back is exactly the trade that produces wrong bytes.
 */
const Q_OPEN = "“", Q_CLOSE = "”";
/* No backslash and no newline inside: an escape sequence's meaning is quote-dependent, so `'a\'b'`
 * has no faithful `“ ”` form and is left raw rather than approximated. */
const SINGLE_QUOTED = /^'([^'\\\n]*)'$/;

/* raw source hole -> dialect text, or null if this hole is not a plain single-quoted literal. */
function toEnglishHole(raw) {
  if (raw.indexOf(Q_OPEN) !== -1 || raw.indexOf(Q_CLOSE) !== -1) return null;
  const m = SINGLE_QUOTED.exec(raw);
  return m === null ? null : Q_OPEN + m[1] + Q_CLOSE;
}

/* dialect text -> raw source hole, or null if this text is not an English-encoded hole.
 * Operates on ESCAPED text: see BYTE-IDENTITY note 2 above. */
function fromEnglishHole(escaped) {
  if (escaped.length < 2 || escaped[0] !== Q_OPEN || escaped[escaped.length - 1] !== Q_CLOSE) return null;
  return "'" + unescapeHole(escaped.slice(1, -1)) + "'";
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
    /* THE GATE, inline so it cannot be bypassed by a future caller: the dialect form is used only
     * if it inverts to the exact raw bytes. Note the escape asymmetry — the wrapper quotes stay
     * literal while the inner text is escaped, which is what `fromEnglishHole` relies on. */
    const en = toEnglishHole(h);
    if (en !== null) {
      const escaped = Q_OPEN + escapeHole(en.slice(1, -1)) + Q_CLOSE;
      if (fromEnglishHole(escaped) === h) { out += H_MARK + escaped; continue; }
    }
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
    for (const part of text.slice(i + 1).split(H_MARK)) {
      /* Discriminate BEFORE unescaping — a raw curly quote arrives here as ⟡8/⟡9 and so cannot
       * impersonate a wrapper. Falls through to the raw path for every unencoded hole. */
      const en = fromEnglishHole(part);
      h.push(en !== null ? en : unescapeHole(part));
    }
  }
  return { d: "lzw", a: axis, w, h };
}

module.exports = { TAG, encode, decode, escapeHole, unescapeHole, toEnglishHole, fromEnglishHole };
