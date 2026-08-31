"use strict";
/**
 * generators.js — MULTI-LINE GENERATOR engine: the additive middle-tier layer.
 *
 * A generator collapses a run of K consecutive straight-line statements (whose canonical
 * skeleton recurs >=2x across the corpus) into ONE high-level English call. Two axes:
 *   • NARROW (level "op", via operations.js): member/method/ctor names stay in the skeleton.
 *     Maximum skeleton -> maximum byte-elimination. Proven byte-exact by operations.js.
 *   • WIDE (level "opw", local canon here): member/method/ctor/bare-call names ALSO become
 *     typed holes, so renamed-but-identical procedures (user.save / invoice.persist) cluster
 *     as ONE generator. Used ADDITIVELY — only to claim spans NARROW leaves fully verbatim.
 *
 * Byte-exact is absolute and self-enforcing: a window's parts refill (fillOf) to the exact
 * source slice, verified at build (every site) and again at render (every emission). The
 * skeleton lives once in the catalog; the .en carries only per-site hole texts (incl.
 * inter-statement trivia as ‹gap› holes) as a base64 payload. Deterministic; zero model calls
 * (the English gloss is a structural, correctness-irrelevant label).
 */
const ts = require("typescript");
const ops = require("./operations");

/* ------- shared part helpers (a "part" is {lit} or {hole:true,type,text}) ------- */
const keyOf = (parts) => parts.map((p) => (p.lit !== undefined ? p.lit : `‹${p.type}›`)).join("");
const fillOf = (parts) => parts.map((p) => (p.lit !== undefined ? p.lit : p.text)).join("");
const holeTextsOf = (parts) => parts.filter((p) => p.hole).map((p) => p.text);
function refill(key, holeTexts) { let i = 0; return key.replace(/‹\w+›/g, () => holeTexts[i++]); }

