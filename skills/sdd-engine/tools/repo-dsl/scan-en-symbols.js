#!/usr/bin/env node
"use strict";
/**
 * scan-en-symbols.js — how far the rendered corpus is from Amir's target, as a COUNT.
 *
 *   node scan-en-symbols.js [--json] [--worst=N]        (npm run scan:symbols)
 *
 * Amir, 2026-09-04: "No glyphs or typescript ANYWHERE in the .en files". This walks every rendered
 * `.en` under <CORPUS>/sen/files and reports what stands between the tree and that sentence. It
 * writes nothing.
 *
 * THREE COUNTS, AND THEY MEASURE DIFFERENT THINGS. Reporting one number here would hide the harder
 * half, because the two problems have different fixes:
 *
 *   GLYPH CHARACTERS   the dialect's own delimiters. They are the parser: they mark where a
 *                      sentence ends and a payload begins. They go when an English parse can find
 *                      those boundaries without them.
 *   TYPESCRIPT LINES   lines carrying a character only code uses. Most of these are not encoded at
 *                      all -- they are source copied through verbatim, because no production covers
 *                      that construct yet. This is TERRITORY THE LANGUAGE DOES NOT COVER, not a
 *                      rendering bug, and no amount of delimiter work touches it.
 *   CLEAN FILES        files with neither. This is the only number that can honestly be called
 *                      progress, and it is the one to watch.
 *
 * WHAT COUNTS AS A TYPESCRIPT CHARACTER is `plain-english.js`'s definition, not a second copy of
 * it: that module states the symbol floor as an ALLOW list (letters, digits, space, comma, period,
 * hyphen), and everything else is a symbol. One definition, so the scanner and the grammar cannot
 * drift into disagreeing about what "clean" means.
 *
 * A NOTE ON A COUNT THAT LOOKS LIKE THIS ONE BUT IS NOT. "lines carrying no glyph" is NOT the same
 * as "lines of raw TypeScript": a hole value that spans several lines puts its continuation lines
 * outside any glyph, and a blank line has no glyph either. Both counts are printed, separately and
 * named, because conflating them overstates the coverage gap. */
const fs = require("fs");
const path = require("path");
const CR = require("./engine/corpus-root");
const PE = require("./engine/plain-english");

const GLYPHS = /[«»⟪⟫⟨⟩⟦⟧▶▷]/g;

function scanTree(root) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".en")) files.push(abs);
    }
  })(root);
  files.sort();

  let glyphChars = 0, tsLines = 0, nonEmptyLines = 0, glyphlessLines = 0, clean = 0, bytes = 0;
  const perFile = [];
  for (const abs of files) {
    const text = fs.readFileSync(abs, "utf8");
    bytes += Buffer.byteLength(text);
    const g = (text.match(GLYPHS) || []).length;
    let ts = 0, ne = 0, gl = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      ne++;
      const s = PE.scanSymbols(line);
      if (s.tsChars > 0) ts++;
      if (s.glyphChars === 0) gl++;
    }
    glyphChars += g; tsLines += ts; nonEmptyLines += ne; glyphlessLines += gl;
    const isClean = g === 0 && ts === 0;
    if (isClean) clean++;
    perFile.push({ rel: path.relative(root, abs), glyphChars: g, tsLines: ts, lines: ne, clean: isClean });
  }
  return { files: files.length, bytes, glyphChars, tsLines, nonEmptyLines, glyphlessLines, clean, perFile };
}

function main(argv) {
  const root = path.join(CR.corpusRoot(), "sen", "files");
  if (!fs.existsSync(root)) { console.error("no rendered .en tree at " + root + " — run `npm run render` first"); return 2; }
  const r = scanTree(root);
  if (argv.includes("--json")) { console.log(JSON.stringify({ ...r, perFile: undefined }, null, 1)); return 0; }

  console.log(`\nHow far the rendered English is from "no glyphs or typescript ANYWHERE in the .en files":\n`);
  console.log(`  files scanned                                  ${r.files}`);
  console.log(`  files with neither a glyph nor TypeScript       ${r.clean}   <- the number to watch`);
  console.log(`  dialect glyph characters                       ${r.glyphChars}`);
  console.log(`  lines carrying a TypeScript character          ${r.tsLines} of ${r.nonEmptyLines} non-empty`);
  console.log(`  lines carrying no glyph at all                 ${r.glyphlessLines}   (not the same count -- see the header)`);

  const n = Number((argv.find((a) => a.startsWith("--worst=")) || "--worst=10").split("=")[1]) || 10;
  const worst = r.perFile.slice().sort((a, b) => (b.glyphChars + b.tsLines) - (a.glyphChars + a.tsLines)).slice(0, n);
  console.log(`\n  the ${n} files that account for the most, so the next slice is obvious:`);
  for (const f of worst) console.log(`    ${String(f.glyphChars).padStart(6)} glyphs  ${String(f.tsLines).padStart(5)} TS lines   ${f.rel}`);
  console.log("");
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { scanTree };
