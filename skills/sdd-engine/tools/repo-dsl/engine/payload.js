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
/* THE CHILD MARK. `lzw1 n842c0,3⟨…` says holes 0 and 3 are child slots: their bytes are produced by
 * an interior compile, not carried here. It sits between the word id and the first hole because the
 * word id is digits and `c` is not, so the existing digit scan terminates on it unchanged and every
 * payload written before this mark existed decodes byte-for-byte identically (next char is ⟨ or EOF).
 *
 * Indices are STRICTLY INCREASING, which is a canonicalisation and not decoration: it makes
 * encode(decode(x)) === x, so a payload has exactly one spelling and a diff over the corpus means a
 * real change rather than a reordering. Anything else is refused. */
const C_MARK = "c";

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
  /* The DATA hole wrapper, same reasoning: a raw hole that happened to be `⟦…⟧` would otherwise
   * decode through `compileData` and produce wrong bytes. Absent from the .ts corpus (measured 0)
   * and used as a sentinel nowhere in the engine, so it is free — and escaping it here is what
   * makes that a guarantee instead of a fact about today's corpus. */
  ["⟦", "a"], ["⟧", "b"],
];
const ENC_MAP = new Map(ESCAPES.map(([ch, d]) => [ch, ESC + d]));
const DEC_MAP = new Map(ESCAPES.map(([ch, d]) => [d, ch]));
const NEEDS_ESC = /[⟡⟨⟩⟪⟫«»▶“”⟦⟧]/g;

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
 * It is TYPELESS ON PURPOSE — the WRAPPER selects the rule, never the hole's declared type. A hole's
 * type IS recoverable (`expandKey(axis, w)` yields the template and its `‹type›` markers pair
 * positionally with `h` — measured 150,313 of 150,313, 0 unknown ids, 0 arity mismatches). But
 * needing it in `decode` would make decode depend on the CATALOG, and then a file rendered with a
 * catalog and compiled without one produces wrong bytes. Every question these rules ask is decidable
 * from the hole text alone, so encode and decode cannot desync.
 *
 * A consequence worth having: a typeless rule catches holes of EVERY type. The string rule fires on
 * 7,209 `str` holes and 1,121 `args` holes — a rule aimed at `str` would have missed 13% of its own
 * reach.
 *
 * DEPENDENCIES, stated because an earlier version of this header claimed there were none. This file
 * now requires `data-english.js` and, through it, `typescript` — the object/array rule needs a parse
 * to know a hole is EXACTLY one data literal, and `compileData` is the inverse. Both are pure text
 * functions with no catalog, so the symmetry argument above still holds; the self-containment claim
 * does not, and is withdrawn rather than quietly left standing.
 *
 * WHAT IT IS WORTH, measured on the stripped page rather than projected per type. Re-encoding all
 * 9,724 corpus payloads (4,270 change, 0 throw) moves `the-goal.test.js` from 138,387 to 112,205:
 *
 *   straight-quote-string  28,911 -> 14,251   -14,660
 *   brace-block            47,913 -> 38,783    -9,130
 *   bracket                14,481 -> 12,089    -2,392
 *   NET                                       -26,182   (-18.9%)
 *
 * TWO HONEST NOTES ON THAT NUMBER. It is BIGGER than the per-type projection (8,321 + 9,167 =
 * 17,488) because rendering an object also converts the string literals NESTED INSIDE it, which
 * neither per-type projection counted — a projected reduction and a measured one are two different
 * properties and the projection is the one that gets quoted. And DIRTY FILES GO 1035 -> 1035: not a
 * single file comes clean. -18.9% is a first cut, not a fix.
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
 *
 * Likewise 16.7% of `obj`/`arr` holes are left raw — `renderData` returns null for anything that is
 * not wholly data, and a hole that is a FRAGMENT beginning with a literal (`'{a:1} , x'` parses) is
 * rejected by a position check rather than rendered. Both refusals are visible in the goal number,
 * which is where they belong: §5C's honesty rule says an honest residue beats a cooked reduction.
 */
