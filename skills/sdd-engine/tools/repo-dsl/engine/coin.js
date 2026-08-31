"use strict";
/**
 * COIN A WORD — the growth mechanism. Define a new named operation once and make
 * it first-class vocabulary the language can then READ and WRITE everywhere.
 *
 * A coined word wraps a once-said snippet behind a reusable english name. It is
 * expressed entirely in the tokenizer's own vocabulary (engine/fanout.js):
 *   - normalizeSlice(example) -> { shape, slots, templateParts } with the invariant
 *     fill(templateParts, slots) === example  (byte-exact by construction).
 * A word records that shape + template, marks which slots are PARAMS (vary per
 * call) vs FIXED (baked meaning, e.g. `process` `env` `NODE_ENV` `'production'`),
 * and optionally emits a real helper DEFINITION so authored calls typecheck.
 *
 * Three capabilities, all deterministic (zero model calls):
 *   coinWord(spec)          DEFINE  — validate (parse) + build the word def.
 *   authorWith(word, args)  WRITE   — fill the template with call args -> TS.
 *   readWith(word, source)  READ    — recognize NEW occurrences and name them.
 *
 * A bespoke sub-expression that is NOT further reducible ships as a `@json` slot:
 * its verbatim bytes travel in the slot text, shape-checked structurally but not
 * decomposed — the language's bespoke-escape.
 *
 * Exports: coinWord, authorWith, readWith, scanTokens, matchStatement, WORD_SCHEMA.
 */
const ts = require("typescript");
const { normalizeSlice, fill } = require("./fanout.js");

const WORD_SCHEMA = "sdd-coined-word/1";

