"use strict";
/**
 * operations.js — ANTI-UNIFICATION core (least-general generalization) for statement
 * and function operation patterns. Shared by measure-operations.js (STEP 3 discovery)
 * and build-operation-idioms.js (STEP 4 catalog) so discovery + verification never
 * diverge. Deterministic; zero model calls.
 *
 * A statement is generalized by walking its AST and replacing whole node CLASSES with
 * TYPED HOLES, keeping the shared skeleton verbatim. Each hole captures the exact source
 * span it abstracted, so keyOf(parts) is the cluster template and fillOf(parts) rebuilds
 * the site's ORIGINAL bytes — the byte-exact refill guarantee.
 *
 * Aggressiveness knob (level):
 *   struct : abstract only ATOMS (identifiers, string/number literals, objects, arrows);
 *            keep every call/method name and argument arity.
 *   op     : also fold each argument list into one ‹args› hole (drops arity) and collapse
 *            a chain rooted at a bare function call — ROOT(args).a().b()…term() — into
 *            ROOT(‹args›)⟨chain⟩ (whole filter/join/aggregate tail, any terminal, is one
 *            hole). This is the OPERATION level.
 */
const ts = require("typescript");

let SF = null;
function useSF(sf) { SF = sf; return sf; }

function chainSegments(call) {
  const segs = []; let cur = call;
  while (ts.isCallExpression(cur) && ts.isPropertyAccessExpression(cur.expression)) {
    segs.unshift({ call: cur, method: cur.expression.name.text });
    cur = cur.expression.expression;
  }
  return { base: cur, segs };
}
function argSpan(call) {
  if (!call.arguments.length) return "";
  return SF.text.slice(call.arguments[0].getStart(SF), call.arguments[call.arguments.length - 1].getEnd());
}
const lit = (out, s) => { if (s) out.push({ lit: s }); };
const hole = (out, type, text) => out.push({ hole: true, type, text });

/* ── EXPRESSION IDENTITY IS A SLOT, NOT SKELETON (2026-09-03) ────────────────────────────────────
 * The callee of a call and the name of a property access used to be emitted as LITERALS, i.e. as
 * part of the skeleton. So `b(c)` and `a(b(c))` were two unrelated dictionary entries, and `a.b`
 * and `a.b.c.d` two more — measured on the synthetic mutation table, four of the six COMPOSED rows
 * failed for exactly this reason and no other. It is the same defect as the nested-statement body
 * baking fixed in 2d83452, one level down the tree: the PARENT's pattern was carrying the CHILD's
 * identity.
 *
 * WHY A SEPARATE HOLE TYPE PER ROLE (`callee`, `prop`) RATHER THAN REUSING `id`. The type is what
 * `keyOf` prints into the skeleton, so it is the only thing distinguishing `‹callee›(‹args›)` from
 * `‹id›(‹args›)` — and those are different shapes worth telling apart when reading a skeleton or
 * writing a production against one. It costs nothing: `skelBytes` strips every `‹\w+›` alike.
 *
 * WHY BYTE-EXACTNESS IS UNAFFECTED. Each hole carries the identifier's exact text, and the
 * surrounding punctuation stays literal, so `fillOf` is unchanged character for character. Every
 * caller is still gated by its own `fillOf === exact slice` check.
 *
 * ── MEASURED, AND WHY IT SHIPS DEFAULT-OFF (2026-09-03) ────────────────────────────────────────
 * Four full corpus mines, 1037 files, byte-identity 1037/1037 in every one:
 *
 *   EXPR_SLOT  MIN_SKEL   narrow leaves   catalog    top surface   tree     residual
 *      0          8           4,787       33.76 MB      1,582      20,999      548     <- today
 *      1          8           2,353       32.69 MB      3,457      23,820    2,423     <- REGRESSION
 *      0          1           4,787       34.42 MB      1,086      20,214       52
 *      1          1           2,353       33.68 MB      1,086      20,214       52     <- dominates
 *
 * The dictionary result is unambiguous: expression slots HALVE the narrow leaf count (4,787 ->
 * 2,353) and collapse the narrow axis onto the wide one, which is the whole point — `b(c)` and
 * `a(b(c))` become one pattern. But at MIN_SKEL=8 that win costs 1,875 top-level review surface,
 * and the mechanism is arithmetic rather than semantic: `skelBytes` strips every `‹\w+›` before
 * applying the floor, so every identifier converted from skeleton to slot SUBTRACTS from the length
 * the floor is applied to. `‹id›.b` measured 2 bytes; `‹id›.‹prop›` measures 1. Skeletons that
 * cleared 8 under baked identifiers no longer clear it, the word is refused, and the statements it
 * covered fall through to residual — 548 -> 2,423.
 *
 * SO THE TWO CHANGES ARE NOT INDEPENDENT: expression slots are only admissible together with a
 * lower floor. And MIN_SKEL is fixed at 8 by R-MINE-3 ("MUST stay 8") and §4B, so lowering it is a
 * PRD amendment and not this file's call. Until that ruling exists the dial ships OFF, because
 * landing it on would put a measured 1,875-surface regression in the tree in exchange for a
 * dictionary win nothing yet consumes.
 *
 * SDD_EXPR_SLOT=1 turns it on, so the two dictionaries can be mined side by side rather than argued
 * about. Flip this default in the same commit that lowers MIN_SKEL, never before. */
