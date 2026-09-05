"use strict";
/* en-symbol-ceiling.test.js — the distance to Amir's target, as a gate that can only ratchet DOWN.
 *
 * Amir, 2026-09-04: "No glyphs or typescript ANYWHERE in the .en files". Not the end-to-end scope,
 * not a sample -- every rendered file. This test is the number he gets to watch move.
 *
 * THE CEILINGS ONLY EVER COME DOWN. Raising one, widening what counts as a symbol, or adding a file
 * to an exemption list are all the same move: making the check agree with the artifact instead of
 * the other way round. If a slice of work makes a count go UP, that is the finding, and it gets
 * reported rather than absorbed. (This already happened once tonight, in cd10282, where the symbol
 * floor in plain-english.js was widened to admit a colon so a fixture of mine would pass. Reverted.)
 *
 * THE BASELINE, measured 2026-09-04 over all 1037 rendered files:
 *
 *     files scanned                                1037
 *     files with neither a glyph nor TypeScript       2      <- and see below, this 2 is hollow
 *     dialect glyph characters                   261218
 *     lines carrying a TypeScript character       85383  of 109728 non-empty
 *     lines carrying no glyph at all              50054
 *
 * THE 2 CLEAN FILES ARE EMPTY FILES. src/hydra-api/chatbot/chatbot.ts.en is nine bytes of blank
 * lines and src/rentsync-api/invoicing/freshbooks/index.ts.en is one byte. They are clean because
 * they hold nothing, so the honest count of files that are clean AND say something is ZERO. Both
 * numbers are asserted below, because a "clean files" figure that counts empty files would let a
 * deletion read as progress.
 *
 * TWO FIGURES I HAD REPORTED EARLIER TONIGHT WERE WRONG, and this file is where they are corrected:
 *   - "50,054 of 124,499 NON-EMPTY lines". 124,499 is the count of ALL lines, blanks included; the
 *     non-empty count is 109,728. My own script incremented the total on every line and the label
 *     said non-empty. The 50,054 itself re-derives exactly.
 *   - "50,054 lines of raw TypeScript". That is the count of lines carrying NO GLYPH, which is not
 *     the same thing and understates it: on the definition the grammar actually uses, 85,383 lines
 *     carry a TypeScript character -- back-ticked names inside a sentence and hole values on a
 *     chunk's own line are TypeScript too, and none of them have a glyph on their line.
 *
 * WHAT THE TWO NUMBERS MEAN, because they do not have the same fix. Glyphs are the parser: they go
 * when an English parse can find a sentence's end without them. TypeScript lines are mostly source
 * copied through verbatim because no production covers that construct -- territory the language does
 * not cover yet, and delimiter work does not touch a single one of them. */
const assert = require("assert");
const path = require("path");
const { scanTree } = require("../scan-en-symbols");
const CR = require("../engine/corpus-root");

/* Measured 2026-09-04. DOWN ONLY. */
const GLYPH_CEILING = 261218;
const TS_LINE_CEILING = 85383;
const CLEAN_FLOOR = 2;              // files with neither -- may only go UP
const CLEAN_NONEMPTY_FLOOR = 0;     // ...of which say anything at all -- may only go UP

const root = path.join(CR.corpusRoot(), "sen", "files");
const r = scanTree(root);
const cleanNonEmpty = r.perFile.filter((f) => f.clean && f.lines > 0).length;

const R = require("./test-report").report(__filename);
const { ok, count } = R;

count(`${r.files} rendered files were scanned. They carry ${r.glyphChars} dialect marks in all, and `
  + `${r.tsLines} of their ${r.nonEmptyLines} non-empty lines carry a TypeScript character.`);
count(`${r.clean} of the ${r.files} files carry neither, and ${cleanNonEmpty} of those ${cleanNonEmpty === 1 ? "file says" : "files say"} anything at all.`);

ok("the rendered English carries no more dialect marks than it did when the ceiling was last lowered", () => {
  assert.ok(r.glyphChars <= GLYPH_CEILING,
    `the count of dialect marks rose to ${r.glyphChars}, above the ceiling of ${GLYPH_CEILING}. `
    + `The ceiling never rises, so find what put ${r.glyphChars - GLYPH_CEILING} more of them in.`);
  if (r.glyphChars < GLYPH_CEILING)
    count(`There are ${GLYPH_CEILING - r.glyphChars} fewer dialect marks than the ceiling allows, so the ceiling should come down to ${r.glyphChars}.`);
});

ok("no more lines carry TypeScript than they did when the ceiling was last lowered", () => {
  assert.ok(r.tsLines <= TS_LINE_CEILING,
    `the count of lines carrying TypeScript rose to ${r.tsLines}, above the ceiling of ${TS_LINE_CEILING}. The ceiling never rises.`);
  if (r.tsLines < TS_LINE_CEILING)
    count(`There are ${TS_LINE_CEILING - r.tsLines} fewer lines carrying TypeScript than the ceiling allows, so the ceiling should come down to ${r.tsLines}.`);
});

ok("no file that was already free of glyphs and TypeScript has stopped being so", () => {
  assert.ok(r.clean >= CLEAN_FLOOR,
    `the count of clean files fell to ${r.clean} from ${CLEAN_FLOOR}. A file that was clean and no longer is, is a regression.`);
  if (r.clean > CLEAN_FLOOR) count(`${r.clean} files are now clean, so the floor should rise to ${r.clean}.`);
});

/* The honest half of the clean count, kept separate so a DELETION cannot read as progress. */
ok("the count of files that are clean AND actually say something has not fallen, so a deletion cannot read as progress", () => {
  assert.ok(cleanNonEmpty >= CLEAN_NONEMPTY_FLOOR,
    `the count of files that are clean and say something fell to ${cleanNonEmpty} from ${CLEAN_NONEMPTY_FLOOR}.`);
  if (cleanNonEmpty > CLEAN_NONEMPTY_FLOOR)
    count(`${cleanNonEmpty} files are now clean and say something, so that floor should rise to ${cleanNonEmpty}.`);
});

/* The gate must be able to see a symbol at all -- a scanner that reported zero for everything would
 * satisfy all four assertions above. */
ok("the scanner can still see a symbol when there is one, so the four counts above are not all zero by accident", () => {
  const PE = require("./plain-english");
  const M = require("./enfile").MARKS;
  /* Built from the engine's own marks rather than spelled here, so this control cannot drift from
   * the dialect and no dialect character appears in this file. */
  const aRenderedLine = M.chunkOpen + M.atomicChunk + " set `x` to 1 " + M.payloadOpen + "lzw1 n1" + M.payloadClose + M.chunkClose;
  const s = PE.scanSymbols(aRenderedLine);
  assert.ok(s.glyphChars > 0 && s.tsChars > 0,
    `the scanner reported ${s.glyphChars} dialect marks and ${s.tsChars} TypeScript characters on a line that carries both`);
});

R.done("the distance between the rendered English and carrying no marks and no TypeScript at all");
