"use strict";
/**
 * enfile.js — STEP 7: the WHOLE-FILE English source language. Renders a .ts file to an
 * editable .en text and compiles it back BYTE-IDENTICAL. The .en is the canonical human
 * artifact; the .ts is derived.
 *
 * FORMAT — a .en file is the source file with rendered spans swapped in place for
 * «English», everything else left as verbatim TypeScript:
 *   • data-leaf expressions (object / array / ${}-template) -> «an object with …» etc.
 *     (engine/data-english — reaches decorator args, initializers, returns, call args)
 *   • pure-logic simple statements with NO data leaf -> «Let `x` be …» / «Return …» …
 *     (engine/cnl — the proven grammar productions)
 * The guillemets « » never occur in TypeScript or in either English dialect, so the
 * compiler scans them unambiguously. A span is swapped ONLY when it re-compiles to its
 * exact source bytes (verified here at render time); anything else stays verbatim TS. So
 * compileFileEn(renderFileEn(src)) === src holds for EVERY file by construction — English
 * coverage varies, byte-identity does not. Deterministic; zero model calls.
 *
 * Exports: renderFileEn(source) -> { en, stats }, compileFileEn(en) -> ts, loadIndex().
 */
const fs = require("fs");
const path = require("path");
const AC = require("./artifact-contract");
const ts = require("typescript");
const cnl = require("./cnl");
const DATA = require("./data-english");
const G = require("./generators");
const EL = require("./enlzw"); // recursive word dictionary (generators referencing generators)
const P = require("./prose"); // reuse deterministic humanisation helpers (words/list/a) for labels

const OPEN = "«", CLOSE = "»";
const DATA_PREFIX = /^(an object with |a list of |an empty object$|an empty list$|text: “)/;
const GEN = "▶", PAY_OPEN = "⟪", PAY_CLOSE = "⟫"; // multi-line generator span: «▶ gloss ⟪lzw1 payload⟫»
/* (There was a `const MAXWIN = 8` here until 2026-08-31. It was declared once and never read —
 * dead, and misleading: same name as the miner's live `MAXWIN` (64, `build-lzw-generators.js`)
 * with a different value, in a different module, which reads as "there are two windows to
 * reason about" when there is one. Deleted rather than documented; the note stays so the next
 * reader of §Q-6 does not go looking for it.) */

/* VERBATIM SENTINEL SAFETY — the other half of payload.js's guarantee.
 *
 * payload.js escapes every sentinel out of hole text, so a PAYLOAD provably contains none. Its
 * header says why, and says the corpus containing no sentinel today "is luck, and luck is what the
 * dialect work just finished removing". That reasoning was never applied to the OTHER text in a
 * .en: the verbatim source between spans, which renderFileEn copies through byte-for-byte.
 *
 * So a `throw new Error("bad « » input")` in the source emitted a raw « into the .en, and
 * compileFileEn -- which finds a span with a bare indexOf(OPEN) over the whole file -- read it as
 * a chunk opener and COMPILED THE STRING LITERAL AWAY. Measured before the fix: `bad « » ⟪ ⟫ ▶`
 * came back as `bad  ⟪ ⟫ ▶`. Not a throw; wrong bytes, silently, through the gate that exists to
 * make wrong bytes impossible.
 *
 * The fix is the same shape as the payload's, for the same reason: safety BY CONSTRUCTION rather
 * than by what the corpus happens to hold. Every verbatim region is escaped on the way out and
 * unescaped on the way back, so no verbatim region can emit a raw OPEN or CLOSE.
 *
 * ONLY three characters need it. Verbatim text lies OUTSIDE every chunk, so the only characters
 * that can change how it parses are the scanner's OPEN and CLOSE and the escape marker itself.
 * ⟪ ⟫ ▶ are chunk-INTERNAL and mean nothing out here; escaping them would be noise that made the
 * artifact worse to read for no gain. The escape marker is shared with payload.js deliberately --
 * one escape character in the dialect, not two.
 *
 * COST ON THE CORPUS: zero. All 1037 SOURCE .ts files were scanned for « » ⟪ ⟫ ▶ ⟨ ⟩ ⟡ and none
 * contains any, so no .en byte and no fingerprint moves. This closes a latent hole; it does not
 * re-render the corpus.
 *
 * FAIL-CLOSED, like PAY.decode: an unrecognised escape throws rather than being passed through.
 * A hand-edited .en with a stray ⟡ is a question for the author, not something to guess at. */
const V_ESC = "⟡";
const V_ENC = new Map([[V_ESC, V_ESC + "0"], [OPEN, V_ESC + "5"], [CLOSE, V_ESC + "6"]]);
const V_DEC = new Map([["0", V_ESC], ["5", OPEN], ["6", CLOSE]]);
const V_NEEDS = /[⟡«»]/g;

function escapeVerbatim(s) { return s.replace(V_NEEDS, (ch) => V_ENC.get(ch)); }

function unescapeVerbatim(s) {
  if (s.indexOf(V_ESC) < 0) return s;          // the corpus-wide case; no scan, no allocation
  let out = "", i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== V_ESC) { out += ch; i++; continue; }
    const lit = V_DEC.get(s[i + 1]);
    if (lit === undefined)
      throw new Error(`enfile: unknown escape ${JSON.stringify(V_ESC + (s[i + 1] || ""))} in verbatim text`);
    out += lit; i += 2;
  }
  return out;
}

/* load the mined multi-line generator catalog (regenerable; absent -> layer disabled) */
/* best-effort coined-word index so cnl can render coined phrases too (empty is fine) */
function loadIndex(corpusRoot) {
  // small load-bearing coined-word catalog; older large snapshots (word-library.json,
  // mined-library.json) yield the SAME index (verified byte-identical .en) and are derived.
  const tryFiles = [path.join(corpusRoot || "", "catalog", "coined-words.json"), AC.pathFor("mined-library", corpusRoot)];
  let idx = null;
  for (const f of tryFiles) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      const words = Array.isArray(j) ? j : (j.words || j.entries || []);
      if (Array.isArray(words) && words.length) { idx = cnl.loadWordsIndex(words); break; }
    } catch (_) { /* fall through */ }
  }
  idx = idx || cnl.loadWordsIndex([]);
  // attach the RECURSIVE word dictionary — the PRIMARY generator layer. It lives in the CORPUS, at
  // <CORPUS>/sen/catalog/generators-lzw.json, resolved by AC.pathFor below (regenerable via
  // build-lzw-generators.js). Absent -> layer disabled -> no generator spans at all; bodies stay
  // verbatim TS, byte-identity holds.
  //   This comment used to say the dictionary "lives in the skills repo catalog ... not the
  // corpus". That was true of an older layout and became false when §8B moved every artifact under
  // the corpus root; the code was already resolving it correctly through the contract, so nothing
  // failed and the comment went stale unchallenged. Left as a note, not silently deleted.
  /* NO SILENT FALLBACK (PRD §8B). A missing dictionary is a legitimate state (layer disabled,
   * bodies stay verbatim, byte-identity holds); a dictionary that fails the contract is a bug and
   * must surface. Both are reported — the previous `catch { null }` turned either one into the
   * indistinguishable "no generator spans anywhere". */
  const lzwPath = AC.pathFor("generators-lzw", corpusRoot);
  if (!fs.existsSync(lzwPath)) {
    console.error("[enfile] generator layer DISABLED: no dictionary at " + lzwPath + " (bodies render verbatim; byte-identity unaffected)");
    idx._lzw = null;
  } else {
    idx._lzw = EL.loadLzw(lzwPath); // throws ArtifactContractError on drift — deliberately uncaught
  }
  return idx;
}

const isSimpleStmt = (st) => ts.isVariableStatement(st) || ts.isExpressionStatement(st) || ts.isReturnStatement(st) || ts.isThrowStatement(st);
const isDataLeaf = (n) => ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n) || ts.isTemplateExpression(n);

/** does this subtree contain a data leaf the data layer can render byte-exact? */
function hasRenderableData(node, sf) {
  let found = false;
  const visit = (n) => { if (found) return; if (isDataLeaf(n) && DATA.dataByteExact(n, sf)) { found = true; return; } ts.forEachChild(n, visit); };
  visit(node);
  return found;
}

/* ------------------------------ RENDER (.ts -> .en) ------------------------------ */
const isSimpleForGen = (st) => G.isFoldable(st); // foldable = simple + control-flow (v2)
/* Payloads are readable text, not base64(JSON) — see engine/payload.js for why and for the
 * structural sentinel guarantee that makes plain text safe between the « » scanner sentinels. */
const PAY = require("./payload");

