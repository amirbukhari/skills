"use strict";
/* e2e-plain-english.test.js — Amir: "End to end test no symbols in it".
 *
 * THE LOOP, and every step is a FILE ON DISK:
 *     symbol-free English .en  ->  scanned on disk  ->  compiled  ->  .ts  ->  byte-compared to the
 *                                                                             real corpus file
 *
 * WHY A SIBLING FILE AND NOT MORE ASSERTIONS IN roundtrip-through-disk.test.js. That file is the
 * BYTE-IDENTITY gate for the corpus dialect: .ts -> .en -> .ts, 7 assertions, all green, and its
 * whole value is that it stays a gate. This one measures a DISTANCE — most of its cases are
 * expected to be red for a while, because the grammar that can say a construct in English does not
 * exist yet. Mixing "must never break" with "not built yet" in one file is how a red-by-design test
 * hides a regression, which run-tests.js's own header records happening here before.
 *
 * THE SCAN IS OF THE FILE, NOT OF THE RENDERER. Every assertion reads the .en back off disk and
 * scans the bytes. A renderer that promised symbol-free output and wrote something else would pass
 * a check that trusted it.
 *
 * CASE 1 IS THE TEMPLATE. src/config.ts, a real corpus file, 42 bytes:
 *     export const requiredUiVersion = '0.1.0';
 * Its rendered corpus .en today is the dialect, and that is the RED this file opened on:
 *     «▶ set `requiredUiVersion` to “0.1.0” ⟪lzw1 n195⟨export ⟨requiredUiVersion⟨“0.1.0”⟫»
 * The hand-written plain-English version carries no glyph and no TypeScript character:
 *     Let required ui version be the text 0.1.0.
 *
 * THE STRING'S BYTES SURVIVE BY POSITION, NOT BY A QUOTE CHARACTER. `0.1.0` is everything between
 * "be the text " and the sentence's final period, taken verbatim. A quote mark would be a symbol,
 * so the grammar cannot use one — and that is the general shape of the answer for every literal. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PE = require("./plain-english");
const CR = require("./corpus-root");

const SRC = CR.sourceRoot(), CORPUS = CR.corpusRoot();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "plain-en-"));

const R = require("./test-report").report(__filename);
/* A character named rather than shown, so a byte-level finding can be reported without putting a
 * quote, a semicolon or a newline into the terminal as itself. */
const NAMED = new Map([["'", "a single quote"], ['"', "a double quote"], [";", "a semicolon"],
  ["\n", "a line ending"], [" ", "a space"], [undefined, "nothing at all"], [null, "nothing at all"]]);
const nameOf = (c) => NAMED.get(c) || `the character ${JSON.stringify(c)}`;
const { ok, count } = R;

/** write English to a real file, read it BACK off disk, scan it, compile it */
function throughDisk(name, english) {
  const p = path.join(TMP, name + ".ts.en");
  fs.writeFileSync(p, english);
  const fromDisk = fs.readFileSync(p, "utf8");
  return { path: p, scan: PE.scanSymbols(fromDisk), ts: PE.compilePlainEnglish(fromDisk) };
}
const corpus = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

/* ── THE NEGATIVE CONTROL, and it runs FIRST so the scanner is never taken on trust ──────────────
 * The corpus dialect .en for the very same file must be reported as NOT symbol-free, with counts.
 * If this ever passes, the scanner has stopped being able to see a glyph and every green below is
 * worthless. */
ok("the scanner can still see a symbol: the same file as the corpus renders it today is reported as not symbol-free", () => {
  const dialect = fs.readFileSync(path.join(CORPUS, "sen", "files", "src", "config.ts.en"), "utf8");
  const s = PE.scanSymbols(dialect);
  assert.equal(s.clean, false, "the rendered dialect file was reported as symbol-free, which it is not");
  assert.ok(s.glyphChars > 0, "the scanner found no dialect mark in a file built entirely out of them");
  assert.ok(s.tsChars > 0, "the scanner found no TypeScript character in the rendered dialect file");
  /* The marks are NOT echoed. They are counted, and named in words by the reporter. */
  count(`the same file as the corpus renders it today carries ${s.glyphChars} dialect marks `
    + `(${R.describe(s.sample.glyphs)}) and ${s.tsChars} TypeScript characters, so the scanner can still see one.`);
});

/* ── CASE 1 — a constant with a string value. src/config.ts ────────────────────────────────────── */
const CASE1 = "Let required ui version be the text 0.1.0.\n";
ok("case 1, a constant: the English written to disk carries no dialect mark and no TypeScript", () => {
  const r = throughDisk("config", CASE1);
  assert.equal(r.scan.glyphChars, 0, `the English on disk carries ${r.scan.glyphChars} dialect marks, and it must carry none`);
  assert.equal(r.scan.tsChars, 0, `the English on disk carries ${r.scan.tsChars} TypeScript characters, and it must carry none`);
  assert.equal(r.scan.otherChars, 0, `the English on disk carries ${r.scan.otherChars} characters outside the allowed letters, digits and ordinary punctuation`);
  assert.equal(r.scan.clean, true, "the English on disk was not reported clean");
});
ok("case 1, a constant: that English compiles to the corpus file src/config.ts, byte for byte", () => {
  const r = throughDisk("config", CASE1);
  const want = corpus("src/config.ts");
  const firstDiff = [...want].findIndex((c, i) => c !== r.ts[i]);
  assert.equal(r.ts, want, r.ts.length !== want.length
    ? `the compiled TypeScript is ${r.ts.length} bytes where src/config.ts is ${want.length}`
    : `both files are ${want.length} bytes, but they first differ at byte ${firstDiff}, where the compiled file `
      + `has ${nameOf(r.ts[firstDiff])} and the corpus file has ${nameOf(want[firstDiff])}`);
  count("1 file of English was compiled: 1 of the 1 is byte-identical to the corpus TypeScript, and 0 failed.");
});

