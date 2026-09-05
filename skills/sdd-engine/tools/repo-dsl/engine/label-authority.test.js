"use strict";
/* label-authority.test.js — the LABEL is what the compiler generates from.
 *
 * Amir, 2026-09-04: "So make the label get read  by the compiler then?"
 *
 * WHAT THIS IS TESTING, and what it deliberately is not. Today `compileChunk` locates the payload
 * with `lastIndexOf(PAY_OPEN)` and generates from it; the label is read only inside the R-REND-6
 * derive check, as a COMPARISON, with `repairFromSentence` as a repair path. So the label is
 * validated and never used. These properties ask whether it can be USED -- for ONE construct,
 * `boolToBit` in `src/helpers.ts`, which round-trips byte-identically today.
 *
 * IT IS SCOPED TO ONE CONSTRUCT ON PURPOSE. A corpus-wide claim here would be a claim about 1037
 * files made from one, and the honest partial is the deliverable. What the other constructs do is
 * measured separately and reported per construct, not generalised from this one.
 *
 * THE REFUSAL IS THE POINT, not the compile. If the compiler generates from the label, then a label
 * that names no values is not merely unhelpful -- it is UNCOMPILABLE, and it must fail loudly
 * saying what it failed to say. A green never seen red proves nothing, so the refusal is shown
 * firing AND shown not firing on a label that does name its value. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const CR = require("./corpus-root");
const LS = require("./label-source");
const MARKS = require("./enfile").MARKS;
const R = require("./test-report").report(__filename);
const { ok, count, setUp } = R;

const SOURCE = CR.sourceRoot();
const ts = (rel) => fs.readFileSync(path.join(SOURCE, rel), "utf8");

/* The specimen is SLICED OUT OF THE CORPUS at run time, never transcribed, so the test cannot
 * silently keep passing against a file that has changed underneath it. */
function declarationIn(rel, firstLine, lastLine) {
  const text = ts(rel);
  const start = text.indexOf(firstLine);
  assert.notEqual(start, -1, `${rel} no longer contains the line this case is built on: ${firstLine}`);
  const end = text.indexOf(lastLine, start);
  assert.notEqual(end, -1, `${rel} no longer closes that declaration with: ${lastLine}`);
  /* NO TRAILING NEWLINE. The line ending after `};` belongs to the ENCLOSING chunk, not to this
   * declaration -- verified by reading the .en file's tail, which is a close mark followed by that
   * newline. Adding one here invented a 93rd byte the construct never owned, and it is the reason
   * the first run of this test failed by exactly one byte. */
  return text.slice(start, end + lastLine.length);
}

const CORPUS = CR.corpusRoot();
const enText = (rel) => fs.readFileSync(path.join(CORPUS, "sen", "files", rel), "utf8");

/* The rendered English for this construct is SLICED OUT OF THE LIVE .en FILE by matching braces,
 * never transcribed, so no dialect character is spelled in this test and the case cannot drift
 * away from what the corpus actually renders. */
function chunkAround(en, needle) {
  const i = en.indexOf(needle);
  assert.notEqual(i, -1, `the rendered English no longer contains ${needle}`);
  let depth = 0, start = -1;
  for (let k = i; k >= 0; k--) {
    if (en[k] === MARKS.chunkClose) depth++;
    else if (en[k] === MARKS.chunkOpen) { if (depth === 0) { start = k; break; } depth--; }
  }
  assert.notEqual(start, -1, "no chunk encloses that text");
  depth = 0;
  for (let k = start; k < en.length; k++) {
    if (en[k] === MARKS.chunkOpen) depth++;
    else if (en[k] === MARKS.chunkClose) { depth--; if (depth === 0) return en.slice(start, k + 1); }
  }
  throw new Error("the enclosing chunk never closes");
}

const WANT = setUp("the boolToBit declaration, sliced out of src/helpers.ts", () =>
  declarationIn("src/helpers.ts", "export const boolToBit", "};"));
const EN_CHUNK = setUp("the rendered English for that declaration, sliced out of the .en file", () =>
  chunkAround(enText("src/helpers.ts.en"), "boolToBit"));

count(`the declaration this case is built on is ${WANT.length} bytes of TypeScript, rendered as ${EN_CHUNK.length} bytes of English.`);

/* The two labels this construct carries, read off the rendered English rather than invented. */
ok("a label that names the value it returns compiles to TypeScript from the label alone", () => {
  assert.equal(LS.compileFromLabel("return `1`"), "return 1;");
  assert.equal(LS.compileFromLabel("return `0`"), "return 0;");
});

ok("the whole construct compiles from its labels alone, byte for byte, with no payload decoded", () => {
  const got = LS.compileConstruct(EN_CHUNK);
  assert.equal(got, WANT, LS.whyTheyDiffer(got, WANT, "construct"));
});

ok("deleting the payload region outright changes nothing, which is what proves the label is the source", () => {
  const stripped = EN_CHUNK.split(MARKS.payloadOpen).map((part, n) => {
    if (n === 0) return part;
    const end = part.indexOf(MARKS.payloadClose);
    assert.notEqual(end, -1, "a payload opens and never closes");
    return part.slice(end + 1);
  }).join("");
  assert.ok(!stripped.includes(MARKS.payloadOpen), "a payload survived the deletion");
  const got = LS.compileConstruct(stripped);
  assert.equal(got, WANT, LS.whyTheyDiffer(got, WANT, "construct with its payloads deleted"));
});

ok("a label that names no value is refused, and the refusal says what the label failed to say", () => {
  let threw = null;
  try { LS.compileFromLabel("1 shape"); } catch (e) { threw = e; }
  assert.ok(threw, "a vacuous label compiled instead of refusing, which is the silent-guess failure this exists to prevent");
  assert.ok(/names no value/.test(threw.message),
    `the refusal fired but did not say what the label failed to say. It said: ${threw.message}`);
});