/* MANDATORY: a label is display-only, but it is embedded between the scanner sentinels, so it must
 * never contain any of them — «»⟪⟫ would corrupt renderFileEn's span scan / compileChunk's payload
 * parse, and ▶ marks a generator chunk. A throw MESSAGE could in theory contain any of these, so
 * every label passes through here before it is emitted. Replacing with a straight quote keeps the
 * text readable while making the sentinels structurally impossible. */
const LABEL_SENTINELS = /[«»⟪⟫▶]/g;
function sanitizeLabel(s) { return String(s).replace(LABEL_SENTINELS, "'").replace(/\s+/g, " ").trim(); }

/* first call name anywhere under a node (the operation it performs), or null. */
function firstCallName(node) {
  let name = null;
  const v = (n) => {
    if (name) return;
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression)) name = n.expression.name.text;
      else if (ts.isIdentifier(n.expression)) name = n.expression.text;
    }
    ts.forEachChild(n, v);
  };
  v(node);
  return name;
}
/* the Error message string of a throw, if it is a literal/template — the business rule in English. */
function throwMessage(node) {
  let msg = null;
  const v = (n) => {
    if (msg) return;
    if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && n.arguments && n.arguments.length) {
      const arg = n.arguments[0];
      if (ts.isStringLiteralLike(arg)) { msg = arg.text; return; }
      if (ts.isTemplateExpression(arg)) { msg = arg.head.text + "…"; return; }
    }
    ts.forEachChild(n, v);
  };
  v(node);
  return msg ? msg.trim().replace(/[.\s]+$/, "") : null;
}
const throwStmtOf = (branch) => (ts.isThrowStatement(branch) ? branch
  : (ts.isBlock(branch) ? branch.statements.find(ts.isThrowStatement) || null : null));
const isGuardThrow = (st) => ts.isIfStatement(st) && !st.elseStatement && !!throwStmtOf(st.thenStatement);

/* ---- ARCHETYPE PROSE: decorated classes and route registrations ------------------------------
 * These read the SAME AST facts engine/archetypes.js's extractEntity/extractRouter read, but they
 * render on the live round-tripping path instead of through a second, disconnected producer. The
 * word dictionary has already discovered these shapes — a TypeORM entity is one span whose payload
 * holes ARE the grammar's slots (measured: 90.5% of entity bytes sit inside spans, 141 hole slots
 * per file). What was missing was never the structure; it was the sentence.
 *
 * NOTE on extractEntity: it is NOT broken. An earlier report of mine said its className/table/
 * column names came back undefined — that was my probe reading g.className and c.name instead of
 * g.slots.className and c.prop. Retracted. Nothing here is a workaround for a bug in it. */
const COLUMN_DECS = new Set(["Column", "PrimaryGeneratedColumn", "PrimaryColumn", "CreateDateColumn", "UpdateDateColumn", "DeleteDateColumn", "VersionColumn", "ObjectIdColumn"]);
const RELATION_DECS = new Set(["ManyToOne", "OneToMany", "ManyToMany", "OneToOne"]);
const REL_VERB = { ManyToOne: "belongs to a", OneToMany: "has many", ManyToMany: "links to many", OneToOne: "pairs with one" };
const ROUTE_VERBS = new Set(["get", "post", "put", "patch", "delete", "del", "all", "head", "options"]);

const decsOf = (n) => (ts.canHaveDecorators(n) ? (ts.getDecorators(n) || []) : []);
const decNameOf = (d, sf) => { const e = d.expression; return (ts.isCallExpression(e) ? e.expression : e).getText(sf); };

/* the string value of `key` in a decorator's object argument, or null */
function decOption(dec, key, sf) {
  const e = dec.expression;
  if (!ts.isCallExpression(e)) return null;
  for (const arg of e.arguments) {
    if (ts.isStringLiteral(arg) && key === "name") return arg.text;
    if (!ts.isObjectLiteralExpression(arg)) continue;
    for (const pr of arg.properties) {
      if (!ts.isPropertyAssignment(pr) || safeMemberName(pr.name, sf) !== key) continue;
      const v = pr.initializer;
      if (ts.isStringLiteral(v)) return v.text;
      if (v.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (v.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (ts.isIdentifier(v)) return { id: v.text };
    }
  }
  return null;
}

/* "an optional `year` (int)" / "a required `status` (enum `EStatus`)" / "an auto-generated `id`" */
function columnClause(m, dec, sf) {
  const name = safeMemberName(m.name, sf);
  if (!name) return null;
  const dn = decNameOf(dec, sf);
  if (dn === "PrimaryGeneratedColumn") return "an auto-generated " + q(name);
  if (dn === "PrimaryColumn") return "a primary key " + q(name);
  if (dn === "CreateDateColumn") return "an automatic created-at " + q(name);
  if (dn === "UpdateDateColumn") return "an automatic updated-at " + q(name);
  if (dn === "DeleteDateColumn") return "a soft-delete " + q(name);
  const nullable = decOption(dec, "nullable", sf);
  const need = (nullable === true || !!m.questionToken) ? "an optional " : "a required ";
  const dbType = decOption(dec, "type", sf);
  const en = decOption(dec, "enum", sf);
  let type = null;
  if (typeof dbType === "string") type = dbType === "enum" && en && en.id ? "enum " + q(en.id) : dbType;
  /* a TS type is a plain type WORD here, not a backticked identifier: it goes inside the
   * parenthesised type idiom, and a backtick there would leave "( )" behind for the scanner. */
  else if (m.type) { const t = m.type.getText(sf); if (/^[A-Za-z_$][\w$]*$/.test(t)) type = t; }
  return need + q(name) + (type ? " (" + type + ")" : "");
}

/* "belongs to a `BillingAccount` (join `account_id`)" / "has many `Installment`" */
function relationClause(m, ds, sf) {
  const rel = ds.find((d) => RELATION_DECS.has(decNameOf(d, sf)));
  if (!rel) return null;
  const dn = decNameOf(rel, sf);
  let target = null;
  const e = rel.expression;
  if (ts.isCallExpression(e) && e.arguments.length) {
    const a0 = e.arguments[0];
    const body = ts.isArrowFunction(a0) ? a0.body : a0;             // () => Target
    if (body && ts.isIdentifier(body)) target = body.text;
  }
  if (!target && m.type) { const t = m.type.getText(sf).replace(/\[\]$/, ""); if (/^[A-Za-z_$][\w$]*$/.test(t)) target = t; }
  if (!target) return null;
  const join = ds.map((d) => (decNameOf(d, sf) === "JoinColumn" ? decOption(d, "name", sf) : null)).find((x) => typeof x === "string");
  return REL_VERB[dn] + " " + q(target) + (join ? " (join " + q(join) + ")" : "");
}

/* the whole entity as one sentence, or null when this is not a decorated persistence class. */
function entityProse(cls, sf) {
  const entDec = decsOf(cls).find((d) => decNameOf(d, sf) === "Entity");
  const cols = [], rels = [];
  for (const m of cls.members) {
    if (!ts.isPropertyDeclaration(m)) continue;
    const ds = decsOf(m);
    if (!ds.length) continue;
    if (ds.some((d) => RELATION_DECS.has(decNameOf(d, sf)))) { const r = relationClause(m, ds, sf); if (r) rels.push(r); continue; }
    const cd = ds.find((d) => COLUMN_DECS.has(decNameOf(d, sf)));
    if (cd) { const c = columnClause(m, cd, sf); if (c) cols.push(c); }
  }
  if (!entDec && !cols.length) return null;
  if (!cols.length && !rels.length) return null;
  const table = entDec ? decOption(entDec, "name", sf) : null;
  let out = "describe the stored record " + q(cls.name.text) + (typeof table === "string" ? " in " + q(table) : "");
  if (cols.length) out += " — " + P.list(cols);
  if (rels.length) out += (cols.length ? " — it " : " — it ") + P.list(rels);
  return out;
}

/* "serve GET `/:accountId`" — a Koa/Express route registration. RouterModule is the largest
 * grammar-carriable archetype (7.6% of corpus bytes) and every one of these rendered as
 * "call get" before this. */
function routeClause(node, sf) {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const verb = callee.name.text;
  if (!ROUTE_VERBS.has(verb)) return null;
  const a0 = node.arguments && node.arguments[0];
  if (!a0 || !ts.isStringLiteralLike(a0)) return null;
  const method = (verb === "del" ? "DELETE" : verb === "all" ? "ANY" : verb.toUpperCase());
  return "serve " + method + " " + q(a0.text);
}

/* ---- prose helpers for spanProse -------------------------------------------------------------
 * Everything emitted into a clause is either a template word or a backticked/quoted verbatim
 * fragment. That is not cosmetic: engine/clause-quality's English-completeness scanner strips
 * exactly `…` and “…” and then fails the clause if any TypeScript survives, so a helper that
 * splices raw source into prose is caught by the metric rather than by review. */
const q = (s) => "`" + String(s) + "`";

/* A member name safe to place in a sentence. A COMPUTED property name (`[\`${E.x}\`]`) is an
 * expression, not a word — splicing it in produces code wearing a sentence's clothes, which is
 * precisely what the English-completeness scanner exists to catch. It caught this one. */
function safeMemberName(nm, sf) {
  if (!nm) return null;
  if (ts.isIdentifier(nm) || ts.isPrivateIdentifier(nm)) return nm.text;
  if (ts.isStringLiteral(nm) || ts.isNoSubstitutionTemplateLiteral(nm)) return nm.text;
  if (ts.isNumericLiteral(nm)) return nm.getText(sf);
  return null; // computed
}

/* the real names bound by a declaration, INCLUDING destructuring patterns. The old code filtered
 * names through /^[A-Za-z_$][\w$]*$/, which silently dropped every `const { a, b } = …` and sent
 * it to "compute a value". */
function bindingNames(name, sf) {
  if (!name) return [];
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return [].concat(...name.elements.map((e) => (e && e.name ? bindingNames(e.name, sf) : [])));
  }
  return [];
}

/* `a`, `a.b`, `a.b.c` — a plain dotted path and nothing else. Returns null for anything with a
 * call, index, await or operator in it, because those are code and belong in a hole, not a
 * sentence. */
function dottedText(n, sf) {
  if (!n) return null;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) {
    const base = dottedText(n.expression, sf);
    return base ? base + "." + n.name.text : null;
  }
  if (n.kind === ts.SyntaxKind.ThisKeyword) return "this";
  return null;
}

