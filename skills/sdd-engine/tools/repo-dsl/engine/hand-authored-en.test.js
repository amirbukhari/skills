"use strict";
/* engine/hand-authored-en.test.js — A4: THE HAND-AUTHORED `.en`, EXERCISED AT LAST.
 *
 * WHAT WAS MISSING. Every gate in this engine is `compile(render(ts)) === ts`. Even the corpus case
 * in `enfile.test.js` reads a PERSISTED `.en` as an input — but that `.en` was written by the
 * renderer, so the round-trip only ever proves the machine agrees with itself. No fixture of a
 * HUMAN-written `.en` existed anywhere in the tree, which is A4 of the 2026-09-01 PRD sweep and
 * reason 1 of §1B.5 for why the source-of-truth flip cannot proceed.
 *
 * WHAT THIS FILE IS FOR. It pins, executably, what actually happens when a person edits the English.
 * Today the answer is "nothing, or an error" — never "the code changes". That is A2, the largest
 * single gap on the flip, and it has been prose until now.
 *
 * >>> THIS TEST IS EXPECTED TO FAIL THE DAY THE FLIP LANDS, AND THAT IS THE POINT. <<<
 * It asserts a LIMITATION, not a desired behaviour. When §5E.3.2's grammar parser makes an edited
 * sentence authoritative (R-REND-6), assertions 3, 5 and 6 below SHOULD go red. Do not "fix" them by
 * loosening them — rewrite the file to assert the new contract, and delete this banner. A green run
 * here means English is still a report, not a source.
 *
 * Measured 2026-09-01, and every assertion below was observed before it was written.
 */
const assert = require("assert");
const { renderFileEn, compileFileEn, loadIndex } = require("./enfile");
const CR = require("./corpus-root");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const idx = loadIndex(CR.corpusRoot());
const SRC = "const total = subtotal + tax;\n";
const { en } = renderFileEn(SRC, idx);

/* The gloss this file edits, read off the render rather than hardcoded. If the renderer's wording
 * changes, this test must follow it or start measuring nothing — see assertion 2. */
const GLOSS = "compute `total`";
const EDITED = en.replace(GLOSS, "compute `grandTotal` by adding tax");

/* 1. The fixture is valid. If the machine's own round-trip is broken, every later assertion here is
 *    meaningless rather than informative, so this runs first and says so. */
ok("baseline: the machine-rendered .en compiles back byte-identically", () => {
  assert.strictEqual(compileFileEn(en, idx, { deriveCheck: true }), SRC,
    "the round-trip itself is broken — nothing below this line measures what it claims to");
});

/* 2. THE GUARD ON THIS WHOLE FILE. The first draft of this test edited a word that was not in the
 *    gloss, so `EDITED === en` and every "the edit did nothing" assertion below passed for the
 *    wrong reason — they were measuring a string that had never been changed. That is the vacuous
 *    -test trap, and it is cheap to close: prove the edit landed before asserting what it did. */
ok("the hand-edit actually changed the .en — otherwise this file proves nothing", () => {
  assert.notStrictEqual(EDITED, en,
    `the gloss ${JSON.stringify(GLOSS)} was not found in the rendered .en, so nothing was edited:\n${en}`);
  assert.ok(EDITED.includes("grandTotal"), "the edited text is not present in the fixture");
});

/* 3. The production path. deriveCheck is OFF unless SDD_DERIVE_CHECK=1, so this is what a real
 *    compile does with edited English: it finds the payload with lastIndexOf(PAY_OPEN) and never
 *    reads the sentence at all. */
ok("PRODUCTION: an edited sentence is a SILENT NO-OP — the .ts is unchanged", () => {
  const out = compileFileEn(EDITED, idx, { deriveCheck: false });
  assert.strictEqual(out, SRC,
    "the edited English changed the compiled .ts — if that is intentional, the flip has landed and " +
    "this file needs rewriting, not relaxing");
});

/* 4. The checked path. Not authorship either — the edit becomes an error. */
ok("CHECKED: the same edit throws R-REND-6 rather than taking effect", () => {
  assert.throws(() => compileFileEn(EDITED, idx, { deriveCheck: true }),
    /SENTENCE AND PAYLOAD DISAGREE/,
    "deriveCheck did not reject a sentence that disagrees with its payload");
});

/* 5. The gap itself, stated as a property over BOTH settings rather than asserted twice. There is
 *    no configuration under which editing the English changes the code. */
ok("NO setting makes an edited sentence authoritative — this is the A2 gap", () => {
  const outcomes = [false, true].map((deriveCheck) => {
    try { return { compiled: compileFileEn(EDITED, idx, { deriveCheck }) }; }
    catch (e) { return { threw: e.message.split("\n")[0] }; }
  });
  const changedTheCode = outcomes.some((o) => o.compiled !== undefined && o.compiled !== SRC);
  assert.strictEqual(changedTheCode, false,
    `a setting made the edit take effect: ${JSON.stringify(outcomes)} — the flip may have landed`);
});

/* 6. English written from scratch, the way a person actually would: a sentence and no payload.
 *    This is the case §1B.5 reason 1 is really about, and it is refused at the payload parser —
 *    there is no grammar parser to read the sentence with (§5E.3.2, unbuilt). */
ok("authored-from-scratch English (a clause with no payload) is REFUSED, not compiled", () => {
  const authored = "«▶ define the grand total as the subtotal plus tax »\n";
  for (const deriveCheck of [false, true]) {
    assert.throws(() => compileFileEn(authored, idx, { deriveCheck }),
      /malformed generator payload/,
      `authored English compiled with deriveCheck=${deriveCheck} — it must refuse until a grammar ` +
      `parser exists, and silently accepting it would be worse than refusing`);
  }
});

console.log(`\n${pass} assertions passed`);
