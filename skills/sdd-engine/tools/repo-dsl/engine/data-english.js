"use strict";
/**
 * data-english.js — STEP 6: a DATA-AS-ENGLISH rendering layer for the LEAF expressions
 * that the call-graph analysis leaves as raw TypeScript (object literals 19.8%, ${}
 * templates 8.8%, array literals 6.2% of production statements). It renders the STRUCTURE
 * of a data leaf as English while keeping every atom verbatim inside a `backtick` escape,
 * so it is fully invertible and BYTE-EXACT:  compileData(renderData(node)) === source.
 *
 * Forms (each byte-exact gated; engages only on canonically-spaced source, bails otherwise):
 *   { a: x, b: y }        -> an object with a = `x`, b = `y`
 *   {}                    -> an empty object
 *   [x, y, z]             -> a list of `x`, `y`, `z`
 *   []                    -> an empty list
 *   `Total: ${n} USD`     -> text: “Total: ⟨n⟩ USD”      (⟨⟩ marks an interpolation)
 * Values recurse: a value that is itself an object/array/template renders in English
 * (parenthesised when nested); every other value stays a minimal `backtick` escape. The
 * escapes are what keep it honest — arithmetic / arrows / one-off calls are NOT dressed up
 * as English, they read verbatim. Deterministic; zero model calls.
 *
 * The delimiters ` “ ” ⟨ ⟩ and the field/element separators are structural; a source atom
 * that itself contains one of them is OUT OF DOMAIN and the whole leaf bails to null (the
 * caller then keeps the raw TS). Exports: renderData, compileData, dataByteExact.
 */
const ts = require("typescript");

const OPENS = { "(": ")", "[": "]", "{": "}" };
const CLOSES = { ")": "(", "]": "[", "}": "{" };
/** split on a separator OUTSIDE quotes/backticks, the “…” template region, and () [] {} nesting */
function splitTop(s, sep) {
  const out = []; let depth = 0, q = null, tmpl = false, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (tmpl) { cur += c; if (c === "”") tmpl = false; continue; }
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; cur += c; continue; }
    if (c === "“") { tmpl = true; cur += c; continue; }
    if (OPENS[c]) { depth++; cur += c; continue; }
    if (CLOSES[c]) { depth--; cur += c; continue; }
    if (depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ""; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur); return out;
}
const balanced = (s) => { let d = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === "(") d++; else if (c === ")") { d--; if (d === 0 && i < s.length - 1) return false; if (d < 0) return false; } } return d === 0; };

