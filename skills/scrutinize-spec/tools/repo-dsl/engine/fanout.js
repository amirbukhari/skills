"use strict";
/**
 * STAGE 1 — AST FAN-OUT.
 *
 * Linearize a TypeScript file's AST into a canonical pre-order TOKEN STREAM.
 *
 * Cutting (structure) comes from the AST; normalization (typed slots) comes from
 * the lexical scanner:
 *
 *  - CUT: walk statements in source order; a statement that owns block(s)
 *    (function/arrow bodies, if/else, loops, try/catch, inline callbacks) is
 *    split into a head token (`… {`), its inner statements (recursively), and a
 *    tail/connector token (`} …`). Statements with no owned block are one token.
 *    The tokens' [start,end) spans + the gaps between them tile the whole file
 *    exactly, so reconstruction is lossless by construction.
 *
 *  - NORMALIZE: each token's source slice is scanned into a `shape` (structural
 *    token-kinds with identifiers/numbers/strings replaced by typed slot markers
 *    ID/NUM/STR — whitespace- and comment-insensitive, so formatting variance
 *    doesn't fragment patterns) plus the ordered slot bindings and a `template`
 *    (the original slice with slot spans hollowed out) that refills to the exact
 *    original bytes. The shape stream is what Stage 2 (LZW) mines.
 *
 * Exports: tokenize(fileName, source) -> { tokens, gaps, source }.
 *   token = { start, end, line, text, shape, slots:[{kind,text}], templateParts }
 *   gap   = { start, end, text }   (inter-token spans: whitespace + comment trivia)
 */

const ts = require("typescript");

const TRIVIA = new Set([
  ts.SyntaxKind.WhitespaceTrivia, ts.SyntaxKind.NewLineTrivia,
  ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia,
  ts.SyntaxKind.ShebangTrivia, ts.SyntaxKind.ConflictMarkerTrivia,
]);

/** Scan one source slice into { shape, slots, templateParts }. */
function normalizeSlice(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  const shapeParts = [];
  const slots = [];
  const templateParts = [];
  let tok;
  while ((tok = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    const tt = scanner.getTokenText();
    if (TRIVIA.has(tok)) { templateParts.push({ lit: tt }); continue; }
    let slotKind = null;
    if (tok === ts.SyntaxKind.Identifier) slotKind = "ID";
    else if (tok === ts.SyntaxKind.NumericLiteral || tok === ts.SyntaxKind.BigIntLiteral) slotKind = "NUM";
    else if (tok === ts.SyntaxKind.StringLiteral || tok === ts.SyntaxKind.NoSubstitutionTemplateLiteral) slotKind = "STR";
    else if (tok === ts.SyntaxKind.TemplateHead || tok === ts.SyntaxKind.TemplateMiddle || tok === ts.SyntaxKind.TemplateTail) slotKind = "STR";
    if (slotKind) {
      const i = slots.length;
      slots.push({ kind: slotKind, text: tt });
      shapeParts.push(slotKind);
      templateParts.push({ slot: i });
    } else {
      shapeParts.push(ts.SyntaxKind[tok]); // structural: keyword / punctuation
      templateParts.push({ lit: tt });
    }
  }
  return { shape: shapeParts.join(" "), slots, templateParts };
}

/** Refill a template with slot bindings -> exact original bytes. */
function fill(templateParts, slots) {
  return templateParts.map((p) => (p.lit !== undefined ? p.lit : slots[p.slot].text)).join("");
}

/** Blocks a node owns without crossing into a nested block (its direct body/bodies). */
function ownedBlocks(node, sf) {
  const blocks = [];
  (function rec(n, root) {
    if (!root && ts.isBlock(n)) { blocks.push(n); return; } // a body boundary — don't descend
    ts.forEachChild(n, (c) => rec(c, false));
  })(node, true);
  return blocks.sort((a, b) => a.getStart(sf) - b.getStart(sf));
}

function tokenize(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cuts = []; // [start,end) spans in source order

  function push(start, end) {
    if (end > start && source.slice(start, end).trim() !== "") cuts.push([start, end]);
  }
  function emit(node, depth) {
    const blocks = depth > 40 ? [] : ownedBlocks(node, sf);
    if (blocks.length === 0) { push(node.getStart(sf), node.getEnd()); return; }
    push(node.getStart(sf), blocks[0].getStart(sf) + 1); // head: `… {`
    for (let i = 0; i < blocks.length; i++) {
      for (const s of blocks[i].statements) emit(s, depth + 1);
      const nextStart = i + 1 < blocks.length ? blocks[i + 1].getStart(sf) + 1 : node.getEnd();
      push(blocks[i].getEnd() - 1, nextStart); // tail/connector: `} …`
    }
  }
  for (const s of sf.statements) emit(s, 0);
  cuts.sort((a, b) => a[0] - b[0]);

  const tokens = [];
  const gaps = [];
  let cursor = 0;
  for (const [start, end] of cuts) {
    if (start > cursor) gaps.push({ start: cursor, end: start, text: source.slice(cursor, start) });
    const text = source.slice(start, end);
    const norm = normalizeSlice(text);
    tokens.push({
      start, end, text,
      line: sf.getLineAndCharacterOfPosition(start).line + 1,
      shape: norm.shape, slots: norm.slots, templateParts: norm.templateParts,
    });
    cursor = end;
  }
  if (cursor < source.length) gaps.push({ start: cursor, end: source.length, text: source.slice(cursor) });
  return { tokens, gaps, source };
}

module.exports = { tokenize, normalizeSlice, fill, TRIVIA };