ok("the refusal is not refusing everything, because a label that does name its value still compiles", () => {
  assert.equal(LS.compileFromLabel("return `7`"), "return 7;");
});

/* THE VACUOUS-LABEL CLASS. 1,619 of the corpus's 19,335 chunks (8.4%) carry a label that names no
 * value -- "9 re-exports", "3 types and 3 functions", "5 constants". Under label authority those
 * are not merely unhelpful, they are UNCOMPILABLE. These two properties pin both halves: a label
 * that NAMES what it re-exports compiles the whole construct with no payload in the picture at all,
 * and a label that goes back to counting is refused by name. */
const MANY = "packages/hydra-internal/src/index.ts";
const WANT_MANY = setUp("the whole of packages/hydra-internal/src/index.ts", () => ts(MANY));

ok("a label naming every module it re-exports compiles the whole construct, byte for byte, with no payload at all", () => {
  const label = "Re-export everything from helpers, csvUtils, paymentsInterfaces, dateTimeHelpers, "
    + "interfaces, subscriptionHelpers, integrityCheckHelpers, typeGuards and enums, "
    + "each a local module named in single quotes";
  const got = LS.compileFromLabel(label);
  assert.equal(got, WANT_MANY, LS.whyTheyDiffer(got, WANT_MANY, "re-export construct"));
});

ok("the label must say which quote character the source used, because 1597 specifiers in the corpus use the other one", () => {
  let threw = null;
  try {
    LS.compileFromLabel("Re-export everything from helpers and enums, each a local module");
  } catch (e) { threw = e; }
  assert.ok(threw, "a label that named the modules but not their quote style compiled anyway, which would corrupt every double-quoted specifier");
  assert.ok(/quote/.test(threw.message), `the refusal fired but did not name the missing fact. It said: ${threw.message}`);
});

ok("a label that COUNTS instead of naming is refused, and the refusal says what it failed to name", () => {
  let threw = null;
  try { LS.compileFromLabel("9 re-exports"); } catch (e) { threw = e; }
  assert.ok(threw, "a counting label compiled instead of refusing");
  assert.ok(/names no value/.test(threw.message),
    `the refusal fired but did not say what the label failed to say. It said: ${threw.message}`);
});

/* THE CONSTRUCTED RETURN'S SHAPES -- and the label the corpus carries today is NOT sufficient.
 * Measured against the generator template, not assumed: narrow word 5509 expands to
 *   export default interface <id> { <id>: string <id>: string } export interface <id> { <id>: string <id>: number }
 * so the TEMPLATE owns `export default`, and owns every field TYPE; the payload holes carry the six
 * names and the whitespace; and the label names only the six names. `string` versus `number` is
 * nowhere in the label, so no widening of the grammar can recover it -- the label has to say it.
 * Indentation is the same shape of fact: interface members are tab-indented in 196 lines and
 * space-indented in 5534, and NO file mixes the two, so it is per-file and this file is in the
 * minority. Guessing the majority would corrupt exactly this construct. */
const SHAPES = "src/freshbooks-api/models/AccountBusiness.ts";
const WANT_SHAPES = setUp("the two interface declarations at the top of AccountBusiness.ts", () =>
  declarationIn(SHAPES, "export default interface AccountBusiness", "account_business_id: number\n}"));

ok("the label the corpus carries for these shapes is refused, because it names the fields but never their types", () => {
  const asRendered = "describe the shape `AccountBusiness` with `accountId` and `businessId` "
    + "then describe the shape `AccountBusinessResponse` with `account_id` and `account_business_id`";
  let threw = null;
  try { LS.compileFromLabel(asRendered); } catch (e) { threw = e; }
  assert.ok(threw, "a label that never names a field type compiled anyway, which means it guessed string or number");
  /* MATCHED ON A PHRASE ONLY THE TYPE REFUSAL USES. A bare /type/ also matched the INDENTATION
   * refusal ("names every field type, but does not say how the members are indented"), so this
   * assertion passed with the type check deleted -- a detector that could not fire. Caught by
   * injecting the fault and getting no failure. */
  assert.ok(/names a field but never its type/.test(threw.message),
    `the refusal fired but did not name the missing field type. It said: ${threw.message}`);
});

ok("a label naming every shape, field, field type and the indentation compiles both declarations byte for byte, with no payload at all", () => {
  const label = "describe the shape `AccountBusiness`, exported by default, with `accountId` which is a string "
    + "and `businessId` which is a string, then describe the shape `AccountBusinessResponse` with "
    + "`account_id` which is a string and `account_business_id` which is a number, each member indented with a tab";
  const got = LS.compileFromLabel(label);
  assert.equal(got, WANT_SHAPES, LS.whyTheyDiffer(got, WANT_SHAPES, "pair of shapes"));
});

ok("the wire-format field names survive into the compiled TypeScript exactly as the remote service spells them", () => {
  const label = "describe the shape `AccountBusiness`, exported by default, with `accountId` which is a string "
    + "and `businessId` which is a string, then describe the shape `AccountBusinessResponse` with "
    + "`account_id` which is a string and `account_business_id` which is a number, each member indented with a tab";
  const got = LS.compileFromLabel(label);
  for (const wire of ["account_id", "account_business_id"])
    assert.ok(got.includes(wire + ":"), `the compiled TypeScript no longer declares the wire-format field ${wire}, so a naming pass would have silently broken the integration`);
});

R.done("whether the label alone can be the compiler's source for one construct that round-trips today");
