"use strict";
/**
 * IDIOM WORDS — first-class multi-statement DSL words matched structurally on the
 * AST (deterministic, no model). The flagship is `fetchAndValidate`: the
 * fetch-and-validate composite
 *
 *     const <var> = [await] <recv>.<find|findOne|findByPk>(<entity>[, <opts>]);
 *     if (!<guardExpr>) { <throw|return ...> }
 *
 * The variation that fragments the raw LZW mine — the receiver chain
 * (`manager` / `getManager('hydra')` / `readManager`), the find selector, the
 * `{ where: … }` options subtree, the negated condition subtree, and the guard
 * action — are all lifted to TYPED SLOTS. So every site is an instance of ONE
 * word, differing only in its params. Each instance keeps its own template (the
 * exact inter-slot bytes, incl. indentation / optional `await` / braces), so
 * `fill(template, params)` reproduces the original span byte-for-byte. Byte-verify
 * is the gate: a site is only claimed when fill === source-span.
 *
 * Exports: findFetchAndValidate(source, fileName) -> [instance], expandInstance,
 *          canonicalSignature, normalizedShape.
 */
const ts = require("typescript");

const FIND_SELECTORS = new Set(["find", "findOne", "findByPk", "findOneBy", "findOneOrFail"]);

function textOf(node, source) { return source.slice(node.getStart(), node.getEnd()); }

/** Unwrap `await X` -> X (records awaited flag). */
function unwrapAwait(node) {
  if (ts.isAwaitExpression(node)) return { awaited: true, expr: node.expression };
  return { awaited: false, expr: node };
}

/** Match a fetch statement -> descriptor, or null. */
function matchFetch(stmt, source) {
  if (!ts.isVariableStatement(stmt)) return null;
  const decls = stmt.declarationList.declarations;
  if (decls.length !== 1) return null;
  const d = decls[0];
  if (!d.initializer || !ts.isIdentifier(d.name)) return null;
  const { awaited, expr } = unwrapAwait(d.initializer);
  if (!ts.isCallExpression(expr)) return null;
  const callee = expr.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const sel = callee.name.getText();
  if (!FIND_SELECTORS.has(sel)) return null;
  const args = expr.arguments;
  if (args.length < 1) return null;
  return {
    varName: d.name.getText(),
    varNameNode: d.name,
    awaited,
    recvNode: callee.expression,      // the receiver chain subtree
    selName: sel,
    selNode: callee.name,
    entityNode: args[0],
    optsNode: args.length >= 2 ? args[1] : null,
    start: stmt.getStart(), end: stmt.getEnd(),
  };
}

/** Match `if (!<expr>) { throw|return … }` (braced or single) -> descriptor, or null. */
function matchGuard(stmt, source) {
  if (!ts.isIfStatement(stmt)) return null;
  const cond = stmt.expression;
  if (!ts.isPrefixUnaryExpression(cond) || cond.operator !== ts.SyntaxKind.ExclamationToken) return null;
  let action = null, braced = false;
  const then = stmt.thenStatement;
  const isAction = (s) => ts.isThrowStatement(s) || ts.isReturnStatement(s);
  if (ts.isBlock(then)) {
    if (then.statements.length !== 1 || !isAction(then.statements[0])) return null;
    action = then.statements[0]; braced = true;
  } else if (isAction(then)) {
    action = then;
  } else return null;
  if (stmt.elseStatement) return null; // keep the idiom clean: no else
  return {
    guardExprNode: cond.operand,       // the negated condition subtree (EXPR slot)
    braced,
    actionKind: ts.isThrowStatement(action) ? "throw" : "return",
    actionNode: action,
    start: stmt.getStart(), end: stmt.getEnd(),
  };
}

/** Build a hollowed template (literal parts + slot indices) over [start,end). */
function buildTemplate(source, start, end, slotSpans) {
  // slotSpans: [{name, s, e}] non-overlapping, within [start,end)
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

/** Find every fetch-and-validate instance in a file (adjacent fetch then guard). */
function findFetchAndValidate(source, fileName = "x.ts") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const instances = [];
  const visitBlockLike = (statements) => {
    for (let i = 0; i < statements.length - 1; i++) {
      const f = matchFetch(statements[i], source);
      if (!f) continue;
      const g = matchGuard(statements[i + 1], source);
      if (!g) continue;
      const start = f.start, end = g.end;
      const slotSpans = [
        { name: "recv", s: f.recvNode.getStart(), e: f.recvNode.getEnd() },
        { name: "selector", s: f.selNode.getStart(), e: f.selNode.getEnd() },
        { name: "var", s: f.varNameNode.getStart(), e: f.varNameNode.getEnd() },
        { name: "entity", s: f.entityNode.getStart(), e: f.entityNode.getEnd() },
        { name: "guardExpr", s: g.guardExprNode.getStart(), e: g.guardExprNode.getEnd() },
        { name: "action", s: g.actionNode.getStart(), e: g.actionNode.getEnd() },
      ];
      if (f.optsNode) slotSpans.push({ name: "opts", s: f.optsNode.getStart(), e: f.optsNode.getEnd() });
      // guardExpr subtree may contain the fetch var; that's fine (it's inside its own slot).
      // ensure non-overlap (defensive): drop any span nested inside another.
      slotSpans.sort((a, b) => a.s - b.s || b.e - a.e);
      const clean = [];
      let lastEnd = -1;
      for (const sp of slotSpans) { if (sp.s >= lastEnd) { clean.push(sp); lastEnd = sp.e; } }
      const { parts, params } = buildTemplate(source, start, end, clean);
      const paramMap = {};
      for (const p of params) paramMap[p.name] = p.text;
      const span = source.slice(start, end);
      const rebuilt = fill(parts, params);
      instances.push({
        file: fileName,
        line: sf.getLineAndCharacterOfPosition(start).line + 1,
        start, end, chars: end - start,
        awaited: f.awaited, selector: f.selName, braced: g.braced, actionKind: g.actionKind,
        params: paramMap,
        template: parts,
        byteIdentical: rebuilt === span,
        signature: canonicalSignature({ awaited: f.awaited, selector: f.selName, braced: g.braced, actionKind: g.actionKind, params: paramMap }),
        normShape: normalizedShape(),
      });
    }
  };
  // walk every block/source-file body
  const walk = (node) => {
    if (ts.isSourceFile(node)) visitBlockLike(node.statements);
    else if (ts.isBlock(node) || ts.isModuleBlock(node)) visitBlockLike(node.statements);
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return instances;
}

/** Readable DSL surface for a member instance. */
function canonicalSignature(x) {
  const p = x.params;
  return `fetchAndValidate(recv=${p.recv}, sel=${x.selector}, entity=${p.entity}` +
    (p.opts !== undefined ? `, opts=${short(p.opts)}` : "") +
    `, guard=!${short(p.guardExpr)}, ${x.actionKind}=${short(p.action)})`;
}
function short(s) { s = (s || "").replace(/\s+/g, " ").trim(); return s.length > 48 ? s.slice(0, 45) + "…" : s; }

/** The single normalized shape all members collapse onto (the "one word"). */
function normalizedShape() {
  return "const <var> = [await] <recv>.<sel>(<entity>[, <opts>]); if (!<guardExpr>) { <action> }";
}

module.exports = { findFetchAndValidate, fill, canonicalSignature, normalizedShape, FIND_SELECTORS };
