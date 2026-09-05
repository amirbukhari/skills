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
/** "a, b, c and d" -> ["a","b","c","d"] -- the English list form, not a delimiter split */
const moduleList = (prose) => prose.split(/,\s*|\s+and\s+/).map((w) => w.trim()).filter(Boolean);

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
  /* THE VACUOUS-LABEL CLASS, converted. "9 re-exports" COUNTS its values; this form NAMES them, and
   * naming them is what makes the construct generable from the label alone. 1,619 of the corpus's
   * 19,335 chunks (8.4%) carry a counting label today, so this is the shape of that whole class.
   *
   * THE QUOTE CLAUSE IS NOT DECORATION. Module-specifier quoting is a PER-SITE fact, measured over
   * the corpus: 6687 specifiers single, 1597 double, and 94 files use BOTH -- so it is not even a
   * per-file fact. The label therefore has to say which one, or the construct is not reproducible
   * from it. That is the same standard the thrown-string rule refuses under: a label that does not
   * carry a byte cannot claim to be the source of it. */
  if ((m = s.match(/^Re-export everything from (.+?), each a local module named in (single|double) quotes$/))) {
    const q = m[2] === "single" ? "'" : '"';
    return moduleList(m[1]).map((mod) => "export * from " + q + "./" + mod + q + ";").join("\n") + "\n";
  }
  if ((m = s.match(/^Re-export everything from (.+?), each a local module$/)))
    throw new Error("label-source: this label names the modules but not which quote character the "
      + "source wrote them with. Specifier quoting is a per-site fact in this corpus -- 6687 single, "
      + "1597 double, and 94 files use both -- so it cannot be inferred from the file or from the "
      + "majority. Say \"each a local module named in single quotes\", or double.");

  /* SHAPES. The corpus label for these names the six identifiers and nothing else, and that is not
   * enough to generate from -- measured against narrow word 5509, whose template owns `export
   * default` and owns every field TYPE while the holes carry only names and whitespace. So the
   * grammar cannot be widened into sufficiency here: the LABEL has to name the types. It also has
   * to name the indentation, which is a per-file fact in this corpus (196 tab-indented member lines
   * against 5534 space-indented, and NO file mixes them) with this construct in the minority --
   * guessing the majority would corrupt exactly this file. */
  if (/^describe the shape /.test(s)) {
    /* THE SEMANTIC OMISSION IS REPORTED BEFORE THE LAYOUT ONE. This label is missing BOTH the field
     * types and the indentation, and a compiler that complained about whitespace while a field type
     * was unknown would be pointing at the smaller hole. So the clauses are parsed and their types
     * demanded first; only then is the indentation required. */
    const ind = s.match(/, each member indented with (a tab|two spaces)$/);
    const body = ind ? s.slice(0, s.length - ind[0].length) : s;
    const clauses = body.split(/,?\s+then\s+/);
    const parsed = clauses.map((c) => {
      const m2 = c.trim().match(/^describe the shape `([^`]+)`(, exported by default)?,?\s+with\s+(.+)$/);
      if (!m2) throw new Error(`label-source: this is not a shape clause the grammar can read: "${c.trim()}"`);
      const fields = m2[3].split(/,?\s+and\s+/).map((f) => {
        const m3 = f.trim().match(/^`([^`]+)` which is an? (.+?)$/);
        if (!m3)
          throw new Error("label-source: this label names a field but never its type: \""
            + f.trim() + "\". A field type is carried by the generator template, not by the payload "
            + "holes, so a label that omits it cannot be the source of these bytes -- it would have "
            + "to guess between string and number. Write it as a name, the words which is a, and a type.");
        return { name: m3[1], type: m3[2].trim() };
      });
      return { shape: m2[1], isDefault: !!m2[2], fields };
    });
    if (!ind)
      throw new Error("label-source: this label describes shapes and names every field type, but does "
        + "not say how the members are indented. That is a per-file fact in this corpus -- 196 member "
        + "lines use a tab and 5534 use spaces, and no file mixes them -- so it cannot be inferred from "
        + "the majority without corrupting the minority. Say \"each member indented with a tab\", or "
        + "with two spaces.");
    const pad = ind[1] === "a tab" ? "\t" : "  ";
    return parsed.map((d) => "export " + (d.isDefault ? "default " : "") + "interface " + d.shape + " {\n"
      + d.fields.map((f) => pad + f.name + ": " + f.type).join("\n") + "\n}").join("\n\n");
  }

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
