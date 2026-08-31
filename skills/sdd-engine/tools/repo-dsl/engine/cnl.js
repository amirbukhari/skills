"use strict";
/**
 * CONTROLLED-ENGLISH LOGIC AUTHORING — write function LOGIC as English sentences
 * that compile to TypeScript, and render TypeScript back to the same sentences.
 * This is a CNL (controlled natural language): a FIXED, closed grammar, not NL
 * understanding. Anything outside the grammar is REJECTED (pointing at the
 * offending phrase) or drops to a QUOTED bespoke escape — never guessed.
 *
 * GRAMMAR (the strict inverse of the prose renderer, for logic):
 *   Header : To <action phrase>[, taking <params>]:
 *   Body   : indented sentences, each ending in '.'
 *     When <cond>, <clause>.            -> if (<cond>) { <clause> }
 *     Otherwise, <clause>.              -> else { <clause> }        (binds to last if)
 *     For each <x> in <xs>, <clause>.   -> for (const <x> of <xs>) { <clause> }
 *     Return <value>. | Stop. | Return. -> return <value>; | return;
 *     <action clause>.                  -> statement(s)
 *   Clause : one or more ACTIONS joined by " and "
 *     run the <noun>   -> await <param>()      (param whose noun matches)
 *     warn <string>    -> console.warn(<str>)
 *     log <string>     -> console.info(<str>)
 *     stop             -> return
 *     return <value>   -> return <value>
 *   Cond   : coined ENGLISH PHRASE (e.g. "it is production" -> isProduction()),
 *            `verbatim` bespoke, or "<a> and <b>" -> <a> && <b>
 *   Value  : "double-quoted" -> a string literal; `backtick` -> verbatim TS
 *
 * Coined words carry an englishPhrase (in coined-words.json). "it is production"
 * <-> isProduction() both directions. Genuinely novel bits ship as `backtick`
 * bespoke, verbatim and marked.
 *
 * Deterministic: zero model calls. Exports: compile, render, CnlError,
 * loadWordsIndex, TYPE_NOUNS, VERBS.
 */
const ts = require("typescript");

class CnlError extends Error {
  constructor(message, phrase) { super(message); this.name = "CnlError"; this.phrase = phrase; }
}

/* noun -> TS type for `taking` params (closed dictionary). */
const TYPE_NOUNS = { action: "() => Promise<void>", number: "number", amount: "number", flag: "boolean", text: "string", name: "string" };
/* leading verb -> emitter for `<verb> <arg>` action clauses. */
const VERBS = {
  warn: (arg) => `console.warn(${arg})`,
  log: (arg) => `console.info(${arg})`,
};

/* ---------- coined-word phrase index ---------- */
function loadWordsIndex(words) {
  const byPhrase = new Map(), byCall = new Map();
  for (const w of words) {
    if (!w.englishPhrase || !w.call) continue;
    byPhrase.set(w.englishPhrase.toLowerCase(), w);
    byCall.set(w.call.replace(/\s+/g, ""), w);
  }
  return { byPhrase, byCall, words };
}

