"use strict";
/* label-source.js — compile a chunk FROM ITS LABEL, with the payload ignored entirely.
 *
 * Amir, 2026-09-04: "So make the label get read  by the compiler then?"
 *
 * WHAT THIS CHANGES, stated precisely so nobody reads it as more than it is. `enfile.compileChunk`
 * locates the payload with `lastIndexOf(PAY_OPEN)` and generates from it; it reads the label only
 * inside the R-REND-6 derive check, as a COMPARISON, and `repairFromSentence` only as a repair when
 * the sentence names the values. So today the label is VALIDATED and never USED. This module is the
 * other arrangement: the label is the source, and the payload is not consulted at all -- not
 * consulted-and-agreed, not consulted-and-overruled. Not consulted.
 *
 * IT DOES NOT TOUCH `enfile.js`. It is a separate front door, exercised by one test over one
 * construct. Nothing in the existing compile path changes, no check is weakened, and
 * `SDD_DERIVE_CHECK` is untouched. If the label ever becomes the corpus-wide source, that is a
 * different change with its own byte-identity measurement; this one is a probe with a scope.
 *
 * WHAT A DEAD PAYLOAD WOULD ACTUALLY BUY, measured over all 1037 rendered files rather than
 * assumed: 182,355 of the 261,218 dialect marks sit inside a payload region, and 78,863 do not.
 * So retiring the payload removes 69.8% of the marks and leaves the chunk delimiters standing.
 * It is most of the glyph problem and it is not all of it, and this file says so rather than
 * letting a later reader infer that the job finished here.
 *
 * THE RULE THAT FALLS OUT, and it is the interesting half. If the compiler generates FROM the
 * label, a label that names no values cannot be compiled at all. "1 shape" stops being a poor
 * gloss and becomes an ERROR. That inverts the quality bar into a correctness rule: every label
 * must name its values or the compile fails, loudly, saying what it failed to say. */
const EN = require("./enfile");
const M = EN.MARKS;

class VacuousLabelError extends Error {
  constructor(label, whatItFailedToSay) {
    super(`this label names no value, so there is nothing to compile from it: "${label}"\n`
      + `  ${whatItFailedToSay}`);
    this.name = "VacuousLabelError";
    this.label = label;
  }
}

/* A label quotes the names and literals it carries in back-ticks -- that is the renderer's own
 * convention (`genLabel`), not one invented here. So "the values this label names" is exactly
 * "what is inside the back-ticks", and a label with none names nothing. */
