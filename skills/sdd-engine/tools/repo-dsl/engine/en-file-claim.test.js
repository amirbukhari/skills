"use strict";
/* en-file-claim.test.js — the executable half of "THE FILE-SCALE LABEL IS A CLAIM, NOT A
 * CONCATENATION". Every section pins a rule that was WRONG first and got measured into shape; the
 * superseded behaviour is quoted so a stale memory cannot re-derive it (CLAUDE.md §9). */

const assert = require("assert");
const FC = require("./en-file-claim.js");

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); console.log("ok  - " + name); pass++; }
  catch (e) { console.log("FAIL- " + name + "\n      " + (e && e.message)); fail++; }
}

/* ---- 1. THE TRIGGER IS CONTENT, NOT POSITION ------------------------------------------------ */

ok("1a. a run with imports AND declarations gets a claim", () => {
  const c = FC.claimForText("import { a } from 'x';\nexport interface S { q: number }\nexport interface T { r: number }\n");
  assert.ok(c, "expected a claim");
  assert.match(c, /2 shapes/);
});

ok("1b. an INNER run gets none — no imports, so not a whole file", () => {
  /* This is the whole reason the trigger is not positional. `deriveStructuralGloss` re-derives an
   * inner body in isolation, where its own start is 0 and its end is its own length, so ANY
   * positional test ("am I at the top of a file?") is true for inner chunks too and the render and
   * compile sides disagree on every one of them. Measured when the gate was positional: 533 of
   * 1038 files refused with "SENTENCE AND PAYLOAD DISAGREE". */
  assert.strictEqual(FC.claimForText("const a = 1;\nconst b = 2;\n"), null);
});

ok("1c. imports with nothing else say nothing", () => {
  assert.strictEqual(FC.claimForText("import { a } from 'x';\nimport { b } from 'y';\n"), null);
});

ok("1d. a re-export barrel triggers too — same top-level-only warrant", () => {
  /* Added after the goal test showed the import-only trigger left the corpus's two WORST labels
   * standing: `src/freshbooks-api/models/index.ts` at 47 words and a components barrel at 31, both
   * pure re-export files with no imports at all. */
  const c = FC.claimForText("export { A } from './A';\nexport { B } from './B';\nexport interface S { q: number }\n");
  assert.ok(c, "expected a claim for a barrel");
});

/* ---- 2. IT NAMES ZERO IMPORTS --------------------------------------------------------------- */

ok("2. the claim names no import — §4B settled that imports are foldable", () => {
  const c = FC.claimForText("import { createClient } from 'redis';\nimport { intVal } from 'util';\nexport function f() {}\nexport function g() {}\n");
  assert.ok(c);
  assert.ok(!/createClient|intVal|redis/.test(c), "claim leaked an import: " + c);
  assert.match(c, /2 functions/);
});

/* ---- 3. AMIR'S SENTENCE --------------------------------------------------------------------- */

const LINKS = `import Router from '@koa/router';
import { isValidJwt } from '../jwt';
import { authorizeFreshbooksAccount, getSavedFreshbooksTokenData } from '../freshbooks-api/auth';
export const linksRouter = new Router({ prefix: '/links' });
linksRouter.get(
  '/client/:freshbooksClientId/invoice/:invoiceId',
  validate<void, IInvoiceAndAccountId, IToken>({ params: validateInvoiceAndAccountId }),
  async (ctx) => {
    const freshbooksClientId = intVal(ctx.params.freshbooksClientId);
    if (await isValidJwt(\`\${token}\`)) { return; }
  },
);
linksRouter.get(
  '/authorized',
  validate<void, void, ICode>({ query: validateCode }),
  async (ctx) => {
    const response = await authorizeFreshbooksAccount(code);
    const { expiry } = await getSavedFreshbooksTokenData();
  },
);
`;

ok("3a. it counts, classifies, states a shared property, and names the prefix", () => {
  const c = FC.claimForText(LINKS);
  assert.strictEqual(c, "The `links` router exposes two Freshbooks GET endpoints under `/links`, both behind a `validate` guard");
});