/* =============================== WIDE canon (level "opw") =============================== */
let SF = null;
const wlit = (out, s) => { if (s) out.push({ lit: s }); };
const whole = (out, type, text) => out.push({ hole: true, type, text });
function argSpan(call) { const a = call.arguments; if (!a || !a.length) return ""; return SF.text.slice(a[0].getStart(SF), a[a.length - 1].getEnd()); }
function wExpr(n, out) {
  if (!n) return;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) return whole(out, "str", n.getText(SF));
  if (ts.isNumericLiteral(n)) return whole(out, "num", n.getText(SF));
  if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return wlit(out, n.getText(SF));
  if (n.kind === ts.SyntaxKind.ThisKeyword) return wlit(out, "this");
  if (ts.isIdentifier(n)) return whole(out, "id", n.text);
  if (ts.isPropertyAccessExpression(n)) { wExpr(n.expression, out); wlit(out, "."); return whole(out, "m", n.name.text); }
  if (ts.isElementAccessExpression(n)) { wExpr(n.expression, out); wlit(out, "["); wExpr(n.argumentExpression, out); return wlit(out, "]"); }
  if (ts.isAwaitExpression(n)) { wlit(out, "await "); return wExpr(n.expression, out); }
  if (ts.isNonNullExpression(n)) { wExpr(n.expression, out); return wlit(out, "!"); }
  if (ts.isParenthesizedExpression(n)) { wlit(out, "("); wExpr(n.expression, out); return wlit(out, ")"); }
  if (ts.isAsExpression(n)) { wExpr(n.expression, out); wlit(out, " as "); return whole(out, "type", n.type.getText(SF)); }
  if (ts.isPrefixUnaryExpression(n)) { wlit(out, ts.tokenToString(n.operator)); return wExpr(n.operand, out); }
  if (ts.isObjectLiteralExpression(n)) return whole(out, "obj", n.getText(SF));
  if (ts.isArrayLiteralExpression(n)) return whole(out, "arr", n.getText(SF));
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return whole(out, "fn", n.getText(SF));
  if (ts.isSpreadElement(n)) { wlit(out, "..."); return wExpr(n.expression, out); }
  if (ts.isBinaryExpression(n)) { wExpr(n.left, out); wlit(out, " " + n.operatorToken.getText(SF) + " "); return wExpr(n.right, out); }
  if (ts.isConditionalExpression(n)) { wExpr(n.condition, out); wlit(out, " ? "); wExpr(n.whenTrue, out); wlit(out, " : "); return wExpr(n.whenFalse, out); }
  if (ts.isNewExpression(n)) { wlit(out, "new "); if (ts.isIdentifier(n.expression)) whole(out, "ctor", n.expression.text); else wExpr(n.expression, out); wlit(out, "("); const s = argSpan(n); if (s) whole(out, "args", s); return wlit(out, ")"); }
  if (ts.isCallExpression(n)) {
    if (ts.isPropertyAccessExpression(n.expression)) { wExpr(n.expression.expression, out); wlit(out, "."); whole(out, "m", n.expression.name.text); wlit(out, "("); }
    else if (ts.isIdentifier(n.expression)) { whole(out, "id", n.expression.text); wlit(out, "("); }
    else { wExpr(n.expression, out); wlit(out, "("); }
    const s = argSpan(n); if (s) whole(out, "args", s); return wlit(out, ")");
  }
  return whole(out, "expr", n.getText(SF));
}
function wStmt(st) {
  const out = [];
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const d = st.declarationList.declarations[0];
    wlit(out, (st.declarationList.flags & ts.NodeFlags.Const) ? "const " : "let ");
    if (ts.isIdentifier(d.name)) whole(out, "id", d.name.text); else whole(out, "bind", d.name.getText(SF));
    if (d.type) { wlit(out, ": "); whole(out, "type", d.type.getText(SF)); }
    if (d.initializer) { wlit(out, " = "); wExpr(d.initializer, out); }
    wlit(out, ";");
  } else if (ts.isExpressionStatement(st)) { wExpr(st.expression, out); wlit(out, ";"); }
  else if (ts.isReturnStatement(st)) { wlit(out, "return"); if (st.expression) { wlit(out, " "); wExpr(st.expression, out); } wlit(out, ";"); }
  else if (ts.isThrowStatement(st)) { wlit(out, "throw "); wExpr(st.expression, out); wlit(out, ";"); }
  else return null;
  return out;
}

/* =============================== window assembly =============================== */
/**
 * Parts for ONE statement, self-verified byte-exact. canonStmt (narrow) / wStmt (wide) both
 * drop leading modifiers (export/declare/…); we capture that prefix as a ‹mod› hole, then
 * assert fillOf(parts) === the statement's exact source slice. Any statement whose parts do
 * not refill exactly returns null, so its window can never become a generator. Absolute gate.
 */
function stmtPartsExact(st, sf, wide) {
  SF = sf; ops.useSF(sf);
  const core = wide ? wStmt(st) : ops.canonStmt(st, "op");
  if (!core) return null;
  const parts = [];
  if (ts.isVariableStatement(st)) {
    const pre = sf.text.slice(st.getStart(sf), st.declarationList.getStart(sf));
    if (pre) parts.push({ hole: true, type: "mod", text: pre });
  }
  for (const x of core) parts.push(x);
  if (fillOf(parts) !== sf.text.slice(st.getStart(sf), st.getEnd())) return null;
  return parts;
}
/* ---- v2: CONTROL-FLOW-aware canon. A whole if/for/try/switch statement becomes ONE unit
 * so recurring procedures (guard+work, loop bodies, try/catch) fold too. Generic getChildren
 * walk: tokens/keywords stay skeleton, inter-token trivia -> ‹gap›, condition/init expressions
 * -> canonExpr (narrow via operations.js, wide via wExpr), nested statements -> recurse. Every
 * result is self-verified fillOf === exact slice, so an unhandled shape simply doesn't fold. */