/* a literal a reader can be told about without quoting code at them. An object/array literal is
 * described by its KEYS or its emptiness — never by splicing its body into the sentence. */
function literalGloss(n, sf) {
  if (!n) return null;
  if (n.kind === ts.SyntaxKind.NullKeyword || n.kind === ts.SyntaxKind.UndefinedKeyword) return "nothing";
  if (n.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (n.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (ts.isNumericLiteral(n)) return q(n.getText(sf));
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
    const t = n.text.trim();
    return t && !/\n/.test(t) && t.length <= 60 ? "“" + t + "”" : "some text";
  }
  if (ts.isArrayLiteralExpression(n)) return n.elements.length ? null : "an empty list";
  if (ts.isObjectLiteralExpression(n)) {
    if (!n.properties.length) return "an empty object";
    const keys = n.properties.map((pr) => safeMemberName(pr.name, sf)).filter(Boolean);
    if (keys.length !== n.properties.length || keys.length > 6) return null; // spreads / too many — say nothing
    return "an object with " + P.list(keys.map(q));
  }
  return null;
}

/* the distinct dotted values an expression READS, in source order, capped so a sentence stays a
 * sentence. Used where the operation itself cannot be named honestly but its inputs can. */
function inputsOf(n, sf, out, seen) {
  out = out || []; seen = seen || new Set();
  const visit = (x) => {
    if (!x || out.length >= 4) return;
    const d = dottedText(x, sf);
    if (d) { if (!seen.has(d)) { seen.add(d); out.push(d); } return; }
    ts.forEachChild(x, visit);
  };
  visit(n);
  return out;
}

/* a CONDITION stated in English, or null. Null is the honest answer for anything this cannot say
 * truthfully — the caller then emits the vacuous clause and the metric counts it. */
const CMP = { [ts.SyntaxKind.EqualsEqualsEqualsToken]: "is", [ts.SyntaxKind.EqualsEqualsToken]: "is",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "is not", [ts.SyntaxKind.ExclamationEqualsToken]: "is not",
  [ts.SyntaxKind.LessThanToken]: "is under", [ts.SyntaxKind.GreaterThanToken]: "is over",
  [ts.SyntaxKind.LessThanEqualsToken]: "is at most", [ts.SyntaxKind.GreaterThanEqualsToken]: "is at least" };
/* `cache[keyStr]` — an element access is two real names, and naming both beats "the result".
 * Only when BOTH sides are quotable; an index that is itself an expression stays code. */
function elemAccess(n, sf) {
  if (!n || !ts.isElementAccessExpression(n)) return null;
  const obj = dottedText(n.expression, sf);
  const arg = n.argumentExpression;
  const idx = arg && (dottedText(arg, sf) ? q(dottedText(arg, sf)) : literalGloss(arg, sf));
  return obj && idx ? q(obj) + " at " + idx : null;
}

/* `[...a, ...b]` / `[x, y]` — say which lists are being joined, by name. */
function arrayGloss(n, sf) {
  if (!n || !ts.isArrayLiteralExpression(n) || !n.elements.length) return null;
  const names = [];
  for (const el of n.elements) {
    const t = ts.isSpreadElement(el) ? dottedText(el.expression, sf) : dottedText(el, sf);
    if (!t) return null;
    names.push(t);
  }
  if (names.length > 4) return null;
  const spread = n.elements.some(ts.isSpreadElement);
  return names.length === 1 ? (spread ? "a copy of " + q(names[0]) : "a list holding " + q(names[0]))
    : P.list(names.map(q)) + (spread ? " joined together" : " as a list");
}

/* `{ a, b, c }` — name the fields, which is what the reader is looking for. */
function recordGloss(n, sf) {
  if (!n || !ts.isObjectLiteralExpression(n) || !n.properties.length) return null;
  const keys = [];
  for (const pr of n.properties) {
    if (ts.isSpreadAssignment(pr)) { const t = dottedText(pr.expression, sf); if (!t) return null; keys.push("everything in " + q(t)); continue; }
    const nm = pr.name && safeMemberName(pr.name, sf);
    if (!nm) return null;
    keys.push(q(nm));
  }
  if (keys.length > 5) return "a record with " + keys.length + " fields";
  return "a record of " + P.list(keys);
}

function condGloss(n, sf, strict) {
  if (!n) return null;
  if (ts.isParenthesizedExpression(n)) return condGloss(n.expression, sf, strict);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    const d = dottedText(n.operand, sf);
    if (d) return q(d) + " is missing";
    const inner = condGloss(n.operand, sf);
    if (inner) return inner.replace(/ passes /, " fails ").replace(/ is set$/, " is missing").replace(/ holds$/, " does not hold");
  }
  /* `typeof x === 'number'` is a type test, and saying so is more informative than either
   * operand alone. 86 conditions were falling through to "branch on a condition" on this shape. */
  if (ts.isBinaryExpression(n) && ts.isTypeOfExpression(n.left) && ts.isStringLiteralLike(n.right)) {
    const t = dottedText(n.left.expression, sf);
    const neg = n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      || n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken;
    if (t) return q(t) + (neg ? " is not " : " is ") + P.a(n.right.text);
  }
  if (ts.isCallExpression(n)) {
    const callee = n.expression;
    const cn = ts.isPropertyAccessExpression(callee) ? callee.name.text : (ts.isIdentifier(callee) ? callee.text : null);
    const ins = inputsOf(n, sf).filter((x) => x !== cn);
    if (cn && ins.length) return P.list(ins.map(q)) + " passes " + q(cn);
    if (cn) return q(cn) + " holds";
  }
  const d = dottedText(n, sf);
  if (d) return q(d) + " is set";
  const ea = elemAccess(n, sf);
  if (ea) return ea + " is set";
  if (ts.isBinaryExpression(n)) {
    const op = CMP[n.operatorToken.kind];
    if (!op) {
      if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        /* Compose only from SPECIFIC glosses. If an operand would itself need the last resort,
         * fall through so the fallback runs ONCE over the whole condition and names every value
         * it reads — rather than "the test on `a` passes and the test on `a` and `b` passes and
         * ...", which is the same sentence stuttered per operand. */
        const join = n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? " and " : " or ";
        const l = condGloss(n.left, sf, true), r = condGloss(n.right, sf, true);
        if (l && r) return l + join + r;
        if (!strict) {
          /* one fallback naming every value the whole condition reads, if there is one ... */
          const all = inputsOf(n, sf);
          if (all.length) return "the test on " + P.list(all.map(q)) + " passes";
          /* ... and only if there is not, the stuttered join, which still beats saying nothing. */
          const l2 = condGloss(n.left, sf), r2 = condGloss(n.right, sf);
          if (l2 && r2) return l2 + join + r2;
        }
      }
      return null;
    }
    const lhs = dottedText(n.left, sf);
    const rhs = dottedText(n.right, sf) ? q(dottedText(n.right, sf)) : literalGloss(n.right, sf);
    if (lhs && rhs) return q(lhs) + " " + op + " " + rhs;
  }
  /* LAST RESORT, and counted as one. We cannot say what the arithmetic MEANS without guessing, but
   * naming the values the test READS is true and site-specific. It is deliberately weaker than the
   * glosses above; the report counts it separately rather than letting it hide in the total.
   * (It was briefly removed on a measurement that said it fired zero times — the counting regex was
   * anchored and this clause usually appears EMBEDDED in a larger sentence, "stop early when ...".
   * It fires 24 times. The lesson is the measurement, not the clause.) */
  if (strict) return null;
  const ins = inputsOf(n, sf);
  if (ins.length) return "the test on " + P.list(ins.map(q)) + " passes";
  return null;
}

