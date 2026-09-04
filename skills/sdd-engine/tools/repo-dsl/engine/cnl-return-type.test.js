"use strict";
/* cnl-return-type.test.js — the controlled-English grammar has FORCE: a grammatical sentence
 * compiles to the TypeScript it describes, an ungrammatical one is refused by name, and the
 * signature the compiler emits must not say something the body contradicts.
 *
 * THE DEFECT THIS FILE WAS OPENED ON. cnl.js:151 read
 *
 *     const retType = ctx.async ? "Promise<void>" : "void";
 *
 * unconditionally, so `To add two numbers, taking a first number and a second number: / Return
 * `firstNumber + secondNumber`.` compiled to
 *
 *     export const addTwoNumbers = (firstNumber: number, secondNumber: number): void => {
 *       return firstNumber + secondNumber;
 *     };
 *
 * — a signature promising `void` over a body that returns a number. `tsc` rejects that outright, so
 * the grammar's own output does not typecheck: the north star is "type English and get deterministic
 * code", and code that will not compile is not the deliverable.
 *
 * THE FIX IS AN OMISSION, DELIBERATELY, AND IT IS THE SMALLEST HONEST ONE. When a function returns a
 * VALUE the annotation is dropped and TypeScript infers the type; when it returns nothing it still
 * reads `: void` / `: Promise<void>`. Inferring a type name here would mean guessing one from the
 * clause text — `firstNumber + secondNumber` is `number` only because both parameters are, and the
 * next case would be a string concatenation or a call. A missing annotation loses nothing (tsc
 * computes it); a WRONG annotation is a compile error. So the rule is: annotate only what the
 * grammar actually knows.
 *
 * RED-GREEN. Against cnl.js before the fix this file printed:
 *
 *     FAIL  a function that RETURNS A VALUE is not annotated void
 *     FAIL  the async form does not claim Promise<void> over a returned value
 *     3 assertions passed
 *
 * and after it, 5 passed. The three that were already green are the no-value cases and the refusals
 * — they are the negative control for a fix that could otherwise have just deleted every annotation. */
const assert = require("assert");
const { compile, CnlError, loadWordsIndex } = require("./cnl.js");

const idx = loadWordsIndex([
  { name: "isProduction", call: "isProduction()", englishPhrase: "it is production",
    define: "export const isProduction = (): boolean => (process.env.NODE_ENV === 'production');" },
]);

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

/* 1. THE GRAMMAR ACCEPTS, and what it produces is the function the sentence describes: the name from
 *    the subject, both parameters typed from their nouns, the clause as the body. */
ok("a grammatical sentence compiles to the function it describes", () => {
  const { ts, fnName, params } = compile(
    "To add two numbers, taking a first number and a second number:\n  Return `firstNumber + secondNumber`.", idx);
  assert.equal(fnName, "addTwoNumbers");
  assert.deepEqual(params.map((p) => p.name + ":" + p.type), ["firstNumber:number", "secondNumber:number"]);
  assert.ok(ts.startsWith("export const addTwoNumbers = (firstNumber: number, secondNumber: number)"), ts);
  assert.ok(ts.includes("return firstNumber + secondNumber;"), ts);
});

/* 2. THE FIX. A returned VALUE must not sit under a `void` signature. */
ok("a function that RETURNS A VALUE is not annotated void", () => {
  const { ts } = compile(
    "To add two numbers, taking a first number and a second number:\n  Return `firstNumber + secondNumber`.", idx);
  assert.ok(!/\):\s*void\s*=>/.test(ts), "signature claims void over a returned value:\n" + ts);
  assert.ok(/\)\s*=>\s*\{/.test(ts), ts);
});

/* 3. THE ASYNC FORM, same defect one type deeper. */
ok("the async form does not claim Promise<void> over a returned value", () => {
  const { ts } = compile("To fetch it, taking an action:\n  Run the action.\n  Return `1`.", idx);
  assert.ok(/^export const fetchIt = async \(/.test(ts), ts);
  assert.ok(!/Promise<void> =>/.test(ts), "signature claims Promise<void> over a returned value:\n" + ts);
});

/* 4. THE NEGATIVE CONTROL FOR 2 AND 3, and the reason the fix is not "drop every annotation".
 *    A function that returns NOTHING still says so. */
ok("a function that returns no value keeps its void annotation", () => {
  const { ts } = compile("To sync when prod, taking a sync action:\n" +
    "  When it is production, run the sync and stop.\n" +
    '  Otherwise, warn "Not in production environment: sync skipped."', idx);
  assert.ok(/\): Promise<void> =>/.test(ts), ts);
  const plain = compile("To warn once:\n  Warn \"careful.\"", idx).ts;
  assert.ok(/\): void =>/.test(plain), plain);
});

/* 5. THE GRAMMAR REFUSES, by name, and refuses the near-misses rather than compiling something
 *    plausible. A rule that only ever accepts is not being tested. */
ok("ungrammatical English is refused, and the refusal names the phrase", () => {
  const cases = [
    ["`Otherwise` with no `When` before it", "To be bad:\n  Otherwise, stop.", /must follow a `When`/],
    ["a control word that is not in the grammar", "To be bad:\n  Whenever it is production, stop.", /Whenever it is production/],
    ["a condition phrase nobody coined", "To be bad:\n  When the moon is full, stop.", /moon is full/],
    ["a sentence with no terminator", "To be bad:\n  stop", /end with/],
    ["`run the <noun>` naming no parameter", "To be bad, taking a list:\n  Run the parrot.", /parrot/],
  ];
  for (const [why, src, re] of cases) {
    let threw = null;
    try { compile(src, idx); } catch (e) { threw = e; }
    assert.ok(threw, why + ": compiled instead of refusing");
    assert.ok(threw instanceof CnlError, why + ": threw " + threw.constructor.name + " — " + threw.message);
    assert.ok(re.test(threw.message + " " + (threw.phrase || "")), why + ": refusal did not name it — " + threw.message + " | " + threw.phrase);
  }
});

console.log(`\n${pass} assertions passed`);
