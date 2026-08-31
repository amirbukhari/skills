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

// Primitive TYPE keywords — kept literal by default; lifted to a TYPE slot only
// when lift.type is on (so `x: number` and `y: string` share a shape).
const PRIM_TYPE_KEYWORDS = new Set([
  ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.VoidKeyword, ts.SyntaxKind.UnknownKeyword,
  ts.SyntaxKind.NeverKeyword, ts.SyntaxKind.ObjectKeyword, ts.SyntaxKind.SymbolKeyword,
  ts.SyntaxKind.BigIntKeyword, ts.SyntaxKind.UndefinedKeyword,
]);
const NO_LIFT = { bool: false, type: false, nullc: false };

/**
 * Scan one source slice into { shape, slots, templateParts }.
 *
 * `lift` controls how aggressively CONSTANT/TYPE token classes are abstracted
 * into typed slots (identifiers/numbers/strings are ALWAYS slotted; keywords,
 * punctuation and control flow are ALWAYS kept literal). Lifting only ever moves
 * a token from a baked literal to a slot whose `text` still refills the exact
 * original bytes, so byte-identity is preserved regardless of the lift level.
 *   lift.bool  — true/false        -> BOOL slot
 *   lift.type  — number/string/…   -> TYPE slot   (primitive type keywords)
 *   lift.nullc — null/undefined    -> NULLC slot
 */
function normalizeSlice(text, lift = NO_LIFT) {
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
    else if (lift.bool && (tok === ts.SyntaxKind.TrueKeyword || tok === ts.SyntaxKind.FalseKeyword)) slotKind = "BOOL";
    else if (lift.nullc && (tok === ts.SyntaxKind.NullKeyword || tok === ts.SyntaxKind.UndefinedKeyword)) slotKind = "NULLC";
    else if (lift.type && PRIM_TYPE_KEYWORDS.has(tok)) slotKind = "TYPE";
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

/**
 * FINER CUT — subdivide a leaf statement into expression / sub-tree spans, down
 * to `maxDepth` levels of AST-child descent. The child spans plus the connector
 * spans between them (operators, dots, parens, keywords like `return`) tile the
 * node exactly, so byte-identity is preserved by construction. Whitespace-only
 * connectors are not pushed (they become gaps, as before); code punctuation
 * becomes its own small structural token.
 *   maxDepth 0 => the whole statement stays one token (current behaviour).
 */
function cutExpr(node, sf, source, depth, maxDepth, push) {
  const kids = [];
  ts.forEachChild(node, (c) => kids.push(c));
  kids.sort((a, b) => a.getStart(sf) - b.getStart(sf));
  if (depth >= maxDepth || kids.length === 0) { push(node.getStart(sf), node.getEnd()); return; }
  let cursor = node.getStart(sf);
  for (const c of kids) {
    const cs = c.getStart(sf);
    if (cs > cursor) push(cursor, cs);      // connector before this child
    cutExpr(c, sf, source, depth + 1, maxDepth, push);
    cursor = c.getEnd();
  }
  if (node.getEnd() > cursor) push(cursor, node.getEnd()); // trailing connector (e.g. `;`)
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

function tokenize(fileName, source, lift = NO_LIFT, cutDepth = 0) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cuts = []; // [start,end) spans in source order

  function push(start, end) {
    if (end > start && source.slice(start, end).trim() !== "") cuts.push([start, end]);
  }
  // A leaf statement (no owned block): one token by default, or subdivided into
  // expression/sub-tree spans when cutDepth > 0 (the finer-granularity knob).
  function pushLeaf(node) {
    if (cutDepth > 0) cutExpr(node, sf, source, 0, cutDepth, push);
    else push(node.getStart(sf), node.getEnd());
  }
  function emit(node, depth) {
    const blocks = depth > 40 ? [] : ownedBlocks(node, sf);
    if (blocks.length === 0) { pushLeaf(node); return; }
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
    const norm = normalizeSlice(text, lift);
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

module.exports = { tokenize, normalizeSlice, fill, TRIVIA, NO_LIFT, PRIM_TYPE_KEYWORDS };
