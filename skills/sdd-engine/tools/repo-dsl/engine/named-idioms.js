"use strict";
/**
 * NAMED IDIOMS — first-class, human-named DSL words matched structurally on the
 * AST (deterministic, no model), the same discipline as fetchAndValidate:
 * ts.is* predicates lift the varying parts to TYPED SLOTS, each instance keeps a
 * per-site template of the exact inter-slot bytes, and a site is only claimed
 * when fill(template, slots) === source.slice(start, end) (byte-identity gate).
 *
 *   throwError     = throw new <ErrorClass>(<message>)
 *                    (message = a single string OR template argument; merges the
 *                     string-literal and template-message variants into one word)
 *
 *   assertOrThrow  = if (!<cond>) { throw new <ErrorClass>(<message>) }
 *                    (a negated guard whose single braced body is a throwError —
 *                     it COMPOSES throwError inside the guard)
 *
 * Exports: findThrowError, findAssertOrThrow, mineNamedIdioms, fill.
 */
const ts = require("typescript");
const { findFetchAndValidate, normalizedShape } = require("./idioms.js");

/* ------------------------- template plumbing (byte-exact) ------------------ */

function buildTemplate(source, start, end, slotSpans) {
  const spans = slotSpans.slice().sort((a, b) => a.s - b.s);
  const parts = [];
  const params = [];
  let cur = start;
  for (const sp of spans) {
    if (sp.s > cur) parts.push({ lit: source.slice(cur, sp.s) });
    parts.push({ slot: params.length });
    params.push({ name: sp.name, text: source.slice(sp.s, sp.e) });
    cur = sp.e;
  }
  if (cur < end) parts.push({ lit: source.slice(cur, end) });
  return { parts, params };
}

function fill(parts, params) {
  return parts.map((p) => (p.lit !== undefined ? p.lit : params[p.slot].text)).join("");
}

/* --------------------------- throwError matcher ---------------------------- */

// A message arg we accept: a single string OR template literal (with or without
// substitutions). Kept tight on purpose so every site byte-verifies.
function isMessageArg(node) {
  return ts.isStringLiteral(node) ||
    node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    ts.isTemplateExpression(node);
}

/** Match a `throw new <Id>(<message>)` node -> descriptor, or null. */
function matchThrowError(stmt) {
  if (!ts.isThrowStatement(stmt)) return null;
  const ex = stmt.expression;
  if (!ex || !ts.isNewExpression(ex)) return null;
  const callee = ex.expression;
  if (!ts.isIdentifier(callee)) return null;               // <ErrorClass> is a bare identifier
  const args = ex.arguments;
  if (!args || args.length !== 1) return null;             // exactly one argument
  if (!isMessageArg(args[0])) return null;                 // string | template message
  return { classNode: callee, msgNode: args[0], start: stmt.getStart(), end: stmt.getEnd() };
}

function instanceFromThrow(source, fileName, sf, m) {
  const slotSpans = [
    { name: "errorClass", s: m.classNode.getStart(), e: m.classNode.getEnd() },
    { name: "message", s: m.msgNode.getStart(), e: m.msgNode.getEnd() },
  ].sort((a, b) => a.s - b.s);
  const { parts, params } = buildTemplate(source, m.start, m.end, slotSpans);
  const paramMap = {}; for (const p of params) paramMap[p.name] = p.text;
  const span = source.slice(m.start, m.end);
  return {
    file: fileName, line: sf.getLineAndCharacterOfPosition(m.start).line + 1,
    start: m.start, end: m.end, chars: m.end - m.start,
    messageKind: ts.isStringLiteral(m.msgNode) ? "string" : "template",
    params: paramMap, template: parts, byteIdentical: fill(parts, params) === span,
  };
}

function findThrowError(source, fileName = "x.ts") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const walk = (n) => { const m = matchThrowError(n); if (m) out.push(instanceFromThrow(source, fileName, sf, m)); ts.forEachChild(n, walk); };
  walk(sf);
  return out;
}

/* -------------------------- assertOrThrow matcher -------------------------- */

/** Match `if (!<cond>) { throw new <Id>(<message>) }` -> descriptor, or null. */
function matchAssertOrThrow(stmt) {
  if (!ts.isIfStatement(stmt)) return null;
  if (stmt.elseStatement) return null;
  const cond = stmt.expression;
  if (!ts.isPrefixUnaryExpression(cond) || cond.operator !== ts.SyntaxKind.ExclamationToken) return null;
  const then = stmt.thenStatement;
  if (!ts.isBlock(then) || then.statements.length !== 1) return null;   // single braced body
  const inner = matchThrowError(then.statements[0]);
  if (!inner) return null;                                              // body IS a throwError
  return { condNode: cond.operand, inner, start: stmt.getStart(), end: stmt.getEnd() };
}