/* ---------- small helpers ---------- */
const camel = (phrase) => phrase.trim().split(/\s+/).map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
const dq2sq = (s) => "'" + s.slice(1, -1).replace(/'/g, "\\'") + "'"; // "x" -> 'x'
const sq2dq = (s) => '"' + s.slice(1, -1).replace(/\\'/g, "'") + '"';

/** split on a separator that is OUTSIDE quotes/backticks */
function splitTop(s, sep) {
  const out = []; let depth = 0, q = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if (s.startsWith(sep, i) && depth === 0) { out.push(cur); cur = ""; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur); return out.map((x) => x.trim()).filter((x) => x.length);
}

/* ============================ COMPILE (English -> TS) ============================ */
function compile(text, index, opts = {}) {
  const rawLines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length);
  if (!rawLines.length) throw new CnlError("empty input", text);

  // Header: To <phrase>[, taking <params>]:
  const header = rawLines[0].trim();
  const hm = header.match(/^To\s+(.+?)\s*:$/i);
  if (!hm) throw new CnlError("header must be `To <phrase>[, taking <params>]:`", header);
  let subject = hm[1], params = [];
  const takeIdx = subject.toLowerCase().indexOf(", taking ");
  if (takeIdx >= 0) {
    const take = subject.slice(takeIdx + ", taking ".length);
    subject = subject.slice(0, takeIdx);
    for (const item of splitTop(take.replace(/\band\b/g, ","), ",")) {
      const m = item.match(/^an?\s+(.+)$/i);
      if (!m) throw new CnlError("param must read `a <noun...>`", item);
      const words = m[1].trim().split(/\s+/);
      const typeNoun = words[words.length - 1].toLowerCase();
      const type = TYPE_NOUNS[typeNoun] || "unknown";
      const roots = (TYPE_NOUNS[typeNoun] ? words.slice(0, -1) : words).map((w) => w.toLowerCase());
      params.push({ name: camel(m[1]), type, roots });
    }
  }
  const fnName = camel(subject);

  // Body sentences.
  const ctx = { params, async: false };
  const stmts = [];
  for (let i = 1; i < rawLines.length; i++) {
    const s = rawLines[i].trim();
    // Sentence terminator: a period, or a closing quote whose own period ends it
    // (e.g. warn "…skipped."). Strip exactly one trailing period if present.
    if (!/[."`]$/.test(s)) throw new CnlError("every sentence must end with '.'", s);
    const body = s.endsWith(".") ? s.slice(0, -1) : s;
    const low = body.toLowerCase();

    if (low.startsWith("otherwise")) {
      const m = body.match(/^Otherwise,\s*(.+)$/i);
      if (!m) throw new CnlError("`Otherwise, <clause>.`", s);
      const prev = stmts[stmts.length - 1];
      if (!prev || prev.kind !== "if") throw new CnlError("`Otherwise` must follow a `When` sentence", s);
      prev.els = compileClause(m[1], ctx);
      continue;
    }
    if (low.startsWith("when ")) {
      const m = body.match(/^When\s+(.+?),\s*(.+)$/i);
      if (!m) throw new CnlError("`When <cond>, <clause>.` (comma required)", s);
      stmts.push({ kind: "if", cond: compileCond(m[1], ctx), then: compileClause(m[2], ctx), els: null });
      continue;
    }
    if (low.startsWith("for each ")) {
      const m = body.match(/^For each\s+(\w+)\s+in\s+(.+?),\s*(.+)$/i);
      if (!m) throw new CnlError("`For each <x> in <xs>, <clause>.`", s);
      stmts.push({ kind: "loop", v: m[1], xs: compileValue(m[2], ctx), body: compileClause(m[3], ctx) });
      continue;
    }
    // a standalone clause (return/stop/action)
    stmts.push({ kind: "clause", parts: compileClause(body, ctx) });
  }

  // Emit TS.
  const emitClause = (parts, ind) => parts.map((p) => ind + p + ";").join("\n");
  const emitStmt = (st, ind) => {
    if (st.kind === "if") {
      let out = `${ind}if (${st.cond}) {\n${emitClause(st.then, ind + "  ")}\n${ind}}`;
      if (st.els) out += ` else {\n${emitClause(st.els, ind + "  ")}\n${ind}}`;
      return out;
    }
    if (st.kind === "loop") return `${ind}for (const ${st.v} of ${st.xs}) {\n${emitClause(st.body, ind + "  ")}\n${ind}}`;
    return emitClause(st.parts, ind);
  };
  const bodyTs = stmts.map((st) => emitStmt(st, "  ")).join("\n");
  const asyncKw = ctx.async ? "async " : "";
  const retType = ctx.async ? "Promise<void>" : "void";
  const paramTs = params.map((p) => `${p.name}: ${p.type}`).join(", ");
  const ts_ = `export const ${fnName} = ${asyncKw}(${paramTs}): ${retType} => {\n${bodyTs}\n};\n`;
  return { ts: ts_, fnName, params, ir: stmts };
}

/** condition -> TS boolean expression */
function compileCond(text, ctx) {
  const ands = splitTop(text, " and ");
  return ands.map((a) => compileAtomCond(a.trim(), ctx)).join(" && ");
}
function compileAtomCond(a, ctx) {
  if (a.startsWith("`") && a.endsWith("`")) return a.slice(1, -1);              // bespoke escape
  const hit = CUR_INDEX && CUR_INDEX.byPhrase.get(a.toLowerCase());
  if (hit) return hit.call;                                                    // coined phrase -> call
  throw new CnlError(`unknown condition phrase (quote it as \`...\` to escape)`, a);
}

/** clause -> array of TS statement strings (no trailing ;) */
function compileClause(text, ctx) {
  return splitTop(text, " and ").map((a) => compileAction(a.trim(), ctx));
}
function compileAction(a, ctx) {
  if (a.startsWith("`") && a.endsWith("`")) return a.slice(1, -1);              // bespoke escape
  const low = a.toLowerCase();
  if (low === "stop" || low === "return") return "return";
  let m;
  // GRAMMAR RULE (throw-error, inverse): "Throw error <VALUE>" -> throw new Error(<v>).
  if ((m = a.match(/^Throw error\s+(.+)$/i))) return `throw new Error(${compileValue(m[1], ctx)})`;
  // GRAMMAR RULE (assignment, inverse): "Let/Set `NAME` be/to <VALUE>" -> const/let.
  if ((m = a.match(/^Let\s+`([^`]+)`\s+be\s+(.+)$/i))) return `const ${m[1]} = ${compileValue(m[2], ctx)}`;
  // "Set `TARGET` to <VALUE>": a plain identifier target is a local `let`; a member
  // target (contains a `.` or `[`) is a member assignment (no `let`).
  if ((m = a.match(/^Set\s+`([^`]+)`\s+to\s+(.+)$/i))) {
    const target = m[1], rhs = compileValue(m[2], ctx);
    return /[.\[]/.test(target) ? `${target} = ${rhs}` : `let ${target} = ${rhs}`;
  }
  // GRAMMAR RULE (bare call / chain, inverse): "Call `f` with `args`" etc. as an action.
  if (/^(call|map|filter|reduce|find|sort|forEach|flatMap|some|every)\s+`/i.test(a)) {
    return compileValue(a.charAt(0).toLowerCase() + a.slice(1), ctx);
  }
  if ((m = a.match(/^return\s+(.+)$/i))) return `return ${compileValue(m[1], ctx)}`;
  if ((m = a.match(/^run the\s+(.+)$/i))) {                                     // run the <noun> -> await param()
    const noun = m[1].trim().toLowerCase();
    const p = ctx.params.find((pp) => pp.roots.includes(noun) || pp.name.toLowerCase().includes(noun));
    if (!p) throw new CnlError(`no parameter matches "the ${noun}"`, a);
    ctx.async = true; return `await ${p.name}()`;
  }
  const verb = a.split(/\s+/)[0].toLowerCase();
  if (VERBS[verb]) { const arg = a.slice(verb.length).trim(); return VERBS[verb](compileValue(arg, ctx)); }
  throw new CnlError(`unknown action (quote it as \`...\` to escape)`, a);
}

/** value -> TS expression */
function compileValue(v, ctx) {
  v = v.trim();
  let mt;
  // GRAMMAR RULE (ternary value, inverse): "`a` if `c` otherwise `b`" -> c ? a : b.
  // Must precede the plain backtick-unwrap below (a ternary value also starts/ends `).
  if ((mt = v.match(/^`([^`]*)`\s+if\s+`([^`]*)`\s+otherwise\s+`([^`]*)`$/)))
    return `${mt[2]} ? ${mt[1]} : ${mt[3]}`;
  if (v.startsWith("`") && v.endsWith("`")) return v.slice(1, -1);             // verbatim TS
  if (v.startsWith('"') && v.endsWith('"')) return dq2sq(v);                   // string literal
  let m;
  // GRAMMAR RULE (call, inverse): "call `f` with `args`" | "call `f`" -> f(args).
  if ((m = v.match(/^call\s+`([^`]+)`(?:\s+with\s+`([^`]*)`)?$/))) return `${m[1]}(${m[2] || ""})`;
  // GRAMMAR RULE (method chain, inverse): "verb `recv` with `args`" -> recv.verb(args).
  if ((m = v.match(/^(map|filter|reduce|find|sort|forEach|flatMap|some|every)\s+`([^`]+)`(?:\s+with\s+`([^`]*)`)?$/)))
    return `${m[2]}.${m[1]}(${m[3] || ""})`;
  const hit = CUR_INDEX && CUR_INDEX.byPhrase.get(v.toLowerCase());
  if (hit) return hit.call;
  // a bare identifier / param
  if (/^[A-Za-z_$][\w$.]*$/.test(v)) return v;
  throw new CnlError(`unknown value (quote it as \`...\` to escape)`, v);
}

// Ambient index for the pure-function helpers (set per compile/render call).
let CUR_INDEX = null;
function withIndex(index, fn) { const prev = CUR_INDEX; CUR_INDEX = index; try { return fn(); } finally { CUR_INDEX = prev; } }

/* ============================ RENDER (TS -> English) ============================ */
function render(source, index) {
  return withIndex(index, () => {
    const sf = ts.createSourceFile("r.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out = [];
    for (const st of sf.statements) {
      const fn = asNamedArrow(st);
      if (fn) out.push(renderFn(fn, sf));
    }
    if (!out.length) throw new CnlError("no `const <name> = (...) => { ... }` function found to render", source.slice(0, 40));
    return out.join("\n\n");
  });
}
function asNamedArrow(st) {
  if (!ts.isVariableStatement(st)) return null;
  const d = st.declarationList.declarations[0];
  if (!d || !ts.isIdentifier(d.name) || !d.initializer || !ts.isArrowFunction(d.initializer)) return null;
  if (!d.initializer.body || !ts.isBlock(d.initializer.body)) return null;
  return { name: d.name.text, arrow: d.initializer };
}
const deCamel = (n) => n.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
function renderFn(fn, sf) {
  const params = fn.arrow.parameters.map((p) => "a " + deCamel(p.name.getText(sf)));
  const head = `To ${deCamel(fn.name)}${params.length ? ", taking " + params.join(" and ") : ""}:`;
  const lines = [head];
  for (const st of fn.arrow.body.statements) lines.push("  " + renderStmt(st, sf));
  return lines.join("\n");
}
// Sentence terminator: a period, unless the sentence already ends in a closing
// quote (whose own period ends it) — mirrors the compile-side terminator rule.
const term = (x) => x + (/["`]$/.test(x) ? "" : ".");
function renderStmt(st, sf) {
  if (ts.isIfStatement(st)) {
    const cond = renderCond(st.expression, sf);
    const then = renderClause(st.thenStatement, sf);
    let out = term(`When ${cond}, ${then}`);
    if (st.elseStatement) out += `\n  ` + term(`Otherwise, ${renderClause(st.elseStatement, sf)}`);
    return out;
  }
  if (ts.isForOfStatement(st)) {
    const v = st.initializer.getText(sf).replace(/^const\s+/, "");
    return term(`For each ${v} in ${renderValue(st.expression, sf)}, ${renderClause(st.statement, sf)}`);
  }
  return term(renderClause(st, sf).replace(/^(.)/, (c) => c.toUpperCase()));
}
function renderClause(node, sf) {
  const stmts = ts.isBlock(node) ? node.statements : [node];
  return stmts.map((s) => renderAction(s, sf)).join(" and ");
}
function renderAction(s, sf) {
  if (ts.isReturnStatement(s)) return s.expression ? `return ${renderValue(s.expression, sf)}` : "stop";
  // GRAMMAR RULE (throw-error): `throw new Error(<arg>);` -> "Throw error <value>".
  // Single-argument `new Error(...)`, single line. A clean string message renders as a
  // readable double-quoted value; any other backtick-free arg (concat, identifier) as a
  // verbatim escape. A template-literal arg carries backticks that cannot nest inside an
  // escape, so it is out of domain and stays the full bespoke statement below.
  if (ts.isThrowStatement(s) && s.expression && ts.isNewExpression(s.expression) &&
      ts.isIdentifier(s.expression.expression) && s.expression.expression.text === "Error" &&
      s.expression.arguments && s.expression.arguments.length === 1 && !/\n/.test(s.getText(sf))) {
    const arg = s.expression.arguments[0], argText = arg.getText(sf);
    // Readable double-quoted frame ONLY for a single-quoted source literal (the canonical
    // form the emitter reproduces). A double-quoted source literal would be re-emitted
    // single-quoted, so it stays a byte-exact verbatim escape via the next branch.
    if (ts.isStringLiteral(arg) && argText[0] === "'" && !/"/.test(arg.text)) return `Throw error ${renderValue(arg, sf)}`;
    if (!/`/.test(argText)) return `Throw error \`${argText}\``;
  }
  // GRAMMAR RULE (assignment): `const/let NAME = INIT;` -> "Let/Set `NAME` be/to <VALUE>".
  // Only for a single plain-identifier declaration with an initializer (the 63%
  // case). Destructuring / multi-declarator fall through to the bespoke escape.
  if (ts.isVariableStatement(s) && s.declarationList.declarations.length === 1 && !/\n/.test(s.getText(sf))) {
    const d = s.declarationList.declarations[0];
    const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0;
    // In-domain only: plain identifier target, an initializer, and NO type annotation
    // (a `: T` annotation is dropped by the canonical emitter, so it is out of domain
    // and stays verbatim). Multi-line RHS is excluded above.
    // Also out of domain if the RHS carries a backtick (template literal): it cannot
    // nest inside a backtick escape and reconstruct, so keep the whole line verbatim.
    if (ts.isIdentifier(d.name) && d.initializer && !d.type && !/`/.test(d.initializer.getText(sf))) {
      return `${isConst ? "Let" : "Set"} \`${d.name.text}\` ${isConst ? "be" : "to"} ${renderValue(d.initializer, sf)}`;
    }
  }
  let e = ts.isExpressionStatement(s) ? s.expression : s;
  if (ts.isAwaitExpression(e) && ts.isCallExpression(e.expression) && ts.isIdentifier(e.expression.expression)) {
    return `run the ${deCamel(e.expression.expression.text).replace(/ action$/, "")}`;
  }
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const fn = e.expression; const obj = fn.expression.getText(sf), meth = fn.name.text;
    if (obj === "console" && (meth === "warn" || meth === "error")) return `warn ${renderValue(e.arguments[0], sf)}`;
    if (obj === "console" && (meth === "info" || meth === "log")) return `log ${renderValue(e.arguments[0], sf)}`;
  }
  // GRAMMAR RULE (bare call / chain statement): `f(args);` / `xs.map(fn);` -> the
  // same English as in value position ("call `f` with `args`", "map `xs` with `fn`").
  // Single-line only (a multi-line object/callback argument is out of domain).
  if (ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && !/\n/.test(s.getText(sf))) {
    const cx = s.expression;
    if (ts.isIdentifier(cx.expression) ||
        (ts.isPropertyAccessExpression(cx.expression) && CHAIN_VERBS.has(cx.expression.name.text))) {
      return renderValue(cx, sf);
    }
  }
  // GRAMMAR RULE (member assignment): `x.y = <v>;` / `a[i] = <v>;` -> "Set `x.y` to <value>".
  // Single-line, plain `=`, member (property/element) target, backtick-free. A local
  // `let x = v` renders the same "Set `x` to v" shape; the inverse tells them apart by
  // the dot/bracket in the target (a member target emits a plain assignment, not `let`).
  if (ts.isExpressionStatement(s) && ts.isBinaryExpression(s.expression) &&
      s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken && !/\n/.test(s.getText(sf))) {
    const lhs = s.expression.left;
    if ((ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) &&
        !/`/.test(lhs.getText(sf)) && !/`/.test(s.expression.right.getText(sf))) {
      return `Set \`${lhs.getText(sf)}\` to ${renderValue(s.expression.right, sf)}`;
    }
  }
  return "`" + s.getText(sf).replace(/;$/, "") + "`"; // bespoke escape
}
/* Chain methods rendered as an English lead verb (surface <-> inverse both frozen). */
const CHAIN_VERBS = new Set(["map", "filter", "reduce", "find", "sort", "forEach", "flatMap", "some", "every"]);
function renderCond(expr, sf) {
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return `${renderCond(expr.left, sf)} and ${renderCond(expr.right, sf)}`;
  }
  const call = exprCall(expr, sf);
  if (call && CUR_INDEX && CUR_INDEX.byCall.get(call)) return CUR_INDEX.byCall.get(call).englishPhrase;
  return "`" + expr.getText(sf) + "`"; // bespoke escape
}
function renderValue(expr, sf) {
  if (ts.isStringLiteral(expr)) return sq2dq(`'${expr.text.replace(/'/g, "\\'")}'`);
  // GRAMMAR RULE (ternary value): `<c> ? <a> : <b>` -> "`a` if `c` otherwise `b`".
  // Frames the CONDITIONAL in English while the three operand atoms stay verbatim in
  // escapes (so the inverse reconstructs byte-exact). Single-line, backtick-free only;
  // a nested ternary rides along verbatim as one operand atom.
  if (ts.isConditionalExpression(expr) && !/\n/.test(expr.getText(sf))) {
    const c = expr.condition.getText(sf), a = expr.whenTrue.getText(sf), b = expr.whenFalse.getText(sf);
    // In-domain only when the source already has canonical `c ? a : b` spacing, so the
    // reconstruction is byte-exact; irregular spacing (e.g. `? a :b`) bails to bespoke.
    if (!/`/.test(c + a + b) && `${c} ? ${a} : ${b}` === expr.getText(sf).trim())
      return `\`${a}\` if \`${c}\` otherwise \`${b}\``;
  }
  const call = exprCall(expr, sf);
  if (call && CUR_INDEX && CUR_INDEX.byCall.get(call)) return CUR_INDEX.byCall.get(call).call;
  // GRAMMAR RULE (method chain): `recv.verb(args)` -> "verb `recv` with `args`".
  // Only the recognised collection verbs; receiver and args stay verbatim so the
  // inverse reconstructs byte-for-byte. `.sort()`/`.reverse()` with no args drop "with".
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && CHAIN_VERBS.has(expr.expression.name.text) &&
      !expr.typeArguments && !expr.questionDotToken && !expr.expression.questionDotToken) {
    const recv = expr.expression.expression.getText(sf), meth = expr.expression.name.text;
    const args = expr.arguments.map((a) => a.getText(sf)).join(", ");
    // Out of domain if any atom carries a backtick (template literal) — it cannot nest
    // inside a backtick escape and reconstruct — so fall through to a full bespoke escape.
    if (!/`/.test(recv + args)) return args ? `${meth} \`${recv}\` with \`${args}\`` : `${meth} \`${recv}\``;
  }
  // GRAMMAR RULE (args-bearing call): `f(args)` -> "call `f` with `args`".
  // Optional calls (`f?.()`) are out of domain — the `?.` would be dropped.
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && !expr.typeArguments && !expr.questionDotToken) {
    const args = expr.arguments.map((a) => a.getText(sf)).join(", ");
    if (!/`/.test(args)) return args ? `call \`${expr.expression.text}\` with \`${args}\`` : `call \`${expr.expression.text}\``;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return "`" + expr.getText(sf) + "`";
}
function exprCall(expr, sf) {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.arguments.length === 0) return expr.expression.text + "()";
  return null;
}

/* wrap compile so CUR_INDEX is set */
const _compile = compile;
function compileWithIndex(text, index, opts) { return withIndex(index, () => _compile(text, index, opts)); }

/* ===================== STATEMENT-LEVEL ROUND-TRIP (for the gate/tests) =====================
 * renderStatement: one TS statement -> its English sentence (through the same renderStmt).
 * compileStatement: one English sentence -> its TS statement text (through the same compile),
 * dedented out of the canonical function wrapper. Round-tripping a statement is
 * renderStatement -> compileStatement; a grammar rule is FAITHFUL on a sample when the
 * result is byte-identical to the original statement. */
function renderStatement(src, index) {
  return withIndex(index, () => {
    const sf = ts.createSourceFile("s.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return sf.statements.map((st) => renderStmt(st, sf)).join("\n");
  });
}
function compileStatement(line, index) {
  const full = compileWithIndex(`To roundTrip:\n  ${line.trim()}`, index).ts;
  const m = full.match(/=>\s*\{\n([\s\S]*)\n\};\s*$/);
  if (!m) throw new CnlError("could not extract body", full);
  return m[1].split("\n").map((l) => l.replace(/^  /, "")).join("\n");
}

module.exports = { compile: compileWithIndex, render, CnlError, loadWordsIndex, TYPE_NOUNS, VERBS, renderStatement, compileStatement, CHAIN_VERBS };
