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
const ts = require("typescript");
const cnl = require("./cnl");
const DATA = require("./data-english");
const G = require("./generators");
const EL = require("./enlzw"); // recursive word dictionary (generators referencing generators)
const P = require("./prose"); // reuse deterministic humanisation helpers (words/list/a) for labels

const OPEN = "«", CLOSE = "»";
const DATA_PREFIX = /^(an object with |a list of |an empty object$|an empty list$|text: “)/;
const GEN = "▶", PAY_OPEN = "⟪", PAY_CLOSE = "⟫"; // multi-line generator span: «▶ gloss ⟪lzw1 payload⟫»
const MAXWIN = 8;

/* load the mined multi-line generator catalog (regenerable; absent -> layer disabled) */
/* best-effort coined-word index so cnl can render coined phrases too (empty is fine) */
function loadIndex(corpusRoot) {
  // small load-bearing coined-word catalog; older large snapshots (word-library.json,
  // mined-library.json) yield the SAME index (verified byte-identical .en) and are derived.
  const tryFiles = ["catalog/coined-words.json", "catalog/mined-library.json"].map((f) => path.join(corpusRoot || "", f));
  let idx = null;
  for (const f of tryFiles) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      const words = Array.isArray(j) ? j : (j.words || j.entries || []);
      if (Array.isArray(words) && words.length) { idx = cnl.loadWordsIndex(words); break; }
    } catch (_) { /* fall through */ }
  }
  idx = idx || cnl.loadWordsIndex([]);
  // attach the RECURSIVE word dictionary — the PRIMARY generator layer. It lives in the skills
  // repo catalog (regenerable via build-lzw-generators.js), not the corpus. Absent -> layer
  // disabled -> no generator spans at all; bodies stay verbatim TS, byte-identity holds.
  try { idx._lzw = EL.loadLzw(path.join(__dirname, "..", "catalog", "generators-lzw.json")); }
  catch (_) { idx._lzw = null; }
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

/* a CONDITION stated in English, or null. Null is the honest answer for anything this cannot say
 * truthfully — the caller then emits the vacuous clause and the metric counts it. */
const CMP = { [ts.SyntaxKind.EqualsEqualsEqualsToken]: "is", [ts.SyntaxKind.EqualsEqualsToken]: "is",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "is not", [ts.SyntaxKind.ExclamationEqualsToken]: "is not",
  [ts.SyntaxKind.LessThanToken]: "is under", [ts.SyntaxKind.GreaterThanToken]: "is over",
  [ts.SyntaxKind.LessThanEqualsToken]: "is at most", [ts.SyntaxKind.GreaterThanEqualsToken]: "is at least" };
function condGloss(n, sf) {
  if (!n) return null;
  if (ts.isParenthesizedExpression(n)) return condGloss(n.expression, sf);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    const d = dottedText(n.operand, sf);
    return d ? q(d) + " is missing" : null;
  }
  const d = dottedText(n, sf);
  if (d) return q(d) + " is set";
  if (ts.isBinaryExpression(n)) {
    const op = CMP[n.operatorToken.kind];
    if (!op) {
      if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        const l = condGloss(n.left, sf), r = condGloss(n.right, sf);
        if (l && r) return l + (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? " and " : " or ") + r;
      }
      return null;
    }
    const lhs = dottedText(n.left, sf);
    const rhs = dottedText(n.right, sf) ? q(dottedText(n.right, sf)) : literalGloss(n.right, sf);
    return lhs && rhs ? q(lhs) + " " + op + " " + rhs : null;
  }
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

/* Tier-1 prose: describe a run of statements as English grouped by ROLE — a lead sequence of
 * actions (declarations / calls / returns) plus the guard rules pulled out as "failing when …",
 * surfacing the real throw messages. DISPLAY ONLY; deterministic; zero model. */
