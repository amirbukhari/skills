"use strict";
/**
 * named-idioms.test.js — runnable node test (exits non-zero on any failure).
 * Proves the throwError / assertOrThrow matchers fire on the AST, extract the
 * right slots, byte-verify (fill(template,slots) === span), and that
 * assertOrThrow genuinely composes a throwError in its guard body.
 *
 *   node engine/named-idioms.test.js
 */
const { findThrowError, findAssertOrThrow, matchThrowError } = require("./named-idioms.js");

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("  FAIL:", msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

/* ---- throwError: string message ---- */
{
  const src = `function f(x){ if (x) return; throw new NotFoundError("no such invoice"); }`;
  const hits = findThrowError(src, "a.ts");
  eq(hits.length, 1, "throwError string: one hit");
  eq(hits[0].params.errorClass, "NotFoundError", "throwError string: errorClass slot");
  eq(hits[0].params.message, `"no such invoice"`, "throwError string: message slot (verbatim, quotes kept)");
  eq(hits[0].messageKind, "string", "throwError string: messageKind");
  ok(hits[0].byteIdentical, "throwError string: byte-identical");
}

/* ---- throwError: template message ---- */
{
  const src = "throw new ValidationError(`bad id ${id} for ${name}`);";
  const hits = findThrowError(src, "b.ts");
  eq(hits.length, 1, "throwError template: one hit");
  eq(hits[0].params.errorClass, "ValidationError", "throwError template: errorClass");
  eq(hits[0].messageKind, "template", "throwError template: messageKind");
  ok(hits[0].params.message.includes("${id}"), "throwError template: message keeps substitutions");
  ok(hits[0].byteIdentical, "throwError template: byte-identical");
}

/* ---- throwError: must NOT match multi-arg or non-new throws ---- */
{
  ok(findThrowError(`throw new Error("a", "b");`).length === 0, "throwError: two-arg new is rejected");
  ok(findThrowError(`throw err;`).length === 0, "throwError: throw identifier is rejected");
  ok(findThrowError(`throw new Error();`).length === 0, "throwError: zero-arg new is rejected");
  ok(findThrowError(`throw new HttpError(404, "nope");`).length === 0, "throwError: numeric-first two-arg rejected");
}

/* ---- assertOrThrow: braced negated guard wrapping a throwError ---- */
{
  const src = `function g(user){ if (!user) { throw new UnauthorizedError("login required"); } return user; }`;
  const hits = findAssertOrThrow(src, "c.ts");
  eq(hits.length, 1, "assertOrThrow: one hit");
  eq(hits[0].params.cond, "user", "assertOrThrow: cond slot (operand of !)");
  eq(hits[0].params.errorClass, "UnauthorizedError", "assertOrThrow: errorClass slot");
  eq(hits[0].params.message, `"login required"`, "assertOrThrow: message slot");
  eq(hits[0].composes, "throwError", "assertOrThrow: declares composition of throwError");
  ok(hits[0].byteIdentical, "assertOrThrow: byte-identical");
  // composition is real: the inner throw span IS a throwError
  const innerSrc = src.slice(hits[0].innerThrow.start, hits[0].innerThrow.end);
  ok(findThrowError(innerSrc).length === 1, "assertOrThrow: inner span is itself a throwError");
}

/* ---- assertOrThrow: negated member/complex cond ---- */
{
  const src = `if (!invoice?.lineItems?.length) { throw new BadRequestError("empty invoice"); }`;
  const hits = findAssertOrThrow(src, "d.ts");
  eq(hits.length, 1, "assertOrThrow complex cond: one hit");
  eq(hits[0].params.cond, "invoice?.lineItems?.length", "assertOrThrow: complex cond captured verbatim");
  ok(hits[0].byteIdentical, "assertOrThrow complex cond: byte-identical");
}

/* ---- assertOrThrow: must NOT match unbraced or multi-statement or else-bearing ---- */
{
  ok(findAssertOrThrow(`if (!x) throw new Error("u");`).length === 0, "assertOrThrow: unbraced body rejected");
  ok(findAssertOrThrow(`if (!x) { log(); throw new Error("m"); }`).length === 0, "assertOrThrow: multi-statement body rejected");
  ok(findAssertOrThrow(`if (!x) { throw new Error("m"); } else { y(); }`).length === 0, "assertOrThrow: else-bearing rejected");
  ok(findAssertOrThrow(`if (x) { throw new Error("m"); }`).length === 0, "assertOrThrow: non-negated cond rejected");
}

console.log(`named-idioms.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
