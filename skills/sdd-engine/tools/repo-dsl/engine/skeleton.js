"use strict";
/**
 * SKELETON TIER — the HIGH-LEVEL structural word. A function/method body is a
 * SEQUENCE of statement KINDS + control flow (ASSIGN, FETCH, GUARD_THROW, CALL,
 * RETURN, LOOP, TRY, ...). Each statement's INTERIOR is a typed HOLE. A skeleton
 * WORD = that control-flow template with holes; the holes are filled by:
 *   (a) an existing statement-tier word / named idiom (throwError, assertOrThrow,
 *       fetchAndValidate) where it fits, else
 *   (b) a LITERAL slot carrying the bespoke bytes.
 * The acceptance test is unchanged and absolute: skeleton + filled slots === the
 * source bytes. Slots absorb ALL divergence, so it verifies for every body.
 *
 * This module extracts bodies, labels statement kinds (recognizing the named
 * idioms), computes a skeleton signature, and names the recurring ones
 * deterministically. Fill attribution + byte-verify + clustering live in the
 * runner (build-skeletons.js), which needs the compose dictionary.
 *
 * Exports: extractBodies, classifyStatement, nameSkeleton, KINDS.
 */
const ts = require("typescript");
const { matchThrowError, matchAssertOrThrow } = require("./named-idioms.js");
const { FIND_SELECTORS } = require("./idioms.js");

const KINDS = ["ASSIGN", "FETCH", "GUARD_THROW", "GUARD", "THROW", "CALL", "AWAIT",
  "RETURN", "IF", "LOOP", "TRY", "SWITCH", "DECLARE", "JUMP", "EXPR", "BLOCK", "OTHER"];

/* ---- FETCH kind = an ASYNC READ bound to a variable: `const x = await <call>(...)`.
 * This is a STRUCTURAL label (no byte claim) — the control-flow shape Amir means by
 * "fetch". The fetchAndValidate IDIOM stays narrow (ORM find-selectors, byte-verified
 * in engine/idioms.js); a broadened FETCH+GUARD that isn't a real fetchAndValidate
 * simply fills as a bespoke/mixed hole, never a false idiom claim. ---- */
function isFetchDecl(stmt) {
  if (!ts.isVariableStatement(stmt)) return false;
  const decls = stmt.declarationList.declarations;
  if (decls.length !== 1) return false;
  const init = decls[0].initializer;
  if (!init || !ts.isAwaitExpression(init)) return false;      // must be an awaited value
  const inner = init.expression;
  return !!inner && ts.isCallExpression(inner);                // awaiting a call = a read/fetch
}
// (FIND_SELECTORS kept imported for parity with the idiom layer; the narrow ORM
// case is a strict subset of the broadened FETCH kind above.)

/** Label ONE statement. Returns {kind, idiom?}. Recognizes the named idioms. */
function classifyStatement(stmt) {
  // named idioms first (they set both kind + idiom attribution)
  if (matchThrowError(stmt)) return { kind: "THROW", idiom: "throwError" };
  if (matchAssertOrThrow(stmt)) return { kind: "GUARD_THROW", idiom: "assertOrThrow" };

  if (ts.isVariableStatement(stmt)) return { kind: isFetchDecl(stmt) ? "FETCH" : "ASSIGN" };
  if (ts.isExpressionStatement(stmt)) {
    const e = stmt.expression;
    if (ts.isBinaryExpression(e) && e.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && e.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return { kind: "ASSIGN" };
    if (ts.isAwaitExpression(e)) return { kind: "AWAIT" };
    if (ts.isCallExpression(e)) return { kind: "CALL" };
    return { kind: "EXPR" };
  }
  if (ts.isReturnStatement(stmt)) return { kind: "RETURN" };
  if (ts.isThrowStatement(stmt)) return { kind: "THROW" };
  if (ts.isIfStatement(stmt)) {
    // plain guard: `if (!x) return ...` / `if (!x) { return ... }`, no else
    if (!stmt.elseStatement && ts.isPrefixUnaryExpression(stmt.expression) &&
        stmt.expression.operator === ts.SyntaxKind.ExclamationToken) {
      const t = stmt.thenStatement;
      const only = ts.isBlock(t) ? (t.statements.length === 1 ? t.statements[0] : null) : t;
      if (only && (ts.isReturnStatement(only) || ts.isThrowStatement(only) || ts.isContinueStatement(only) || ts.isBreakStatement(only)))
        return { kind: "GUARD" };
    }
    return { kind: "IF" };
  }
  if (ts.isForStatement(stmt) || ts.isForOfStatement(stmt) || ts.isForInStatement(stmt) ||
      ts.isWhileStatement(stmt) || ts.isDoStatement(stmt)) return { kind: "LOOP" };
  if (ts.isTryStatement(stmt)) return { kind: "TRY" };
  if (ts.isSwitchStatement(stmt)) return { kind: "SWITCH" };
  if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) return { kind: "DECLARE" };
  if (ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) return { kind: "JUMP" };
  if (ts.isBlock(stmt)) return { kind: "BLOCK" };
  return { kind: "OTHER" };
}

