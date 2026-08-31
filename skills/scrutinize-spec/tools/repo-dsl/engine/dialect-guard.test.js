"use strict";
/* Guard test for the PAYLOAD DIALECT dispatch (engine/enfile.js compileChunk).
 *
 * Why this exists: two payload dialects coexist in a .en — flat `{g,h}` (catalog/generators.json)
 * and lzw `{d:"lzw",a,w,h}` (catalog/generators-lzw.json). Dispatch used to read whichever key was
 * present, so correctness rested on the two key sets staying disjoint (g vs w) by accident. An
 * overlap would let a compiler resolve a payload to the WRONG BYTES and still report success —
 * silent-wrong. These cases pin the fail-closed behaviour so the accident cannot come back.
 *
 * §10 compliance: case 4 asserts correctness against REAL SOURCE via round-trip, never against a
 * mined artifact. Cases 1-3 assert the guard's own error messages, which is the guard's contract. */
const assert = require("assert");
const path = require("path");
const { renderFileEn, compileFileEn, loadIndex } = require("./enfile");

const CORPUS = process.env.HYDRA_CORPUS || "/home/amir/Documents/Rentsync/delonix/hydra-source";
let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const GEN = "▶", OPEN = "⟪", CLOSE = "⟫";
const span = (obj) => "«" + GEN + " gloss " + OPEN +
  Buffer.from(JSON.stringify(obj), "utf8").toString("base64") + CLOSE + "»";
const idx = loadIndex(CORPUS);
const throwsWith = (obj, re) => assert.throws(() => compileFileEn(span(obj), idx), re);

/* 1. AMBIGUOUS: both dialect keys present. Must refuse, not pick one. */
ok("payload carrying both `g` and `w` is refused as ambiguous", () => {
  throwsWith({ g: "op_1", w: 7, h: [] }, /ambiguous generator payload/);
});

/* 2. UNKNOWN dialect tag. Must refuse rather than fall through to a key-shape guess. */
ok("unknown dialect tag is a hard error", () => {
  throwsWith({ d: "wat", w: 7, h: [] }, /unknown generator payload dialect/);
});

/* 3. NEITHER key and no tag. */
ok("payload naming no dialect and carrying no id is a hard error", () => {
  throwsWith({ h: [] }, /names no dialect/);
});

/* 4. A tag must agree with its own payload shape. */
ok('dialect "lzw" without a `w` id is a hard error', () => {
  throwsWith({ d: "lzw", h: [] }, /tagged dialect "lzw" but carries no `w`/);
});

/* 5. REAL-SOURCE ORACLE (§10.1): tagging the payload must not disturb byte-identity. */
ok("round-trip over real source stays byte-identical with dialect tags live", () => {
  const src = "@Column({ name: 'account_id', type: 'int', nullable: true })\naccountId: number;\n";
  assert.strictEqual(compileFileEn(renderFileEn(src, idx).en, idx), src);
});

console.log(`\nPASS ${pass} assertions — dialect dispatch fails closed; byte-identity held.`);