/* ── THE GRAMMAR HAS FORCE — it must REFUSE, or "compiles" means nothing ──────────────────────── */
ok("case 1, a constant: a sentence the grammar does not cover is refused rather than guessed at", () => {
  for (const [why, text] of [
    ["no rule matches", "Make a thing that does something.\n"],
    ["no terminator", "Let required ui version be the text 0.1.0\n"],
    ["indented with no block", "  Return roles from the result of use auth.\n"],
  ]) {
    let threw = null;
    try { PE.compilePlainEnglish(text); } catch (e) { threw = e; }
    assert.ok(threw instanceof PE.PlainEnglishError, why + ": " + (threw ? threw.message : "compiled instead of refusing"));
  }
});
ok("case 1, a constant: a file carrying a symbol is refused before anything is compiled", () => {
  let threw = null;
  try { PE.compilePlainEnglish("export const requiredUiVersion = '0.1.0';\n"); } catch (e) { threw = e; }
  assert.ok(threw instanceof PE.PlainEnglishError && /not symbol-free/.test(threw.message), String(threw));
});

/* ── CASE 2 — THE LAYOUT WALL, on a real file, with the exact bytes ────────────────────────────────
 * src/hydra-ui/src/customHooks/usePermissions.ts: a bare import, a no-parameter arrow function, an
 * optional member access and a nullish default. The English says all of the CODE and none of the
 * STYLE, and this is the concrete example behind the layout question:
 *
 *     Bring in use auth from the local module use auth.
 *
 *     To use permissions.
 *       Return roles from the result of use auth if it is set, otherwise an empty list.
 *
 * compiles to a program that is IDENTICAL in behaviour and differs from the file on disk in FOUR
 * bytes, every one of them a style fact prose does not carry:
 *
 *     at byte 24:  got "'"   want '"'      the import quote
 *     at byte 34:  got "'"   want '"'      the import quote
 *     at byte 110: got ";"   want "\n"     the semicolon after the closing brace
 *     at byte 111: got "\n"  want undefined
 *
 * The emitter is NOT tuned to this file: both style choices come from counting the corpus
 * (' 4916 vs " 189; }; 1855 vs } 1040 — see plain-english.js), and this file is in the minority on
 * both. Tuning them to match would make this one green and every majority-style file red, which is
 * why it is recorded rather than fixed.
 *
 * THIS ASSERTION IS GREEN AND IT IS NOT A PASS. It pins a KNOWN LIMIT: the day byte-identity through
 * plain English becomes possible, this test fails and must be rewritten. It is written as an exact
 * diff rather than as a red so that a REGRESSION in the compiled code — a wrong identifier, a lost
 * `?.` — still fails loudly here instead of hiding inside an expected red. */
const CASE2 = "Bring in use auth from the local module use auth.\n\n"
  + "To use permissions.\n"
  + "  Return roles from the result of use auth if it is set, otherwise an empty list.\n";
ok("case 2, a hook: the English written to disk carries no dialect mark and no TypeScript", () => {
  const r = throughDisk("usePermissions", CASE2);
  assert.equal(r.scan.glyphChars, 0, `the English on disk carries ${r.scan.glyphChars} dialect marks, and it must carry none`);
  assert.equal(r.scan.tsChars, 0, `the English on disk carries ${r.scan.tsChars} TypeScript characters, and it must carry none`);
  assert.equal(r.scan.clean, true, "the English on disk was not reported clean");
});
ok("case 2, a hook: the program compiles correctly, and the only four bytes that differ are layout, each one named", () => {
  const got = throughDisk("usePermissions", CASE2).ts;
  const want = corpus("src/hydra-ui/src/customHooks/usePermissions.ts");
  /* the program, with the two style facts normalised away -- this is the part that must never break */
  const norm = (t) => t.replace(/["']/g, "'").replace(/}\s*;?\s*$/, "}");
  assert.equal(norm(got), norm(want),
    "once quoting and the trailing semicolon are set aside, the compiled program still differs from the corpus one");
  assert.ok(got.includes("useAuth()?.roles ?? []"),
    "the compiled body does not read the roles off the auth result with a fallback, which is what the English says");
  /* and the difference is EXACTLY the four bytes recorded in the header, no more */
  const a = [...got], b = [...want], diff = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push([i, a[i], b[i]]);
  assert.equal(diff.length, 4, `${diff.length} bytes differ from the corpus file, and only 4 are accounted for as style`);
  assert.deepEqual(diff.map((d) => d[0]), [24, 34, 110, 111],
    `the differing bytes are at positions ${diff.map((d) => d[0]).join(", ")}, not the four style positions this pins`);
  count("1 file of English was compiled: 0 of the 1 is byte-identical to the corpus TypeScript, and 1 failed, "
    + "on exactly 4 bytes, every one of them layout the English does not carry:");
  for (const [i, g, w] of diff)
    count(`  at byte ${i} the compiled file has ${nameOf(g)} where the corpus file has ${nameOf(w)}.`);
});
ok("case 2, a hook: the English is load-bearing, because dropping the fallback clause changes the compiled code", () => {
  const shorter = CASE2.replace(" if it is set, otherwise an empty list.", ".");
  const got = PE.compilePlainEnglish(shorter);
  assert.ok(got.includes("return useAuth().roles;"),
    "with the fallback clause removed the code should read the roles straight off the result, and it does not");
  assert.ok(!got.includes("?? []"),
    "the fallback clause was removed from the English but the fallback is still in the compiled code");
});

R.done("English written by hand on disk, compiled to TypeScript");