/* import/export shapes the naming pass does not cover (rare arities, `* as`, aliases). */
function importGloss(st, sf) {
  const c = st.importClause;
  if (!c) return "load a module for its side effects only";
  if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) return "import a whole module under one namespace";
  const named = c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.length : 0;
  if (c.name && named) return "import a module's default export plus " + named + " more names";
  if (c.name) return "import a module's default export";
  if (named) return "import " + named + " name" + (named === 1 ? "" : "s") + " from a module";
  return null;
}
function exportGloss(st, sf) {
  if (!st.moduleSpecifier) {
    if (st.exportClause && ts.isNamedExports(st.exportClause)) {
      const n = st.exportClause.elements.length;
      return "export " + n + " name" + (n === 1 ? "" : "s") + " from this module";
    }
    return null;
  }
  if (!st.exportClause) return "re-export everything from another module";
  if (ts.isNamedExports(st.exportClause)) {
    const n = st.exportClause.elements.length;
    return "re-export " + n + " name" + (n === 1 ? "" : "s") + " from another module";
  }
  return null;
}

/* ---- CHUNK RULES (PRD §5D.3C, §5D.3D) -------------------------------------------------------
 * A rule is keyed to an AST NODE KIND, never to a shape mined from a corpus, and CARDINALITY IS A
 * PARAMETER OF THE RULE: the same rule renders one statement or twelve, joining with a list rather
 * than repeating itself. That is the whole point — a run of imports is ONE clause naming each
 * import, not N clauses joined by "then" (§5D.3D: Amir's "No", 2026-09-01).
 *
 * Each rule is { kind, match, render }. `render` returns ONE action string for the whole run, or
 * null to decline — declining is safe and falls straight through to the per-statement path below,
 * which is why adding a rule can never regress a file (R-LANG-17).
 *
 * DISPLAY ONLY, like every other label producer here: the compiler reads the payload, never the
 * label (see compileChunk). A wrong rule is wrong prose and cannot be wrong bytes. */
function importPhrase(st, sf) {
  const spec = st.moduleSpecifier && ts.isStringLiteralLike(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
  const from = spec ? " from " + q(spec) : "";
  const c = st.importClause;
  if (!c) return spec ? q(spec) + " for its side effects only" : null;
  const nb = c.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) return "all of " + q(nb.name.text) + from;
  const named = nb && ts.isNamedImports(nb) ? nb.elements.map((e) => e.name.text) : [];
  const parts = [];
  if (c.name) parts.push(q(c.name.text) + " (its default)");
  for (const n of named) parts.push(q(n));
  if (!parts.length) return null;
  return P.list(parts) + from;
}
const CHUNK_RULES = [
  /* ImportDeclaration — the single most repetitive kind in the corpus (5,833 of 33,918
   * statements, per generators.js's v3 note), and the one Amir named. */
  { kind: "ImportDeclaration",
    match: (st) => ts.isImportDeclaration(st),
    render: (run, sf) => {
      const phrases = run.map((st) => importPhrase(st, sf));
      if (phrases.some((x) => !x)) return null; // one unreadable member -> decline the whole run
      return "import " + P.list(phrases);
    } },
];
const chunkRuleFor = (st) => CHUNK_RULES.find((r) => r.match(st)) || null;

/* Tier-1 prose: describe a run of statements as English grouped by ROLE — a lead sequence of
 * actions (declarations / calls / returns) plus the guard rules pulled out as "failing when …",
 * surfacing the real throw messages. DISPLAY ONLY; deterministic; zero model. */