const EXPR_SLOT = process.env.SDD_EXPR_SLOT === "1";
/* emit an identifier that names something (a callee, a property) as a slot or, under the dial, as
 * the literal it used to be. `pre`/`post` are the punctuation around it, which is always skeleton. */
const nameSlot = (out, type, text, pre, post) => {
  if (pre) lit(out, pre);
  if (EXPR_SLOT) hole(out, type, text); else lit(out, text);
  if (post) lit(out, post);
};

function canonArgs(call, out, level) {
  if (level === "op") { const s = argSpan(call); if (s) hole(out, "args", s); return; }
  call.arguments.forEach((a, i) => { if (i) lit(out, ", "); canonExpr(a, out, level); });
}
function canonCall(call, out, level) {
  if (level === "op") {
    const { base, segs } = chainSegments(call);
    if (segs.length >= 1 && ts.isCallExpression(base) && ts.isIdentifier(base.expression)) {
      nameSlot(out, "callee", base.expression.text, "", "(");
      canonArgs(base, out, level);
      lit(out, ")");
      const tail = SF.text.slice(base.getEnd(), call.getEnd());
      if (tail) hole(out, "chain", tail);
      return;
    }
  }
  if (ts.isPropertyAccessExpression(call.expression)) {
    canonExpr(call.expression.expression, out, level);
    nameSlot(out, "callee", call.expression.name.text, ".", "(");
  } else if (ts.isIdentifier(call.expression)) {
    nameSlot(out, "callee", call.expression.text, "", "(");
  } else { canonExpr(call.expression, out, level); lit(out, "("); }
  canonArgs(call, out, level); lit(out, ")");
}
function canonExpr(n, out, level) {
  if (!n) return;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) return hole(out, "str", n.getText(SF));
  if (ts.isNumericLiteral(n)) return hole(out, "num", n.getText(SF));
  if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) return lit(out, n.getText(SF));
  if (n.kind === ts.SyntaxKind.ThisKeyword) return lit(out, "this");
  if (ts.isIdentifier(n)) return hole(out, "id", n.text);
  if (ts.isPropertyAccessExpression(n)) { canonExpr(n.expression, out, level); return nameSlot(out, "prop", n.name.text, ".", ""); }
  if (ts.isElementAccessExpression(n)) { canonExpr(n.expression, out, level); lit(out, "["); canonExpr(n.argumentExpression, out, level); return lit(out, "]"); }
  if (ts.isAwaitExpression(n)) { lit(out, "await "); return canonExpr(n.expression, out, level); }
  if (ts.isNonNullExpression(n)) { canonExpr(n.expression, out, level); return lit(out, "!"); }
  if (ts.isParenthesizedExpression(n)) { lit(out, "("); canonExpr(n.expression, out, level); return lit(out, ")"); }
  if (ts.isAsExpression(n)) { canonExpr(n.expression, out, level); lit(out, " as "); return hole(out, "type", n.type.getText(SF)); }
  if (ts.isPrefixUnaryExpression(n)) { lit(out, ts.tokenToString(n.operator)); return canonExpr(n.operand, out, level); }
  if (ts.isObjectLiteralExpression(n)) return hole(out, "obj", n.getText(SF));
  if (ts.isArrayLiteralExpression(n)) return hole(out, "arr", n.getText(SF));
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return hole(out, "fn", n.getText(SF));
  if (ts.isSpreadElement(n)) { lit(out, "..."); return canonExpr(n.expression, out, level); }
  if (ts.isBinaryExpression(n)) { canonExpr(n.left, out, level); lit(out, " " + n.operatorToken.getText(SF) + " "); return canonExpr(n.right, out, level); }
  if (ts.isConditionalExpression(n)) { canonExpr(n.condition, out, level); lit(out, " ? "); canonExpr(n.whenTrue, out, level); lit(out, " : "); return canonExpr(n.whenFalse, out, level); }
  if (ts.isNewExpression(n)) { lit(out, "new "); if (ts.isIdentifier(n.expression)) lit(out, n.expression.text); else canonExpr(n.expression, out, level); lit(out, "("); if (n.arguments) canonArgs(n, out, level); return lit(out, ")"); }
  if (ts.isCallExpression(n)) return canonCall(n, out, level);
  return hole(out, "expr", n.getText(SF));
}
function canonStmt(st, level) {
  const out = [];
  if (ts.isVariableStatement(st) && st.declarationList.declarations.length === 1) {
    const d = st.declarationList.declarations[0];
    const kw = (st.declarationList.flags & ts.NodeFlags.Const) ? "const " : "let ";
    lit(out, kw);
    if (ts.isIdentifier(d.name)) hole(out, "id", d.name.text); else hole(out, "bind", d.name.getText(SF));
    if (d.type) { lit(out, ": "); hole(out, "type", d.type.getText(SF)); }
    if (d.initializer) { lit(out, " = "); canonExpr(d.initializer, out, level); }
    lit(out, ";");
  } else if (ts.isExpressionStatement(st)) { canonExpr(st.expression, out, level); lit(out, ";"); }
  else if (ts.isReturnStatement(st)) { lit(out, "return"); if (st.expression) { lit(out, " "); canonExpr(st.expression, out, level); } lit(out, ";"); }
  else if (ts.isThrowStatement(st)) { lit(out, "throw "); canonExpr(st.expression, out, level); lit(out, ";"); }
  else return null;
  return out;
}
const keyOf = (parts) => parts.map((p) => p.lit !== undefined ? p.lit : `‹${p.type}›`).join("");
const fillOf = (parts) => parts.map((p) => p.lit !== undefined ? p.lit : p.text).join("");
const holeTypes = (parts) => parts.filter((p) => p.hole).map((p) => p.type);

