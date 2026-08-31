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
const GEN = "▶", PAY_OPEN = "⟪", PAY_CLOSE = "⟫"; // multi-line generator span: «▶ gloss ⟪base64(payload)⟫»
const MAXWIN = 8;

/* load the mined multi-line generator catalog (regenerable; absent -> layer disabled) */
function loadGenerators(corpusRoot) {
  const byKey = new Map(), byId = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(corpusRoot || "", "catalog", "generators.json"), "utf8"));
    for (const g of j.generators || []) { byKey.set(g.key, g); byId.set(g.id, g); }
  } catch (_) { /* layer disabled */ }
  return { byKey, byId };
}

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
  idx._generators = loadGenerators(corpusRoot); // attach the FLAT generator layer (fallback only)
  // attach the RECURSIVE word dictionary — the PRIMARY generator layer. It lives in the skills
  // repo catalog (regenerable via build-lzw-generators.js), not the corpus. Absent -> layer
  // disabled and rendering falls back entirely to the flat layer.
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
function b64(obj) { return Buffer.from(JSON.stringify(obj), "utf8").toString("base64"); }

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
    if (ts.isVariableStatement(st)) {
      const decls = st.declarationList.declarations;
      const names = decls.map((d) => d.name.getText(sf)).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
      const nm = names.length ? P.list(names.map((n) => "`" + n + "`")) : "a value";
      const init = decls[0] && decls[0].initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) { actions.push("define " + nm); continue; }
      const call = firstCallName(st);
      if (isAwait(st)) actions.push("await " + (call ? P.words(call) : "a value") + " into " + nm);
      else if (call) actions.push("get " + nm + " from " + P.words(call));
      else actions.push("compute " + nm);
      continue;
    }
    if (ts.isReturnStatement(st)) { const c = firstCallName(st); actions.push(c ? "return " + P.words(c) : "return the result"); continue; }
    if (ts.isThrowStatement(st)) { const m = throwMessage(st); actions.push(m ? "throw “" + m + "”" : "throw an error"); continue; }
    if (ts.isExpressionStatement(st)) {
      const inner = ts.isAwaitExpression(st.expression) ? st.expression.expression : st.expression;
      const callee = ts.isCallExpression(inner) ? inner.expression : null;
      if (callee && ts.isPropertyAccessExpression(callee) && callee.expression.getText(sf) === "console") { actions.push("log a message"); continue; }
      const name = firstCallName(st);
      actions.push((isAwait(st) ? "await " : "call ") + (name ? P.words(name) : "a step"));
      continue;
    }
    if (ts.isForStatement(st) || ts.isForOfStatement(st) || ts.isForInStatement(st) || ts.isWhileStatement(st) || ts.isDoStatement(st)) {
      const c = firstCallName(st); actions.push(c ? "loop over " + P.words(c) : "loop"); continue;
    }
    if (ts.isIfStatement(st)) { const c = firstCallName(st.thenStatement); actions.push(c ? "if a condition holds, " + P.words(c) : "branch on a condition"); continue; }
    if (ts.isTryStatement(st)) { const c = firstCallName(st.tryBlock); actions.push(c ? "try " + P.words(c) : "run a try/catch"); continue; }
    if (ts.isSwitchStatement(st)) { actions.push("switch on a value"); continue; }
    const c = firstCallName(st); actions.push(c ? "call " + P.words(c) : "run a step");
  }
  let out = P.list(actions, "then");
  if (guards.length) out += (out ? " — " : "") + "failing when " + guards.join("; ");
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

/* Pass 0 — collapse runs of straight-line statements into ONE multi-line generator call.
 * Narrow-preferred (longest narrow match at a position), widened generators only claim a
 * position narrow leaves fully verbatim. Emits a span ONLY if refill === exact source slice. */