const EXPR_GUARDS = [ts.isCallExpression, ts.isBinaryExpression, ts.isPropertyAccessExpression, ts.isElementAccessExpression, ts.isIdentifier, ts.isAwaitExpression, ts.isPrefixUnaryExpression, ts.isPostfixUnaryExpression, ts.isParenthesizedExpression, ts.isConditionalExpression, ts.isObjectLiteralExpression, ts.isArrayLiteralExpression, ts.isTemplateExpression, ts.isNewExpression, ts.isAsExpression, ts.isNonNullExpression, ts.isArrowFunction, ts.isFunctionExpression, ts.isSpreadElement, ts.isTaggedTemplateExpression, ts.isTypeOfExpression, ts.isVoidExpression, ts.isDeleteExpression, ts.isStringLiteralLike, ts.isNumericLiteral];
const isExprNode = (n) => EXPR_GUARDS.some((g) => g(n));
const isSimpleStmt = (st) => ts.isVariableStatement(st) || ts.isExpressionStatement(st) || ts.isReturnStatement(st) || ts.isThrowStatement(st);
const isCFStmt = (st) => ts.isIfStatement(st) || ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st) || ts.isTryStatement(st) || ts.isSwitchStatement(st) || ts.isBlock(st);
/* v3: DECLARATION statements. An import is the single most repetitive construct in the corpus
 * (5,833 of 33,918 statements) and it was not foldable, so it never entered the symbol stream AND
 * it split the run at that point — every file's head was shredded before LZW saw it. Routed
 * through the same generic getChildren walk as control flow, which is self-verifying: identifiers
 * and module specifiers become holes, keywords stay skeleton, and `fillOf !== exact slice` returns
 * null. So this widens what is ELIGIBLE without touching the byte-exact gate. */
const isDeclStmt = (st) => ts.isImportDeclaration(st);
function pushExpr(node, out, wide) { const tmp = []; if (wide) wExpr(node, tmp); else ops.canonExpr(node, tmp, "op"); for (const x of tmp) out.push(x); }
function genericParts(node, sf, wide, out) {
  let cursor = node.getStart(sf);
  for (const kid of node.getChildren(sf)) {
    const ks = kid.getStart(sf), ke = kid.getEnd();
    if (ks > cursor) out.push({ hole: true, type: "gap", text: sf.text.slice(cursor, ks) }); // inter-token trivia
    appendKid(kid, sf, wide, out);
    cursor = ke;
  }
}
function appendKid(kid, sf, wide, out) {
  if (kid.getChildren(sf).length === 0) { // leaf token
    if (ts.isIdentifier(kid)) out.push({ hole: true, type: "id", text: kid.getText(sf) });
    else if (ts.isStringLiteralLike(kid) || ts.isNumericLiteral(kid)) out.push({ hole: true, type: ts.isNumericLiteral(kid) ? "num" : "str", text: kid.getText(sf) });
    else out.push({ lit: kid.getText(sf) }); // keyword / punctuation -> skeleton
    return;
  }
  if (ts.isBlock(kid) || ts.isStatement(kid)) { const p = generalStmtPartsInner(kid, sf, wide); if (p) for (const x of p) out.push(x); else out.push({ hole: true, type: "expr", text: kid.getText(sf) }); return; }
  if (isExprNode(kid)) { pushExpr(kid, out, wide); return; }
  genericParts(kid, sf, wide, out); // SyntaxList, clauses, decl-lists, etc.
}
function generalStmtPartsInner(st, sf, wide) {
  if (isSimpleStmt(st)) return stmtPartsExact(st, sf, wide);
  if (isCFStmt(st) || isDeclStmt(st)) { const out = []; genericParts(st, sf, wide, out); if (fillOf(out) !== sf.text.slice(st.getStart(sf), st.getEnd())) return null; return out; }
  return null;
}
/** foldable statement (simple OR control-flow) -> exact parts | null */
function generalStmtParts(st, sf, wide) { SF = sf; ops.useSF(sf); return generalStmtPartsInner(st, sf, wide); }
const isFoldable = (st) => isSimpleStmt(st) || isCFStmt(st) || isDeclStmt(st);