function fnKey(node) {
  const parts = [];
  const stmtKey = (st) => {
    if (ts.isIfStatement(st)) { parts.push("IF{"); block(st.thenStatement); parts.push("}"); if (st.elseStatement) { parts.push("ELSE{"); block(st.elseStatement); parts.push("}"); } return; }
    if (ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)) { parts.push("LOOP{"); block(st.statement); parts.push("}"); return; }
    if (ts.isTryStatement(st)) { parts.push("TRY{"); block(st.tryBlock); parts.push("}"); if (st.catchClause) { parts.push("CATCH{"); block(st.catchClause.block); parts.push("}"); } if (st.finallyBlock) { parts.push("FIN{"); block(st.finallyBlock); parts.push("}"); } return; }
    if (ts.isSwitchStatement(st)) { parts.push("SWITCH{"); for (const c of st.caseBlock.clauses) for (const s of c.statements) stmtKey(s); parts.push("}"); return; }
    const p = canonStmt(st, "op");
    parts.push(p ? keyOf(p) : ts.SyntaxKind[st.kind]);
  };
  const block = (n) => { if (ts.isBlock(n)) n.statements.forEach(stmtKey); else stmtKey(n); };
  block(node);
  return parts.join(" ");
}
/* PER-FUNCTION CLUSTER SIZE — how many statements one function body holds, for reporting how big a
 * clustered idiom is (`measure-operations.js`, its only consumer). It is NOT `S`, the review-surface
 * denominator, and MUST NOT be used as a ratio denominator: it recurses into if/loop/try bodies but
 * never sees SourceFile-level statements, so it ranges over a different population than the folder
 * does. PRD §7.3 named it as the frozen `S` until 2026-08-31 and the resulting ratio divided 22,760
 * by 22,916 while reporting 895 restated against 156 unfolded — impossible, and published. The
 * canonical S is `enfile.countBodyStatements`, deliberately defined in the same file as the
 * numerator it is divided into, because the rule that mistake settled is that the denominator must
 * be the SAME WALK as the numerator. */
function fnStmtCount(node) { let n = 0; const b = (x) => { if (ts.isBlock(x)) x.statements.forEach(walkS); else walkS(x); }; const walkS = (st) => { n++; if (ts.isIfStatement(st)) { b(st.thenStatement); if (st.elseStatement) b(st.elseStatement); } else if (st.statement) b(st.statement); else if (ts.isTryStatement(st)) { b(st.tryBlock); if (st.catchClause) b(st.catchClause.block); } }; b(node); return n; }

module.exports = { useSF, canonStmt, canonExpr, keyOf, fillOf, holeTypes, fnKey, fnStmtCount, chainSegments };