function spanActions(win, sf) {
  const actions = [], guards = [];
  const isAwait = (st) => /\bawait\b/.test(st.getText(sf).slice(0, 80));
  let wi = 0;
  while (wi < win.length) {
    /* CHUNK-RULE PRE-PASS: a maximal run of one node kind gets ONE clause from its rule. Placed
     * before the per-statement productions so a rule always wins over N repetitions; a rule that
     * declines (null) leaves wi untouched and the statement falls through unchanged. */
    const rule = chunkRuleFor(win[wi]);
    if (rule) {
      let wj = wi; while (wj < win.length && rule.match(win[wj])) wj++;
      const one = rule.render(win.slice(wi, wj), sf);
      if (one) { actions.push(one); wi = wj; continue; }
    }
    const st = win[wi++];
    if (isGuardThrow(st)) {
      const msg = throwMessage(throwStmtOf(st.thenStatement));
      if (msg) guards.push('“' + msg + '”');
      else { const c = firstCallName(st); guards.push(c ? "a " + P.words(c) + " check fails" : "a check fails"); }
      continue;
    }

    /* ---- DECLARATIONS. spanProse had NO production for these at all, so every interface, type
     * alias, enum and class in the corpus rendered as "run a step" (783 statements). The names
     * are already the clearest available words (PRD §3), so they are quoted verbatim, not
     * translated — `IPartnerCutAmountSource` is what the reader will grep for. */
    if (ts.isInterfaceDeclaration(st)) {
      const fields = st.members.map((m) => safeMemberName(m.name, sf)).filter(Boolean);
      actions.push("describe the shape " + q(st.name.text)
        + (fields.length ? " with " + P.list(fields.map(q)) : " with no fields"));
      continue;
    }
    if (ts.isTypeAliasDeclaration(st)) { actions.push("name the type " + q(st.name.text)); continue; }
    if (ts.isEnumDeclaration(st)) {
      const ms = st.members.map((m) => safeMemberName(m.name, sf)).filter(Boolean);
      actions.push("list the choices for " + q(st.name.text) + (ms.length ? " — " + P.list(ms.map(q)) : ""));
      continue;
    }
    if (ts.isClassDeclaration(st) && st.name) {
      const ent = entityProse(st, sf);
      actions.push(ent || "define the class " + q(st.name.text));
      continue;
    }
    if (ts.isFunctionDeclaration(st) && st.name) { actions.push("define " + q(st.name.text)); continue; }
    if (ts.isModuleDeclaration(st) && st.name) { actions.push("declare the module " + q(st.name.getText(sf))); continue; }

    /* imports/exports the naming pass did not cover (rare arities) */
    if (ts.isExportAssignment(st)) {
      const d = dottedText(st.expression, sf);
      actions.push(d ? "make " + q(d) + " this module's default export" : "set this module's default export");
      continue;
    }
    if (ts.isImportDeclaration(st)) { const w = importGloss(st, sf); if (w) { actions.push(w); continue; } }
    if (ts.isExportDeclaration(st)) { const w = exportGloss(st, sf); if (w) { actions.push(w); continue; } }

    if (ts.isVariableStatement(st)) {
      const decls = st.declarationList.declarations;
      /* A destructuring pattern is a list of real names; the old filter dropped it on the floor
       * and the statement fell through to "compute a value" (388 sites). */
      const names = [].concat(...decls.map((d) => bindingNames(d.name, sf)));
      const nm = names.length ? P.list(names.map(q)) : null;
      const init = decls[0] && decls[0].initializer;
      if (!nm) { actions.push("compute a value"); continue; } // nothing true to say — counts, by design
      if (init && ts.isNewExpression(init) && /Router$/.test(init.expression.getText(sf))) {
        const a0 = init.arguments && init.arguments[0];
        let pfx = null;
        if (a0 && ts.isObjectLiteralExpression(a0)) for (const pr of a0.properties)
          if (ts.isPropertyAssignment(pr) && safeMemberName(pr.name, sf) === "prefix" && ts.isStringLiteralLike(pr.initializer)) pfx = pr.initializer.text;
        actions.push("open the route group " + nm + (pfx ? " at " + q(pfx) : "")); continue;
      }
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) { actions.push("define " + nm); continue; }
      const call = firstCallName(st);
      if (isAwait(st)) { actions.push("await " + (call ? P.words(call) : "a value") + " into " + nm); continue; }
      if (call) { actions.push("get " + nm + " from " + P.words(call)); continue; }
      /* no call: the initializer is a value, a field, or a literal — say which. */
      if (init) {
        const src = dottedText(init, sf);
        if (src) { actions.push("take " + nm + " from " + q(src)); continue; }
        const lit = literalGloss(init, sf);
        if (lit) { actions.push("set " + nm + " to " + lit); continue; }
      }
      actions.push("compute " + nm);
      continue;
    }

    if (ts.isReturnStatement(st)) {
      const e = st.expression;
      if (!e) { actions.push("return"); continue; }
      /* `x as Foo` returns x; the cast is a type assertion, not part of what is returned. */
      let bare = e; while (ts.isAsExpression(bare) || ts.isTypeAssertionExpression(bare) || ts.isNonNullExpression(bare) || ts.isParenthesizedExpression(bare)) bare = bare.expression;
      if (bare !== e) {
        const bd = dottedText(bare, sf);
        if (bd) { actions.push("return " + q(bd)); continue; }
        if (ts.isNewExpression(bare) && ts.isIdentifier(bare.expression)) { actions.push("return a new " + q(bare.expression.text)); continue; }
        const bl = literalGloss(bare, sf);
        if (bl) { actions.push("return " + bl); continue; }
        const bc = firstCallName(bare);
        if (bc) { actions.push("return " + P.words(bc)); continue; }
      }
      if (ts.isNewExpression(e) && ts.isIdentifier(e.expression)) { actions.push("return a new " + q(e.expression.text)); continue; }
      const lit = literalGloss(e, sf);
      if (lit) { actions.push("return " + lit); continue; }
      const dotted = dottedText(e, sf);
      if (dotted) { actions.push("return " + q(dotted)); continue; }
      const ag = arrayGloss(e, sf);
      if (ag) { actions.push("return " + ag); continue; }
      const rg = recordGloss(e, sf);
      if (rg) { actions.push("return " + rg); continue; }
      const eg = elemAccess(e, sf);
      if (eg) { actions.push("return " + eg); continue; }
      const c = firstCallName(st);
      if (c) { actions.push("return " + P.words(c)); continue; }
      /* An expression return. We cannot say what the arithmetic MEANS without guessing, but we
       * can truthfully say which values feed it, which is what a reader actually wants. */
      if (ts.isTemplateExpression(e)) {
        const parts = inputsOf(e, sf);
        actions.push(parts.length ? "return text built from " + P.list(parts.map(q)) : "return some text");
        continue;
      }
      if (ts.isConditionalExpression(e)) {
        const cg = condGloss(e.condition, sf);
        const a = dottedText(e.whenTrue, sf) || literalGloss(e.whenTrue, sf);
        const b = dottedText(e.whenFalse, sf) || literalGloss(e.whenFalse, sf);
        const fmt = (x, node) => (dottedText(node, sf) ? q(x) : x);
        if (cg && a && b) { actions.push("return " + fmt(a, e.whenTrue) + " when " + cg + ", otherwise " + fmt(b, e.whenFalse)); continue; }
        if (cg) { actions.push("return one of two values depending on whether " + cg); continue; }
      }
      if (ts.isBinaryExpression(e) || ts.isParenthesizedExpression(e) || ts.isPrefixUnaryExpression(e)) {
        const parts = inputsOf(e, sf);
        if (parts.length) { actions.push("return a value worked out from " + P.list(parts.map(q))); continue; }
      }
      /* LAST RESORT, as for conditions: name the values the returned expression reads. */
      const rin = inputsOf(e, sf);
      actions.push(rin.length ? "return a value worked out from " + P.list(rin.map(q)) : "return the result");
      continue;
    }

    if (ts.isThrowStatement(st)) {
      const m = throwMessage(st);
      if (m) { actions.push("throw “" + m + "”"); continue; }
      const d = dottedText(st.expression, sf);
      if (d) { actions.push("re-throw " + q(d)); continue; }
      const arg = ts.isNewExpression(st.expression) && st.expression.arguments && st.expression.arguments[0];
      const ad = arg && dottedText(arg, sf);
      if (ad) { actions.push("throw an error built from " + q(ad)); continue; }
      const tin = inputsOf(st.expression, sf);
      actions.push(tin.length ? "throw an error reporting " + P.list(tin.map(q)) : "throw an error");
      continue;
    }

    if (ts.isExpressionStatement(st)) {
      const inner = ts.isAwaitExpression(st.expression) ? st.expression.expression : st.expression;
      if (ts.isDeleteExpression(inner)) {
        const t = dottedText(inner.expression, sf) || (elemAccess(inner.expression, sf) && null);
        const ea = elemAccess(inner.expression, sf);
        if (t) { actions.push("remove " + q(t)); continue; }
        if (ea) { actions.push("remove " + ea); continue; }
      }
      if (ts.isCallExpression(inner) && ts.isElementAccessExpression(inner.expression)) {
        const ea = elemAccess(inner.expression, sf);
        if (ea) { actions.push("call " + ea); continue; }
      }
      /* assignment: `ctx.body = {...}` had no call, so it rendered as "run a step" */
      if (ts.isBinaryExpression(inner) && (inner.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken || inner.operatorToken.kind === ts.SyntaxKind.MinusEqualsToken)) {
        const t = dottedText(inner.left, sf);
        if (t) { actions.push((inner.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ? "add to " : "subtract from ") + q(t)); continue; }
      }
      if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        let lhs = dottedText(inner.left, sf);
        if (!lhs && ts.isElementAccessExpression(inner.left)) {
          const base = dottedText(inner.left.expression, sf);
          if (base) { actions.push("store a value in " + q(base)); continue; }
        }
        if (lhs) {
          const lit = literalGloss(inner.right, sf);
          actions.push("set " + q(lhs) + (lit ? " to " + lit : ""));
          continue;
        }
      }
      const callee = ts.isCallExpression(inner) ? inner.expression : null;
      if (callee && ts.isPropertyAccessExpression(callee) && callee.expression.getText(sf) === "console") {
        const lvl = callee.name.text, msg = throwMessage(inner);
        const noun = lvl === "error" ? "an error" : lvl === "warn" ? "a warning" : "a message";
        if (msg) { actions.push("log " + noun + " “" + msg + "”"); continue; }
        const a0 = inner.arguments && inner.arguments[0];
        const keys = a0 && ts.isObjectLiteralExpression(a0)
          ? a0.properties.map((pr) => safeMemberName(pr.name, sf)).filter(Boolean) : [];
        if (keys.length && keys.length <= 6) { actions.push("log " + noun + " about " + P.list(keys.map(q))); continue; }
        const ad = a0 && dottedText(a0, sf);
        if (ad) { actions.push("log " + noun + " about " + q(ad)); continue; }
        const ins = a0 ? inputsOf(a0, sf) : [];
        if (ins.length) { actions.push("log " + noun + " about " + P.list(ins.map(q))); continue; }
        actions.push("log " + (lvl === "log" ? "a message" : noun));
        continue;
      }
      if (ts.isPostfixUnaryExpression(inner) || ts.isPrefixUnaryExpression(inner)) {
        const d = dottedText(inner.operand, sf);
        const up = inner.operator === ts.SyntaxKind.PlusPlusToken;
        if (d && (up || inner.operator === ts.SyntaxKind.MinusMinusToken)) {
          actions.push((up ? "count up " : "count down ") + q(d)); continue;
        }
      }
      { /* a route registration, possibly chained: router.get(...).post(...) */
        const routes = []; let cur = inner;
        while (ts.isCallExpression(cur)) { const r = routeClause(cur, sf); if (r) routes.unshift(r);
          cur = ts.isPropertyAccessExpression(cur.expression) ? cur.expression.expression : null; if (!cur) break; }
        if (routes.length) { actions.push(P.list(routes)); continue; }
      }
      if (ts.isCallExpression(inner) && inner.expression.kind === ts.SyntaxKind.SuperKeyword) {
        actions.push("call the parent constructor"); continue;
      }
      const name = firstCallName(st);
      actions.push((isAwait(st) ? "await " : "call ") + (name ? P.words(name) : "a step"));
      continue;
    }

    if (ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)) {
      const c = firstCallName(st);
      if (c) { actions.push("loop over " + P.words(c)); continue; }
      const over = (ts.isForOfStatement(st) || ts.isForInStatement(st)) ? dottedText(st.expression, sf)
        : (ts.isForStatement(st) && st.condition ? inputsOf(st.condition, sf).filter((x) => !/^i$|^j$|^k$/.test(x))[0] : null);
      actions.push(over ? "loop over " + q(over) : "loop"); continue;
    }

    if (ts.isIfStatement(st)) {
      /* describe the TEST and what the branch does with it. Emit only when the condition can be
       * stated truthfully; otherwise fall through to the vacuous clause and let it count. */
      const cond = condGloss(st.expression, sf);
      const then = st.thenStatement;
      const body = ts.isBlock(then) ? then.statements[0] : then;
      if (cond && then) {
        /* what the branch DOES is the point of the sentence. A block that ends in a throw or a
         * return is a guard even when it does other work first (logging, status codes) —
         * isGuardThrow only recognises the bare form, so those were understated as
         * "check whether …", which describes the test and hides the consequence. */
        const stmts = ts.isBlock(then) ? [...then.statements] : [then];
        const last = stmts[stmts.length - 1];
        if (last && ts.isThrowStatement(last)) {
          const m = throwMessage(last);
          actions.push("fail when " + cond + (m ? " — “" + m + "”" : "")); continue;
        }
        if (last && ts.isReturnStatement(last)) { actions.push("stop early when " + cond); continue; }
        if (stmts.length === 1) { const c = firstCallName(stmts[0]); if (c) { actions.push("when " + cond + ", " + P.words(c)); continue; } }
        actions.push("check whether " + cond); continue;
      }
      const c = firstCallName(st.thenStatement);
      actions.push(c ? "if a condition holds, " + P.words(c) : "branch on a condition");
      continue;
    }

    if (ts.isTryStatement(st)) {
      const c = firstCallName(st.tryBlock);
      if (c) { actions.push("try " + P.words(c)); continue; }
      const first = st.tryBlock.statements[0];
      const inner = first ? spanProse([first], sf) : null;
      actions.push(inner && !/^(run a step|compute a value)$/.test(inner) ? "try to " + inner + ", recovering on error" : "run a try/catch");
      continue;
    }
    if (ts.isSwitchStatement(st)) {
      const on = dottedText(st.expression, sf);
      actions.push(on ? "choose on " + q(on) : "switch on a value"); continue;
    }
    const c = firstCallName(st); actions.push(c ? "call " + P.words(c) : "run a step");
  }
  /* CARDINALITY, the generic case (PRD §5D.3C point 1, §5D.3D). Two adjacent statements that
   * produce the IDENTICAL clause are the same pattern occurring twice, so say it once with a
   * count — "call `res.set` twice" — rather than repeating the clause. This is the same move the
   * import rule makes, applied to every kind at once: it is what `namedLabel`'s long-dead (×N)
   * collapse was reaching for, in the one place that is actually reachable.
   *
   * Only ADJACENT identicals collapse. A B A is genuinely interleaved and stays as it is. */
  const merged = [];
  for (const a of actions) {
    const last = merged[merged.length - 1];
    if (last && last.a === a) last.n++; else merged.push({ a, n: 1 });
  }
  /* `raw` is returned alongside because the says-nothing test MUST run before the collapse:
   * "run a step" twice collapses to "run a step twice", which is not in the says-nothing set and
   * would have slipped a meaningless whole-file word past the R-ARCH-17 gate. Caught by
   * chunk-naming.test.js rather than by reading the code. */
  return { actions: merged.map((m) => (m.n === 1 ? m.a : m.a + (m.n === 2 ? " twice" : " " + m.n + " times"))), guards, raw: actions };
}