function generatorSpans(sf, source, gens) {
  const spans = [];
  if (!gens || !gens.byKey || !gens.byKey.size) return spans;
  const blocks = [];
  const collect = (n) => { if (ts.isBlock(n) || ts.isSourceFile(n)) if (n.statements.length) blocks.push([...n.statements]); ts.forEachChild(n, collect); };
  collect(sf);
  for (const stmts of blocks) {
    let i = 0;
    while (i < stmts.length) {
      if (!isSimpleForGen(stmts[i])) { i++; continue; }
      let j = i; while (j < stmts.length && isSimpleForGen(stmts[j])) j++;
      const run = stmts.slice(i, j);
      // precompute per-statement parts (narrow + wide) and inter-statement gaps ONCE
      const nc = run.map((st) => G.generalStmtParts(st, sf, false));
      const wc = run.map((st) => G.generalStmtParts(st, sf, true));
      const gaps = run.map((st, k) => k < run.length - 1 ? sf.text.slice(st.getEnd(), run[k + 1].getStart(sf)) : "");
      let p = 0;
      while (p < run.length) {
        let hit = null;
        const maxK = Math.min(MAXWIN, run.length - p);
        // meaning-aware boundary (SAME constraint as the recursive path, EL.isUnit): a flat window
        // must not straddle >=2 unit definitions either — otherwise a merge rejected on the
        // recursive path silently reappears here as a flat-fallback merge and the fix only LOOKS
        // complete. Applied in the K-search so the longest ADMISSIBLE window still wins.
        const straddlesUnits = (K) => run.slice(p, p + K).filter(EL.isUnit).length >= 2;
        // longest NARROW match first
        for (let K = maxK; K >= 2 && !hit; K--) {
          if (straddlesUnits(K)) continue;
          const wp = G.windowFromCache(nc, gaps, p, K);
          if (wp && gens.byKey.has(wp.key)) hit = { K, wp, g: gens.byKey.get(wp.key) };
        }
        // else longest WIDE match (additive: only where narrow found nothing here)
        if (!hit) for (let K = maxK; K >= 2 && !hit; K--) {
          if (straddlesUnits(K)) continue;
          const wp = G.windowFromCache(wc, gaps, p, K);
          if (wp && gens.byKey.has(wp.key) && gens.byKey.get(wp.key).level === "opw") hit = { K, wp, g: gens.byKey.get(wp.key) };
        }
        if (hit) {
          const win = run.slice(p, p + hit.K);
          const start = win[0].getStart(sf), end = win[hit.K - 1].getEnd();
          const slice = source.slice(start, end);
          if (G.refill(hit.wp.key, hit.wp.holes) === slice) { // absolute byte gate at emission
            const label = hit.g.name || hit.g.gloss; // domain phrase if the naming pass set one, else structural gloss (label only — compiler reads the payload, not this)
            const en = GEN + " " + label + " " + PAY_OPEN + b64({ d: "flat", g: hit.g.id, h: hit.wp.holes }) + PAY_CLOSE;
            spans.push({ start, end, en, kind: "gen", stmts: hit.K });
            p += hit.K; continue;
          }
        }
        p += 1;
      }
      i = j; // advance past this run (critical: without this the run reprocesses forever)
    }
  }
  return spans;
}

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
    en: GEN + " " + genLabel(s.start, s.end, source, s.stmts) + " " + PAY_OPEN + b64(s.payload) + PAY_CLOSE,
  }));
  const overlapsRec = (s, e) => genSpans.some((g) => s < g.end && e > g.start);
  const flatSpans = generatorSpans(sf, source, index._generators);
  for (const f of flatSpans) {
    if (overlapsRec(f.start, f.end)) continue; // recursive dictionary already owns these bytes
    f.tier = "flat"; f.depth = 1; genSpans.push(f); // genuine fallback: verbatim tiling, no composition
  }
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
    const obj = JSON.parse(Buffer.from(chunk.slice(a + 1, b), "base64").toString("utf8"));
    // DIALECT DISPATCH. Two payload dialects coexist:
    //   flat: { d:"flat", g:generatorId, h }   -> catalog/generators.json  (fallback tier)
    //   lzw:  { d:"lzw", a:"n"|"w", w:wordId, h } -> catalog/generators-lzw.json (primary)
    // Until now this dispatched on which key happened to be present, so correctness rested on
    // the two key sets staying disjoint (g vs w) — nothing enforced that. If they ever overlapped,
    // a compiler would resolve a payload to the WRONG BYTES and still report success: silent-wrong,
    // the one failure this project must never have. Dispatch is now explicit and fails CLOSED.
    const dialect = obj.d !== undefined ? obj.d
      : (obj.w !== undefined && obj.g !== undefined) ? "__ambiguous"
      : obj.w !== undefined ? "lzw"
      : obj.g !== undefined ? "flat"
      : "__none";
    if (dialect === "__ambiguous")
      throw new Error("enfile: ambiguous generator payload — carries both flat `g` and lzw `w` keys, so its dialect cannot be determined; refusing to guess (would risk compiling to the wrong bytes)");
    if (dialect === "__none")
      throw new Error("enfile: generator payload names no dialect and carries neither `g` (flat) nor `w` (lzw)");
    if (dialect !== "flat" && dialect !== "lzw")
      throw new Error(`enfile: unknown generator payload dialect ${JSON.stringify(obj.d)} — known dialects are "flat" and "lzw". Refusing to compile rather than guess.`);
    if (dialect === "lzw") { // RECURSIVE tier: payload { d:"lzw", a:"n"|"w", w:wordId, h:holes }
      if (obj.w === undefined) throw new Error('enfile: payload tagged dialect "lzw" but carries no `w` word id');
      if (!index || !index._lzw) throw new Error("enfile: recursive generator span but no lzw catalog loaded");
      return EL.compileSpan(obj, index._lzw);
    }
    // FLAT fallback tier: payload { d:"flat", g:generatorId, h:holes }
    if (obj.g === undefined) throw new Error('enfile: payload tagged dialect "flat" but carries no `g` generator id');
    const gens = index && index._generators;
    const rec = gens && gens.byId && gens.byId.get(obj.g);
    if (!rec) throw new Error("enfile: unknown generator id " + obj.g);
    return G.refill(rec.key, obj.h);
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

/* gen-covered SOURCE ranges for a file (for collapse/residual measurement) */
function genRanges(source, index) {
  const sf = ts.createSourceFile("f.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return generatorSpans(sf, source, index && index._generators).map((s) => [s.start, s.end]);
}

module.exports = { renderFileEn, compileFileEn, loadIndex, genRanges, genLabel, spanProse, sanitizeLabel };