const quoted = (label) => [...label.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/* A VALUE IS NOT ALWAYS BACK-TICKED, and assuming it was is what made the conditional construct
 * read as vacuous on the first run. `«▶ return true ⟪lzw1 n413⟫»` carries a payload with NO HOLES
 * at all -- the word id alone -- and its label names the value in plain English, unquoted, because
 * `true` is a keyword and not an identifier. The repo already draws exactly this line:
 * `plain-english.js:126` -- "a whole number and the two booleans are written as themselves;
 * anything else is a name". So this is that same rule read across, not a widening invented here to
 * make a case pass: a label naming `true` names a value, and "9 re-exports" still names none. */
const BARE = /^(?:true|false|\d+)$/;
const namesAValue = (label) => quoted(label).length > 0 || BARE.test(String(label).trim().replace(/^return /, ""));

/** a whole number and the two booleans are written as themselves; anything else is a name */
const literal = (w) => w;

/* THE GRAMMAR, deliberately one form wide. This probe covers the construct it was written for and
 * refuses everything else BY NAME, rather than falling through to a guess. A grammar that quietly
 * accepts what it does not understand is the failure this whole effort exists to remove. */
function compileFromLabel(label) {
  const s = String(label).trim();
  const values = quoted(s);
  let m;
  if ((m = s.match(/^return `([^`]*)`$/))) return "return " + literal(m[1]) + ";";
  /* the two booleans and a bare whole number, written as themselves -- plain-english.js:126 */
  if ((m = s.match(/^return (true|false|\d+)$/))) return "return " + m[1] + ";";
  /* A THROWN STRING IS WHERE THE LABEL PROVABLY LOSES A BYTE, and it refuses rather than guessing.
   * The renderer sets a thrown message in curly quotes, which say nothing about which quote
   * character the source used. Measured, not assumed: word 7 is `throw new Error(<args>);`, so the
   * quote lives in the HOLE, and decoding this construct's payload gives
   * h: ["\'bit must be either 0 or 1\'"] -- single quotes, carried by the payload. Corpus-wide the
   * split is 4916 single to 189 double, so hardcoding the majority would compile this file and
   * silently corrupt 189 others. That is the guess this refusal exists to prevent. */
  if ((m = s.match(/^throw \u201c(.*)\u201d$/)))
    throw new Error("label-source: this label names the thrown message but not which quote character "
      + "the source wrote it with -- the renderer sets it in curly quotes either way. The payload "
      + "carries that byte and the label does not, so the label alone cannot reproduce this "
      + "construct. Refusing rather than picking the majority quote style.");
  if (!namesAValue(s))
    throw new VacuousLabelError(s, "A label is compilable only when it names the values it carries, "
      + "which the renderer writes inside back-ticks. This one carries none, so no value can be recovered from it.");
  throw new Error(`label-source: no rule in this grammar matches the label "${s}". `
    + `It names ${values.length} value(s), so it is not vacuous -- the grammar is simply too narrow for it, `
    + `and it refuses rather than guessing.`);
}

/* Compile a whole .en chunk tree. Structural chunks contribute their BODY, which is ordinary .en
 * text -- verbatim TypeScript with nested chunks in it -- so byte-exactness for those is inherited
 * from the children, exactly as `enfile` does it. Atomic chunks contribute `compileFromLabel` of
 * their label, and their payload is stepped over without being decoded. */
function compileConstruct(en) {
  let out = "", i = 0;
  while (i < en.length) {
    const open = en.indexOf(M.chunkOpen, i);
    if (open < 0) { out += EN.unescapeVerbatim(en.slice(i)); break; }
    out += EN.unescapeVerbatim(en.slice(i, open));
    const close = matchClose(en, open);
    if (close < 0) throw new Error("label-source: unbalanced chunk (no matching close)");
    out += compileChunkFromLabel(en.slice(open + 1, close));
    i = close + 1;
  }
  return out;
}

function matchClose(en, open) {
  let depth = 0;
  for (let k = open; k < en.length; k++) {
    if (en[k] === M.chunkOpen) depth++;
    else if (en[k] === M.chunkClose) { depth--; if (depth === 0) return k; }
  }
  return -1;
}

function compileChunkFromLabel(chunk) {
  if (chunk[0] === M.structuralChunk) {
    const split = EN.splitStructural(chunk);
    if (!split) throw new Error("label-source: malformed structural chunk (no body)");
    /* A structural chunk with a payload of its own is an INTERIOR PRODUCTION: its bytes are the
     * scaffolding that payload generates, with the body spliced into a hole. This probe cannot
     * produce those from the heading, and says so by name instead of emitting the body and
     * calling the difference a rounding error. */
    if (split.payload !== null)
      throw new Error("label-source: this structural chunk carries a payload of its own, so its bytes are "
        + "generated by that payload and not by its body. Compiling it from the heading alone is not "
        + "something this probe can do, and it refuses rather than emitting the body and hoping.");
    return compileConstruct(chunk.slice(split.bodyStart, split.bodyEnd));
  }
  if (chunk[0] === M.atomicChunk) {
    /* THE WHOLE POINT: the label region is taken and the payload region is NOT read. The payload
     * is located only to know where the label ends -- its contents are never decoded. */
    const a = chunk.lastIndexOf(M.payloadOpen);
    const label = (a < 0 ? chunk.slice(1) : chunk.slice(1, a)).trim();
    return compileFromLabel(label);
  }
  throw new Error("label-source: this probe compiles structural and atomic chunks only");
}

/** name the first byte two strings differ at, in words, so an equal-length mismatch still says something */
function whyTheyDiffer(got, want, what) {
  if (got === want) return `the compiled ${what} is byte-identical`;
  if (got.length !== want.length)
    return `the ${what} compiled from its labels is ${got.length} bytes where the corpus one is ${want.length}`;
  const at = [...want].findIndex((c, i) => c !== got[i]);
  return `both are ${want.length} bytes, but they first differ at byte ${at}, where the ${what} compiled `
    + `from its labels has ${JSON.stringify(got[at])} and the corpus one has ${JSON.stringify(want[at])}`;
}

module.exports = { compileFromLabel, compileConstruct, whyTheyDiffer, VacuousLabelError };