/* The joined sentence. Kept as its own function so ONE-CLAUSE-NESS is testable without re-deriving
 * it from the string (R-ARCH-17 needs to ask "did this whole run collapse to a single clause?"). */
function spanProse(win, sf) {
  const { actions, guards } = spanActions(win, sf);
  let out = P.list(actions, "then");
  /* joined as prose, not with a semicolon: the English-completeness scanner correctly flagged
   * `"A"; "B"` as leftover punctuation, and it was right — a semicolon is not English. */
  if (guards.length) out += (out ? " — " : "") + "failing when " + P.list(guards);
  return out;
}

/* The gloss for a whole run, or null if that run may NOT be collapsed into one word — the test
 * the amended R-MINE-7 (§5D.4, R-ARCH-17) needs. It is deliberately NOT "exactly one clause":
 * two DIFFERENT actions joined by "then" is ordinary English and reads fine ("import A, B and C
 * then define D"). What Amir rejected in §5D.3D was MECHANICAL REPETITION — the same clause said
 * N times because no rule recognised the pattern. So the three disqualifiers are:
 *
 *   1. a REPEATED action — some kind recurs here and has no chunk rule yet. Refusing keeps
 *      today's re-segmented output AND makes the missing rule visible as a non-collapsed file,
 *      which is exactly the residual work queue (§5D.4A). This is the only interesting one.
 *   2. an action that SAYS NOTHING ("run a step", "compute a value") — an opaque whole-file word
 *      is what R-ARCH-15 forbids outright.
 *   3. nothing to say at all.
 *
 * Guards are fine: "… — failing when “x is required”" is real English and carries real content.
 * A named whole-chunk name (R-LANG-19) bypasses this entirely — see namedLabel. */
/* Every gloss that carries no information. "call a step" / "await a step" come from the
 * expression-statement production at line ~771 when no call name could be found — they are the
 * most common meaningless clause in the corpus, and omitting them would have let an unreadable
 * whole-file word through the gate. */
const SAYS_NOTHING = /^(run a step|call a step|await a step|compute a value|branch on a condition|switch on a value|run a try\/catch|compose \d+ statements)$/;
function chunkGloss(win, sf) {
  let r; try { r = spanActions(win, sf); } catch (_) { return null; }
  if (!r.actions.length) return null;
  if (r.raw.some((x) => !x || SAYS_NOTHING.test(x))) return null; // pre-collapse: see spanActions
  if (r.actions.some((x) => !x)) return null;
  if (new Set(r.actions).size !== r.actions.length) return null; // mechanical repetition — rule missing
  let out = P.list(r.actions, "then");
  if (r.guards.length) out += " — failing when " + P.list(r.guards);
  return out;
}

/* human label for a collapsed span (DISPLAY ONLY — the compiler reads the payload, not this).
 * Re-parse the covered slice into its top-level statements and describe them as English. */