const DE = require("./data-english");
const ts = require("typescript");

/* THE RULE TABLE. Each rule is a WRAPPER PAIR plus a total inverse pair over the wrapper's inner
 * text. Adding a rule is additive and cannot affect the others, because the wrapper — not a prefix,
 * not a guess about content — is what selects it, and every wrapper is in the escape table above.
 *
 * `to(raw)`   -> inner text, or null if the rule does not apply to this hole
 * `from(inner)` -> raw source bytes, or null if the inner text is not well-formed for this rule
 *
 * Neither direction is trusted: `encode` verifies `from(to(raw)) === raw` per hole before using it.
 */
const RULES = [
  {
    name: "single-quoted string",
    open: "“", close: "”",
    /* No backslash and no newline inside: an escape sequence's meaning is quote-dependent, so
     * `'a\'b'` has no faithful `“ ”` form and is left raw rather than approximated. */
    to: (raw) => { const m = /^'([^'\\\n]*)'$/.exec(raw); return m === null ? null : m[1]; },
    from: (inner) => "'" + inner + "'",
  },
  {
    name: "object / array literal",
    open: "⟦", close: "⟧",
    to: (raw) => {
      /* The hole must be EXACTLY one data literal — not a fragment that merely starts with one.
       * The position check is what enforces that; `'{a:1} , x'` parses but does not qualify. */
      const pre = "const _ = ";
      const sf = ts.createSourceFile("h.ts", pre + raw + ";", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      if (sf.parseDiagnostics && sf.parseDiagnostics.length) return null;
      const d = sf.statements[0] && sf.statements[0].declarationList
        && sf.statements[0].declarationList.declarations[0];
      const e = d && d.initializer;
      /* A CALL JOINS THIS RULE RATHER THAN GETTING A WRAPPER OF ITS OWN. The wrapper selects the
       * rule and the rule asks data-english what it can say; a fourth delimiter pair would add two
       * characters to the escape table and two more ways for a raw hole to impersonate a wrapper,
       * for no gain -- `⟦…⟧` already means "data-english wrote this", not "this is an object". */
      if (!e || (!ts.isObjectLiteralExpression(e) && !ts.isArrayLiteralExpression(e)
        && !ts.isCallExpression(e))) return null;
      if (e.getStart(sf) !== pre.length || e.getEnd() !== pre.length + raw.length) return null;
      let en = null;
      try { en = DE.renderData(e, sf); } catch (_) { return null; }
      if (en === null) return null;
      /* REFUSED RATHER THAN ESCAPED. `renderData` writes a nested template literal as `“…”`, which
       * is the other rule's wrapper. Escaping it would work but would put `⟡8`/`⟡9` pairs on Amir's
       * page, and unreadable-but-correct is not what this exercise is for. A data hole carrying a
       * template falls back to raw instead, and pays for it in the goal number where it shows. */
      return /[“”⟦⟧]/.test(en) ? null : en;
    },
    from: (inner) => { try { return DE.compileData(inner); } catch (_) { return null; } },
  },
];

/* raw hole -> ESCAPED payload text for that hole. Returns null when no rule applies or the
 * round-trip is not exact, in which case `encode` falls back to the raw escaped form. */
function encodeHoleEnglish(raw) {
  for (const r of RULES) {
    let inner;
    try { inner = r.to(raw); } catch (_) { continue; }
    if (inner === null || inner === undefined) continue;
    const escaped = r.open + escapeHole(inner) + r.close;
    /* THE GATE. Inline, and on the ESCAPED form, so what is verified is exactly what is written. */
    if (decodeHoleEnglish(escaped) === raw) return escaped;
  }
  return null;
}

/* ESCAPED payload text -> raw hole, or null if this hole is not English-encoded.
 * Runs BEFORE `unescapeHole`: a raw hole's own `“ ” ⟦ ⟧` arrive here as escape pairs and so cannot
 * impersonate a wrapper. This is the whole reason those four characters are in the escape table. */
