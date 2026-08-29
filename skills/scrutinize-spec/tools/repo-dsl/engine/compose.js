"use strict";
/**
 * COMPOSE — the per-file COMPOSITIONAL DSL. Every file is tiled, byte-losslessly,
 * as an ordered sequence of items:
 *
 *   file = [ word, literalSlot, word, word, literalSlot, ... ]
 *
 * A `word` is a token whose SHAPE recurs across the corpus AND carries >=1 typed
 * slot AND whose shared canonical template refills THAT token byte-for-byte. Every
 * other span — a novel/bespoke statement, a structural connector, all gap trivia —
 * is an explicit LITERAL slot (verbatim bytes). Because the fan-out's tokens+gaps
 * already tile [0,len) exactly, and each item reproduces its own bytes (a word via
 * fill(canonicalTemplate, slots) which is verified to equal the token; a literal
 * verbatim), EXPANSION IS BYTE-IDENTICAL BY CONSTRUCTION.
 *
 * Deterministic, no model. Words carry params (leaves are opaque atoms, not words);
 * a word here is a parameterized recurring statement/span.
 */
const crypto = require("crypto");
const { tokenize, fill } = require("./fanout");

const MIN_COUNT = 2;         // a word must recur in >=2 occurrences
const MIN_WORD_CHARS = 4;    // ignore trivial punctuation tokens as "words"

function shapeId(shape) { return "c_" + crypto.createHash("sha256").update(shape).digest("hex").slice(0, 10); }

/**
 * Build the shared word dictionary from pre-tokenized files.
 *   perFile: [{ rel, source, tokens }]  (tokens from tokenize(...,cut 0))
 * Returns { dict: { id -> {id, shape, template, freq, files, slots, example} }, byShape }
 */
function buildDictionary(perFile) {
  // group tokens by shape; collect template variants + spread + example
  const shapes = new Map(); // shape -> { freq, files:Set, templates:Map(json->{parts,count}), slots, example }
  for (const pf of perFile) {
    const seenInFile = new Set();
    for (const t of pf.tokens) {
      if (!t.slots || t.slots.length === 0) continue;              // words carry params
      if (t.text.trim().length < MIN_WORD_CHARS) continue;         // skip trivial punctuation
      let e = shapes.get(t.shape);
      if (!e) { e = { freq: 0, files: new Set(), templates: new Map(), slots: t.slots.length, example: t.text.split("\n")[0].slice(0, 100) }; shapes.set(t.shape, e); }
      e.freq++; e.files.add(pf.rel);
      const key = JSON.stringify(t.templateParts);
      const tv = e.templates.get(key); if (tv) tv.count++; else e.templates.set(key, { parts: t.templateParts, count: 1 });
    }
    seenInFile.clear();
  }
  const dict = {}; const byShape = new Map();
  for (const [shape, e] of shapes) {
    if (e.freq < MIN_COUNT) continue;                              // must recur
    // canonical template = the plurality variant
    let best = null; for (const tv of e.templates.values()) if (!best || tv.count > best.count) best = tv;
    const id = shapeId(shape);
    const rec = { id, shape, template: best.parts, freq: e.freq, files: e.files.size, slots: e.slots, example: e.example };
    dict[id] = rec; byShape.set(shape, rec);
  }
  return { dict, byShape };
}

/**
 * Tile one file into compositional items. Returns
 *   { items:[{w,s}|{lit}], wordChars, literalChars, wordTokens, literalTokens, wordsUsed:Set }
 * A token is a WORD iff its shape is in byShape AND fill(canonical, slots) === text.
 */
// A literal span is STRUCTURAL — pure connective punctuation and whitespace with no
// domain meaning (`;`, `{`, `}`, `(`, `)`, `,`, and inter-token whitespace/newlines) —
// and must NOT be counted or labelled as a bespoke "novel bytes" slot. The bytes still
// emit verbatim (byte-exact reconstruction is unchanged); they are only accounted
// separately so the true bespoke share reflects REAL bespoke content, not scaffolding.
const STRUCTURAL_ONLY = /^[\s;{}(),]*$/;

function composeFile(tokens, gaps, source, byShape) {
  // merge tokens + gaps into one source-ordered stream
  const pieces = [];
  for (const t of tokens) pieces.push({ start: t.start, kind: "tok", t });
  for (const g of gaps) pieces.push({ start: g.start, kind: "gap", text: g.text });
  pieces.sort((a, b) => a.start - b.start);

  const items = [];
  let wordChars = 0, literalChars = 0, structuralChars = 0, wordTokens = 0, literalTokens = 0, structuralTokens = 0;
  const wordsUsed = new Set();
  // pushLit tags each span structural-or-not; adjacent spans merge only when they share
  // that flag, so the composition view can render structural spans distinctly (never as
  // bespoke chips) while keeping the byte stream intact.
  const pushLit = (text, structural) => {
    if (!text) return;
    const last = items[items.length - 1];
    if (last && last.lit !== undefined && !!last.structural === !!structural) last.lit += text;
    else items.push({ lit: text, structural: !!structural });
  };
  for (const p of pieces) {
    if (p.kind === "gap") {
      const structural = STRUCTURAL_ONLY.test(p.text);
      pushLit(p.text, structural);
      if (structural) structuralChars += p.text.length; else literalChars += p.text.length;
      continue;
    }
    const t = p.t;
    const rec = (t.slots && t.slots.length) ? byShape.get(t.shape) : null;
    if (rec && fill(rec.template, t.slots) === t.text) {
      items.push({ w: rec.id, s: t.slots.map((s) => s.text) });
      wordChars += t.text.length; wordTokens++; wordsUsed.add(rec.id);
    } else {
      // A non-word token that is only structural punctuation (a lone `;`, `}`…) is NOT a
      // bespoke slot either — count it structural, not as novel bytes.
      const structural = STRUCTURAL_ONLY.test(t.text);
      pushLit(t.text, structural);
      if (structural) { structuralChars += t.text.length; structuralTokens++; }
      else { literalChars += t.text.length; literalTokens++; }
    }
  }
  return { items, wordChars, literalChars, structuralChars, wordTokens, literalTokens, structuralTokens, wordsUsed };
}

/** Expand a composition against the dictionary -> source bytes. */
function expandComposition(items, dict) {
  let out = "";
  for (const it of items) {
    if (it.lit !== undefined) { out += it.lit; continue; }
    const rec = dict[it.w];
    if (!rec) throw new Error(`unknown word ${it.w}`);
    out += fill(rec.template, it.s.map((text) => ({ text })));
  }
  return out;
}

module.exports = { buildDictionary, composeFile, expandComposition, shapeId, tokenize, MIN_COUNT, MIN_WORD_CHARS };
