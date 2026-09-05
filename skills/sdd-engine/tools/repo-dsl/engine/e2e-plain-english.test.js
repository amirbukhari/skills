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

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.message}`); process.exitCode = 1; } };

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
ok("the scanner SEES the dialect: today's rendered .en for src/config.ts is not symbol-free", () => {
  const dialect = fs.readFileSync(path.join(CORPUS, "sen", "files", "src", "config.ts.en"), "utf8");
  const s = PE.scanSymbols(dialect);
  assert.equal(s.clean, false);
  assert.ok(s.glyphChars > 0, JSON.stringify(s));
  assert.ok(s.tsChars > 0, JSON.stringify(s));
  console.log(`      dialect .en: ${s.glyphChars} glyph chars [${s.sample.glyphs}], ${s.tsChars} TypeScript chars [${s.sample.ts}]`);
});

/* ── CASE 1 — a constant with a string value. src/config.ts ────────────────────────────────────── */
const CASE1 = "Let required ui version be the text 0.1.0.\n";
ok("case 1 — the .en ON DISK carries no glyph and no TypeScript", () => {
  const r = throughDisk("config", CASE1);
  assert.equal(r.scan.glyphChars, 0, JSON.stringify(r.scan));
  assert.equal(r.scan.tsChars, 0, JSON.stringify(r.scan));
  assert.equal(r.scan.otherChars, 0, JSON.stringify(r.scan));
  assert.equal(r.scan.clean, true);
});
ok("case 1 — it compiles to src/config.ts, byte-identical", () => {
  const r = throughDisk("config", CASE1);
  const want = corpus("src/config.ts");
  assert.equal(r.ts, want, "\n  got:  " + JSON.stringify(r.ts) + "\n  want: " + JSON.stringify(want));
  console.log(`      files: 1  byte-identical: 1  FAILURES: 0`);
});

/* ── THE GRAMMAR HAS FORCE — it must REFUSE, or "compiles" means nothing ──────────────────────── */
ok("case 1 — a sentence outside the grammar is REFUSED, not guessed at", () => {
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
ok("case 1 — a file with a SYMBOL in it is refused before anything is compiled", () => {
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
ok("case 2 — the .en ON DISK carries no glyph and no TypeScript", () => {
  const r = throughDisk("usePermissions", CASE2);
  assert.equal(r.scan.glyphChars, 0, JSON.stringify(r.scan));
  assert.equal(r.scan.tsChars, 0, JSON.stringify(r.scan));
  assert.equal(r.scan.clean, true, JSON.stringify(r.scan));
});
ok("case 2 — the CODE is right; the four differing bytes are style, and they are named", () => {
  const got = throughDisk("usePermissions", CASE2).ts;
  const want = corpus("src/hydra-ui/src/customHooks/usePermissions.ts");
  /* the program, with the two style facts normalised away -- this is the part that must never break */
  const norm = (t) => t.replace(/["']/g, "'").replace(/}\s*;?\s*$/, "}");
  assert.equal(norm(got), norm(want), "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want));
  assert.ok(got.includes("useAuth()?.roles ?? []"), got);
  /* and the difference is EXACTLY the four bytes recorded in the header, no more */
  const a = [...got], b = [...want], diff = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push([i, a[i], b[i]]);
  assert.equal(diff.length, 4, JSON.stringify(diff));
  assert.deepEqual(diff.map((d) => d[0]), [24, 34, 110, 111], JSON.stringify(diff));
  console.log(`      files: 1  byte-identical: 0  FAILURES: 1  (4 style bytes: ${JSON.stringify(diff.map((d) => [d[0], d[1], d[2]]))})`);
});
ok("case 2 — the English is load-bearing: dropping the fallback clause changes the code", () => {
  const shorter = CASE2.replace(" if it is set, otherwise an empty list.", ".");
  const got = PE.compilePlainEnglish(shorter);
  assert.ok(got.includes("return useAuth().roles;"), got);
  assert.ok(!got.includes("?? []"), got);
});

console.log(`\n${pass} assertions passed`);