const SAFE = /[`“”⟨⟩]/; // structural delimiters an atom must not contain
const atom = (text) => SAFE.test(text) ? null : "`" + text + "`";

/* ============================ RENDER (TS -> English) ============================ */
function renderData(node, sf) {
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isTemplateExpression(node)
    || ts.isCallExpression(node)) return renderVal(node, sf, false);
  return null; // not a structural data leaf — caller handles atoms
}
function renderVal(node, sf, nested) {
  if (ts.isObjectLiteralExpression(node)) { const s = renderObject(node, sf); return s == null ? null : (nested ? "(" + s + ")" : s); }
  if (ts.isArrayLiteralExpression(node)) { const s = renderArray(node, sf); return s == null ? null : (nested ? "(" + s + ")" : s); }
  if (ts.isCallExpression(node)) { const s = renderCall(node, sf); return s == null ? null : (nested ? "(" + s + ")" : s); }
  if (ts.isTemplateExpression(node)) return renderTemplate(node, sf); // “…” self-delimits
  if (ts.isSpreadElement(node)) { const inner = atom(node.expression.getText(sf)); return inner == null ? null : "spread " + inner; }
  return atom(node.getText(sf));
}
/* LAYOUT IS CONTENT, and that is a measured correction rather than a preference. This module's
 * header said it "engages only on canonically-spaced source, bails otherwise" -- and the bail was
 * costing 6,170 of 18,044 data leaves, carrying 30,890 braces, which is 64% of every brace left on
 * the reading surface. Measured 2026-09-03 against the-goal.test.js: those nodes fail the byte-exact
 * gate NOT because their content cannot be said in English, but because the English was re-emitted
 * on one canonical line and the source was written across several. Only 365 nodes lose real content
 * (comments, which this form genuinely cannot carry).
 *
 * So the separators are taken FROM THE SOURCE instead of being invented: the bytes between `{` and
 * the first field, between each pair of fields (the comma and whatever whitespace follows it), and
 * between the last field and `}` (which is where a trailing comma lives). The English then mirrors
 * the shape of the thing it describes, and compileData reassembles the original bytes exactly.
 *
 * WHY THIS CANNOT BREAK BYTE-IDENTITY, structurally rather than by care: every caller reaches this
 * through `dataByteExact`, which renders, compiles back, and compares against the source text. A
 * node whose round-trip fails is simply not made into a span and stays verbatim exactly as it is
 * today. The worst case of a bug here is NO IMPROVEMENT, never a wrong byte. */
function gapText(sf, from, to) {
  const t = sf.getFullText().slice(from, to);
  /* a gap must be punctuation and whitespace only -- a comment in the gap is real content this form
   * cannot carry, and it bails rather than silently dropping it (365 nodes, measured). */
  return /^[\s,]*$/.test(t) ? t : null;
}
function joinWithSourceGaps(node, sf, items, nodes, eatOneSpace, span) {
  /* `span` overrides the delimiter positions. An object's or list's brackets ARE its first and last
   * bytes, so the default holds; a CALL's parens are not -- they sit after the callee -- and
   * assuming otherwise would slice the callee into the first gap and fail the byte-exact gate. */
  const open = span ? span.open : node.getStart(sf) + 1, close = span ? span.close : node.getEnd() - 1;
  let lead = gapText(sf, open, nodes[0].getStart(sf));
  /* `an object with ` already ends in a space, so a canonical `{ a: 1 }` would otherwise render
   * with two. The English keeps its own word boundary and the SOURCE's single space is folded into
   * it; `reassemble` puts it back by the mirror-image rule. Anything other than one plain space --
   * a newline and indent, say -- is layout and is carried through untouched. */
  if (eatOneSpace && lead === " ") lead = "";
  const tail = gapText(sf, nodes[nodes.length - 1].getEnd(), close);
  if (lead == null || tail == null) return null;
  let out = lead + items[0];
  for (let i = 1; i < items.length; i++) {
    const g = gapText(sf, nodes[i - 1].getEnd(), nodes[i].getStart(sf));
    if (g == null) return null;
    out += g + items[i];
  }
  return out + tail;
}
function renderObject(node, sf) {
  if (node.properties.length === 0) return "an empty object";
  const parts = [];
  for (const p of node.properties) {
    if (ts.isPropertyAssignment(p)) {
      const key = p.name.getText(sf); const val = renderVal(p.initializer, sf, true);
      if (val == null || SAFE.test(key)) return null;
      parts.push(`${key} = ${val}`);
    } else if (ts.isShorthandPropertyAssignment(p)) {
      const key = p.name.getText(sf); if (SAFE.test(key) || p.objectAssignmentInitializer) return null; parts.push(key);
    } else if (ts.isSpreadAssignment(p)) {
      const inner = atom(p.expression.getText(sf)); if (inner == null) return null; parts.push("spread " + inner);
    } else return null; // method / accessor -> out of domain
  }
  const body = joinWithSourceGaps(node, sf, parts, [...node.properties], true);
  return body == null ? null : "an object with " + body;
}
function renderArray(node, sf) {
  if (node.elements.length === 0) return "an empty list";
  const vals = [];
  for (const e of node.elements) { if (ts.isOmittedExpression(e)) return null; const v = renderVal(e, sf, true); if (v == null) return null; vals.push(v); }
  const body = joinWithSourceGaps(node, sf, vals, [...node.elements], false);
  return body == null ? null : "a list of " + body;
}
/* A CALL IS A LIST WITH A NAME IN FRONT OF IT, which is why this is nine lines and not ninety: the
 * argument list is joined by exactly the same source-gap discipline as an array literal, so layout,
 * trailing commas and multi-line calls all round-trip for the same reason they do there.
 *
 * THE HEAD IS CARRIED LITERALLY, NOT PARSED. Everything from the start of the node to the open paren
 * -- the callee, a `?.`, any type arguments -- is one atom. That is deliberate: it means an optional
 * call, a generic call and a dotted callee need no cases of their own, and a head this form cannot
 * express (one containing a backtick or a dialect delimiter) is refused by `atom` rather than
 * mangled. `node.arguments.pos` is the byte after the open paren, which is the only reliable way to
 * find it -- searching for "(" would find one inside the callee of `f()()`. */
function renderCall(node, sf) {
  const openParen = node.arguments.pos - 1;
  const head = atom(sf.getFullText().slice(node.getStart(sf), openParen));
  if (head == null) return null;
  if (node.arguments.length === 0) {
    /* No arguments means no items to hang the gap on, so the gap has nowhere to live. An empty gap
     * is expressible and anything else -- `f(  )`, a comment between the parens -- is refused. */
    return sf.getFullText().slice(openParen + 1, node.getEnd() - 1) === "" ? "call " + head + " with no arguments" : null;
  }
  const vals = [];
  for (const a of node.arguments) { const v = renderVal(a, sf, true); if (v == null) return null; vals.push(v); }
  const body = joinWithSourceGaps(node, sf, vals, [...node.arguments], false,
    { open: openParen + 1, close: node.getEnd() - 1 });
  return body == null ? null : "call " + head + " with " + body;
}
function renderTemplate(node, sf) {
  const strip = (t, lead, tail) => t.slice(lead, t.length - tail);
  const lit0 = strip(node.head.getText(sf), 1, 2); // `…${  ->  …
  let body = lit0, ok = !SAFE.test(lit0);
  for (const span of node.templateSpans) {
    const exprText = span.expression.getText(sf);
    const litT = span.literal; const isTail = litT.kind === ts.SyntaxKind.TemplateTail;
    const chunk = strip(litT.getText(sf), 1, isTail ? 1 : 2); // }…`  or  }…${
    if (SAFE.test(exprText) || SAFE.test(chunk)) ok = false;
    body += "⟨" + exprText + "⟩" + chunk;
  }
  return ok ? "text: “" + body + "”" : null;
}

/* ============================ COMPILE (English -> TS) ============================ */
/* DO NOT TRIM HERE. The trailing gap of an object or list -- the bytes between its last field and
 * its closing brace, which is exactly where a trailing comma and its newline live -- is part of the
 * node's own text, so trimming it silently truncated every multi-line literal. That single .trim()
 * was one of the two reasons 6,170 data leaves failed the byte-exact gate; found by unit-testing
 * the round trip on ten shapes rather than by reading this function, which looks obviously correct. */
function compileData(text) { return parseVal(text); }
function parseVal(s) {
  const t = s.trim();                       /* for MATCHING only -- never for slicing a body */
  if (t[0] === "(" && t[t.length - 1] === ")" && balanced(t)) return parseVal(t.slice(1, -1));
  if (t === "an empty object") return "{}";
  if (t === "an empty list") return "[]";
  if (t[0] === "`" && t[t.length - 1] === "`") return t.slice(1, -1);
  if (t.startsWith("spread `") && t.endsWith("`")) return "..." + t.slice("spread `".length, -1);
  s = s.replace(/^\s+/, "");               /* left-trim only: the RIGHT side carries the layout */
  if (s.startsWith("an object with ")) {
    return "{" + reassemble(s.slice("an object with ".length), parseField, true) + "}";
  }
  /* The mirror of renderCall. The head is delimited by backticks and `atom` guarantees it contains
   * none, so this match is exact rather than a longest-wins guess. "with " consumes exactly one
   * space -- the word boundary the English owns -- and every remaining byte is the source's own
   * layout, which is why the capture is NOT trimmed. */
  {
    const m = /^call `([^`]*)` with ([\s\S]*)$/.exec(s);
    if (m !== null) {
      const head = m[1], body = m[2];
      if (body === "no arguments") return head + "()";
      return head + "(" + reassemble(body, (c) => parseVal(c), false) + ")";
    }
  }
  if (s.startsWith("a list of ")) {
    return "[" + reassemble(s.slice("a list of ".length), (c) => parseVal(c), false) + "]";
  }
  if (t.startsWith("text: “") && t.endsWith("”")) {
    const inner = t.slice("text: “".length, -1);
    return "`" + inner.replace(/⟨([^⟨⟩]*)⟩/g, (_, e) => "${" + e + "}") + "`";
  }
  throw new Error("data-english: cannot parse value: " + t);
}
/* THE INVERSE OF joinWithSourceGaps. The gaps are carried in the English itself, so this splits on
 * top-level commas and puts back whatever whitespace surrounded each one, rather than imposing a
 * canonical ", ". An EMPTY core is not an error: it is a TRAILING COMMA, whose whitespace is the
 * only thing left after the final separator, and dropping it was one of the two reasons 6,170 nodes
 * failed the byte-exact gate. */
function reassemble(body, parseCore, restoreOneSpace) {
  const pieces = splitTop(body, ",");
  const out = [];
  for (let i = 0; i < pieces.length; i++) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(pieces[i]);
    let lead = m[1]; const core = m[2], trail = m[3];
    /* the mirror of joinWithSourceGaps's eatOneSpace, and only ever on the FIRST field */
    if (restoreOneSpace && i === 0 && lead === "") lead = " ";
    out.push(core === "" ? lead : lead + parseCore(core) + trail);
  }
  return out.join(",");
}
function parseField(f) {
  f = f.trim();
  if (f.startsWith("spread `") && f.endsWith("`")) return "..." + f.slice("spread `".length, -1);
  const kv = splitTop(f, " = ");
  if (kv.length >= 2) { const key = kv[0].trim(); const val = kv.slice(1).join(" = ").trim(); return `${key}: ${parseVal(val)}`; }
  return f; // shorthand property
}

/** the byte-exact gate: does the English form reconstruct the exact source bytes? */
function dataByteExact(node, sf) {
  try { const eng = renderData(node, sf); return eng != null && compileData(eng) === node.getText(sf); } catch (_) { return false; }
}

module.exports = { renderData, compileData, dataByteExact, splitTop };