function decodeHoleEnglish(escaped) {
  for (const r of RULES) {
    if (escaped.length < 2 || escaped[0] !== r.open || escaped[escaped.length - 1] !== r.close) continue;
    let inner;
    try { inner = unescapeHole(escaped.slice(1, -1)); } catch (_) { return null; }
    let raw;
    try { raw = r.from(inner); } catch (_) { return null; }
    return raw === null || raw === undefined ? null : raw;
  }
  return null;
}

/* obj: { d:"lzw", a:"n"|"w", w:<int>, h:[string,...] } -> payload text */
function encode(obj) {
  if (obj.d !== undefined && obj.d !== "lzw") throw new Error(`payload: refusing to encode dialect ${JSON.stringify(obj.d)}`);
  const axis = obj.a;
  if (axis !== "n" && axis !== "w") throw new Error(`payload: axis must be "n" or "w", got ${JSON.stringify(axis)}`);
  if (!Number.isInteger(obj.w) || obj.w < 0) throw new Error(`payload: word id must be a non-negative integer, got ${JSON.stringify(obj.w)}`);
  const holes = obj.h || [];
  let out = TAG + " " + axis + obj.w;
  if (obj.c !== undefined && obj.c !== null) {
    if (!Array.isArray(obj.c)) throw new Error(`payload: child slots must be an array, got ${typeof obj.c}`);
    if (obj.c.length) {
      let prev = -1;
      for (const i of obj.c) {
        if (!Number.isInteger(i) || i < 0) throw new Error(`payload: child slot must be a non-negative integer, got ${JSON.stringify(i)}`);
        if (i >= holes.length) throw new Error(`payload: child slot ${i} is not a hole index (${holes.length} hole(s))`);
        if (i <= prev) throw new Error(`payload: child slots must be strictly increasing, got ${JSON.stringify(obj.c)}`);
        prev = i;
      }
      out += C_MARK + obj.c.join(",");
    }
  }
  for (const h of holes) {
    if (typeof h !== "string") throw new Error(`payload: hole must be a string, got ${typeof h}`);
    const en = encodeHoleEnglish(h);
    out += H_MARK + (en !== null ? en : escapeHole(h));
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
  const c = [];
  if (text[i] === C_MARK) {
    i++;
    let field = "";
    while (i < text.length && text[i] !== H_MARK) { field += text[i]; i++; }
    if (!field) throw new Error(`payload: "${C_MARK}" child mark with no slot indices after it`);
    let prev = -1;
    for (const part of field.split(",")) {
      if (!/^[0-9]+$/.test(part)) throw new Error(`payload: child slot ${JSON.stringify(part)} is not a non-negative integer`);
      const n = Number(part);
      if (n <= prev) throw new Error(`payload: child slots must be strictly increasing, got ${JSON.stringify(field)}`);
      prev = n; c.push(n);
    }
  }
  const h = [];
  if (i < text.length) {
    if (text[i] !== H_MARK) throw new Error(`payload: expected ${H_MARK} at offset ${i}, got ${JSON.stringify(text[i])}`);
    // Escaping guarantees no hole body contains H_MARK, so splitting on it is exact, not heuristic.
    for (const part of text.slice(i + 1).split(H_MARK)) {
      /* Discriminate BEFORE unescaping — a raw curly quote arrives here as ⟡8/⟡9 and so cannot
       * impersonate a wrapper. Falls through to the raw path for every unencoded hole. */
      const en = decodeHoleEnglish(part);
      h.push(en !== null ? en : unescapeHole(part));
    }
  }
  /* Range-checked AFTER the holes are read, because until then there is nothing to check against.
   * A slot past the end is a corrupt payload, not a payload with an empty child. */
  for (const n of c)
    if (n >= h.length) throw new Error(`payload: child slot ${n} is not a hole index (${h.length} hole(s))`);
  return c.length ? { d: "lzw", a: axis, w, h, c } : { d: "lzw", a: axis, w, h };
}

module.exports = { TAG, C_MARK, encode, decode, escapeHole, unescapeHole, encodeHoleEnglish, decodeHoleEnglish, RULES };