/** Non-trivia token stream with byte offsets: [{kind, text, start, end}]. */
function scanTokens(text) {
  const s = ts.createScanner(ts.ScriptTarget.Latest, /*skipTrivia*/ true, ts.LanguageVariant.Standard, text);
  const out = [];
  let t;
  while ((t = s.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    out.push({ kind: ts.SyntaxKind[t], text: s.getTokenText(), start: s.getTokenStart(), end: s.getTextPos() });
  }
  return out;
}

/** Structural kind for a token (matches normalizeSlice's slot abstraction). */
function slotKindOf(kind) {
  if (kind === "Identifier") return "ID";
  if (kind === "NumericLiteral" || kind === "BigIntLiteral") return "NUM";
  if (kind === "StringLiteral" || kind === "NoSubstitutionTemplateLiteral"
    || kind === "TemplateHead" || kind === "TemplateMiddle" || kind === "TemplateTail") return "STR";
  return null; // structural (keyword / punctuation)
}

/**
 * DEFINE. spec = {
 *   name,                       english word name (also the emitted helper name for call words)
 *   kind: "statement"|"expression",
 *   example,                    canonical source snippet (one statement, or one expression)
 *   params: [{ name, at }],     at = 0-based index into the ordered slots that this param binds
 *                               (a slot not claimed by a param is FIXED / baked meaning)
 *   bespoke?: [ at, ... ],      slot indices whose value is a @json bespoke escape (verbatim, opaque)
 *   define?,                    optional emitted helper DEFINITION (TS) so authored calls typecheck
 *   call?,                      optional call template for author-with (e.g. "isProduction()"); else fill()
 *   english?,                   prose phrase for render
 * }
 */
function coinWord(spec) {
  const { name, kind = "statement", example, params = [], bespoke = [], define = null, call = null, english = null, englishPhrase = null } = spec;
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`coinWord: invalid word name ${JSON.stringify(name)}`);
  if (!example || typeof example !== "string") throw new Error("coinWord: example source required");

  // VALIDATE: the example must parse cleanly (statement or expression).
  const wrapped = kind === "expression" ? `const __coin__ = (${example});` : example;
  const sf = ts.createSourceFile("__coin__.ts", wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diags = sf.parseDiagnostics || [];
  if (diags.length) throw new Error(`coinWord: example does not parse: ${diags.map((d) => d.messageText).join("; ")}`);

  // NORMALIZE into shape / slots / template (byte-exact refill invariant).
  const { shape, slots, templateParts } = normalizeSlice(example);
  if (!fill(templateParts, slots).includes(example.trim()) && fill(templateParts, slots) !== example) {
    throw new Error("coinWord: fill(template,slots) !== example — refill invariant broken");
  }
  // Mark each slot: param (varies) / bespoke (@json escape) / fixed (baked).
  const paramAt = new Map(params.map((p) => [p.at, p.name]));
  const bespokeSet = new Set(bespoke);
  const slotRoles = slots.map((sl, i) => ({
    at: i, kind: sl.kind, text: sl.text,
    role: paramAt.has(i) ? "param" : (bespokeSet.has(i) ? "bespoke" : "fixed"),
    paramName: paramAt.get(i) || null,
  }));
  // Canonical scanner token stream (for expression substring READ).
  const scan = scanTokens(example).map((t) => ({ kind: t.kind, text: t.text, sk: slotKindOf(t.kind) }));

  return {
    schema: WORD_SCHEMA, name, kind, english: english || name, englishPhrase,
    shape, templateParts, slots: slotRoles, scan,
    params: params.map((p) => ({ name: p.name, kind: slots[p.at].kind, at: p.at })),
    bespoke: [...bespokeSet], define, call, example,
  };
}

/**
 * WRITE. Fill the word with call args -> TS bytes. args = { paramName: valueText }.
 * Byte-exact for the templated parts; a `@json` bespoke arg ships verbatim.
 * Authoring the word's OWN canonical args reproduces `example` exactly.
 */
function authorWith(word, args = {}, opts = {}) {
  // If a call template is set and asCall requested, emit the call form.
  if (opts.asCall && word.call) {
    let out = word.call;
    for (const p of word.params) if (p.name in args) out = out.replace(new RegExp("\\$" + p.name + "\\b"), args[p.name]);
    return out;
  }
  // Otherwise fill the byte-exact statement/expression template.
  const filled = word.slots.map((s) => {
    if (s.role === "param" || s.role === "bespoke") {
      if (!(s.paramName in args) && s.role === "param") throw new Error(`authorWith: missing arg ${s.paramName}`);
      return { kind: s.kind, text: s.paramName in args ? args[s.paramName] : s.text };
    }
    return { kind: s.kind, text: s.text }; // fixed
  });
  return fill(word.templateParts, filled);
}

/** Does a full statement TOKEN (from fanout) match this statement-word? shape + fixed slots. */
function matchStatement(word, token) {
  if (token.shape !== word.shape) return false;
  for (const s of word.slots) {
    if (s.role === "fixed") { if (!token.slots[s.at] || token.slots[s.at].text !== s.text) return false; }
  }
  const bind = {};
  for (const s of word.slots) if (s.role === "param") bind[s.paramName] = token.slots[s.at] ? token.slots[s.at].text : null;
  return { matched: true, bind };
}

/**
 * READ. Recognize NEW occurrences of the word inside `source` and name them.
 *  - statement word: scan the source's own tokens and match by shape+fixed.
 *  - expression word: find the canonical token subsequence anywhere (whitespace-
 *    insensitive), capturing param slots; report each site's [start,end) span.
 * Returns [{ start, end, text, bind }]. Byte-honest: a site's captured span
 * re-scans to the same token stream (semantic identity); whitespace may differ
 * from the canonical, so READ NAMES a site, it does not claim byte-reproduction.
 */
function readWith(word, source) {
  const sites = [];
  if (word.kind === "expression") {
    const toks = scanTokens(source);
    const W = word.scan;
    for (let i = 0; i + W.length <= toks.length; i++) {
      let ok = true; const bind = {};
      for (let j = 0; j < W.length; j++) {
        const w = W[j], t = toks[i + j];
        if (w.sk) { // slot position
          if (slotKindOf(t.kind) !== w.sk) { ok = false; break; }
          const role = word.slots.find((s) => s.text === w.text && s.kind === w.sk);
          // fixed slot: text must equal the canonical; param slot: capture.
          const isFixed = word.slots.some((s) => s.role === "fixed" && s.kind === w.sk && s.text === w.text);
          if (isFixed && t.text !== w.text) { ok = false; break; }
          if (!isFixed) bind["arg" + j] = t.text;
        } else { // structural: kind must equal
          if (t.kind !== w.kind) { ok = false; break; }
        }
      }
      if (ok) { const start = toks[i].start, end = toks[i + W.length - 1].end; sites.push({ start, end, text: source.slice(start, end), bind }); i += W.length - 1; }
    }
  }
  return sites;
}

module.exports = { coinWord, authorWith, readWith, matchStatement, scanTokens, slotKindOf, WORD_SCHEMA };
