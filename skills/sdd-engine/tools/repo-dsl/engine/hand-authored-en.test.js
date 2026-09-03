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
 * >>> THE FLIP HAS LANDED (2026-09-03) AND THIS FILE IS STILL GREEN. READ WHY BEFORE TRUSTING IT. <<<
 * The banner here used to say this test was expected to FAIL the day an edited sentence became
 * authoritative. That day came — `repairFromSentence` in enfile.js inverts the payload's hole layer
 * and honours an edit it can prove it understood — and every assertion below still passes. That is
 * not the tripwire failing to fire; it is this fixture sitting on the far side of the boundary the
 * flip drew, and the distinction is worth stating exactly because a green run here is now easy to
 * misread as "English is still a report".
 *
 * WHY THIS FIXTURE IS STILL REFUSED, AND CORRECTLY. The edit below is
 *     "compute `total`"  ->  "compute `grandTotal` by adding tax"
 * which does two things at once: it renames a hole fill (honourable) AND adds prose the payload has
 * no way to encode (not). The repair path is a closed loop — it refills the holes, re-derives the
 * gloss from the repaired payload, and accepts ONLY a byte-equal match against what the human
 * wrote. "by adding tax" can never appear in a re-derived gloss, so the loop cannot close, so the
 * edit is refused. The engine does not half-understand a sentence and compile the half it got.
 *
 * WHAT CHANGED HERE, THEN. Assertion 5's name, and only its name — it claimed "NO setting makes an
 * edited sentence authoritative", which became false engine-wide the moment one setting does. The
 * assertion body is unchanged and still passes; it has been renamed to the property it actually
 * establishes, which is the more useful one now: an edit the engine cannot PROVE it understood is
 * refused under every setting. Nothing was loosened. See `sentence-authority.test.js`, which pins
 * the near side of the same boundary and is green for the opposite reason.
 *
 * Measured 2026-09-01; the boundary above re-measured 2026-09-03.
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

/* 3. THE ESCAPE HATCH — NO LONGER THE PRODUCTION PATH. Until 2026-09-03 deriveCheck was off unless
 *    SDD_DERIVE_CHECK=1, so this WAS what a real compile did with edited English: find the payload
 *    with lastIndexOf(PAY_OPEN) and never read the sentence. The default is now ON (measured free:
 *    1037/1037 either way, 5,484 ms vs 5,779 ms), so an ordinary caller gets the refusal asserted in
 *    (4) and only an explicit `deriveCheck:false` still gets the silent no-op. This assertion is
 *    kept, with its argument now explicit and its name corrected, because the hatch still exists and
 *    what it does is still the wrong behaviour — the day the hatch is removed, this is the line that
 *    says so. */
ok("ESCAPE HATCH: with deriveCheck:false an edited sentence is a SILENT NO-OP — the .ts is unchanged", () => {
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

/* 5. THE BOUNDARY, stated as a property over BOTH settings rather than asserted twice. This used to
 *    read "there is no configuration under which editing the English changes the code", which was
 *    true when it was written and is now false: an edit confined to hole fills IS authoritative
 *    (sentence-authority.test.js section 7). What remains true, and is the property worth pinning,
 *    is that an edit the engine cannot PROVE it understood — here, one that adds prose the payload
 *    cannot encode — is refused under every setting rather than partially applied. */
ok("an edit the engine cannot PROVE it understood is refused under every setting (added prose)", () => {
  const outcomes = [false, true].map((deriveCheck) => {
    try { return { compiled: compileFileEn(EDITED, idx, { deriveCheck }) }; }
    catch (e) { return { threw: e.message.split("\n")[0] }; }
  });
  const changedTheCode = outcomes.some((o) => o.compiled !== undefined && o.compiled !== SRC);
  assert.strictEqual(changedTheCode, false,
    `a setting compiled an edit whose prose the payload cannot encode: ${JSON.stringify(outcomes)}\n` +
    `      That is a half-understood sentence being compiled, which is the one outcome forbidden ` +
    `in every version of the engine.`);
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
