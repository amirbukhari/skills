"use strict";
/* Tests for engine/coin.js — DEFINE / WRITE / READ, byte-exact + round-trip.
 * Runnable node file; exits non-zero on any failure. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { tokenize } = require("./fanout.js");
const { coinWord, authorWith, readWith, matchStatement } = require("./coin.js");
const CR = require("./corpus-root");
const { SKIP } = require("./walk-skip");   // the ONE canonical corpus walk-skip set — this walker had NONE

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; } };

/* 1. DEFINE validates a good example; rejects a broken one. */
ok("coinWord parses a valid expression", () => {
  const w = coinWord({ name: "isProduction", kind: "expression", example: "process.env.NODE_ENV === 'production'" });
  assert.equal(w.name, "isProduction");
  assert.equal(w.kind, "expression");
  assert.ok(w.shape.includes("EqualsEqualsEqualsToken"));
});
ok("coinWord rejects a syntactically broken example", () => {
  assert.throws(() => coinWord({ name: "bad", kind: "expression", example: "process.env.NODE_ENV ===" }));
});
ok("coinWord rejects an invalid word name", () => {
  assert.throws(() => coinWord({ name: "9nope", kind: "expression", example: "1 + 1" }));
});

/* 2. WRITE is byte-exact: authoring the canonical args reproduces the example. */
ok("authorWith reproduces the example byte-for-byte (expression, no params)", () => {
  const ex = "process.env.NODE_ENV === 'production'";
  const w = coinWord({ name: "isProduction", kind: "expression", example: ex });
  assert.strictEqual(authorWith(w), ex);
});
ok("authorWith fills a param slot byte-exactly (statement word)", () => {
  const ex = "const isProduction = process.env.NODE_ENV === 'production';";
  const w = coinWord({ name: "prodFlag", kind: "statement", example: ex, params: [{ name: "flag", at: 0 }] });
  // canonical args -> example
  assert.strictEqual(authorWith(w, { flag: "isProduction" }), ex);
  // new args -> new bytes, fixed parts intact
  assert.strictEqual(authorWith(w, { flag: "shouldSync" }), "const shouldSync = process.env.NODE_ENV === 'production';");
});
ok("authorWith fills a param and passes a @json bespoke slot through verbatim", () => {
  // slots: floatVal(0) current(1) credits(2). param=current(1); credits(2) is a bespoke escape.
  const ex = "return floatVal(current) - credits;";
  const w = coinWord({ name: "netOfCredits", kind: "statement", example: ex, params: [{ name: "gross", at: 1 }], bespoke: [2] });
  assert.strictEqual(authorWith(w, { gross: "amountInvoiced" }), "return floatVal(amountInvoiced) - credits;");
});

/* 3. Call-form authoring for a helper-backed word. */
ok("authorWith emits the call form when asked", () => {
  const w = coinWord({ name: "isProduction", kind: "expression", example: "process.env.NODE_ENV === 'production'",
    call: "isProduction()", define: "export const isProduction = (): boolean => (process.env.NODE_ENV === 'production');" });
  assert.strictEqual(authorWith(w, {}, { asCall: true }), "isProduction()");
});

/* 4. READ recognizes NEW occurrences (expression word) — whitespace-insensitive. */
ok("readWith finds the expression across whitespace variants", () => {
  const w = coinWord({ name: "isProduction", kind: "expression", example: "process.env.NODE_ENV === 'production'" });
  const src = "if (process.env.NODE_ENV === 'production') { a(); }\nconst z = process.env.NODE_ENV==='production';";
  const sites = readWith(w, src);
  assert.equal(sites.length, 2, `expected 2 sites, got ${sites.length}`);
  for (const s of sites) assert.ok(/NODE_ENV/.test(s.text));
});
ok("readWith does NOT match a different string literal (fixed slot enforced)", () => {
  const w = coinWord({ name: "isProduction", kind: "expression", example: "process.env.NODE_ENV === 'production'" });
  const sites = readWith(w, "const q = process.env.NODE_ENV === 'staging';");
  assert.equal(sites.length, 0);
});

/* 5. Statement match on a real fixture (shape + fixed slots). */
ok("matchStatement binds the param and enforces fixed slots", () => {
  const ex = "const isProduction = process.env.NODE_ENV === 'production';";
  const w = coinWord({ name: "prodFlag", kind: "statement", example: ex, params: [{ name: "flag", at: 0 }] });
  const toks = tokenize("x.ts", "const isProdEnv = process.env.NODE_ENV === 'production';").tokens;
  const stmt = toks.find((t) => t.shape === w.shape);
  const m = matchStatement(w, stmt);
  assert.ok(m && m.matched);
  assert.equal(m.bind.flag, "isProdEnv");
  // a mismatched fixed literal must fail
  const toks2 = tokenize("y.ts", "const q = a.b.c === 'production';").tokens;
  const stmt2 = toks2.find((t) => t.shape === w.shape);
  assert.equal(matchStatement(w, stmt2), false);
});

/* 6. READ against the REAL corpus: isProduction names its siblings. */
ok("readWith names the real corpus occurrences of isProduction", () => {
  const CORPUS = CR.sourceRoot();
  if (!fs.existsSync(CORPUS)) { console.log("      (corpus absent — skipped)"); return; }
  const w = coinWord({ name: "isProduction", kind: "expression", example: "process.env.NODE_ENV === 'production'" });
  function walk(d, o = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; }
  let total = 0;
  for (const f of walk(CORPUS).filter((f) => !f.includes("/demo/"))) { total += readWith(w, fs.readFileSync(f, "utf8")).length; }
  assert.ok(total >= 6, `expected >=6 sites, got ${total}`);
  console.log(`      (named ${total} real sites)`);
});

console.log(`\ncoin.test: ${pass} passed`);