function genLabel(start, end, source, stmts) {
  const slice = source.slice(start, end);
  try {
    const frag = ts.createSourceFile("s.ts", slice, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const p = spanProse([...frag.statements], frag);
    if (p) return sanitizeLabel(p);
  } catch (_) { /* fall through to the older shallow gloss, then structural */ }
  try {
    const frag = ts.createSourceFile("s.ts", slice, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const g = G.glossForStatements([...frag.statements], frag);
    if (g) return sanitizeLabel(g);
  } catch (_) { /* fall through */ }
  return "compose " + stmts + " statements";
}

/* ---- NAMED LABELS (PRD §2.2) -------------------------------------------------------------
 * The word dictionary's own names, keyed by content hash of each LEAF skeleton (engine/word-names).
 * A span's sentence is COMPOSED from its members' names, in source order, never invented whole:
 * w.m = [prefix, appended] is binary and left-leaning, so a depth-4 word is a chain of 5 leaves and
 * clause i belongs to statement i. Any leaf without a name degrades to that ONE statement's
 * spanProse clause, so a partially-named span still reads, and a span with no named leaf at all
 * falls back to today's genLabel unchanged.
 *
 * NO LONGER DISPLAY ONLY — see deriveGloss/compileChunk below. This comment used to end "compileChunk
 * finds the payload with lastIndexOf(PAY_OPEN) and decodes only that; it never reads this text. A
 * wrong name is wrong prose, never wrong bytes." That was true, and it made a hand-edit to the
 * English a NO-OP, which contradicts PRD §5D.0 statement 4 (Amir mines, hand-edits the .en, and it
 * goes back into the codebase). R-REND-6 is now inverted: the sentence is authoritative and the
 * payload is a derived index. The first cut of that is DERIVE-AND-CHECK (PRD §5E.8 mechanic 5). */
const WN = require("./word-names");
/* Corpus-rooted (PRD §8B): names are corpus data and live with the corpus, never in the engine tree. */
const NAMES = WN.load(AC.pathFor("word-names"));

function namedLabel(s, source, cat, names, chunks) {
  /* R-LANG-19: a WHOLE-CHUNK name outranks member composition. Amir's "No" (§5D.3D): a recurring
   * run is one named pattern, not N clauses joined by "then". Composition below remains the
   * fallback for every word that has no whole-chunk name, so this is purely additive. */
  const whole = WN.chunkNameFor(cat, s.payload, chunks);
  if (whole) return sanitizeLabel(whole);
  const clauses = WN.clausesFor(cat, s.payload, names);
  if (!clauses) return null;
  let frag;
  try { frag = ts.createSourceFile("s.ts", source.slice(s.start, s.end), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
  catch (_) { return null; }
  const stmts = [...frag.statements];
  if (stmts.length !== clauses.length) return null; // leaf/statement alignment broken — do not guess
  const filled = clauses.map((c, i) => c || spanProse([stmts[i]], frag) || null).filter(Boolean);
  if (!filled.length) return null;
  // collapse runs of the identical clause — names are per-skeleton, so seven identical imports
  // should say it once with a count rather than seven times.
  const runs = [];
  for (const c of filled) {
    const last = runs[runs.length - 1];
    if (last && last.c === c) last.n++; else runs.push({ c, n: 1 });
  }
  return sanitizeLabel(P.list(runs.map((r) => (r.n > 1 ? r.c + " (×" + r.n + ")" : r.c)), "then"));
}

/* Pass 0 — collapse runs of straight-line statements into ONE multi-line generator call.
 * Narrow-preferred (longest narrow match at a position), widened generators only claim a
 * position narrow leaves fully verbatim. Emits a span ONLY if refill === exact source slice. */
/* REVIEW SURFACE (PRD R-ARCH-16, §5D.4). The headline metric is no longer byte size but how many
 * statements a human must still read AS CODE. Amir, 2026-08-31: "its not about compression, its
 * about less of a review surface." So the renderer has to publish the denominator it already has
 * the AST for.
 *   bodyStatements  THE FOLDER'S OWN UNIVERSE: every statement that is a direct child of a Block
 *                   or of the SourceFile — which is exactly what `enlzw.genSpans` collects when it
 *                   looks for runs to fold (`if ((ts.isBlock(n) || ts.isSourceFile(n)) && n.statements.length)`).
 *
 *                   TWO WRONG DENOMINATORS PRECEDED THIS, both flattering, both caught by
 *                   measurement rather than by reading:
 *                     1. direct children of FUNCTION-LIKE blocks only -> S = 17,852 while collapsed
 *                        was 22,760. Collapsed EXCEEDED the denominator, so residual clamped at 0
 *                        and the metric published a perfect score. (s12 caught this as R-MEAS-2.)
 *                     2. §7.3's frozen `operations.fnStmtCount` over function bodies -> S = 22,916,
 *                        which fixed the inequality but left `restated` (895) larger than
 *                        `unfolded` (156) — impossible, and the tell that numerator and denominator
 *                        were still counting different things. fnStmtCount recurses into if/loop/try
 *                        bodies but never sees SourceFile-level statements, and the folder folds
 *                        those too.
 *
 *                   THE RULE THIS SETTLES: the denominator must be the SAME WALK as the numerator.
 *                   A metric whose two halves come from different traversals cannot be checked by
 *                   an inequality, which is why both errors published rather than failing.
 *                   §7.3 WAS AMENDED to match, 2026-08-31: the frozen `S` is this walk, not
 *                   `fnStmtCount`. `countBodyStatements` is EXPORTED as the single canonical S —
 *                   a second consumer must call it, not re-derive it. `operations.fnStmtCount`
 *                   is a per-function cluster size with one consumer (`measure-operations.js`)
 *                   and is NOT a ratio denominator anywhere; see the note on it there.
 *   collapsed       statements folded into a MULTI-STATEMENT generator word. The reader reviews
 *                   the word once, not these statements — this is the only category that actually
 *                   removes review work.
 *   restated        statements rendered as their OWN one-to-one English clause. English, but still
 *                   one review unit each, and §4 names line-by-line restatement "a failure mode,
 *                   not the goal". Counted separately and NOT credited as collapsed — crediting it
 *                   would let the metric improve by paraphrasing bespoke code, which is the exact
 *                   thing §4 forbids.
 *   verbatim        statements with no English at all. Read as raw TypeScript.
 *   reviewSurface   genSpans + (bodyStatements - collapsed) — the number of things a reader must
 *                   still read. ONE DEFINITION, shared with §7.3's corpus ratio; this is the
 *                   per-file view of the same quantity.
 *                   A generator call is counted as ONE unit, not zero: reading a word's sentence is
 *                   cheaper than reading its statements, but it is not free. An earlier cut of this
 *                   counter treated a call as free, which credited a 10-statement fold as removing
 *                   10 units of review when it removes 9.
 *   residual        bodyStatements - collapsed: the unfolded statements alone (restated + verbatim),
 *                   kept as a component of reviewSurface, not as a competing metric.
 * Counted here rather than in a separate measure script on purpose: a second definition of
 * "statement" in a second file is the producer/consumer drift shape (§8B) with the metric as the
 * consumer. One definition, published beside the spans it is derived from. */
function countBodyStatements(sf) {
  let n = 0;
  const walk = (nd) => {
    if ((ts.isBlock(nd) || ts.isSourceFile(nd)) && nd.statements.length) n += nd.statements.length;
    ts.forEachChild(nd, walk);
  };
  walk(sf);
  return n;
}

function renderFileEn(source, index) {
  index = index || cnl.loadWordsIndex([]);
  const sf = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const spans = []; // {start, end, en, kind}

  // Pass 0 — multi-line generator collapse (takes precedence over the single-statement passes).
  //   0a PRIMARY: the RECURSIVE word dictionary — generators referencing generators, so a span
  //      can compose to real depth. Byte-gated inside enlzw.genSpans (fill === source slice).
  //   0b THERE IS NO PASS 0b. This comment used to describe a FALLBACK to the flat
  //      generators.json for ranges the recursive dictionary did not claim. No such pass is
  //      implemented below, and nothing live reads generators.json — the four remaining mentions
  //      of it in this tree are all prose. Kept as a correction rather than deleted, because the
  //      comment outlived the code it described and a reader was entitled to believe it.
  //      Consequence, measured 2026-08-31: `tier` is set to "recursive" at exactly one place, so
  //      the flat counters below (flatN / genFlatFallback / flatFallbackPct) are STRUCTURALLY
  //      ZERO — not measured-zero. Per PRD R-MECH-8 the engine must not publish a number no mine
  //      can move, so they are retained as a TRIPWIRE for a re-introduced flat producer, not
  //      reported as a coverage figure. A non-zero value means someone added a flat tier without
  //      updating the composition gate (R-COMP-7).
  /* R-ARCH-17: the whole-run refusal is now conditional on the run having a real chunk gloss. */
  const recSpans = index._lzw ? EL.genSpans(sf, source, index._lzw, { wholeRunOk: (run, rsf) => !!chunkGloss(run, rsf) }) : [];
  const genSpans = recSpans.map((s) => ({
    start: s.start, end: s.end, kind: "gen", tier: "recursive", stmts: s.stmts, depth: s.depth,
    en: GEN + " " + (namedLabel(s, source, index._lzw, NAMES.names, NAMES.chunks) || genLabel(s.start, s.end, source, s.stmts))
      + " " + PAY_OPEN + PAY.encode(s.payload) + PAY_CLOSE,
  }));
  for (const g of genSpans) spans.push(g);
  const inGen = (s, e) => genSpans.some((g) => s < g.end && e > g.start);

  // Pass 1 — pure-logic simple statements (no data leaf) via the cnl grammar.
  const seenStmt = [];
  const visitStmt = (node) => {
    if (isSimpleStmt(node) && !inGen(node.getStart(sf), node.getEnd()) && !hasRenderableData(node, sf)) {
      const text = node.getText(sf);
      if (!/[«»]/.test(text)) {
        let en = null;
        try { en = cnl.renderStatement(text, index); } catch (_) { en = null; }
        // accept only a single-line render that (a) recompiles byte-exact AND (b) actually
        // adds English — a pure `backtick` bespoke escape is just raw TS in guillemets, so
        // skip it (leave the statement verbatim) rather than inflate the English count.
        const isPureEscape = en != null && /^`[\s\S]*`\.?$/.test(en);
        if (en != null && !en.includes("\n") && !isPureEscape) {
          let back = null; try { back = cnl.compileStatement(en, index); } catch (_) { back = null; }
          if (back === text) { spans.push({ start: node.getStart(sf), end: node.getEnd(), en, kind: "stmt" }); seenStmt.push([node.getStart(sf), node.getEnd()]); }
        }
      }
    }
    ts.forEachChild(node, visitStmt);
  };
  visitStmt(sf);

  // Pass 2 — MAXIMAL data-leaf expressions via the data layer (reaches decorators / args).
  const inStmt = (s, e) => seenStmt.some(([a, b]) => s >= a && e <= b);
  const dataSpans = [];
  const visitData = (node, insideData) => {
    if (isDataLeaf(node) && DATA.dataByteExact(node, sf)) {
      const s = node.getStart(sf), e = node.getEnd();
      if (!insideData && !inStmt(s, e) && !inGen(s, e)) { const en = DATA.renderData(node, sf); dataSpans.push({ start: s, end: e, en, kind: "data" }); ts.forEachChild(node, (c) => visitData(c, true)); return; }
    }
    ts.forEachChild(node, (c) => visitData(c, insideData));
  };
  visitData(sf, false);
  for (const d of dataSpans) spans.push(d);

  // reconstruct .en: swap accepted spans for «en», keep the rest verbatim
  spans.sort((a, b) => a.start - b.start);
  let out = "", pos = 0, englishBytes = 0, stmtN = 0, dataN = 0, genN = 0, genStmts = 0;
  let recN = 0, flatN = 0, maxDepth = 0; const depthHist = {};
  for (const sp of spans) {
    if (sp.start < pos) continue; // safety: never overlap
    out += escapeVerbatim(source.slice(pos, sp.start)) + OPEN + sp.en + CLOSE;
    pos = sp.end; englishBytes += sp.end - sp.start;
    if (sp.kind === "stmt") { stmtN++; continue; }
    if (sp.kind !== "gen") { dataN++; continue; }
    genN++; genStmts += sp.stmts || 0;
    if (sp.tier === "flat") flatN++; else recN++;
    const d = sp.depth || 0; depthHist[d] = (depthHist[d] || 0) + 1; if (d > maxDepth) maxDepth = d;
  }
  out += escapeVerbatim(source.slice(pos));
  const bodyStmts = countBodyStatements(sf);
  /* count TOP-LEVEL spans in the emitted English (nesting-aware) and the non-whitespace bytes
   * outside them — the two numbers R-ARCH-15 is measured with. Derived from `out` rather than from
   * the span list so it measures what the reader actually receives. */
  let topSpanCount = 0, outsideNonWs = 0;
  { let depth = 0, cursor = 0;
    for (let k = 0; k < out.length; k++) {
      const ch = out[k];
      if (ch === OPEN) { if (depth === 0) { outsideNonWs += out.slice(cursor, k).replace(/\s/g, "").length; } depth++; }
      else if (ch === CLOSE) { depth--; if (depth === 0) { topSpanCount++; cursor = k + 1; } }
    }
    outsideNonWs += out.slice(cursor).replace(/\s/g, "").length;
  }
  return { en: out, stats: {
    totalBytes: source.length, englishBytes,
    englishPct: source.length ? +(100 * englishBytes / source.length).toFixed(1) : 0,
    stmtSpans: stmtN, dataSpans: dataN,
    /* R-ARCH-16 — review surface. `residualStatements` is the number that must fall; it is
     * reported as a count, never only as a percentage, because a percentage of a shrinking
     * denominator can improve while the reader's work does not. */
    bodyStatements: bodyStmts,
    collapsedStatements: genStmts, restatedStatements: stmtN,
    verbatimStatements: Math.max(0, bodyStmts - genStmts - stmtN),
    residualStatements: Math.max(0, bodyStmts - genStmts),
    /* R-MEAS-6 / R-ARCH-15: does this file collapse to ONE top-level word? `topSpans` is the count
     * of top-level spans and `oneWord` is true only when there is exactly one AND nothing but
     * whitespace outside it — i.e. one word accounts for the whole file. Published per file
     * because an average hides the worst file, which is the one that costs the review. */
    topSpans: topSpanCount, outsideNonWs: outsideNonWs, oneWord: topSpanCount === 1 && outsideNonWs === 0,
    /* §7.3's frozen definition, per file. netStatementReduction = collapsed - calls is what leaves
     * the reader's view; reviewSurface is what is left of S after it. */
    netStatementReduction: genStmts - genN,
    reviewSurface: genN + Math.max(0, bodyStmts - genStmts),
    reviewSurfacePct: bodyStmts ? +(100 * (genN + Math.max(0, bodyStmts - genStmts)) / bodyStmts).toFixed(1) : 0,
    genSpans: genN, genStmtsCollapsed: genStmts,
    genRecursive: recN, genFlatFallback: flatN, maxDepth, depthHist,
  } };
}

/* ------------------------------ COMPILE (.en -> .ts) ------------------------------ */
/* DERIVE-AND-CHECK — the first cut of sentence-authority (PRD R-REND-6, §5E.5, §5E.8 mechanic 5).
 *
 * WHY. The compiler used to locate the payload with lastIndexOf and ignore every other byte in the
 * chunk, so hand-editing the English changed nothing: the edit compiled the OLD code and looked
 * like it had worked. That is the worst of the three options — worse than refusing, and worse than
 * honouring the edit. Amir's lifecycle (§5D.0 statement 4) requires the .en to be editable, and an
 * edit that silently does nothing is not an editable artifact.
 *
 * WHAT THIS DOES, AND WHAT IT DOES NOT. It makes a hand-edit DETECTED, not yet EFFECTIVE. The gloss
 * is re-derived from the payload and compared to the gloss that is written; a mismatch throws and
 * names the clause. Making the edit change the output needs the grammar parser (§5E.3.2), which is
 * the larger job; this closes the silent-no-op hole first.
 *
 * WHY DERIVE THE GLOSS RATHER THAN PARSE IT. The obvious cheap check — "every `backticked` token in
 * the gloss must be one of the payload's hole fills" — was MEASURED on the fixture and is wrong:
 * 32/40 spans pass, and all 8 failures are the same benign shape, a gloss saying `this.rows` where
 * the hole holds `rows` and `this.` came from the template. A check that fires on 20% of correct
 * spans is worse than no check. Deriving instead has NO false positives by construction: the
 * renderer produced the written gloss by calling these same two functions on these same bytes, so
 * agreement is guaranteed unless a human changed something.
 *
 * COST. One extra parse per generator span at compile time, and it needs the catalog (already
 * required for compileSpan). Off unless asked for, because the .en -> .ts round-trip is on the hot
 * path of every test; `SDD_DERIVE_CHECK=1` or `{deriveCheck:true}` turns it on. It is ON by default
 * in the round-trip tests, which is where a drifted gloss must not slip through. */
function deriveGloss(payload, compiled, cat) {
  const s = { payload, start: 0, end: compiled.length, stmts: null };
  try { return namedLabel(s, compiled, cat, NAMES.names, NAMES.chunks) || genLabel(0, compiled.length, compiled, null); }
  catch (_) { return null; }   /* a gloss we cannot derive is not evidence of an edit */
}

const DERIVE_CHECK = process.env.SDD_DERIVE_CHECK === "1";

function compileChunk(chunk, index, opts) {
  const deriveCheck = (opts && opts.deriveCheck !== undefined) ? opts.deriveCheck : DERIVE_CHECK;
  if (chunk[0] === GEN) { // multi-line generator: refill catalog template with per-site holes
    const a = chunk.lastIndexOf(PAY_OPEN), b = chunk.lastIndexOf(PAY_CLOSE);
    if (a < 0 || b < 0 || b < a) throw new Error("enfile: malformed generator payload");
    // ONE DIALECT, ONE ENCODING. The flat anti-unification path is deleted (PRD §4A defect) and
    // base64(JSON) is retired, so a payload is either `lzw1` text or it is not ours. decode()
    // is fail-closed: it throws on anything it does not fully understand rather than guessing,
    // and it names a stale base64 payload specifically so the fix is obvious.
    const obj = PAY.decode(chunk.slice(a + 1, b));
    if (!index || !index._lzw) throw new Error("enfile: recursive generator span but no lzw catalog loaded");
    const compiled = EL.compileSpan(obj, index._lzw);
    if (deriveCheck) {
      const written = chunk.slice(1, a).trim();
      const derived = deriveGloss(obj, compiled, index._lzw);
      if (derived !== null && derived !== written) {
        throw new Error(
          "enfile: SENTENCE AND PAYLOAD DISAGREE (R-REND-6 — the sentence is authoritative)\n" +
          "  written:  " + written + "\n" +
          "  derived:  " + derived + "\n" +
          "  The English in this clause is not what its payload compiles to. Either the prose was\n" +
          "  hand-edited (the payload has not caught up — re-render, or wait for grammar parsing to\n" +
          "  make the edit effective) or the payload is stale. It is NOT compiled silently.");
      }
    }
    return compiled;
  }
  if (DATA_PREFIX.test(chunk)) return DATA.compileData(chunk);
  return cnl.compileStatement(chunk, index);
}
function compileFileEn(en, index, opts) {
  index = index || cnl.loadWordsIndex([]);
  let out = "", i = 0;
  while (i < en.length) {
    const open = en.indexOf(OPEN, i);
    if (open < 0) { out += unescapeVerbatim(en.slice(i)); break; }
    out += unescapeVerbatim(en.slice(i, open));
    const close = en.indexOf(CLOSE, open + 1);
    if (close < 0) throw new Error("enfile: unbalanced « (no matching »)");
    out += compileChunk(en.slice(open + 1, close), index, opts);
    i = close + 1;
  }
  return out;
}

module.exports = { renderFileEn, compileFileEn, compileChunk, deriveGloss, countBodyStatements, loadIndex, genLabel, spanProse, spanActions, chunkGloss, sanitizeLabel, namedLabel, NAMES, escapeVerbatim, unescapeVerbatim };
