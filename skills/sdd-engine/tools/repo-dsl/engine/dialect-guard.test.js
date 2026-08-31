"use strict";
/* Guard test for the PAYLOAD DIALECT + ENCODING (engine/enfile.js compileChunk, engine/payload.js).
 *
 * Why this exists. There is exactly ONE dialect, lzw, in exactly ONE encoding, `lzw1` text. The flat
 * dialect `{g,h}` was deleted with the flat path; base64(JSON) was retired because it expanded the
 * payload 4/3 and turned a quarter of the canonical human artifact (§1) into an opaque blob.
 * Dispatch once rested on key sets staying disjoint (g vs w) BY ACCIDENT — an overlap would have
 * resolved a payload to the WRONG BYTES while reporting success. Both hazards are now closed by
 * construction, and these cases pin that: anything not understood is refused loudly, never guessed.
 *
 * The sentinel case is the load-bearing one. The .en scanner locates spans by searching for « »,
 * which is only sound if no payload can contain one. base64 gave that for free; plain text does not,
 * so escaping provides it BY CONSTRUCTION. That must be a proven property, not an observation that
 * TypeScript source "doesn't usually" contain ⟪ — luck is what the dialect work removed.
 *
 * §10: the real-source cases assert against actual bytes via round-trip, never a mined artifact. */
const assert = require("assert");
const { renderFileEn, compileFileEn, loadIndex } = require("./enfile");
const PAY = require("./payload");
const CR = require("./corpus-root");

const CORPUS = CR.corpusRoot();
let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const GEN = "▶", P_OPEN = "⟪", P_CLOSE = "⟫";
const span = (payloadText) => "«" + GEN + " gloss " + P_OPEN + payloadText + P_CLOSE + "»";
const idx = loadIndex(CORPUS);
const refuses = (payloadText, re) => assert.throws(() => compileFileEn(span(payloadText), idx), re);
const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");

/* 1. A stale base64 payload — flat OR lzw — must be REFUSED with a migration instruction, not
 *    decoded on a best guess. Every .en rendered before this change carries one. */
ok("a stale base64 payload is refused and names the fix", () => {
  refuses(b64({ d: "lzw", a: "n", w: 7, h: [] }), /base64 generator payload.*re-render it: node write-en-files\.js/s);
  refuses(b64({ g: "op_1", h: [] }), /base64 generator payload.*re-render it: node write-en-files\.js/s);
});

/* 2. Anything that is not the one encoding is a hard error, not a fall-through. */
ok("an unknown payload dialect is a hard error", () => {
  refuses("lzw2 n7", /unknown payload dialect — expected a "lzw1 " prefix/);
  refuses("{\"d\":\"lzw\"}", /unknown payload dialect/);
});

/* 3-4. The header must be complete. A missing id or a bad axis cannot be defaulted: either would
 *      silently select the WRONG dictionary word and emit wrong bytes while reporting success. */
ok("a payload carrying no word id is a hard error", () => refuses("lzw1 n", /carries no word id/));
ok("a payload with an unknown axis is a hard error", () => {
  refuses("lzw1 x7", /axis must be "n" or "w"/);
});

/* 5. An unknown escape is refused rather than passed through as literal text — passing it through
 *    would corrupt the hole and produce wrong bytes that still round-trip-looked fine. */
ok("an unknown escape sequence is refused", () => {
  refuses("lzw1 n7⟨abc⟡9def", /unknown escape/);
});

/* 6. STRUCTURAL SENTINEL SAFETY. Encoding any hole content, including every sentinel itself, must
 *    produce a payload containing none of the scanner sentinels. This is the property that lets
 *    plain text live between « » at all. */
ok("an encoded payload provably contains no scanner sentinel", () => {
  const nasty = "«»⟪⟫▶⟨⟩⟡ mixed ⟡⟡ with ⟫⟫ text\nand newlines «";
  const text = PAY.encode({ d: "lzw", a: "w", w: 42, h: [nasty, "", nasty + nasty] });
  assert.ok(!/[«»⟪⟫▶]/.test(text), `encoded payload leaked a scanner sentinel: ${text}`);
  assert.deepStrictEqual(PAY.decode(text).h, [nasty, "", nasty + nasty], "escaping must be exactly reversible");
});

/* 7. Hole boundaries survive content that looks like a boundary. */
ok("holes round-trip when their text mimics the delimiter", () => {
  for (const h of [[], [""], ["a"], ["a", ""], ["", "x"], ["⟨", "⟨⟨"], ["a\nb", "c"]]) {
    const t = PAY.encode({ d: "lzw", a: "n", w: 1, h });
    assert.deepStrictEqual(PAY.decode(t).h, h, `round-trip failed for ${JSON.stringify(h)} -> ${t}`);
  }
});

/* 8. REAL-SOURCE ORACLE (§10.1): the encoding change must not disturb byte-identity. */
ok("round-trip over real source stays byte-identical under the lzw1 encoding", () => {
  const src = "@Column({ name: 'account_id', type: 'int', nullable: true })\naccountId: number;\n";
  assert.strictEqual(compileFileEn(renderFileEn(src, idx).en, idx), src);
});

console.log(`\nPASS ${pass} assertions — one dialect, one encoding, fails closed; byte-identity held.`);
