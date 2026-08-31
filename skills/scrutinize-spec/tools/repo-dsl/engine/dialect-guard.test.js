"use strict";
/* Guard test for the PAYLOAD DIALECT dispatch (engine/enfile.js compileChunk).
 *
 * Why this exists: there is now exactly ONE dialect, lzw `{d:"lzw",a,w,h}`. The flat dialect
 * `{g,h}` was deleted with the flat path. Dispatch previously read whichever key happened to be
 * present, so correctness rested on the two key sets staying disjoint (g vs w) by accident — an
 * overlap would have resolved a payload to the WRONG BYTES while reporting success. With one
 * dialect that hazard is gone by construction; these cases pin the fail-closed behaviour so a
 * stale .en is refused loudly instead of being guessed at, and so a second dialect cannot be
 * reintroduced silently.
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

/* 1. A FLAT payload must be REFUSED, not silently resolved. This is the whole point: the flat
 *    dialect is deleted, and a stale .en carrying `g` must fail closed with a migration message
 *    rather than resolve against some other catalog and produce the wrong bytes. */
ok("a stale FLAT payload (`g`) is refused with a re-render instruction", () => {
  throwsWith({ g: "op_1", h: [] }, /FLAT generator payload .* no longer exists/);
});

/* 2. UNKNOWN dialect tag is a hard error rather than a fall-through guess. */
ok("unknown dialect tag is a hard error", () => {
  throwsWith({ d: "wat", w: 7, h: [] }, /unknown generator payload dialect/);
});

/* 3. A payload with no word id cannot be compiled. */
ok("payload carrying no `w` word id is a hard error", () => {
  throwsWith({ h: [] }, /carries no `w` word id/);
});

/* 4. The tag and the shape must agree: tagged lzw but carrying a flat id is still refused. */
ok("a payload tagged lzw but carrying a flat `g` id is refused", () => {
  throwsWith({ d: "lzw", g: "op_1", h: [] }, /FLAT generator payload/);
});

/* 5. REAL-SOURCE ORACLE (§10.1): tagging the payload must not disturb byte-identity. */
ok("round-trip over real source stays byte-identical with dialect tags live", () => {
  const src = "@Column({ name: 'account_id', type: 'int', nullable: true })\naccountId: number;\n";
  assert.strictEqual(compileFileEn(renderFileEn(src, idx).en, idx), src);
});

console.log(`\nPASS ${pass} assertions — single-dialect dispatch fails closed; byte-identity held.`);
