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
const CANON = require("./canon-fingerprint");
const ts = require("typescript");
const cnl = require("./cnl");
const DATA = require("./data-english");
const G = require("./generators");
const EL = require("./enlzw"); // recursive word dictionary (generators referencing generators)
const REF = require("./refusals");
const P = require("./prose"); // reuse deterministic humanisation helpers (words/list/a) for labels

const OPEN = "«", CLOSE = "»";
const DATA_PREFIX = /^(an object with |a list of |an empty object$|an empty list$|text: “)/;
const GEN = "▶", PAY_OPEN = "⟪", PAY_CLOSE = "⟫"; // multi-line generator span: «▶ gloss ⟪lzw1 payload⟫»
/* NESTED RENDERING (PRD §5D.4E, R-ARCH-19). A generator chunk comes in two shapes now:
 *   ATOMIC      «▶ gloss ⟪payload⟫»        — a word whose statements have no inner blocks to
 *                                            drill into. Compiles by refilling the catalog
 *                                            skeleton. This is the byte-eliminating form, and it
 *                                            is exactly what every chunk was before.
 *   STRUCTURAL  «▶ gloss ⟨ …children… ⟩»   — a word whose statements DO contain inner runs. It
 *                                            carries no payload: it is a NAME over children, and
 *                                            it compiles by concatenating them. Its children are
 *                                            chunks in their own right, recursively, to leaves.
 * A structural chunk is what makes R-ARCH-15's "editable at every level" true: the reader can
 * open a file's word, see the word for each definition inside it, open that, and reach the run of
 * statements at the bottom — every level a sentence with a payload or children under it. */
/* A structural chunk is marked ▷ rather than ▶ so the two shapes are told apart by ONE character at
 * a fixed position, never by scanning for a delimiter. That matters here: `payload.js:34` emits ⟨
 * RAW as its hole marker, so "does this chunk contain ⟨" would call every atomic chunk structural.
 * ⟩, by contrast, is escaped in hole text and emitted nowhere raw, so the body's close is
 * unambiguously the chunk's last character. */
const GEN_NEST = "▷", BODY_OPEN = "⟨", BODY_CLOSE = "⟩";
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
/* ⟨ ⟩ JOINED THE ESCAPE SET 2026-09-01, with nested rendering. Before it, verbatim text lay only
 * OUTSIDE every chunk, where the body sentinels mean nothing — the reasoning in the note above.
 * A structural chunk puts verbatim text INSIDE a chunk body, where a stray ⟨ or ⟩ would end the
 * body early, so the same by-construction argument now reaches them. Cost on the corpus is still
 * zero: the 1037 source files contain none of these characters. */
const V_ENC = new Map([[V_ESC, V_ESC + "0"], [OPEN, V_ESC + "5"], [CLOSE, V_ESC + "6"],
                       [BODY_OPEN, V_ESC + "7"], [BODY_CLOSE, V_ESC + "8"]]);
const V_DEC = new Map([["0", V_ESC], ["5", OPEN], ["6", CLOSE], ["7", BODY_OPEN], ["8", BODY_CLOSE]]);
const V_NEEDS = /[⟡«»⟨⟩]/g;

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
    checkCanon(idx._lzw, lzwPath);
  }
  return idx;
}

/* THE CANON GATE (§8B). A dictionary keyed by skeletons is only usable by a canon that produces the
 * same skeletons. Nothing checked this until 2026-09-03, and the gap is not theoretical: SDD_BODY_SLOT
 * shipped default-on in 2d83452 over a catalog mined before it, and the corpus rendered at 3,527
 * top / 23,935 tree against a 1,582 / 20,999 baseline for a day with every check green — because a
 * missed lookup falls through to the verbatim path, so BYTE-IDENTITY, the floor we assert first,
 * cannot see it. Neither can an mtime staleness edge: no artifact moved, the CODE moved underneath
 * one whose mtime is honestly unchanged.
 *
 * ABSENT IS A STATE, NOT A BUG (§8B, no silent fallback in either direction). Every catalog mined
 * before this field existed lacks it, and refusing those would brick the corpus to install a guard.
 * Absent warns, loudly, once per path, and names the fix. PRESENT-AND-DIFFERENT is a bug and throws:
 * at that point we KNOW the skeletons disagree, and rendering on would silently produce a degraded
 * corpus rather than a broken one — which is the harder failure to notice and the one that already
 * happened. SDD_CANON_CHECK=0 escapes it for a deliberate side-by-side measurement.
 *
 * MINING PARAMETERS ARE NOT CANON and must not trip this. §10 (10-language-and-grammar.md:42): names
 * key on the canonical skeleton and never on the word id, so "retuning MAXWIN, MIN_COUNT or MIN_SKEL
 * cannot orphan a name". The fingerprint is behavioural — it hashes what the canon PRODUCES for a
 * frozen probe set — so those dials leave it unchanged, verified in engine/canon-fingerprint.test.js. */
const canonWarned = new Set();
function checkCanon(lzw, lzwPath) {
  if (process.env.SDD_CANON_CHECK === "0" || !lzw) return;
  const stored = lzw.canonFingerprint;
  if (!stored) {
    if (!canonWarned.has(lzwPath)) {
      canonWarned.add(lzwPath);
      console.error("[enfile] catalog records NO canonFingerprint: " + lzwPath
        + "\n  It was mined before the canon gate existed, so whether its skeletons match this code is UNKNOWN."
        + "\n  Re-mine (node build-lzw-generators.js) to record one. Rendering continues.");
    }
    return;
  }
  const live = CANON.fingerprint();
  if (stored === live) return;
  throw new Error("CANON MISMATCH — refusing to render against a dictionary keyed by a different canon."
    + "\n  catalog " + lzwPath
    + "\n  mined under canon " + stored
    + "\n  this process is canon " + live
    + "\n  Every skeleton lookup would silently miss and fall through to verbatim. Byte-identity would"
    + "\n  still read 1037/1037 while review surface degraded, which is why this is an error and not a"
    + "\n  warning. Re-mine the corpus, or set SDD_CANON_CHECK=0 for a deliberate side-by-side."
    + "\n  Diff the canons with: node -e \"console.log(require('./engine/canon-fingerprint').describe())\"");
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
const LABEL_SENTINELS = /[«»⟪⟫▶▷⟨⟩]/g;
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

/* ---- PRODUCTIONS FOR THE SPEC DIALECT (§5C) ---------------------------------------------------
 * Measured 2026-09-03: 2,036 of the 7,329 ExpressionStatement sites in the corpus produced a clause
 * with nothing from the site in it, and ~1,960 of those are two shapes from the test dialect.
 * `expect(result.success).toBe(true)` rendered as "call to be" -- which is not only contentless, it
 * is not English, because it was assembled from the METHOD NAME of a fluent matcher. And
 * `it('should generate SUIP records ...')` rendered as "call `it`", discarding a sentence the author
 * had already written in plain English three characters away.
 *
 * These are the highest-yield productions in the corpus and among the safest, because the assertion
 * dialect is closed: a fixed matcher vocabulary, a fixed argument shape.
 *
 * THE HONESTY RULE (§5C) IS LOAD-BEARING HERE, and both productions decline rather than waffle. If
 * the thing under assertion cannot be named truthfully, the production returns null and the site
 * falls through to the vacuous clause AND STAYS COUNTED. A matcher outside the table is not guessed
 * at by de-camel-casing its name -- that is exactly the move that produced "call to be". */

/* the fluent matcher vocabulary. Keys are matcher identifiers, values read after "to". Frozen in the
 * sense that it MAY be added to, never loosened into a fallback: an unknown matcher declines. */
const MATCHERS = {
  toBe: "be", toEqual: "equal", toStrictEqual: "equal", toMatchObject: "match",
  toHaveLength: "have length", toContain: "contain", toContainEqual: "contain",
  toMatch: "match", toThrow: "throw", toThrowError: "throw",
  toBeTruthy: "be truthy", toBeFalsy: "be falsy", toBeNull: "be null",
  toBeUndefined: "be undefined", toBeDefined: "be defined", toBeNaN: "be NaN",
  toBeGreaterThan: "be greater than", toBeGreaterThanOrEqual: "be at least",
  toBeLessThan: "be less than", toBeLessThanOrEqual: "be at most",
  toBeCloseTo: "be close to", toBeInstanceOf: "be an instance of",
  toHaveProperty: "have property", toHaveBeenCalled: "have been called",
  toBeCalled: "have been called", toHaveBeenCalledWith: "have been called with",
  toBeCalledWith: "have been called with", toHaveBeenCalledTimes: "have been called",
  toHaveBeenLastCalledWith: "have been last called with",
};

/* Name the thing under assertion. Order matters: a dotted path is the most informative, a call is
 * named by its callee, and a thunk is named by what it calls -- which is the whole point of
 * `expect(() => f()).toThrow(...)`, where the interesting name is INSIDE the arrow. */
function assertSubject(n, sf) {
  if (!n) return null;
  const dotted = dottedText(n, sf);
  if (dotted) return q(dotted);
  if (ts.isCallExpression(n)) {
    const c = dottedText(n.expression, sf) || (ts.isIdentifier(n.expression) ? n.expression.text : null);
    return c ? "the result of " + q(c) : null;
  }
  if (ts.isAwaitExpression(n)) { const inner = assertSubject(n.expression, sf); return inner || null; }
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
    const c = firstCallName(n.body);
    return c ? "calling " + q(c) : null;
  }
  if (ts.isElementAccessExpression(n)) { const b = dottedText(n.expression, sf); return b ? q(b) + "'s entry" : null; }
  const lit = literalGloss(n, sf);
  return lit && lit !== "some text" ? lit : null;
}

