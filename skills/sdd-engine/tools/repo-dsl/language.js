#!/usr/bin/env node
"use strict";
/**
 * language — publish the DSL's VOCABULARY and GRAMMAR as machine JSON.
 *
 * Until now the language existed only as code: the leaf/composite tables in
 * generators.js, the signature-derived role classifier in dsl.js, and a prose
 * pretty-printer (`dsl.js --grammar`) meant for a human reading a terminal.
 * A cross-repo consumer — the Kraken SDD panel's Syntax and Grammar tabs —
 * needs the same facts as data.
 *
 *   repo-dsl language <dir> --json
 *
 * THE ONE RULE THIS FILE IS BUILT AROUND: nothing here is hand-authored.
 *
 * Every name, param, kind, keyword, marker, tier and token rule is read live
 * from the real tables at call time — `LEAVES`/`COMPOSITES` from generators.js,
 * `DSL.grammar()`/`DSL.classify()` for the role classification, `DSL.LEXICAL`
 * for the token regexes, `tierOf` from explain.js for the tier rule. This file
 * contains no list of composites, no list of markers and no copy of a regex.
 *
 * That is not tidiness, it is the whole correctness argument. A published
 * grammar that is hand-maintained describes the parser the repo used to have,
 * and it fails SILENTLY — the JSON stays well-formed and well-shaped while
 * saying something untrue, which is the `catch { return null }` class CLAUDE.md
 * §8 exists to kill. Because every fact is derived, adding a composite to
 * generators.js changes this output with no edit here; and language.test.js
 * asserts the output against those same live tables, so a hand-written list
 * added later fails the suite instead of quietly going stale.
 *
 * Corpus-dependence, stated rather than blurred: the vocabulary and grammar are
 * properties of the ENGINE and do not vary by corpus. Only `resolution` — the
 * mined import map that decides whether a derived import folds away — is a fact
 * about the directory named on the command line. The two are separate top-level
 * blocks for that reason, and `corpusIndependent` says so in the output.
 */

const fs = require("fs");
const AC = require("./engine/artifact-contract");
const DSL = require("./dsl");
const { tierOf } = require("./explain");
const { LEAVES, COMPOSITES } = require("./generators");

/* A regex is not JSON. Publish the SOURCE and the flags, so a consumer can rebuild the exact
 * matcher, rather than a stringified object that silently becomes "{}". */
const rx = (r) => ({ source: r.source, flags: r.flags });

/* What a word is BUILT OF, obtained by running its own `build` with placeholder params — never by
 * reading its source or restating its body here. Placeholders make the shape visible without
 * pretending to be real arguments. */
function emitsOf(name, def) {
  const probe = {};
  for (const p of Object.keys(def.params || {})) probe[p] = `<${p}>`;
  let built;
  try { built = def.build(probe); }
  catch (e) {
    /* Loud and specific. A word whose composition cannot be read is a real finding about the
     * library, not a blank to fill with null: a bare null here would publish "this word is made of
     * nothing", which reads as a fact and is not one. */
    return { readable: false, why: `build() threw on placeholder params: ${e.message}`, leaves: [], composites: [], gaps: 0, indents: 0 };
  }
  const leaves = [], composites = [];
  let gaps = 0, indents = 0;
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n == null) continue;
      if (n.gap != null) { gaps++; continue; }
      if (n.indent != null) { indents++; walk(n.children); continue; }
      if (n.leaf) { leaves.push(n.leaf); continue; }
      if (n.composite) { composites.push(n.composite); continue; }
    }
  };
  walk(built);
  return { readable: true, why: null, leaves, composites, gaps, indents };
}

/* ------------------------------- vocabulary ------------------------------- */

function primitives() {
  return Object.keys(LEAVES).sort().map((id) => {
    const d = LEAVES[id];
    const params = d.params || {};
    return {
      id,
      patternId: d.patternId === undefined ? null : d.patternId,
      label: d.label || null,
      tier: tierOf(d, "leaf"),
      structural: !!d.structural,
      trivia: !!d.trivia,
      params,
      paramOrder: Object.keys(params),   // signature order IS the surface order; a JSON object
      arity: Object.keys(params).length, // preserves it, but say it explicitly for consumers that
    };                                   // reorder keys.
  });
}

function words() {
  return Object.keys(COMPOSITES).sort().map((name) => {
    const d = COMPOSITES[name];
    const params = d.params || {};
    const derived = d.derived || {};
    return {
      name,
      patternId: d.patternId === undefined ? null : d.patternId,
      label: d.label || null,
      tier: tierOf(d, "composite"),
      structural: !!d.structural,
      params,
      paramOrder: Object.keys(params),
      arity: Object.keys(params).length,
      /* `derived` maps a module-specifier param -> the param naming the symbol it imports. These
       * are the params the surface DROPS when the mined canonical agrees with the stored value. */
      derived,
      derivedParams: Object.keys(derived).sort(),
      /* Does this word get a surface form? The filter is dsl.js grammar()'s, restated as a
       * property of the word rather than left implicit in a list membership. */
      surface: !d.structural && !d.tier,
      emits: emitsOf(name, d),
    };
  });
}

