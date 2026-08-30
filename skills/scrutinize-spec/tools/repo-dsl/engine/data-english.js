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
  if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isTemplateExpression(node)) return renderVal(node, sf, false);
  return null; // not a structural data leaf — caller handles atoms
}
function renderVal(node, sf, nested) {
  if (ts.isObjectLiteralExpression(node)) { const s = renderObject(node, sf); return s == null ? null : (nested ? "(" + s + ")" : s); }
  if (ts.isArrayLiteralExpression(node)) { const s = renderArray(node, sf); return s == null ? null : (nested ? "(" + s + ")" : s); }
  if (ts.isTemplateExpression(node)) return renderTemplate(node, sf); // “…” self-delimits
  if (ts.isSpreadElement(node)) { const inner = atom(node.expression.getText(sf)); return inner == null ? null : "spread " + inner; }
  return atom(node.getText(sf));
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
  return "an object with " + parts.join(", ");
}
function renderArray(node, sf) {
  if (node.elements.length === 0) return "an empty list";
  const vals = [];
  for (const e of node.elements) { if (ts.isOmittedExpression(e)) return null; const v = renderVal(e, sf, true); if (v == null) return null; vals.push(v); }
  return "a list of " + vals.join(", ");
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
function compileData(text) { return parseVal(text.trim()); }
function parseVal(s) {
  s = s.trim();
  if (s[0] === "(" && s[s.length - 1] === ")" && balanced(s)) return parseVal(s.slice(1, -1));
  if (s === "an empty object") return "{}";
  if (s === "an empty list") return "[]";
  if (s[0] === "`" && s[s.length - 1] === "`") return s.slice(1, -1);
  if (s.startsWith("spread `") && s.endsWith("`")) return "..." + s.slice("spread `".length, -1);
  if (s.startsWith("an object with ")) {
    const fields = splitTop(s.slice("an object with ".length), ", ").map(parseField);
    return "{ " + fields.join(", ") + " }";
  }
  if (s.startsWith("a list of ")) {
    const els = splitTop(s.slice("a list of ".length), ", ").map((e) => parseVal(e.trim()));
    return "[" + els.join(", ") + "]";
  }
  if (s.startsWith("text: “") && s.endsWith("”")) {
    const inner = s.slice("text: “".length, -1);
    return "`" + inner.replace(/⟨([^⟨⟩]*)⟩/g, (_, e) => "${" + e + "}") + "`";
  }
  throw new Error("data-english: cannot parse value: " + s);
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