/** `expect(<actual>)[.not].<matcher>(<expected>)` -> a sentence, or null to decline (§5C). */
function matchAssertion(st, sf) {
  if (!ts.isExpressionStatement(st)) return null;
  let e = st.expression;
  if (ts.isAwaitExpression(e)) e = e.expression;
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression)) return null;
  const matcherName = e.expression.name.text;
  const phrase = MATCHERS[matcherName];
  if (!phrase) return null;                       // unknown matcher: decline, do not de-camel-case it
  /* walk back through `.not` / `.resolves` / `.rejects` to the expect(...) call itself */
  let recv = e.expression.expression, negated = false, mood = null;
  while (ts.isPropertyAccessExpression(recv)) {
    const w = recv.name.text;
    if (w === "not") negated = true;
    else if (w === "resolves" || w === "rejects") mood = w;
    else return null;
    recv = recv.expression;
  }
  if (!ts.isCallExpression(recv)) return null;
  const head = ts.isIdentifier(recv.expression) ? recv.expression.text : null;
  if (head !== "expect" || recv.arguments.length !== 1) return null;
  const subject = assertSubject(recv.arguments[0], sf);
  if (!subject) return null;                      // cannot name it truthfully -> vacuous, and counted
  let out = "expect " + subject + (mood === "rejects" ? " to reject" : "") + (negated ? " not" : "") + " to " + phrase;
  const arg = e.arguments[0];
  if (arg) {
    const v = literalGloss(arg, sf) || assertSubject(arg, sf);
    if (v) out += " " + v;
  }
  return out;
}

/* Collection verbs whose result is worth naming in the reader's terms rather than the callee's.
 * Closed table, same discipline as MATCHERS: an entry may be added, but an unknown method is NEVER
 * de-camel-cased into a phrase -- it falls to "the result of `<dotted callee>`", which is still
 * true and still site-specific, or declines entirely. */
const RETURN_VERBS = {
  map: "mapped", filter: "filtered", reduce: "reduced", sort: "sorted",
  slice: "sliced", flat: "flattened", flatMap: "mapped and flattened",
  reverse: "reversed", join: "joined", concat: "with more appended",
};

/** `return <call>` -> a clause naming the RECEIVER, not just the method. Null to decline (§5C). */
function returnCallGloss(e, sf) {
  if (!e) return null;
  let inner = e, awaited = false;
  while (ts.isAwaitExpression(inner) || ts.isParenthesizedExpression(inner)) {
    if (ts.isAwaitExpression(inner)) awaited = true;
    inner = inner.expression;
  }
  if (!ts.isCallExpression(inner)) return null;
  const lead = awaited ? "return what " : "return ";
  if (ts.isPropertyAccessExpression(inner.expression)) {
    const method = inner.expression.name.text;
    const recv = dottedText(inner.expression.expression, sf);
    /* `rounded.map(...)` -> "return `rounded` mapped". The receiver is the thing the reader is
     * tracking; the method is how it was transformed. Naming only the method -- "return map" --
     * is the same defect as "call to be", one statement kind over. */
    if (recv && RETURN_VERBS[method]) return "return " + q(recv) + " " + RETURN_VERBS[method];
    const dotted = dottedText(inner.expression, sf);
    if (dotted) return (awaited ? "return what " + q(dotted) + " gives" : "return the result of " + q(dotted));
    return null;                                  // receiver is itself a call -> cannot name it truthfully
  }
  if (ts.isIdentifier(inner.expression)) {
    const n = inner.expression.text;
    return awaited ? "return what " + q(n) + " gives" : "return the result of " + q(n);
  }
  return null;
}

/** `describe|it|test('<sentence>', ...)` -> the author's own sentence, which beats anything we build. */
function matchSpecBlock(st, sf) {
  if (!ts.isExpressionStatement(st)) return null;
  let e = st.expression;
  if (ts.isAwaitExpression(e)) e = e.expression;
  if (!ts.isCallExpression(e)) return null;
  let head = e.expression;
  /* it.each(...)`...`, it.skip(...), describe.only(...) — take the base identifier */
  while (ts.isPropertyAccessExpression(head) || ts.isCallExpression(head) || ts.isTaggedTemplateExpression(head)) {
    head = ts.isPropertyAccessExpression(head) ? head.expression : (head.expression || head.tag);
  }
  if (!ts.isIdentifier(head)) return null;
  const kind = head.text;
  if (kind !== "describe" && kind !== "it" && kind !== "test") return null;
  const first = e.arguments[0];
  if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) return null;
  const text = String(first.text).trim().replace(/\s+/g, " ");
  if (!text) return null;
  const label = text.length <= 90 ? text : text.slice(0, 87).trimEnd() + "…";
  return (kind === "describe" ? "describe " : "specify ") + "“" + label + "”";
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
/* ExportDeclaration — the sibling of importPhrase, and it exists because the rule-coverage
 * measurement (§5D.3G) found the asymmetry: the import rule QUOTES the symbol and the module, while
 * exports fell through to `exportGloss`, which only COUNTS them ("re-export 1 name from another
 * module") — 9 leaf skeletons over 113 sites where the reader was told how many names moved but
 * never which. Naming those skeletons would have served this corpus; writing this rule serves every
 * codebase in the language (§5D.2, R-LANG-16). Cardinality stays a parameter, exactly as it is for
 * imports: one export or twelve, one clause. */