function findAssertOrThrow(source, fileName = "x.ts") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const walk = (n) => {
    const m = matchAssertOrThrow(n);
    if (m) {
      const slotSpans = [
        { name: "cond", s: m.condNode.getStart(), e: m.condNode.getEnd() },
        { name: "errorClass", s: m.inner.classNode.getStart(), e: m.inner.classNode.getEnd() },
        { name: "message", s: m.inner.msgNode.getStart(), e: m.inner.msgNode.getEnd() },
      ].sort((a, b) => a.s - b.s);
      const { parts, params } = buildTemplate(source, m.start, m.end, slotSpans);
      const paramMap = {}; for (const p of params) paramMap[p.name] = p.text;
      const span = source.slice(m.start, m.end);
      out.push({
        file: fileName, line: sf.getLineAndCharacterOfPosition(m.start).line + 1,
        start: m.start, end: m.end, chars: m.end - m.start,
        composes: "throwError",
        params: paramMap, template: parts, byteIdentical: fill(parts, params) === span,
        // the byte range of the inner throwError this guard wraps (composition link)
        innerThrow: { start: m.inner.start, end: m.inner.end },
      });
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/* ------------------------------ vocabulary --------------------------------- */

const DEFS = {
  fetchAndValidate: { tier: "idiom", hint: "fetchAndValidate", dsl: normalizedShape(),
    params: ["recv", "selector", "entity", "opts", "guardExpr", "action"] },
  throwError: { tier: "idiom", hint: "throwError", dsl: "throw new <errorClass>(<message>)",
    params: ["errorClass", "message"] },
  assertOrThrow: { tier: "idiom", hint: "assertOrThrow", dsl: "if (!<cond>) { throw new <errorClass>(<message>) }  // composes throwError",
    params: ["cond", "errorClass", "message"] },
};

/**
 * Run all three named-idiom matchers over a list of {rel, source} files and
 * assemble idiom-word objects in the shape the artifacts expect (members[] +
 * membersFull[] with per-site templates, byteIdentical counts, file spread).
 */
function mineNamedIdioms(files) {
  const collect = (finder) => {
    const all = [];
    for (const f of files) { let inst; try { inst = finder(f.source, f.rel); } catch (_) { continue; } for (const x of inst) all.push(x); }
    return all;
  };
  const fav = collect(findFetchAndValidate);
  const thr = collect(findThrowError);
  const aot = collect(findAssertOrThrow);

  const wordOf = (name, list, selKeyer) => {
    const d = DEFS[name];
    const byteIdentical = list.filter((m) => m.byteIdentical).length;
    const variant = selKeyer ? list.reduce((a, m) => { const k = selKeyer(m); a[k] = (a[k] || 0) + 1; return a; }, {}) : undefined;
    return {
      name, tier: d.tier, hint: d.hint, dsl: d.dsl, params: d.params,
      sites: list.length, files: new Set(list.map((m) => m.file)).size,
      byteIdentical, charsCovered: list.reduce((a, m) => a + m.chars, 0),
      variantBreakdown: variant,
      members: list.map((m) => ({ file: m.file, line: m.line, byteIdentical: m.byteIdentical, params: m.params,
        ...(m.selector ? { selector: m.selector } : {}), ...(m.messageKind ? { messageKind: m.messageKind } : {}),
        ...(m.composes ? { composes: m.composes } : {}) })),
      membersFull: list.map((m) => ({ file: m.file, line: m.line, start: m.start, end: m.end, chars: m.chars,
        params: m.params, template: m.template, byteIdentical: m.byteIdentical,
        ...(m.innerThrow ? { innerThrow: m.innerThrow } : {}) })),
    };
  };
  return {
    fetchAndValidate: wordOf("fetchAndValidate", fav, (m) => m.selector),
    throwError: wordOf("throwError", thr, (m) => m.messageKind),
    assertOrThrow: wordOf("assertOrThrow", aot),
  };
}

module.exports = { findThrowError, findAssertOrThrow, matchThrowError, matchAssertOrThrow, mineNamedIdioms, fill, DEFS };
