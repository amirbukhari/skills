"use strict";
/* plain-english.js — a .en with NO SYMBOLS IN IT: plain English sentences on disk that compile to
 * TypeScript. Amir, 2026-09-04: "I don't want to see any typescript or symbols in any files", then,
 * scoping it: "End to end test no symbols in it".
 *
 * WHAT THIS IS NOT. It is not the corpus dialect and it does not replace it. The rendered corpus
 * under <CORPUS>/sen/files/**.ts.en is the `«▶ … ⟪lzw1 n14300⟨ … ⟫»` dialect, and today 50,054 of
 * its 124,499 non-empty lines are verbatim TypeScript with no glyph on them at all (counted across
 * all 1037 files, 2026-09-04). Nothing here changes any of that; the byte-identity gate is
 * untouched and still reads 1037/1037.
 *
 * WHAT IT IS. The smallest honest END of the loop Amir asked to see: a file a person can read with
 * no dialect at all, parsed by GRAMMAR rather than by scanning for glyphs, compiled to real
 * TypeScript. Deliberately tiny — three sentence forms, exactly what the two scoped corpus files
 * need. It is a demonstration of the target and the measuring stick for the distance to it, not a
 * general parser, and it must not be sold as one.
 *
 * THE GRAMMAR, in full:
 *
 *   Let <name> be the text <literal>.
 *       -> export const <name> = '<literal>';
 *       <literal> is the rest of the sentence before the final period, taken VERBATIM. That is the
 *       only way a string's exact bytes can survive prose: they are quoted by POSITION, not by a
 *       quote character, because a quote character is a symbol.
 *
 *   Bring in <name> from the local module <name>.
 *       -> import { <name> } from './<name>';
 *
 *   To <name>.
 *     Return <prop> from the result of <fn> if it is set, otherwise an empty list.
 *       -> export const <name> = () => {
 *            return <fn>()?.<prop> ?? [];
 *          };
 *       Dropping "if it is set, otherwise an empty list" is a DIFFERENT sentence and compiles to
 *       `return <fn>().<prop>;` — the English is load-bearing, not decoration.
 *
 * NAMES. English words, lowercase, separated by spaces; joined into camelCase. "use auth" is
 * `useAuth`, "required ui version" is `requiredUiVersion`. Reversible only because the convention
 * is fixed; a name whose TypeScript spelling is not camelCase of its English words CANNOT be
 * written in this grammar, and REFUSING is the correct behaviour, not a gap to paper over.
 *
 * TWO STYLE FACTS THE ENGLISH DOES NOT CARRY, and they are the whole layout question in miniature.
 * Prose says nothing about which quote character or whether a trailing semicolon follows a closing
 * brace, so this emitter takes both from a MEASUREMENT of the corpus rather than from taste
 * (counted 2026-09-04 over src/, packages/, tests/):
 *
 *     import quote     '  4916 files-worth of lines   "  189
 *     top-level close  };  1855 lines                 }   1040
 *
 * So: single quotes, and `};`. A file written in the minority style therefore does NOT round-trip
 * byte-identically through this grammar, and engine/e2e-plain-english.test.js pins exactly that on
 * a real file with the exact differing bytes named. That is the honest state, and it is Amir's
 * decision to make, not something to tune away by hardcoding one file's style. */

class PlainEnglishError extends Error {
  constructor(message, sentence) { super(message + (sentence ? "\n  sentence: " + sentence : "")); this.name = "PlainEnglishError"; this.sentence = sentence || null; }
}

/* THE SYMBOL FLOOR. A plain-English file may hold letters, digits, spaces, newlines, and the three
 * marks ordinary prose uses: comma, period and hyphen. Everything else is a symbol, and that includes
 *
 * THE COLON IS NOT ALLOWED, and the first version of this file allowed it. The block header read
 * "To use permissions:" and the colon tripped the floor, so the floor was widened to let it
 * through -- which is the one move that is never available: widening the check until the artifact
 * passes it. Reverted. The colon turned out to be INCIDENTAL rather than load-bearing: the
 * INDENTATION already says where the block is, so the header is an ordinary sentence ending in a
 * period, and nothing is lost. Recorded because the wrong instinct was the fast one.
 *
 * The apostrophe is not allowed either -- it is a quote character. This also includes
 * every glyph of the corpus dialect and every character TypeScript needs. Stated as an ALLOW list,
 * because a deny list of "the glyphs I remembered" is exactly the guard that cannot fire. */