/* --------------------------------- grammar -------------------------------- */

/* One surface form, rendered from the LIVE classifier. `DSL.classify` decides every role; this
 * only reshapes what it returns into the form/marker view a syntax highlighter wants. */
function formOf(c) {
  const subject = c.roles.find((r) => r.kind === "subject") || null;
  const types = c.roles.filter((r) => r.kind === "type");
  const marked = c.roles.filter((r) => r.kind === "const" || r.kind === "via" || r.kind === "field");
  const role = (r) => ({
    kind: r.kind, param: r.name,
    marker: r.marker === undefined ? null : r.marker,
    /* A `const` role's value is stored with a SCREAMING_SNAKE prefix that the surface strips and
     * the parser re-adds. Publishing it lets a consumer show the stored value from the written one
     * without knowing the rule. */
    droppedPrefix: r.prefix === undefined ? null : r.prefix,
    importParam: r.importParam === undefined ? null : r.importParam,
  });
  return {
    composite: c.name,
    keyword: c.keyword,
    subject: subject ? role(subject) : null,
    types: types.map(role),
    markers: marked.map(role),
    roles: c.roles.map(role),               // full signature order, nothing filtered out
    derived: c.derived,
    droppedWhenResolvable: Object.keys(c.derived).sort(),
    /* The line shapes, as a template rather than as prose. Positions are what the parser keys on:
     * line 0 is the header, a line whose first token is a known marker is the marked line, and any
     * other line is the types line. */
    lines: [
      { position: "header", required: true, template: `${c.keyword} <${subject ? subject.name : "?"}>` },
      ...(types.length ? [{ position: "types", required: true, template: types.map((r) => `<${r.name}>`).join(" -> ") }] : []),
      ...(marked.length ? [{ position: "marked", required: true, template: marked.map((r) => `${r.marker} <${r.name}${r.prefix ? " minus " + r.prefix : ""}>`).join(" ") }] : []),
    ],
  };
}

function grammar() {
  const forms = DSL.grammar().map(formOf);
  /* marker -> which keywords accept it. The parser resolves a marked line by first token, so this
   * index is exactly what a highlighter needs, and it is built from the forms, not listed. */
  const markerIndex = {};
  for (const f of forms) {
    for (const m of f.markers) {
      if (!m.marker) continue;
      (markerIndex[m.marker] = markerIndex[m.marker] || []).push(f.keyword);
    }
  }
  for (const k of Object.keys(markerIndex)) markerIndex[k] = [...new Set(markerIndex[k])].sort();

  const L = DSL.LEXICAL;
  return {
    forms,
    keywords: forms.map((f) => f.keyword).sort(),
    markers: Object.keys(markerIndex).sort(),
    markerIndex,
    lexical: {
      identifier: rx(L.identifier),
      moduleSpecifier: rx(L.moduleSpecifier),
      comment: L.comment,
      typeSeparator: L.typeSeparator,
      importKeyword: L.importKeyword,
      /* Stated because the parser trims every line: indentation in the surface is presentation,
       * never structure. A consumer that treats it as significant would be wrong about the language. */
      indentationSignificant: false,
    },
    /* The two surface transforms this grammar is defined by (dsl.js header). Named so a consumer
     * can explain a dropped import rather than showing a param that is not there. */
    transforms: [
      { name: "import-dropping",
        what: "a param flagged `derived` is a module specifier for a symbol named by another param; it is dropped from the surface when the stored value equals the mined canonical, and kept inline as `from '<module>'` when it differs",
        reversible: "on parse, a dropped import is re-derived from the mined import map, so expansion is byte-exact" },
      { name: "positional-rendering",
        what: "a word renders as `<keyword> <exportName>`, then the typeName params joined by ` -> `, then the marked params; roles come from the signature, never from a hand-written table",
        reversible: "print(tree) -> parse deep-equals tree, and parse -> print is string-identity (verify-dsl.js)" },
    ],
  };
}

/* ------------------------------- resolution ------------------------------- */

/* The ONE corpus-dependent block. Reported as state with its path, never as a silent {}: an absent
 * import map does not mean "no symbol resolves", it means the map has not been mined, and those two
 * read identically to a consumer that is only handed a count. */