function spanProse(win, sf) {
  const actions = [], guards = [];
  const isAwait = (st) => /\bawait\b/.test(st.getText(sf).slice(0, 80));
  for (const st of win) {
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
      const lit = literalGloss(e, sf);
      if (lit) { actions.push("return " + lit); continue; }
      const dotted = dottedText(e, sf);
      if (dotted) { actions.push("return " + q(dotted)); continue; }
      const c = firstCallName(st);
      actions.push(c ? "return " + P.words(c) : "return the result");
      continue;
    }

    if (ts.isThrowStatement(st)) {
      const m = throwMessage(st);
      if (m) { actions.push("throw “" + m + "”"); continue; }
      const d = dottedText(st.expression, sf);
      if (d) { actions.push("re-throw " + q(d)); continue; }
      const arg = ts.isNewExpression(st.expression) && st.expression.arguments && st.expression.arguments[0];
      const ad = arg && dottedText(arg, sf);
      actions.push(ad ? "throw an error built from " + q(ad) : "throw an error");
      continue;
    }

    if (ts.isExpressionStatement(st)) {
      const inner = ts.isAwaitExpression(st.expression) ? st.expression.expression : st.expression;
      /* assignment: `ctx.body = {...}` had no call, so it rendered as "run a step" */
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
      const c = firstCallName(st); actions.push(c ? "loop over " + P.words(c) : "loop"); continue;
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

    if (ts.isTryStatement(st)) { const c = firstCallName(st.tryBlock); actions.push(c ? "try " + P.words(c) : "run a try/catch"); continue; }
    if (ts.isSwitchStatement(st)) {
      const on = dottedText(st.expression, sf);
      actions.push(on ? "choose on " + q(on) : "switch on a value"); continue;
    }
    const c = firstCallName(st); actions.push(c ? "call " + P.words(c) : "run a step");
  }
  let out = P.list(actions, "then");
  /* joined as prose, not with a semicolon: the English-completeness scanner correctly flagged
   * `"A"; "B"` as leftover punctuation, and it was right — a semicolon is not English. */
  if (guards.length) out += (out ? " — " : "") + "failing when " + P.list(guards);
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
 * DISPLAY ONLY. compileChunk finds the payload with lastIndexOf(PAY_OPEN) and decodes only that;
 * it never reads this text. A wrong name is wrong prose, never wrong bytes. */
const WN = require("./word-names");
const NAMES = WN.load(path.join(__dirname, "..", "catalog", "word-names.json"));

function namedLabel(s, source, cat, names) {
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
function renderFileEn(source, index) {
  index = index || cnl.loadWordsIndex([]);
  const sf = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const spans = []; // {start, end, en, kind}

  // Pass 0 — multi-line generator collapse (takes precedence over the single-statement passes).
  //   0a PRIMARY: the RECURSIVE word dictionary — generators referencing generators, so a span
  //      can compose to real depth. Byte-gated inside enlzw.genSpans (fill === source slice).
  //   0b FALLBACK ONLY: the FLAT generators.json, admitted solely for byte ranges the recursive
  //      dictionary did not claim. A flat span is a depth-1 hole in the language; it is measured.
  const recSpans = index._lzw ? EL.genSpans(sf, source, index._lzw) : [];
  const genSpans = recSpans.map((s) => ({
    start: s.start, end: s.end, kind: "gen", tier: "recursive", stmts: s.stmts, depth: s.depth,
    en: GEN + " " + (namedLabel(s, source, index._lzw, NAMES.names) || genLabel(s.start, s.end, source, s.stmts))
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
    out += source.slice(pos, sp.start) + OPEN + sp.en + CLOSE;
    pos = sp.end; englishBytes += sp.end - sp.start;
    if (sp.kind === "stmt") { stmtN++; continue; }
    if (sp.kind !== "gen") { dataN++; continue; }
    genN++; genStmts += sp.stmts || 0;
    if (sp.tier === "flat") flatN++; else recN++;
    const d = sp.depth || 0; depthHist[d] = (depthHist[d] || 0) + 1; if (d > maxDepth) maxDepth = d;
  }
  out += source.slice(pos);
  return { en: out, stats: {
    totalBytes: source.length, englishBytes,
    englishPct: source.length ? +(100 * englishBytes / source.length).toFixed(1) : 0,
    stmtSpans: stmtN, dataSpans: dataN,
    genSpans: genN, genStmtsCollapsed: genStmts,
    genRecursive: recN, genFlatFallback: flatN, maxDepth, depthHist,
  } };
}

/* ------------------------------ COMPILE (.en -> .ts) ------------------------------ */
function compileChunk(chunk, index) {
  if (chunk[0] === GEN) { // multi-line generator: refill catalog template with per-site holes
    const a = chunk.lastIndexOf(PAY_OPEN), b = chunk.lastIndexOf(PAY_CLOSE);
    if (a < 0 || b < 0 || b < a) throw new Error("enfile: malformed generator payload");
    // ONE DIALECT, ONE ENCODING. The flat anti-unification path is deleted (PRD §4A defect) and
    // base64(JSON) is retired, so a payload is either `lzw1` text or it is not ours. decode()
    // is fail-closed: it throws on anything it does not fully understand rather than guessing,
    // and it names a stale base64 payload specifically so the fix is obvious.
    const obj = PAY.decode(chunk.slice(a + 1, b));
    if (!index || !index._lzw) throw new Error("enfile: recursive generator span but no lzw catalog loaded");
    return EL.compileSpan(obj, index._lzw);
  }
  if (DATA_PREFIX.test(chunk)) return DATA.compileData(chunk);
  return cnl.compileStatement(chunk, index);
}
function compileFileEn(en, index) {
  index = index || cnl.loadWordsIndex([]);
  let out = "", i = 0;
  while (i < en.length) {
    const open = en.indexOf(OPEN, i);
    if (open < 0) { out += en.slice(i); break; }
    out += en.slice(i, open);
    const close = en.indexOf(CLOSE, open + 1);
    if (close < 0) throw new Error("enfile: unbalanced « (no matching »)");
    out += compileChunk(en.slice(open + 1, close), index);
    i = close + 1;
  }
  return out;
}

module.exports = { renderFileEn, compileFileEn, loadIndex, genLabel, spanProse, sanitizeLabel, namedLabel, NAMES };