ok("3b. and it does NOT say 'both behind a JWT check'", () => {
  /* AMIR'S OWN APPROVED TARGET SENTENCE WAS FALSE ABOUT HIS OWN CODE, and this assertion is the
   * reason the honesty rule is a rule rather than a preference. He approved:
   *
   *     The `links` router exposes two Freshbooks endpoints, both behind a JWT check.
   *
   * `isValidJwt` is imported once and called once, inside the FIRST route only; `/authorized` is a
   * Freshbooks authorisation callback with no JWT reference anywhere in it. The count was right,
   * the classification was right, and the shared property was wrong — and wrong in the direction
   * that sends a reader looking for a check that is not there. A human wrote that sentence from the
   * file and it still was not true, which is the whole argument: the target has to be DERIVED and
   * VERIFIED, never authored. */
  const c = FC.claimForText(LINKS);
  assert.ok(!/JWT|Jwt/.test(c), "claim asserted a JWT check over both routes: " + c);
});

/* ---- 4. THE HONESTY RULE, EXECUTABLE -------------------------------------------------------- */

ok("4a. quantifiers are derived from counts and cannot overstate", () => {
  assert.strictEqual(FC.quantify(2, 2), "both");
  assert.strictEqual(FC.quantify(3, 3), "all");
  assert.strictEqual(FC.quantify(3, 4), "most");
  assert.strictEqual(FC.quantify(2, 4), "some", "exactly half is SOME, not most");
  assert.strictEqual(FC.quantify(0, 4), null);
});

ok("4b. a minority shared property is not stated at all", () => {
  /* Measured over-claim, pinned with the file that produced it: `src/xero-api/contact.ts` came out
   * "12 functions and 1 type, SOME behind a `checkForFbClientsNotInXeroWithInvoices` guard" off ONE
   * of twelve functions calling a domain helper whose name starts with `check`. The count was
   * honest; the word "guard" was a misclassification. */
  const items = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }];
  assert.strictEqual(FC.quantify(1, 4), "some");
  const c = FC.claimForText(LINKS.replace("if (await isValidJwt(`${token}`)) { return; }", "noop();"));
  assert.ok(c && !/some behind/.test(c), "a minority property reached the label: " + c);
});

ok("4c. a domain word comes from identifiers, never from a string literal", () => {
  /* With literals included, `links.ts` read "two **Credentials** GET endpoints": both routes answer
   * failure with `'Invalid credentials'`, and "credentials" (11) beat "freshbooks" (10) on the
   * longest-wins tiebreak. An error message is not a classification of an endpoint. */
  const withMsg = LINKS.replace("noop();", "").replace(
    "const response = await authorizeFreshbooksAccount(code);",
    "const response = await authorizeFreshbooksAccount(code); err({ error: 'Invalid credentials' });")
    .replace("if (await isValidJwt(`${token}`)) { return; }",
             "if (await isValidJwt(`${token}`)) { return; } err({ error: 'Invalid credentials' });");
  const c = FC.claimForText(withMsg);
  assert.ok(c && !/Credential/i.test(c), "a string literal became the domain word: " + c);
});

ok("4d. and a domain word must recur across the run, not merely be shared", () => {
  /* Shared-across and recurs-within are DIFFERENT PROPERTIES OF DIFFERENT SUBJECTS — §16's failure
   * class 6, met while tuning a threshold. Requiring the recurrence PER ROUTE instead of per file
   * killed the one label this module was built for: `links.ts`'s first route spells `freshbooks` in
   * exactly one identifier while the file spells it in three. */
  const c = FC.claimForText(LINKS);
  assert.match(c, /Freshbooks/, "the file-wide recurrence threshold stopped admitting a real domain");
});

ok("4e. vacuous is COUNTED, never dressed up", () => {
  FC.resetStats();
  assert.strictEqual(FC.claimForText("import { a } from 'x';\ndeclare module 'z' {}\n"), null);
  assert.ok(FC.stats.skipped >= 1, "a triggered-but-silent run was not counted: " + JSON.stringify(FC.stats));
  assert.strictEqual(FC.stats.fired, 0);
});

/* ---- 5. THE WORD BUDGET -------------------------------------------------------------------- */

ok("5. the label stays inside Amir's 'a couple dozen words'", () => {
  const c = FC.claimForText(LINKS);
  const n = FC.labelWords(c);
  assert.ok(n <= 24, "label ran to " + n + " words: " + c);
  /* the superseded design, kept so it cannot be re-derived:
   * >   the first line of `src/routers/links.ts.en` was a ~200-word run-on that named all fifteen
   * >   imports and then every route, joined by "then" — the label Amir read when he said
   * >   "You lied to me." */
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