function resolutionState(corpusDir) {
  const p = AC.pathFor("import-resolution", corpusDir);
  if (!fs.existsSync(p)) {
    return {
      present: false, path: p, symbols: null,
      why: "not mined — import canonicalization is OFF, so every derived import stays inline rather than folding away",
      fix: "node resolve-imports.js",
    };
  }
  let doc;
  try { doc = AC.load("import-resolution", p); }
  catch (e) {
    return { present: true, path: p, symbols: null, why: `present but REFUSED by the artifact contract: ${e.message.split("\n")[0]}`, fix: "re-mine it" };
  }
  const syms = doc.symbols || {};
  const names = Object.keys(syms);
  return {
    present: true, path: p, why: null, fix: null,
    symbols: names.length,
    canonical: names.filter((n) => syms[n] && syms[n].canonical).length,
  };
}

/* --------------------------------- build ---------------------------------- */

/** The stamped, publishable language document for one corpus dir. */
function buildLanguage(corpusDir, opts = {}) {
  const prims = primitives();
  const wds = words();
  const gram = grammar();
  const body = {
    /* Says out loud which half of this document depends on the dir above. */
    corpusIndependent: ["vocabulary", "grammar"],
    vocabulary: {
      note: "read live from generators.js at publish time; this file hand-authors no part of it",
      primitives: prims,
      words: wds,
    },
    grammar: gram,
    resolution: resolutionState(corpusDir),
    counts: {
      primitives: prims.length,
      structuralPrimitives: prims.filter((p) => p.structural).length,
      triviaPrimitives: prims.filter((p) => p.trivia).length,
      words: wds.length,
      surfaceWords: wds.filter((w) => w.surface).length,
      midWords: wds.filter((w) => w.tier === "mid").length,
      forms: gram.forms.length,
      keywords: gram.keywords.length,
      markers: gram.markers.length,
    },
  };
  return AC.stamp("language", body, { corpus: corpusDir, generated: opts.generated });
}

/* ------------------------------ human render ------------------------------ */

function renderHuman(doc) {
  const out = [];
  const c = doc.counts;
  out.push(`DSL language — ${c.primitives} primitives, ${c.words} words (${c.surfaceWords} with a surface form), ${c.forms} grammar forms`);
  out.push(`schema ${doc.schema}  fingerprint ${doc.fingerprint}`);
  out.push("");
  out.push("VOCABULARY — words (composites)");
  for (const w of doc.vocabulary.words) {
    out.push(`  ${w.name}  [${w.tier}]${w.surface ? "" : "  (internal — no surface form)"}`);
    if (w.label) out.push(`    ${w.label}`);
    out.push(`    params: ${w.paramOrder.map((p) => `${p}:${w.params[p]}`).join(", ") || "none"}`);
    if (w.derivedParams.length) out.push(`    derived (dropped when resolvable): ${w.derivedParams.join(", ")}`);
    out.push(`    emits: ${w.emits.readable ? `${w.emits.leaves.length} leaf slot(s)${w.emits.composites.length ? `, composites ${w.emits.composites.join(", ")}` : ""}` : `UNREADABLE — ${w.emits.why}`}`);
  }
  out.push("");
  out.push("VOCABULARY — primitives (leaves)");
  for (const p of doc.vocabulary.primitives) {
    out.push(`  ${p.id}  [${p.tier}]  ${p.label || ""}`);
    out.push(`    params: ${p.paramOrder.map((n) => `${n}:${p.params[n]}`).join(", ") || "none"}`);
  }
  out.push("");
  out.push("GRAMMAR — surface forms");
  for (const f of doc.grammar.forms) {
    out.push(`  ${f.composite}  ->  keyword "${f.keyword}"`);
    for (const l of f.lines) out.push(`    ${l.position === "header" ? "" : "  "}${l.template}`);
    out.push(`    derived (dropped when resolvable): ${f.droppedWhenResolvable.join(", ") || "none"}`);
  }
  out.push("");
  out.push(`GRAMMAR — lexical: identifier /${doc.grammar.lexical.identifier.source}/  moduleSpecifier /${doc.grammar.lexical.moduleSpecifier.source}/`);
  out.push(`  comment "${doc.grammar.lexical.comment}"  typeSeparator "${doc.grammar.lexical.typeSeparator}"  importKeyword "${doc.grammar.lexical.importKeyword}"  indentation ${doc.grammar.lexical.indentationSignificant ? "SIGNIFICANT" : "insignificant"}`);
  out.push(`  markers: ${doc.grammar.markers.map((m) => `${m} (${doc.grammar.markerIndex[m].join(", ")})`).join("  ") || "none"}`);
  out.push("");
  const r = doc.resolution;
  out.push(`RESOLUTION (corpus-dependent) — ${r.present ? `present, ${r.symbols} symbols, ${r.canonical} canonical` : `ABSENT: ${r.why}`}`);
  if (r.fix) out.push(`  fix: ${r.fix}`);
  return out.join("\n") + "\n";
}

module.exports = { buildLanguage, renderHuman, primitives, words, grammar, resolutionState, emitsOf };