/**
 * windowParts(stmts, sf, wide) -> { parts, key, holes, fill } | null
 * parts include a ‹gap› hole for the exact inter-statement trivia, so key is whitespace-
 * insensitive (clusters across indentation) while fill restores exact source bytes. Returns
 * null unless every statement refills exactly (checked in stmtPartsExact).
 */
function windowParts(stmts, sf, wide) {
  SF = sf; ops.useSF(sf);
  const parts = [];
  for (let j = 0; j < stmts.length; j++) {
    const p = generalStmtPartsInner(stmts[j], sf, wide);
    if (!p) return null;
    for (const x of p) parts.push(x);
    if (j < stmts.length - 1) parts.push({ hole: true, type: "gap", text: sf.text.slice(stmts[j].getEnd(), stmts[j + 1].getStart(sf)) });
  }
  return { parts, key: keyOf(parts), holes: holeTextsOf(parts), fill: fillOf(parts) };
}

/* skeleton literal byte length of a key (the bytes that leave the .en) */
function skelBytes(key) { return key.replace(/‹\w+›/g, "").length; }

/* deterministic English gloss naming a generator's OPERATION SHAPE (shared across all its
 * sites; per-site names live in the payload). Structural, correctness-irrelevant. */
function glossFor(stmtsCanon) {
  const callName = (k) => { const m = k.match(/\.(\w+)\(/) || k.match(/(?:=\s*|await\s+|throw\s+|^)(\w+)\(/); return m ? m[1] : null; };
  const step = (k) => {
    const c = callName(k);
    if (/^const |^let /.test(k)) return c ? (/await/.test(k) ? "await " + c : "get " + c) : (/await/.test(k) ? "await a value" : "set a local");
    if (/^return/.test(k)) return c ? "return " + c : "return the result";
    if (/^throw/.test(k)) return c ? "throw " + c : "throw";
    return c ? "call " + c : "run a step";
  };
  return stmtsCanon.map(step).join(", then ");
}
/* gloss straight from the statements (handles control flow too) */
function glossForStatements(win, sf) {
  const firstCall = (st) => { let name = null; const v = (n) => { if (name) return; if (ts.isCallExpression(n)) { if (ts.isPropertyAccessExpression(n.expression)) name = n.expression.name.text; else if (ts.isIdentifier(n.expression)) name = n.expression.text; } ts.forEachChild(n, v); }; v(st); return name; };
  const label = (st) => {
    if (ts.isIfStatement(st)) { const c = firstCall(st.thenStatement); return c ? ("if … " + c) : "guard"; }
    if (ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)) { const c = firstCall(st); return c ? ("loop " + c) : "loop"; }
    if (ts.isTryStatement(st)) { const c = firstCall(st.tryBlock); return c ? ("try " + c) : "try/catch"; }
    if (ts.isSwitchStatement(st)) return "switch";
    if (ts.isReturnStatement(st)) { const c = firstCall(st); return c ? "return " + c : "return the result"; }
    if (ts.isThrowStatement(st)) return "throw";
    const c = firstCall(st);
    if (ts.isVariableStatement(st)) return c ? (/await/.test(st.getText(sf).slice(0, 40)) ? "await " + c : "get " + c) : "set a local";
    return c ? "call " + c : "run a step";
  };
  return win.map(label).join(", then ");
}

/* assemble a window from PRE-COMPUTED per-statement parts (cache) + inter-statement gaps.
 * cache[j] = stmtPartsExact(...) | null ; gaps[j] = trivia between stmt j and j+1.
 * Returns { key, holes } | null. Cheap: no re-canonicalization. */
function windowFromCache(cache, gaps, p, K) {
  const parts = [];
  for (let j = p; j < p + K; j++) {
    if (!cache[j]) return null;
    for (const x of cache[j]) parts.push(x);
    if (j < p + K - 1) parts.push({ hole: true, type: "gap", text: gaps[j] });
  }
  return { key: keyOf(parts), holes: holeTextsOf(parts) };
}

module.exports = { keyOf, fillOf, holeTextsOf, refill, windowParts, stmtPartsExact, generalStmtParts, isFoldable, windowFromCache, skelBytes, glossFor, glossForStatements, wStmt };
