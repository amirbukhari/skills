"use strict";
/**
 * en-prose.js — ONE definition of "the prose surface of an .en", shared by every standard test.
 *
 * WHY A MODULE AND NOT A HELPER COPIED INTO EACH TEST. The tests in this suite all ask a version of
 * "what does a human actually read here", and if each one answered it slightly differently the
 * suite would drift against itself — the §8B producer/consumer shape, one level in, in the very
 * files whose job is to catch it. So the answer is defined once.
 *
 * WHAT COUNTS AS THE READER'S SURFACE, and why payloads are excluded:
 *   - `⟪ … ⟫` PAYLOADS ARE STRIPPED. §5C item 2: the payload is "a DERIVED INDEX, not the source of
 *     truth ... a cache of what the sentence says". It is verbatim TypeScript by construction and
 *     always will be, so scanning it for TypeScript would make every standard unreachable BY DESIGN
 *     rather than by defect — a test that cannot pass measures nothing.
 *   - EVERYTHING ELSE STAYS, including source the renderer never claimed. That residue is not an
 *     artifact of the format; it is a statement the engine had nothing to say about, sitting in the
 *     file where the reader will hit it. It is most of the gap these tests exist to measure.
 */

const OPEN = "«", CLOSE = "»", GEN = "▶", GEN_NEST = "▷";
const PAY_OPEN = "⟪", PAY_CLOSE = "⟫", BODY_OPEN = "⟨", BODY_CLOSE = "⟩";

/* Remove `⟪ … ⟫` regions. Depth-counted rather than regex'd: a payload's interior is raw source and
 * may itself contain `⟨`/`⟩`, so a non-greedy match would end one at the wrong byte. */
function stripPayloads(en) {
  let out = "", depth = 0;
  for (const ch of en) {
    if (ch === PAY_OPEN) { depth++; continue; }
    if (ch === PAY_CLOSE) { depth--; continue; }
    if (depth <= 0) out += ch;
  }
  return out;
}

/* The text a reader sees: payloads gone, chunk delimiters gone, escaped guillemets restored. */
function readable(en, unescape) {
  const s = stripPayloads(en);
  return (unescape ? unescape(s) : s).replace(/[«»▶▷⟨⟩]/g, "");
}

/* Every emitted label region in order — one per chunk, atomic or structural. A label runs from the
 * chunk marker to whichever comes first: its body `⟨`, its payload (already stripped, so the chunk
 * `»`), or the next chunk. */
function labelsOf(en) {
  const s = stripPayloads(en), out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== OPEN) continue;
    let j = i + 1;
    while (j < s.length && (s[j] === GEN || s[j] === GEN_NEST || s[j] === " ")) j++;
    let txt = "";
    while (j < s.length && s[j] !== BODY_OPEN && s[j] !== CLOSE && s[j] !== OPEN) { txt += s[j]; j++; }
    if (txt.trim()) out.push(txt.trim());
    i = j - 1;
  }
  return out;
}

/* Paragraphs, with internal whitespace normalised. The standards are written with hard wraps for
 * readability; pinning the wrap column would make these tests assert a formatter rather than a
 * rendering, so a different wrap is not a failure and a different WORD is. */
function paragraphs(s) {
  return String(s).trim().split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

module.exports = { stripPayloads, readable, labelsOf, paragraphs, OPEN, CLOSE, GEN, GEN_NEST };