function exportPhrase(st, sf) {
  const spec = st.moduleSpecifier && ts.isStringLiteralLike(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
  const from = spec ? " from " + q(spec) : "";
  const cl = st.exportClause;
  if (!cl) return spec ? "everything" + from : null;          // export * from './m'
  if (ts.isNamespaceExport && ts.isNamespaceExport(cl)) return "all of " + q(cl.name.text) + from; // export * as ns from './m'
  if (ts.isNamedExports(cl)) {
    /* `export { internalName as publicName }` — the rename is the interesting half and the reader
     * cannot recover it from the module path, so both sides are quoted. */
    const parts = cl.elements.map((e) => (e.propertyName ? q(e.propertyName.text) + " as " + q(e.name.text) : q(e.name.text)));
    if (!parts.length) return null;
    return P.list(parts) + from;
  }
  return null;
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
  /* ExportDeclaration. A run that MIXES re-exports (`export { X } from './m'`) with local exports
   * (`export { X }`) is declined rather than fudged into one verb — declining falls through to the
   * per-statement path (R-LANG-17), which is correct, just less compact. */
  { kind: "ExportDeclaration",
    match: (st) => ts.isExportDeclaration(st),
    render: (run, sf) => {
      const reexport = run.every((st) => !!st.moduleSpecifier);
      const local = run.every((st) => !st.moduleSpecifier);
      if (!reexport && !local) return null;
      const phrases = run.map((st) => exportPhrase(st, sf));
      if (phrases.some((x) => !x)) return null;
      return (reexport ? "re-export " : "export ") + P.list(phrases) + (local ? " from this module" : "");
    } },
];
const chunkRuleFor = (st) => CHUNK_RULES.find((r) => r.match(st)) || null;

/* Tier-1 prose: describe a run of statements as English grouped by ROLE — a lead sequence of
 * actions (declarations / calls / returns) plus the guard rules pulled out as "failing when …",
 * surfacing the real throw messages. DISPLAY ONLY; deterministic; zero model. */
function spanActions(win, sf) {
  const actions = [], guards = [];
  /* WHICH STATEMENTS EACH CLAUSE COVERS (R-LANG-23). `covers[i]` is the [from, to) range of `win`
   * that produced `raw[i]`. It exists so namedLabel can substitute a NAME INTO this structure
   * instead of recomputing a structure of its own: a chunk rule that folds three imports into one
   * clause covers [0,3), and a name — which is one statement's spelling — may not replace it.
   * Recorded by wrapping push rather than by editing ~40 call sites, so a production added later
   * is covered automatically and cannot silently forget to report its range. */
  const covers = [];
  let cover = [0, 0];
  actions.push = function (a) { covers.push([cover[0], cover[1]]); return Array.prototype.push.call(this, a); };
  const isAwait = (st) => /\bawait\b/.test(st.getText(sf).slice(0, 80));
  let wi = 0;
  while (wi < win.length) {
    /* CHUNK-RULE PRE-PASS: a maximal run of one node kind gets ONE clause from its rule. Placed
     * before the per-statement productions so a rule always wins over N repetitions; a rule that
     * declines (null) leaves wi untouched and the statement falls through unchanged. */
    const rule = chunkRuleFor(win[wi]);
    if (rule) {
      let wj = wi; while (wj < win.length && rule.match(win[wj])) wj++;
      const sub = win.slice(wi, wj);
      const one = rule.render(sub, sf);
      cover = [wi, wj];
      if (one) { actions.push(one); wi = wj; continue; }
      /* The rule matched the KIND and then refused the run — the one refusal in this engine that
       * names a hand-written rule rather than a mined word. Recorded so an unwritten case (a mixed
       * export run, an import shape importPhrase cannot say) is a counted, named backlog item. */
      if (REF.active()) {
        REF.record({ reason: "rule-declined", rule: "chunkRule:" + rule.kind, stmts: sub.length,
                     start: sub[0].getStart(sf), end: sub[sub.length - 1].getEnd(),
                     detail: "run of " + sub.length + " " + rule.kind });
      }
    }
    const st = win[wi++];
    cover = [wi - 1, wi];
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
        const brc = returnCallGloss(bare, sf);
        if (brc) { actions.push(brc); continue; }
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
      /* NAME THE RECEIVER, NOT JUST THE METHOD. `firstCallName` below yields the callee's last
       * segment, so `return rounded.map(...)` became "return map" and `return
       * subscriptionsBuiltQuery.getMany()` became "return get many" -- the same defect as "call to
       * be", one statement kind over: a clause assembled from a method name, with the thing the
       * reader is actually tracking discarded. Measured 2026-09-03: 61 + 35 + 31 + 29 + 22 sites in
       * the top five clusters alone. Declines (receiver is itself a call) fall through unchanged. */
      const rcg = returnCallGloss(e, sf);
      if (rcg) { actions.push(rcg); continue; }
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
      /* THE SPEC DIALECT FIRST (§5C productions). It must precede the general call handling below,
       * not follow it: that handler quotes a plain dotted receiver and otherwise de-camel-cases the
       * CALLEE, which is what turned `expect(result.success).toBe(true)` into "call to be" -- a
       * clause assembled from the method name of a fluent matcher, contentless and not English.
       *
       * Placing it first is safe precisely because both productions DECLINE rather than guess: an
       * unknown matcher, or a subject that cannot be named truthfully, returns null and falls
       * straight through to the handling below exactly as before. (First attempt put these at the
       * generic fall-through at the bottom of the loop, where this branch had already claimed every
       * site and the measured numbers did not move at all. The clause table said so immediately --
       * 2,161 generic before, 2,161 after.) */
      const spec = matchSpecBlock(st, sf);
      if (spec) { actions.push(spec); continue; }
      const assertion = matchAssertion(st, sf);
      if (assertion) { actions.push(assertion); continue; }

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
      /* NAME THE RECEIVER (R-LANG-24). `firstCallName` returns only the METHOD, so
       * `cacheProxy.set(argStr, returnValue)` and `Decimal.set({...})` both rendered "call set" —
       * the same six characters for two unrelated operations, and the one thing a reader needs to
       * tell them apart was in the source and thrown away. Measured: 3,595 statements in the
       * foldable scope call a method on a receiver.
       *
       * Quoted verbatim rather than de-camelCased, on the precedent this file already sets for
       * declarations: "the names are already the clearest available words (PRD §3), so they are
       * quoted verbatim, not translated — `IPartnerCutAmountSource` is what the reader will grep
       * for". The same argument applies to `clearPartnerActivePropertiesCache`, and it applies
       * harder to a receiver, which is usually a variable the reader can look up.
       *
       * WHY THIS IS A RULE AND NOT A NAME. Both defects the naming pilots surfaced were this one:
       * a model was asked to name `‹id›.set(‹args›)` and answered "set a configuration value",
       * which is right for `Decimal.set` and wrong for `cacheProxy.set`. No single hole-free name
       * can be correct for a skeleton whose receiver varies — only a hole can (§5D.2: a rule
       * serves every codebase, a name serves this corpus). The receiver is that hole. */
      const verb = isAwait(st) ? "await " : "call ";
      {
        let e = st.expression;
        while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
        if (ts.isCallExpression(e)) {
          if (ts.isPropertyAccessExpression(e.expression)) {
            /* dottedText returns null for anything that is not a plain dotted name, which is what
             * keeps `expect(usageItems).toHaveLength(3)` out — quoting a call expression as if it
             * were a variable would be worse than saying nothing about it. */
            const recv = dottedText(e.expression.expression, sf);
            if (recv) { actions.push(verb + q(e.expression.name.text) + " on " + q(recv)); continue; }
          } else if (ts.isIdentifier(e.expression)) {
            actions.push(verb + q(e.expression.text)); continue;
          }
        }
      }
      const name = firstCallName(st);
      actions.push(verb + (name ? P.words(name) : "a step"));
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
  return { actions: merged.map((m) => (m.n === 1 ? m.a : m.a + (m.n === 2 ? " twice" : " " + m.n + " times"))), guards, raw: actions, covers };
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
  /* Each `return null` below is a refusal worth NAMING (refusals.js): this gate is what stands
   * between a mined word and a chunk the reader ever sees, so a rule that quietly stops passing it
   * shows up as lost collapse and nothing else. `no` records why and declines unchanged. */
  const no = (detail) => {
    if (REF.active() && win.length) {
      REF.record({ reason: "gloss-refused", rule: "chunkGloss:" + detail, detail,
                   start: win[0].getStart(sf), end: win[win.length - 1].getEnd(), stmts: win.length });
    }
    return null;
  };
  let r; try { r = spanActions(win, sf); } catch (_) { return no("threw"); }
  if (!r.actions.length) return no("no-clauses");
  if (r.raw.some((x) => !x || SAYS_NOTHING.test(x))) return no("says-nothing"); // pre-collapse: see spanActions
  if (r.actions.some((x) => !x)) return no("empty-clause");
  if (new Set(r.actions).size !== r.actions.length) return no("repetition"); // mechanical repetition — rule missing
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
  /* R-LANG-19 AS AMENDED 2026-09-01: a whole-chunk name is a HEADING OVER the content, never a
   * REPLACEMENT FOR it. The original rule ("a whole-chunk name outranks member composition") was
   * implemented as `if (whole) return whole` — one hole-free string standing in for every clause
   * the rules had filled with the code's own identifiers. That is the leaf-tier pilot's defect one
   * level up, and s11 measured the blast radius: 63% of the corpus's concrete identifiers live in
   * d>=1 chunk labels, so an 80-name composite pilot would have deleted ~23,000 of them.
   *
   * A chunk name still does the job Amir asked it to do in §5D.3D — a recurring run reads as ONE
   * recognised pattern rather than N clauses joined by "then" — because it is what the reader sees
   * FIRST. What it no longer does is take the identifiers away with it:
   *
   *     charge the partner's commission: get `rate` from `getRate`, then call `chargeAccount`
   *     ^ the name (recognition)          ^ the holes, still filled by the mine (the specifics)
   *
   * The content is composed exactly as it would be with no chunk name at all, so R-LANG-23's fold
   * invariance holds through this path unchanged and the gate's detail check has something to
   * count. A chunk name is now purely ADDITIVE — it can only ever make a label say more. */
  const whole = WN.chunkNameFor(cat, s.payload, chunks);
  const clauses = WN.clausesFor(cat, s.payload, names);
  if (!clauses && !whole) return null;
  let frag;
  try { frag = ts.createSourceFile("s.ts", source.slice(s.start, s.end), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
  catch (_) { return null; }
  const stmts = [...frag.statements];
  // leaf/statement alignment broken — do not guess. A chunk name alone needs no alignment: it is a
  // heading over whatever the rules say, so it survives a mismatch that would void a leaf name.
  if (clauses && stmts.length !== clauses.length) { if (!whole) return null; }
  const leafClauses = (clauses && stmts.length === clauses.length) ? clauses : null;

  /* A NAME IS A LABEL, NOT A STRUCTURE (§5D.3A as amended 2026-09-01, R-LANG-23). Amir's ruling:
   * structure is computed from the UNNAMED dictionary first and names are applied afterwards,
   * purely as labels. This function used to compose ONE CLAUSE PER STATEMENT — `clauses.map((c, i)
   * => c || spanProse([stmts[i]], frag))` — which asked the renderer for each statement in
   * isolation and so DISSOLVED every rule that folds a run. Measured: naming one leaf in a run
   * (`dotenv.config()`) unfolded the IMPORT run beside it, taking import repeats inside a single
   * clause from 1 to 284 corpus-wide. Three statements that were one clause became three. The
   * bytes still round-tripped and every identifier was still quoted, so nothing in the gate saw it.
   *
   * So the clause STRUCTURE now comes from spanActions over the whole run — the same call
   * spanProse/genLabel make, so the unnamed shape is identical by construction — and a name is
   * substituted only where a clause covers EXACTLY ONE statement. A clause covering two or more is
   * a chunk rule speaking about a pattern (R-LANG-16/17), and a leaf name, which is one statement's
   * spelling, has no standing to replace it. Guard-consumed statements produce no clause and so
   * take no name; they keep the "failing when" suffix spanProse gives them. */
  let r;
  try { r = spanActions(stmts, frag); } catch (_) { return null; }
  if (!r.raw.length) return null;
  let reached = !!whole;
  const pieces = r.raw.map((a, i) => {
    const [from, to] = r.covers[i] || [0, 0];
    if (to - from === 1 && leafClauses && leafClauses[from]) { reached = true; return leafClauses[from]; }
    return a;
  }).filter(Boolean);
  if (!pieces.length) return null;
  if (!reached) return null; // no name reached this span — let genLabel own it, one path not two

  /* the same adjacent-identical collapse spanActions applies, for the same reason (cardinality is
   * a parameter): substituting a name can create the repetition, so it is re-run after. */
  const runs = [];
  for (const c of pieces) {
    const last = runs[runs.length - 1];
    if (last && last.a === c) last.n++; else runs.push({ a: c, n: 1 });
  }
  let out = P.list(runs.map((x) => (x.n === 1 ? x.a : x.a + (x.n === 2 ? " twice" : " " + x.n + " times"))), "then");
  if (r.guards.length) out += (out ? " — " : "") + "failing when " + P.list(r.guards);
  /* HOW MANY CLAUSES THIS LABEL EMITTED, published so the renderer can check it against how many
   * the RULES said there were (see `label`). Reported on the function rather than in the return
   * value because every existing caller consumes a bare string, and a gate that requires its
   * subject to be rewritten to accommodate it tends not to get adopted. */
  namedLabel.lastClauses = runs.length;
  /* the heading, then the content it is a heading FOR. Never one or the other. */
  return sanitizeLabel(whole ? whole + ": " + out : out);
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

/* ============================ NESTED RENDERING (PRD §5D.4E) ============================
 *
 * WHY THIS EXISTS. R-ARCH-22 made the renderer prefer one whole-file word over the nested words
 * inside it, taking one-word-per-file from 30.6% to 93.1%. It also took review surface from 13,873
 * to 23,784, and the reason was structural rather than a bad choice: under a FLAT span model a
 * whole-file word and the words inside its statements' bodies cover overlapping bytes, so the
 * scheduler can only ever have one of them. `src/xero-api/invoice.ts` became a single chunk — a
 * 4,911-character sentence over a 48,953-character payload, which is the "one opaque reference"
 * R-ARCH-15 forbids in as many words.
 *
 * THE FIX IS NOT A BETTER OBJECTIVE, IT IS A TREE. A word for a run becomes a chunk; each statement
 * of that run becomes a chunk inside it; each inner block's runs become chunks inside those, to
 * leaves. Parent and child stop competing because they are at different depths. Every level carries
 * a sentence, so the reader opens the file's word, sees a word per definition, opens one, and
 * reaches straight-line statements at the bottom.
 *
 * WHERE THE BYTES GO. A chunk with no inner blocks is ATOMIC: its word's skeleton stays in the
 * catalog and only holes are emitted, exactly as before — this is still where compression happens,
 * and it is now the frontier of the recursion rather than the whole of it. A chunk with inner
 * blocks is STRUCTURAL: it emits the bytes it owns and nothing more, which for a function is its
 * signature and braces. Those bytes were previously inside a catalog skeleton; they are now in the
 * .en, verbatim. That is a real cost in size and a real gain in legibility, and it is measured
 * rather than assumed (§5D.4E §4).
 *
 * BYTE-IDENTITY. Every atomic chunk passes the same `wp.fill === source.slice(...)` gate as before.
 * A structural chunk compiles by concatenating its children with the exact inter-child bytes, so
 * it reconstructs its range if and only if its children do. The induction bottoms out at atomic
 * chunks and verbatim text, both byte-exact, so the tree is byte-exact. */

/* the maximal runs of foldable statements in a statement list: [[st,...], ...]
 *
 * A STRAY `;` DOES NOT BREAK A RUN (R-ARCH-15, 2026-09-01). An EmptyStatement is not foldable —
 * there is nothing to say about it — and treating it as a wall split 29 files' top-level run in
 * two, which is 29 files that could not collapse to one word. Measured: across the 34 files that
 * fail R-ARCH-15, `EmptyStatement` is the ONLY non-foldable top-level kind, 30 occurrences.
 *
 * It is absorbed rather than folded. An interior `;` is dropped from the run, so the word is keyed
 * on the real statements either side, and its bytes survive as part of the GAP hole between them —
 * `windowParts` builds each gap from `sf.text.slice(stmts[j].getEnd(), stmts[j+1].getStart(sf))`,
 * which spans the semicolon and its whitespace verbatim. Gap text is a hole, so it does not enter
 * `keyOf`: the key is the same one a file WITHOUT the stray `;` produces, which is why the word
 * already exists in the dictionary and why the refill is byte-exact.
 *
 * A run may not START or END on one — `lastFoldable` — since a trailing `;` outside the last real
 * statement is not inside any gap, and would be lost from the span rather than carried by it. Those
 * fall to renderVerbatim, where they were already. */
function foldableRuns(stmts) {
  const runs = [];
  let i = 0;
  while (i < stmts.length) {
    if (!G.isFoldable(stmts[i])) { i++; continue; }
    let j = i, lastFoldable = i;
    while (j < stmts.length && (G.isFoldable(stmts[j]) || ts.isEmptyStatement(stmts[j]))) {
      if (G.isFoldable(stmts[j])) lastFoldable = j;
      j++;
    }
    runs.push(stmts.slice(i, lastFoldable + 1).filter((st) => !ts.isEmptyStatement(st)));
    i = j;
  }
  return runs;
}

/* the OUTERMOST blocks strictly inside `node` — the recursion's next level down. Deeper blocks are
 * reached by recursing into these, not by collecting them here, or a nested block would be emitted
 * twice (once by its own chunk and once inside its parent's). */
function outerBlocks(node, sf) {
  const out = [];
  const visit = (n) => {
    if (n !== node && ts.isBlock(n)) { out.push(n); return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/* every inner run of `st`, as byte ranges, in source order */
function innerRunRanges(st, sf) {
  const out = [];
  for (const b of outerBlocks(st, sf))
    for (const run of foldableRuns([...b.statements]))
      out.push({ start: run[0].getStart(sf), end: run[run.length - 1].getEnd(), run });
  out.sort((a, b) => a.start - b.start);
  return out;
}

function NestRenderer(sf, source, index) {
  const cat = index && index._lzw;
  const stats = { atomic: 0, structural: 0, atomicStmts: 0, structuralStmts: 0, maxDepth: 0, verbatimStmts: 0, depthHist: {}, stmtSpans: 0, dataSpans: 0, labelClauses: 0 };

  /* THE LEAF LAYERS STILL APPLY (passes 1 and 2 of the flat renderer). A structural chunk emits the
   * bytes it owns — a function's signature, a class's members, an `if`'s condition — and those
   * bytes are exactly where the cnl statement grammar and the data layer do their work. Dropping
   * them was the first thing nesting broke: `@Column({...})` stopped rendering as "an object with
   * …" because the region was no longer reached by any pass. So every verbatim region goes through
   * `renderVerbatim` instead of straight to `escapeVerbatim`.
   *
   * COMPUTED ONCE FOR THE FILE, not per region. The obvious implementation re-walks the AST for
   * each verbatim range, which is O(nodes x ranges) — thousands of ranges in a deeply nested file.
   * The candidates do not depend on the range, so they are gathered once and sliced. */
  const leafSpans = (() => {
    const out = [], seen = [];
    const visitStmt = (node) => {
      if (isSimpleStmt(node) && !hasRenderableData(node, sf)) {
        const text = node.getText(sf);
        if (!/[«»]/.test(text)) {
          let en = null;
          try { en = cnl.renderStatement(text, index); } catch (_) { en = null; }
          const isPureEscape = en != null && /^`[\s\S]*`\.?$/.test(en);
          if (en != null && !en.includes("\n") && !isPureEscape) {
            let back = null; try { back = cnl.compileStatement(en, index); } catch (_) { back = null; }
            if (back === text) { const s = node.getStart(sf), e = node.getEnd(); out.push({ start: s, end: e, en, kind: "stmt" }); seen.push([s, e]); }
          }
        }
      }
      ts.forEachChild(node, visitStmt);
    };
    visitStmt(sf);
    const inStmt = (s, e) => seen.some(([a, b]) => s >= a && e <= b);
    const visitData = (node, insideData) => {
      if (isDataLeaf(node) && DATA.dataByteExact(node, sf)) {
        const s = node.getStart(sf), e = node.getEnd();
        if (!insideData && !inStmt(s, e)) { out.push({ start: s, end: e, en: DATA.renderData(node, sf), kind: "data" }); ts.forEachChild(node, (c) => visitData(c, true)); return; }
      }
      ts.forEachChild(node, (c) => visitData(c, insideData));
    };
    visitData(sf, false);
    return out.sort((a, b) => a.start - b.start || b.end - a.end);
  })();

  /* a verbatim byte range, with any leaf span that falls WHOLLY inside it rendered as English */
  function renderVerbatim(start, end) {
    if (end <= start) return "";
    let out = "", pos = start;
    for (const sp of leafSpans) {
      if (sp.start < pos || sp.end > end) continue;
      out += escapeVerbatim(source.slice(pos, sp.start)) + OPEN + sp.en + CLOSE;
      pos = sp.end; if (sp.kind === "data") stats.dataSpans++; else stats.stmtSpans++;
    }
    return out + escapeVerbatim(source.slice(pos, end));
  }

  /* ONE DEFINITION OF A CHUNK'S SENTENCE, shared with deriveGloss (R-REND-6). It is tempting to
   * reach for chunkGloss here — it is the nicer sentence, and it is already computed. Measured, it
   * is also WRONG: deriveGloss recomputes the sentence as `namedLabel || genLabel`, so a chunk
   * labelled by any third path fails its own derive check at compile ("await find one or fail into
   * `payment`" written against "await await into `payment`" derived, on the real corpus). A
   * renderer and its checker computing the same thing two ways is the producer/consumer drift
   * shape §8B is about — so this calls exactly what deriveGloss calls, in the same order. */
  const label = (run, start, end, payload) => {
    let s = null;
    namedLabel.lastClauses = null;
    if (payload && cat) { try { s = namedLabel({ start, end, payload }, source, cat, NAMES.names, NAMES.chunks); } catch (_) { s = null; } }
    /* FOLD INVARIANCE (§5D.3A as amended, R-LANG-23). A name is a label: it may change how a clause
     * READS and never HOW MANY clauses there are. That number is decided by the rules from the
     * unnamed dictionary — `spanActions` never consults NAMES — so the renderer publishes the count
     * it actually emitted and naming-gate.js compares it across a render with names and one
     * without. Comparing the two HERE would be vacuous now that namedLabel derives its clause list
     * from spanActions: the check has to be a differential against an unnamed render, which only
     * the gate is in a position to do. This is what would have caught the defect that unfolded 283
     * import runs while passing all four existing checks. */
    if (s && namedLabel.lastClauses !== null) stats.labelClauses += namedLabel.lastClauses;
    else {
      /* Counted off the RE-PARSED SLICE, because that is what genLabel actually renders from
       * (`ts.createSourceFile` over `source.slice(start, end)`). Counting the original `run` nodes
       * here instead made the two branches disagree by a handful of clauses on spans where a name
       * merely CHANGED WHICH BRANCH RAN — a measurement artifact that reads exactly like a name
       * splitting a fold, and would have failed check 5 on a batch that had done nothing wrong. */
      try {
        const frag = ts.createSourceFile("s.ts", source.slice(start, end), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        stats.labelClauses += spanActions([...frag.statements], frag).actions.length;
      } catch (_) { /* unruled */ }
    }
    return sanitizeLabel(s || genLabel(start, end, source, run.length));
  };

  /* one chunk for an entire run: atomic when nothing inside it can be drilled into, structural
   * otherwise. Returns null when the run has no word AND no inner structure — the caller then
   * emits it verbatim rather than inventing a chunk with nothing behind it. */
  function renderRun(run, depth) {
    if (depth > stats.maxDepth) stats.maxDepth = depth;
    const start = run[0].getStart(sf), end = run[run.length - 1].getEnd();
    const drillable = run.some((st) => innerRunRanges(st, sf).length > 0);
    const w = cat ? EL.runWord(run, sf, source, cat) : null;

    if (!drillable) {
      if (!w) return null;                                   // no word, nothing under it: verbatim
      stats.atomic++; stats.atomicStmts += run.length;
      stats.depthHist[depth] = (stats.depthHist[depth] || 0) + 1;
      return OPEN + GEN + " " + label(run, start, end, w.payload) + " "
           + PAY_OPEN + PAY.encode(w.payload) + PAY_CLOSE + CLOSE;
    }

    /* STRUCTURAL: children are the maximal NON-DRILLABLE sub-runs (each one atomic word, if the
     * dictionary has one) plus each drillable statement on its own.
     *
     * WHY NOT ONE CHILD PER STATEMENT (the shape this replaced). A structural chunk used to emit a
     * child for every statement in the run, which threw away every word covering a CONTIGUOUS
     * STRETCH of statements inside it — ten imports above a slice definition rendered as ten
     * chunks, not one. It was invisible while runs were short; the stray-`;` fix made whole-file
     * runs common and it became the corpus's largest single cost. Measured over 1,037 files:
     * whole-tree review surface 29,393 -> 19,776 (-33%), chunks 28,845 -> 19,228, atomic 19,234 ->
     * 9,617, with the top-level read (1,582) and one-word-per-file (1,030) unchanged — this changes
     * how a chunk's children are GROUPED, never which bytes a chunk owns.
     *
     * BYTE-IDENTITY IS UNAFFECTED BY CONSTRUCTION: the children still tile the run in order, the
     * gaps between them are still the exact source slices, and a sub-run that finds no word falls
     * back to the per-statement rendering it would have had. 1037/1037 before and after. */
    const segs = [];
    for (const st of run) {
      const dr = innerRunRanges(st, sf).length > 0;
      const prev = segs[segs.length - 1];
      if (!dr && prev && !prev.drillable) prev.stmts.push(st);
      else segs.push({ drillable: dr, stmts: [st] });
    }
    let body = "";
    for (let k = 0; k < segs.length; k++) {
      const seg = segs[k];
      let piece = null;
      if (!seg.drillable && seg.stmts.length > 1) piece = renderRun(seg.stmts, depth + 1);
      if (piece === null) {
        piece = "";
        for (let m = 0; m < seg.stmts.length; m++) {
          piece += renderStatement(seg.stmts[m], depth + 1);
          if (m < seg.stmts.length - 1) piece += renderVerbatim(seg.stmts[m].getEnd(), seg.stmts[m + 1].getStart(sf));
        }
      }
      body += piece;
      if (k < segs.length - 1) {
        const a = seg.stmts[seg.stmts.length - 1].getEnd(), b = segs[k + 1].stmts[0].getStart(sf);
        body += renderVerbatim(a, b);
      }
    }
    /* the run's statements are counted by their OWN chunks below; counting them here too
     * would double-count every statement in a drillable run (measured: 834 for a 486-statement
     * file before this line was corrected). */
    stats.structural++;
    stats.depthHist[depth] = (stats.depthHist[depth] || 0) + 1;
    return OPEN + GEN_NEST + " " + label(run, start, end, w && w.payload) + " " + BODY_OPEN + body + BODY_CLOSE + CLOSE;
  }

  /* one statement: a chunk of its own if it has inner runs (structural) or a word (atomic). */
  function renderStatement(st, depth) {
    if (depth > stats.maxDepth) stats.maxDepth = depth;
    const start = st.getStart(sf), end = st.getEnd();
    const inner = innerRunRanges(st, sf);
    if (!inner.length) {
      const one = renderRun([st], depth);
      if (one) return one;
      stats.verbatimStmts++;
      return renderVerbatim(start, end);
    }
    let body = "", pos = start;
    for (const r of inner) {
      const child = renderRun(r.run, depth + 1);
      body += renderVerbatim(pos, r.start) + (child !== null ? child : renderVerbatim(r.start, r.end));
      pos = r.end;
    }
    body += renderVerbatim(pos, end);
    const w = cat ? EL.runWord([st], sf, source, cat) : null;
    stats.structural++; stats.structuralStmts += 1;
    stats.depthHist[depth] = (stats.depthHist[depth] || 0) + 1;
    return OPEN + GEN_NEST + " " + label([st], start, end, w && w.payload) + " " + BODY_OPEN + body + BODY_CLOSE + CLOSE;
  }

  function renderFile() {
    let out = "", pos = 0;
    for (const run of foldableRuns([...sf.statements])) {
      const start = run[0].getStart(sf), end = run[run.length - 1].getEnd();
      const chunk = renderRun(run, 0);
      out += renderVerbatim(pos, start) + (chunk !== null ? chunk : renderVerbatim(start, end));
      pos = end;
    }
    out += renderVerbatim(pos, source.length);
    return out;
  }

  return { renderFile, stats };
}

/* renderFileNested — the nested renderer wearing renderFileEn's contract, so every existing caller
 * (tests, the corpus writer, the round-trip gates) gets the tree without knowing about it.
 *
 * THE METRICS CHANGE MEANING HERE, AND SAYING SO IS THE POINT (R-MECH-8). A flat render put one
 * list in front of the reader, so "how many things must you read" had one answer. A tree does not:
 * the reader reads the top sentence, and descends only where they need to. Publishing one number
 * as if nothing had changed would be the flattering choice. So three are published, and they are
 * different questions:
 *   reviewSurface      — the TOP-LEVEL read: top-level chunks + statements under no chunk at all.
 *                        What the file costs to understand at a glance. This is the number
 *                        R-ARCH-16 is about, and it is the one that falls.
 *   chunks             — every node of the tree. What the file costs to read EXHAUSTIVELY, which
 *                        no one does, but it is the honest ceiling and it must not hide.
 *   verbatimStatements — statements with no English over them at all, at any depth. Raw
 *                        TypeScript, the thing the whole effort exists to remove. */
function renderFileNested(source_sf, source, index) {
  const sf = source_sf;
  const N = NestRenderer(sf, source, index);
  const out = N.renderFile();
  const s = N.stats;
  const bodyStmts = countBodyStatements(sf);
  let topSpanCount = 0, outsideNonWs = 0;
  { let depth = 0, cursor = 0;
    for (let k = 0; k < out.length; k++) {
      const ch = out[k];
      if (ch === OPEN) { if (depth === 0) { outsideNonWs += out.slice(cursor, k).replace(/\s/g, "").length; } depth++; }
      else if (ch === CLOSE) { depth--; if (depth === 0) { topSpanCount++; cursor = k + 1; } }
    }
    outsideNonWs += out.slice(cursor).replace(/\s/g, "").length;
  }
  const chunks = s.atomic + s.structural;
  const covered = Math.min(bodyStmts, s.atomicStmts + s.structuralStmts);
  return { en: out, stats: {
    totalBytes: source.length, englishBytes: source.length - outsideNonWs,
    englishPct: source.length ? +(100 * (source.length - outsideNonWs) / source.length).toFixed(1) : 0,
    stmtSpans: s.stmtSpans, dataSpans: s.dataSpans,
    bodyStatements: bodyStmts,
    collapsedStatements: covered, restatedStatements: 0,
    verbatimStatements: s.verbatimStmts,
    residualStatements: Math.max(0, bodyStmts - covered),
    topSpans: topSpanCount, outsideNonWs,
    oneWord: topSpanCount === 1 && outsideNonWs === 0,
    netStatementReduction: Math.max(0, covered - topSpanCount),
    /* the TOP-LEVEL read, not the whole tree — see the note above */
    reviewSurface: topSpanCount + Math.max(0, bodyStmts - covered),
    reviewSurfacePct: bodyStmts ? +(100 * (topSpanCount + Math.max(0, bodyStmts - covered)) / bodyStmts).toFixed(1) : 0,
    genSpans: chunks, genStmtsCollapsed: covered,
    genRecursive: chunks, genFlatFallback: 0,
    /* tree shape */
    chunks, chunksAtomic: s.atomic, chunksStructural: s.structural,
    nestMaxDepth: s.maxDepth,
    /* the number of CLAUSES the labels emitted — the fold-invariance subject (R-LANG-23) */
    labelClauses: s.labelClauses,
    maxDepth: s.maxDepth, depthHist: s.depthHist,
  } };
}

/* NEST=0 restores the FLAT renderer for measurement only — it is how §5D.4E's before/after pairs
 * were produced. Not a supported production mode: with it off, a file is one opaque chunk. */
const NEST = process.env.NEST !== "0";

function renderFileEn(source, index) {
  index = index || cnl.loadWordsIndex([]);
  const sf = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (NEST && index._lzw) return renderFileNested(sf, source, index);
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
    /* R-MEAS-9 / R-ARCH-15: does this file collapse to ONE top-level word? `topSpans` is the count
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
 * COST. MEASURED, AND IT IS NOTHING. This was off by default on the reasoning that it costs "one
 * extra parse per generator span at compile time" and the .en -> .ts round-trip is on the hot path
 * of every test. Measured over the whole corpus on 2026-09-03: byte-identity 1037/1037 with the
 * check OFF in 5,779 ms and 1037/1037 with it ON in 5,484 ms — the same, inside noise, with ZERO
 * refusals. The cost the default was protecting does not exist.
 *
 * SO IT IS ON BY DEFAULT (Amir's approval, 2026-09-03). The trade is one-sided: with it off, a
 * hand-edited sentence compiles the OLD code and reports success, which is the worst of the three
 * possible behaviours — worse than refusing and worse than honouring the edit. With it on, that
 * same edit is a loud refusal naming the clause. `SDD_DERIVE_CHECK=0` or `{deriveCheck:false}`
 * turns it back off for a caller that genuinely needs the old behaviour.
 *
 * WHAT IT STILL DOES NOT COVER, unchanged by this flip: compileChunk's structural branch returns
 * before the check, so a hand-edit to a structural chunk's NAME is silent even now. See the note
 * there before reading a green round-trip as "no hand-edit got through".
 *
 * SCOPE. Atomic generator chunks only — compileChunk's structural branch returns before the check
 * runs. See the note there before reading a green round-trip as "no hand-edit got through". */
function deriveGloss(payload, compiled, cat) {
  const s = { payload, start: 0, end: compiled.length, stmts: null };
  try { return namedLabel(s, compiled, cat, NAMES.names, NAMES.chunks) || genLabel(0, compiled.length, compiled, null); }
  catch (_) { return null; }   /* a gloss we cannot derive is not evidence of an edit */
}

/* THE STRUCTURAL HEADING, DERIVED (§5C rule 3, closing the branch cecfd70 documented as open).
 * A structural chunk carries no payload of its own, which is why the derive check skipped it and
 * why a hand-edit to a heading was silent even with SDD_DERIVE_CHECK=1. But "no payload" is not
 * "nothing to check against": the heading was computed by the renderer FROM THE RUN, and compiling
 * the body reproduces that run's source bytes exactly. So the same computation runs again here.
 *
 * IT MUST BE THE SAME COMPUTATION, NOT AN EQUIVALENT ONE — the drift shape §8B exists for. The
 * renderer's `label()` is `sanitizeLabel(namedLabel(...) || genLabel(...))` over `EL.runWord`; this
 * calls those four in that order on the compiled slice, which is byte-identical to the slice the
 * renderer labelled. Anything cheaper here re-introduces the "await find one or fail" class of
 * false positive that the comment above deriveGloss records paying for once already.
 *
 * FAIL SOFT, ALWAYS. Every failure path returns null (= "no opinion"), never a throw and never a
 * guess. A heading we cannot re-derive is not evidence of an edit, and a check that fires on
 * correct spans is worse than no check at all. The parse-diagnostics gate is part of that: a
 * structural chunk nested inside a block can hold statements that do not parse as a standalone
 * program, and labelling a broken parse would fire on a file nobody touched. */
function deriveStructuralGloss(compiled, cat) {
  if (!cat || !compiled.trim()) return null;
  let frag;
  try { frag = ts.createSourceFile("s.ts", compiled, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
  catch (_) { return null; }
  if (frag.parseDiagnostics && frag.parseDiagnostics.length) return null;  /* not a standalone program */
  const stmts = [...frag.statements];
  if (!stmts.length) return null;
  let w = null;
  try { w = EL.runWord(stmts, frag, compiled, cat); } catch (_) { w = null; }
  let s = null;
  try { s = namedLabel({ start: 0, end: compiled.length, payload: w && w.payload }, compiled, cat, NAMES.names, NAMES.chunks); }
  catch (_) { s = null; }
  try { return sanitizeLabel(s || genLabel(0, compiled.length, compiled, stmts.length)); }
  catch (_) { return null; }
}

/* ================================================================================================
 * R-REND-6 CUT 2 — THE SENTENCE BECOMES EFFECTIVE (§5C rule 2, §Q-3 mechanics).
 *
 * Cut 1 (`deriveGloss` above) made a hand-edited sentence a LOUD REFUSAL instead of a silent no-op.
 * That satisfies §5C rule 3 and leaves rule 2 unbuilt: "a hand-edit to a clause's English MUST
 * change the compiled TypeScript". A refusal is not a change. Until this function existed the
 * engine was a documentation generator — the English described the program and could not BE it,
 * which is the whole of Amir's goal: he cannot stop reading TypeScript while the English is a
 * comment.
 *
 * WHY THIS IS NOT THE §5E.3.2 GRAMMAR PARSER, and why it does not need to be. Parsing an arbitrary
 * English clause back into a payload is the open half of §Q-3 and is a large piece of work. But the
 * payload is `{d,a,w,h}` and `compileSpan` is `refill(template, h)` — the word id `w` picks a
 * TEMPLATE and the holes `h` are the ONLY per-site content. So every edit that changes what a
 * clause MEANS about this site, rather than which pattern it is, is an edit to a hole. §5C's own
 * examples are exactly that class: "an identifier, a status code, a callee". This inverts the hole
 * layer only, and refuses everything else rather than guessing at it.
 *
 * THE LOOP IS CLOSED, WHICH IS WHY IT IS ALLOWED TO GUESS AT ALL. The repair is a HYPOTHESIS, and
 * it is never trusted on its own reasoning:
 *
 *     written gloss  ->  hypothesise a hole substitution  ->  refill  ->  RE-DERIVE the gloss
 *                                                                              |
 *                        accept ONLY if the re-derived gloss is byte-equal to what the human wrote
 *
 * The acceptance test is the renderer itself. If the repaired payload re-renders to the human's
 * exact sentence, the edit was understood — not plausibly, provably, because the same function that
 * writes every clause in the corpus now writes theirs. Anything else is a refusal. There is no
 * branch where a partially-understood edit compiles.
 *
 * ASSERT YOUR OWN DENOMINATOR (skills-4a, 2026-09-03, from the orphan-ledger failure the same day:
 * `reconcile-names.js` walked a 6-entry leaf ledger and reported a confident "2 newly orphaned"
 * against a corpus where 974 chunk names had died — it was not wrong about what it looked at, it
 * looked at the wrong collection and said nothing about the rest). So: EVERY differing token must
 * be consumed by a substitution. A diff this function cannot account for is a refusal even if the
 * tokens it DID account for would have verified. Silence about the remainder is the bug class.
 *
 * WHAT IT DELIBERATELY DOES NOT REPAIR, each a refusal and not a silent pass:
 *   - a changed token count or token kind        (the clause was restructured, not re-filled)
 *   - an old token that is not a hole value      (it came from the template — that is a NEW WORD,
 *                                                 which is the miner's job, not the compiler's)
 *   - prose outside the quoted tokens            (adjectives the payload never encoded)
 *   - anything whose re-derivation does not match (we did not understand it)
 * ============================================================================================== */

/* the quoted tokens of a gloss, in order, with their kind. A gloss quotes identifiers in `backticks`
 * and string literals in “curly quotes” (sanitizeLabel guarantees neither can appear in prose), so
 * these two are the full set of positions where a gloss names something the payload also carries. */
function glossTokens(g) {
  const out = [];
  const re = /`([^`]*)`|“([^”]*)”/g;
  let m;
  while ((m = re.exec(g)) !== null) {
    out.push(m[1] !== undefined ? { kind: "id", text: m[1] } : { kind: "str", text: m[2] });
  }
  return out;
}

/* Attempt to honour a hand-edited sentence. Returns the compiled TypeScript on success, or null —
 * never a partial result, and never a throw of its own (the caller owns the refusal message). */
function repairFromSentence(written, obj, cat) {
  const holes = obj.h || [];
  if (!holes.length) return null;                 /* nothing per-site to edit */

  /* re-derive the CURRENT sentence so the diff is against what the payload actually says, not
   * against whatever was on disk — the same call the check above made. */
  let baseCompiled;
  try { baseCompiled = EL.compileSpan(obj, cat); } catch (_) { return null; }
  const derived = deriveGloss(obj, baseCompiled, cat);
  if (derived === null) return null;

  const dTok = glossTokens(derived), wTok = glossTokens(written);
  if (dTok.length !== wTok.length || dTok.length === 0) return null;   /* restructured, not refilled */

  /* build the substitution, and refuse the moment anything is unaccounted for. */
  const subs = new Map();
  for (let i = 0; i < dTok.length; i++) {
    if (dTok[i].kind !== wTok[i].kind) return null;
    if (dTok[i].text === wTok[i].text) continue;
    const from = dTok[i].text, to = wTok[i].text;
    if (!holes.includes(from)) return null;       /* came from the template — a new word, not a fill */
    if (subs.has(from) && subs.get(from) !== to) return null;  /* one token, two fates */
    subs.set(from, to);
  }
  if (subs.size === 0) return null;               /* the difference is prose, not tokens */

  const newH = holes.map((h) => (subs.has(h) ? subs.get(h) : h));
  if (newH.every((h, i) => h === holes[i])) return null;

  const newObj = { d: obj.d, a: obj.a, w: obj.w, h: newH };
  let compiled;
  try { compiled = EL.compileSpan(newObj, cat); } catch (_) { return null; }

  /* THE CLOSED LOOP. Accept only if the repaired payload re-renders to the human's exact sentence. */
  const reDerived = deriveGloss(newObj, compiled, cat);
  if (reDerived !== written) return null;

  return compiled;
}

/* HOW A PARENT KNOWS ITS BODY MOVED BENEATH IT. Monotonic and never reset, so it is safe under
 * recursion: a caller snapshots it, compiles, and compares. Only repairFromSentence bumps it, so
 * "greater than my snapshot" means exactly "an honoured hand-edit changed my body's bytes". */
let honouredEdits = 0;

/* NAME THE FILE IN THE REFUSAL. `compileChunk` has never known which file it is compiling — it is
 * handed a chunk — so both refusals below could name the clause and not the file, and a caller
 * compiling 1,037 of them printed a perfect diagnosis of an unidentified file. Threaded as an
 * optional `opts.file` rather than a required argument so no existing caller changes behaviour:
 * absent, the message reads exactly as before. */
function whereFile(opts) { return (opts && opts.file) ? "\n  file:     " + opts.file : ""; }

const DERIVE_CHECK = process.env.SDD_DERIVE_CHECK !== "0";

function compileChunk(chunk, index, opts) {
  const deriveCheck = (opts && opts.deriveCheck !== undefined) ? opts.deriveCheck : DERIVE_CHECK;
  if (chunk[0] === GEN_NEST) {
    /* STRUCTURAL chunk (PRD §5D.4E): a NAME over children, with no payload of its own. It
     * reconstructs its range by compiling its body — which is ordinary .en text: nested chunks and
     * escaped verbatim — so byte-exactness is inherited from the children rather than asserted
     * here. The body is delimited by the LAST BODY_CLOSE, matched against the first BODY_OPEN
     * after the marker, so a ⟨ inside a child's payload cannot end it early. */
    /* WHERE THE R-REND-6 DERIVE CHECK STOPS, and it is structural, not an oversight. This branch
     * returns before the deriveCheck below, so a structural chunk's OWN name is never compared
     * against anything — it has no payload to disagree with. Its CHILDREN are still checked, on
     * the recursive call. So a hand-edit to a nested chunk's sentence is refused; a hand-edit to
     * the NAME this chunk carries is silent, even with SDD_DERIVE_CHECK=1.
     * Measured 2026-09-01 (`measure-hand-edit.js`, another lane): of 580 hand edits, the check
     * turns all 460 atomic-chunk edits into refusals and leaves the 120 structural ones silent —
     * and all 120 sit at chunk depth 0, which is 777 of 9,611 structural chunks corpus-wide, so
     * the silent class is measured on the atypical 8.1%. Closing it is not a comment's business:
     * it needs a second producer of the run grouping, which is the shape R-REND-9 forbids. */
    const bo = chunk.indexOf(BODY_OPEN), bc = chunk.lastIndexOf(BODY_CLOSE);
    if (bo < 0 || bc < bo) throw new Error("enfile: malformed structural chunk (no ⟨…⟩ body)");
    const body = chunk.slice(bo + 1, bc);
    const honouredBefore = honouredEdits;
    const built = compileFileEn(body, index, opts);
    const childHonoured = honouredEdits > honouredBefore;
    if (deriveCheck && index && index._lzw) {
      const written = chunk.slice(1, bo).trim();
      const derived = deriveStructuralGloss(built, index._lzw);
      if (derived !== null && derived !== written) {
        /* STALE BY CONSEQUENCE IS NOT A CONTRADICTION, and telling the two apart is what makes
         * rule 2 actually reachable. Found by running this, not by reading it: the first version
         * refused the ATOMIC test case, because the edited clause sits inside a structural chunk
         * and honouring the child moved the body out from under a heading nobody had touched. The
         * comment below claimed the edit "remains expressible at the child" while this branch was
         * making that false — the exact shape §9 of CLAUDE.md is a list of.
         *
         * The discriminator is exact, not a heuristic. Re-compile the body with repair OFF, which
         * reproduces the PRE-EDIT bytes, and derive the heading from those:
         *   - it matches what the human wrote  -> the heading was right before the child edit and
         *                                         is merely behind it. The body wins; the heading
         *                                         re-derives on the next render.
         *   - it does not match either         -> the human edited the heading TOO, on top of a
         *                                         child edit. Still a contradiction. Still refused.
         * Costs one extra compile of the body, and only on a file that carries an honoured edit —
         * never on the clean corpus, where repair never runs at all. */
        if (childHonoured) {
          let preEdit = null;
          try { preEdit = compileFileEn(body, index, Object.assign({}, opts, { deriveCheck: false })); }
          catch (_) { preEdit = null; }
          const derivedPreEdit = preEdit === null ? null : deriveStructuralGloss(preEdit, index._lzw);
          if (derivedPreEdit !== null && derivedPreEdit === written) return built;
        }
        /* WHY THIS REFUSES INSTEAD OF HONOURING THE EDIT, unlike the atomic branch below. A
         * heading is not an independent statement about the code — it is COMPUTED FROM THE
         * CHILDREN, and every identifier in it is an echo of an identifier in a child clause. So
         * an edit to the heading alone is not the sentence disagreeing with a derived index; it is
         * two pieces of ENGLISH disagreeing with each other, and there is no principled winner:
         * honouring the heading would silently rewrite child clauses the human did not touch.
         *
         * Rule 2 is not weakened by this, because the edit remains EXPRESSIBLE — at the child. Edit
         * the atomic clause that names the identifier and the repair path honours it, and the
         * heading then re-derives to match on the next render. Every semantic edit has an
         * effective home; this one just is not it. */
        throw new Error(
          "enfile: HEADING AND BODY DISAGREE (R-REND-6 — the sentence is authoritative)" +
          whereFile(opts) + "\n" +
          "  written:  " + written + "\n" +
          "  derived:  " + derived + "\n" +
          "  A structural heading is computed from the clauses beneath it, so an edit to the heading\n" +
          "  alone contradicts them. Make the edit in the child clause that names the identifier —\n" +
          "  the heading follows from it. It is NOT compiled silently.");
      }
    }
    return built;
  }
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
        /* §5C RULE 2 FIRST, RULE 3 ONLY AS THE FALLBACK. The sentence is authoritative, so before
         * refusing a disagreement we try to HONOUR it: repairFromSentence inverts the hole layer
         * and accepts only a repair that re-derives to this exact sentence. Rule 3's refusal is
         * what happens when the sentence says something we cannot prove we understood — never a
         * tie the payload wins, and never a silent compile of the pre-edit bytes. */
        const honoured = repairFromSentence(written, obj, index._lzw);
        if (honoured !== null) { honouredEdits++; return honoured; }
        throw new Error(
          "enfile: SENTENCE AND PAYLOAD DISAGREE (R-REND-6 — the sentence is authoritative)" +
          whereFile(opts) + "\n" +
          "  written:  " + written + "\n" +
          "  derived:  " + derived + "\n" +
          "  The English in this clause is not what its payload compiles to, AND the repair path could\n" +
          "  not prove it understood the difference — so it refused rather than compile a guess.\n" +
          "  An edit is honoured when it renames what a hole carries (an identifier, a callee, a\n" +
          "  literal) and the clause otherwise reads the same. It is refused when it adds or reworks\n" +
          "  prose the payload cannot encode, changes how many things the clause names, or renames\n" +
          "  something that came from the pattern rather than this site — that last case is a NEW\n" +
          "  WORD, which the miner owns, not the compiler. It is NOT compiled silently either way.");
      }
    }
    return compiled;
  }
  if (DATA_PREFIX.test(chunk)) return DATA.compileData(chunk);
  return cnl.compileStatement(chunk, index);
}
/* NESTING-AWARE SCAN (PRD §5D.4E). This used to find a chunk's end with `indexOf(CLOSE)`, which
 * takes the FIRST » — right through the middle of a structural chunk whose children carry their
 * own. Matching depth is what makes children reachable at all; without it the outermost chunk of
 * every nested file would compile to garbage or throw. */
function matchClose(en, open) {
  let depth = 0;
  for (let k = open; k < en.length; k++) {
    const ch = en[k];
    if (ch === OPEN) depth++;
    else if (ch === CLOSE) { depth--; if (depth === 0) return k; }
  }
  return -1;
}
function compileFileEn(en, index, opts) {
  index = index || cnl.loadWordsIndex([]);
  let out = "", i = 0;
  while (i < en.length) {
    const open = en.indexOf(OPEN, i);
    if (open < 0) { out += unescapeVerbatim(en.slice(i)); break; }
    out += unescapeVerbatim(en.slice(i, open));
    const close = matchClose(en, open);
    if (close < 0) throw new Error("enfile: unbalanced « (no matching »)");
    out += compileChunk(en.slice(open + 1, close), index, opts);
    i = close + 1;
  }
  return out;
}

/* THE FOLDER AND PROGRAM SCALES live in engine/en-scales.js and are re-exported here so the
 * engine has ONE front door (`require("./enfile")`) at every scale — file, folder, program.
 * Required lazily INSIDE that module, not at the top of this one, because the dependency runs the
 * other way: en-scales calls renderFileEn/compileFileEn, and a top-level require here would be a
 * cycle. Deliberately two lines in this file: enfile.js is the hot file several sessions edit at
 * once (CLAUDE.md §7), and 270 lines of new scale logic does not belong in it. */
const SCALES = require("./en-scales");

module.exports = { renderFileEn, NestRenderer, compileFileEn, compileChunk, deriveGloss, deriveStructuralGloss, repairFromSentence,
  renderFolderEn: SCALES.renderFolderEn, compileFolderEn: SCALES.compileFolderEn,
  renderProgramEn: SCALES.renderProgramEn, compileProgramEn: SCALES.compileProgramEn, SCALES, countBodyStatements, loadIndex, genLabel, spanProse, spanActions, chunkGloss, sanitizeLabel, namedLabel, NAMES, escapeVerbatim, unescapeVerbatim,
  /* exported for engine/rule-coverage.js: "carries no information" must have exactly ONE definition,
   * and it is this one — the renderer's. A second copy in the consumer would drift from it silently. */
  SAYS_NOTHING };