/* ---- collect every function-like body (Block) in a file ---- */
function bodyBlocks(sf) {
  const out = [];
  const push = (node, ownerKind, nameNode) => {
    const body = node.body;
    if (body && ts.isBlock(body)) out.push({ node, body, ownerKind, name: nameNode ? nameNode.getText() : (ownerKind === "arrow" ? "=>" : "?") });
  };
  const walk = (n) => {
    if (ts.isFunctionDeclaration(n)) push(n, "function", n.name);
    else if (ts.isMethodDeclaration(n)) push(n, "method", n.name);
    else if (ts.isConstructorDeclaration(n)) push(n, "constructor", null);
    else if (ts.isGetAccessorDeclaration(n)) push(n, "getter", n.name);
    else if (ts.isSetAccessorDeclaration(n)) push(n, "setter", n.name);
    else if (ts.isFunctionExpression(n)) push(n, "function-expr", n.name);
    else if (ts.isArrowFunction(n)) push(n, "arrow", null);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/**
 * Extract every function-like body with its top-level statement sequence + kinds.
 * fetchAndValidate is recognized as the ADJACENCY of a FETCH var-decl immediately
 * followed by a GUARD/GUARD_THROW — the pair is tagged so the runner can fill both
 * statements with the fetchAndValidate idiom.
 */
function extractBodies(source, fileName = "x.ts") {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const blocks = bodyBlocks(sf);
  const bodies = [];
  for (const b of blocks) {
    const stmts = b.body.statements.map((s) => {
      const c = classifyStatement(s);
      return { kind: c.kind, idiom: c.idiom || null, start: s.getStart(), end: s.getEnd() };
    });
    // fetchAndValidate adjacency: FETCH followed by GUARD/GUARD_THROW
    const favPairs = [];
    for (let i = 0; i < stmts.length - 1; i++) {
      if (stmts[i].kind === "FETCH" && (stmts[i + 1].kind === "GUARD" || stmts[i + 1].kind === "GUARD_THROW")) {
        stmts[i].fav = true; stmts[i + 1].fav = true;
        favPairs.push([i, i + 1]);
      }
    }
    bodies.push({
      owner: b.name, ownerKind: b.ownerKind,
      bodyStart: b.body.getStart(), bodyEnd: b.body.getEnd(),
      stmts, sig: stmts.map((s) => s.kind).join(" "),
      stmtCount: stmts.length, favPairs,
    });
  }
  return { bodies, sourceFile: sf };
}

/* ---- deterministic namer: kind sequence -> readable camelCase ---- */
const KIND_WORD = {
  ASSIGN: "assign", FETCH: "fetch", GUARD_THROW: "guard", GUARD: "guard", THROW: "throw",
  CALL: "call", AWAIT: "await", RETURN: "return", IF: "if", LOOP: "loop", TRY: "tryCatch",
  SWITCH: "switch", DECLARE: "declare", JUMP: "jump", EXPR: "expr", BLOCK: "block", OTHER: "other",
};
/** Name a skeleton from its kind sequence: literal camelCase concat (no compression). */
function nameSkeleton(sig) {
  const kinds = sig.split(" ").filter(Boolean);
  if (kinds.length === 0) return "empty";
  let name = kinds.map((k, i) => {
    const w = KIND_WORD[k] || "x";
    return i === 0 ? w : w[0].toUpperCase() + w.slice(1);
  }).join("");
  if (name.length > 48) name = name.slice(0, 40) + "Etc" + kinds.length; // cap very long sequences
  return name;
}

module.exports = { extractBodies, classifyStatement, nameSkeleton, KINDS, isFetchDecl };