const ALLOWED = /^[A-Za-z0-9 \n,.\-]*$/;
const GLYPHS = /[«»⟪⟫⟨⟩⟦⟧▶▷]/g;
/* Characters that are TypeScript, not prose. Used for REPORTING, so a violation says which kind it
 * is; the ALLOW list above is what actually decides. */
const TS_CHARS = /[{}()\[\];:=<>`'"$*+/\\|&!?@#%^~]/g;

/** scan TEXT (read from a file, never from a renderer) and report every symbol in it */
function scanSymbols(text) {
  const glyphs = text.match(GLYPHS) || [];
  const tsChars = text.match(TS_CHARS) || [];
  const other = [];
  for (const ch of text) if (!ALLOWED.test(ch)) { if (!GLYPHS.test(ch) && !TS_CHARS.test(ch)) other.push(ch); GLYPHS.lastIndex = 0; TS_CHARS.lastIndex = 0; }
  const lines = text.split("\n");
  const tsLines = lines.filter((l) => l.trim() && TS_CHARS.test(l));
  TS_CHARS.lastIndex = 0;
  return {
    clean: glyphs.length === 0 && tsChars.length === 0 && other.length === 0,
    glyphChars: glyphs.length, tsChars: tsChars.length, otherChars: other.length,
    tsLines: tsLines.length, totalLines: lines.filter((l) => l.trim()).length,
    sample: { glyphs: [...new Set(glyphs)].join(""), ts: [...new Set(tsChars)].join(""), other: [...new Set(other)].join("") },
  };
}

const camel = (words) => words.trim().split(/\s+/)
  .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join("");

const QUOTE = "'";          // measured majority, see the header
const CLOSE = "};";         // measured majority, see the header

/** compile a symbol-free English file to TypeScript. Throws PlainEnglishError on anything it cannot
 *  account for — an unparsed sentence is never emitted as a comment or dropped. */
function compilePlainEnglish(text) {
  const scan = scanSymbols(text);
  if (!scan.clean)
    throw new PlainEnglishError("this file is not symbol-free: " + scan.glyphChars + " dialect glyph(s), "
      + scan.tsChars + " TypeScript character(s), " + scan.otherChars + " other — [" + scan.sample.glyphs
      + scan.sample.ts + scan.sample.other + "]");

  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim()) { if (out.length) out.push(""); i++; continue; }
    if (/^\s/.test(raw)) throw new PlainEnglishError("an indented sentence with no block above it", raw.trim());
    const s = raw.trim();
    let m;

    if ((m = s.match(/^Let (.+?) be the text (.+)\.$/))) {
      out.push("export const " + camel(m[1]) + " = " + QUOTE + m[2] + QUOTE + ";");
      i++; continue;
    }
    if ((m = s.match(/^Bring in (.+?) from the local module (.+)\.$/))) {
      out.push("import { " + camel(m[1]) + " } from " + QUOTE + "./" + camel(m[2]) + QUOTE + ";");
      i++; continue;
    }
    if ((m = s.match(/^To (.+)\.$/))) {
      const fnName = camel(m[1]);
      const body = [];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) { body.push(lines[i].trim()); i++; }
      if (!body.length) throw new PlainEnglishError("a block with no sentences in it", s);
      out.push("export const " + fnName + " = () => {");
      for (const b of body) out.push("  " + compileClause(b));
      out.push(CLOSE);
      continue;
    }
    throw new PlainEnglishError("no rule in the grammar matches this sentence", s);
  }
  /* A BLANK LINE BETWEEN SENTENCES IS A BLANK LINE IN THE OUTPUT, but the newline that ends the
   * last sentence is not one -- it is how a text file ends. Emitting it as a paragraph break put a
   * second "\n" on every file and was the first RED this grammar produced:
   *     got:  "export const requiredUiVersion = '0.1.0';\n\n"
   *     want: "export const requiredUiVersion = '0.1.0';\n" */
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

function compileClause(s) {
  let m;
  if ((m = s.match(/^Return (.+?) from the result of (.+?) if it is set, otherwise an empty list\.$/)))
    return "return " + camel(m[2]) + "()?." + camel(m[1]) + " ?? [];";
  if ((m = s.match(/^Return (.+?) from the result of (.+?)\.$/)))
    return "return " + camel(m[2]) + "()." + camel(m[1]) + ";";
  throw new PlainEnglishError("no rule in the grammar matches this clause", s);
}

module.exports = { compilePlainEnglish, scanSymbols, PlainEnglishError };
