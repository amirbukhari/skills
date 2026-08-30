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
  const tryFiles = ["word-library.json", "catalog/mined-library.json"].map((f) => path.join(corpusRoot || "", f));
  let idx = null;
  for (const f of tryFiles) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      const words = Array.isArray(j) ? j : (j.words || j.entries || []);
      if (Array.isArray(words) && words.length) { idx = cnl.loadWordsIndex(words); break; }
    } catch (_) { /* fall through */ }
  }
  idx = idx || cnl.loadWordsIndex([]);
  idx._generators = loadGenerators(corpusRoot); // attach the multi-line generator layer
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
        // longest NARROW match first
        for (let K = maxK; K >= 2 && !hit; K--) {
          const wp = G.windowFromCache(nc, gaps, p, K);
          if (wp && gens.byKey.has(wp.key)) hit = { K, wp, g: gens.byKey.get(wp.key) };
        }
        // else longest WIDE match (additive: only where narrow found nothing here)
        if (!hit) for (let K = maxK; K >= 2 && !hit; K--) {
          const wp = G.windowFromCache(wc, gaps, p, K);
          if (wp && gens.byKey.has(wp.key) && gens.byKey.get(wp.key).level === "opw") hit = { K, wp, g: gens.byKey.get(wp.key) };
        }
        if (hit) {
          const win = run.slice(p, p + hit.K);
          const start = win[0].getStart(sf), end = win[hit.K - 1].getEnd();
          const slice = source.slice(start, end);
          if (G.refill(hit.wp.key, hit.wp.holes) === slice) { // absolute byte gate at emission
            const en = GEN + " " + hit.g.gloss + " " + PAY_OPEN + b64({ g: hit.g.id, h: hit.wp.holes }) + PAY_CLOSE;
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
  const genSpans = generatorSpans(sf, source, index._generators);
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
  for (const sp of spans) {
    if (sp.start < pos) continue; // safety: never overlap
    out += source.slice(pos, sp.start) + OPEN + sp.en + CLOSE;
    pos = sp.end; englishBytes += sp.end - sp.start;
    if (sp.kind === "stmt") stmtN++; else if (sp.kind === "gen") { genN++; genStmts += sp.stmts || 0; } else dataN++;
  }
  out += source.slice(pos);
  return { en: out, stats: { totalBytes: source.length, englishBytes, englishPct: source.length ? +(100 * englishBytes / source.length).toFixed(1) : 0, stmtSpans: stmtN, dataSpans: dataN, genSpans: genN, genStmtsCollapsed: genStmts } };
}

/* ------------------------------ COMPILE (.en -> .ts) ------------------------------ */
function compileChunk(chunk, index) {
  if (chunk[0] === GEN) { // multi-line generator: refill catalog template with per-site holes
    const a = chunk.lastIndexOf(PAY_OPEN), b = chunk.lastIndexOf(PAY_CLOSE);
    if (a < 0 || b < 0 || b < a) throw new Error("enfile: malformed generator payload");
    const { g, h } = JSON.parse(Buffer.from(chunk.slice(a + 1, b), "base64").toString("utf8"));
    const gens = index && index._generators;
    const rec = gens && gens.byId && gens.byId.get(g);
    if (!rec) throw new Error("enfile: unknown generator id " + g);
    return G.refill(rec.key, h);
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

module.exports = { renderFileEn, compileFileEn, loadIndex, genRanges };
