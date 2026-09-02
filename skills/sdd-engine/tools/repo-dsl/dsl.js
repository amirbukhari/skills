#!/usr/bin/env node
"use strict";
/**
 * dsl — the readable SURFACE layer over the composition-tree IR.
 *
 * The JSON composition tree stays the internal IR; this adds a concrete,
 * declarative syntax that reads like a language (positional, a few keyword
 * markers) rather than a property bag. The grammar is NOT hand-authored — it is
 * DERIVED from the generator signatures in generators.js. Opaque leaf ids never
 * appear (leaves stay internal); the surface is the readable-name layer.
 *
 * Two deterministic surface transforms, both signature-driven:
 *
 *   (1) IMPORT DROPPING. Params flagged `derived` in a composite are module
 *       specifiers for a symbol named by another param. They are resolved from
 *       the mined import map (catalog/import-resolution.json) and DROPPED from
 *       the surface — but only when the stored value equals the mined canonical,
 *       so expansion is always byte-exact. When the stored specifier differs
 *       from canonical (a genuinely ambiguous symbol), the import is KEPT inline
 *       (`Type from '<module>'`) rather than guessed.
 *
 *   (2) POSITIONAL RENDERING. A composite renders as:
 *           <keyword> <exportName>
 *             <TypeA> -> <TypeB>
 *             billingType <CONST-suffix> via <fn>
 *       keyword   = composite name minus `make`/`CalculatorFn`, lower-initial.
 *       ` -> `    = join of the typeName params (in signature order).
 *       `billingType <x>` = an identifier param whose name ends `Const`; the
 *                    marker is the name minus `Const`, and the SCREAMING_SNAKE
 *                    of that marker is the constant's dropped prefix.
 *       `via <fn>`= an identifier param whose name ends `Fn` (the delegate).
 *
 * Guarantees (see verify-dsl.js): print(tree)->parse deep-equals tree,
 * parse->print is string-identity, and parse(dsl)->expand is byte-identical to
 * the tree's expansion. Prose / unknown markers / opaque ids are rejected.
 *
 * Usage:
 *   node dsl.js --grammar               # the auto-derived positional grammar
 *   node dsl.js --print <tree.json>     # IR -> DSL text
 *   node dsl.js --parse <file.calc>     # DSL text -> IR (prints JSON)
 */

const fs = require("fs");
const path = require("path");
const AC = require("./engine/artifact-contract");
const CR = require("./engine/corpus-root");
const { COMPOSITES } = require("./generators");

/* ------------------------- mined import resolution ------------------------ */

let _resolution = null;
function resolution() {
  if (_resolution) return _resolution;
  /* An absent import map used to degrade SILENTLY to {} — which does not read as "the artifact is
   * missing", it reads as "no symbol resolves anywhere in your corpus", and every import silently
   * loses its canonical module. That is the `catch { return null }` class CLAUDE.md §8 exists to
   * kill: `{ optional: true }` returns a REASON, never a bare null. Degrading is still the right
   * behaviour here — dsl.js must work on a corpus that has never been mined — but it says so. */
  const p = AC.pathFor("import-resolution");
  if (!fs.existsSync(p)) {
    console.error(`[import-resolution] absent at ${p} — every bare symbol will resolve to NO canonical`);
    console.error(`[import-resolution] module, so import canonicalization is OFF. Produce it: node resolve-imports.js`);
    return (_resolution = {});
  }
  _resolution = AC.load("import-resolution", p).symbols;
  return _resolution;
}
function canonicalModule(symbol) {
  const e = resolution()[symbol];
  return e && e.canonical ? e.canonical : null;
}

/* ----------------------- signature-derived classifier --------------------- */

const screaming = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

function keywordFor(compositeName) {
  let k = compositeName.replace(/^make/, "").replace(/CalculatorFn$/, "");
  return k.charAt(0).toLowerCase() + k.slice(1);
}

/** Classify a composite's params into surface roles, purely from the signature. */
function classify(compositeName) {
  const c = COMPOSITES[compositeName];
  if (!c) throw new Error(`unknown composite "${compositeName}"`);
  const derived = c.derived || {};
  const sourceToImport = {}; // symbol-param -> its derived module-specifier param
  for (const [imp, src] of Object.entries(derived)) sourceToImport[src] = imp;

  const roles = []; // in signature order, only the surface (non-derived) params
  for (const [name, kind] of Object.entries(c.params || {})) {
    if (name in derived) continue; // module specifiers are derived, never shown as fields
    let role;
    if (name === "exportName") role = { kind: "subject", name };
    else if (kind === "typeName") role = { kind: "type", name };
    else if (/Fn$/.test(name)) role = { kind: "via", name, marker: "via" };
    else if (/Const$/.test(name)) {
      const marker = name.replace(/Const$/, "");
      role = { kind: "const", name, marker, prefix: screaming(marker) + "_" };
    } else role = { kind: "field", name, marker: name };
    role.importParam = sourceToImport[name] || null; // the module spec to fold in
    roles.push(role);
  }
  return { name: compositeName, keyword: keywordFor(compositeName), roles, derived };
}

function grammar() {
  return Object.entries(COMPOSITES)
    .filter(([, c]) => !c.structural && !c.tier) // top-level surface forms only (mids are internal)
    .map(([name]) => classify(name));
}
function grammarByKeyword(kw) {
  const g = grammar().find((c) => c.keyword === kw);
  if (!g) throw new Error(`no surface form for keyword "${kw}"`);
  return g;
}

/* --------------------------------- render --------------------------------- */

/** For a surface role, does its derived import fold away (stored === canonical)? */
function importAnnotation(role, params) {
  if (!role.importParam) return null;
  const stored = params[role.importParam];
  const canon = canonicalModule(params[role.name]);
  return canon !== null && canon === stored ? null : ` from ${stored}`; // null => dropped
}

function printTree(tree) {
  if (!tree || !tree.composite) throw new Error("printTree expects a { composite, params } node");
  const g = classify(tree.composite);
  const p = tree.params || {};
  const subject = g.roles.find((r) => r.kind === "subject");
  if (!subject) throw new Error(`${tree.composite}: no exportName param to head the surface form`);

  const header = `${g.keyword} ${p[subject.name]}`;
  const lines = [header];

  const typeParts = g.roles.filter((r) => r.kind === "type").map((r) => {
    const ann = importAnnotation(r, p);
    return `${p[r.name]}${ann || ""}`;
  });
  if (typeParts.length) lines.push("  " + typeParts.join(" -> "));

  const marked = [];
  for (const r of g.roles) {
    if (r.kind === "const") {
      const v = p[r.name];
      if (!v.startsWith(r.prefix)) throw new Error(`${r.name} "${v}" lacks expected prefix ${r.prefix}`);
      marked.push(`${r.marker} ${v.slice(r.prefix.length)}${importAnnotation(r, p) || ""}`);
    } else if (r.kind === "via" || r.kind === "field") {
      marked.push(`${r.marker} ${p[r.name]}${importAnnotation(r, p) || ""}`);
    }
  }
  if (marked.length) lines.push("  " + marked.join(" "));

  return lines.join("\n") + "\n";
}

/* --------------------------------- parse ---------------------------------- */

const IDENT = /^[A-Za-z_$][\w$.]*$/;
const MODSPEC = /^(['"]).*\1$/;

/* The lexical surface, named ONCE and exported, so a consumer that publishes the grammar
 * (language.js -> `repo-dsl language --json`) quotes these exact regexes instead of spelling its
 * own copy. A second spelling of a token rule is a silent drift vector of precisely the §8B kind:
 * the published grammar would keep describing the parser this repo used to have. */
const LEXICAL = Object.freeze({
  identifier: IDENT,
  moduleSpecifier: MODSPEC,
  comment: "#",
  typeSeparator: "->",
  importKeyword: "from",
});

/** Pull an optional `from '<module>'` off the front of a token list -> {module, rest}. */
function takeFrom(tokens) {
  if (tokens[0] === "from") {
    const mod = tokens[1];
    if (!mod || !MODSPEC.test(mod)) throw new Error(`'from' must be followed by a quoted module (got ${JSON.stringify(mod)})`);
    return { module: mod, rest: tokens.slice(2) };
  }
  return { module: null, rest: tokens };
}

function parseText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) throw new Error("empty DSL");

  const head = lines[0].split(/\s+/);
  if (head.length !== 2) throw new Error(`expected "<keyword> <exportName>", got ${JSON.stringify(lines[0])}`);
  const [kw, subject] = head;
  if (!IDENT.test(subject)) throw new Error(`exportName must be a bareword (got ${JSON.stringify(subject)})`);
  const g = grammarByKeyword(kw);

  const params = {};
  const subjectRole = g.roles.find((r) => r.kind === "subject");
  params[subjectRole.name] = subject;

  const typeRoles = g.roles.filter((r) => r.kind === "type");
  const constRoles = g.roles.filter((r) => r.kind === "const");
  const otherMarked = g.roles.filter((r) => r.kind === "via" || r.kind === "field");
  const markerToRole = {};
  for (const r of [...constRoles, ...otherMarked]) markerToRole[r.marker] = r;

  // Classify the remaining lines by their first token: a known marker => the
  // marked line; otherwise the types line.
  for (const line of lines.slice(1)) {
    const first = line.split(/\s+/)[0];
    if (first in markerToRole) parseMarkedLine(line, markerToRole, params);
    else parseTypesLine(line, typeRoles, params);
  }

  // Fill every derived import: kept-inline ones were set above; the rest resolve
  // from the mined canonical (byte-identical to what the printer dropped).
  for (const [imp, src] of Object.entries(g.derived)) {
    if (imp in params) continue;
    const canon = canonicalModule(params[src]);
    if (canon === null) throw new Error(`cannot resolve module for "${params[src]}" — it must be kept inline`);
    params[imp] = canon;
  }

  // Completeness: every signature param present.
  const missing = Object.keys(COMPOSITES[g.name].params).filter((k) => !(k in params));
  if (missing.length) throw new Error(`${g.name}: missing ${missing.join(", ")}`);
  return { composite: g.name, params };
}

function parseTypesLine(line, typeRoles, params) {
  const parts = line.split("->").map((s) => s.trim());
  if (parts.length !== typeRoles.length)
    throw new Error(`expected ${typeRoles.length} type(s) on "${line}"`);
  parts.forEach((part, i) => {
    const toks = part.split(/\s+/);
    const typeName = toks[0];
    if (!IDENT.test(typeName)) throw new Error(`type must be a bareword (got ${JSON.stringify(typeName)})`);
    const role = typeRoles[i];
    params[role.name] = typeName;
    const { module, rest } = takeFrom(toks.slice(1));
    if (rest.length) throw new Error(`unexpected tokens after type: ${rest.join(" ")}`);
    if (module) {
      if (!role.importParam) throw new Error(`${role.name} has no import to override`);
      params[role.importParam] = module;
    }
  });
}

function parseMarkedLine(line, markerToRole, params) {
  let toks = line.split(/\s+/);
  while (toks.length) {
    const marker = toks.shift();
    const role = markerToRole[marker];
    if (!role) throw new Error(`unknown marker "${marker}"`);
    const value = toks.shift();
    if (value === undefined || !IDENT.test(value)) throw new Error(`marker "${marker}" needs a bareword value`);
    if (role.kind === "const") params[role.name] = role.prefix + value;
    else params[role.name] = value;
    const { module, rest } = takeFrom(toks);
    toks = rest;
    if (module) {
      if (!role.importParam) throw new Error(`${role.name} has no import to override`);
      params[role.importParam] = module;
    }
  }
}

/* --------------------------- grammar pretty ------------------------------- */

function renderGrammar() {
  const out = ["# Auto-derived DSL grammar (positional; from generator signatures)\n"];
  for (const c of grammar()) {
    const dropped = Object.keys(c.derived);
    out.push(`${c.name}  ->  keyword "${c.keyword}"`);
    const subject = c.roles.find((r) => r.kind === "subject");
    out.push(`  ${c.keyword} <${subject ? subject.name : "?"}>`);
    const types = c.roles.filter((r) => r.kind === "type");
    if (types.length) out.push(`    ${types.map((r) => `<${r.name}>`).join(" -> ")}`);
    const marked = c.roles.filter((r) => r.kind === "const" || r.kind === "via" || r.kind === "field");
    if (marked.length) out.push(`    ${marked.map((r) => `${r.marker} <${r.name}${r.prefix ? " minus " + r.prefix : ""}>`).join(" ")}`);
    out.push(`  derived (dropped when resolvable): ${dropped.join(", ") || "none"}\n`);
  }
  return out.join("\n");
}

function main() {
  const [mode, file] = process.argv.slice(2);
  if (mode === "--grammar") { process.stdout.write(renderGrammar()); return; }
  if (mode === "--print") { process.stdout.write(printTree(JSON.parse(fs.readFileSync(path.resolve(file), "utf8")))); return; }
  if (mode === "--parse") { process.stdout.write(JSON.stringify(parseText(fs.readFileSync(path.resolve(file), "utf8")), null, 2) + "\n"); return; }
  console.error("usage: dsl.js --grammar | --print <tree.json> | --parse <file.calc>");
  process.exit(1);
}

if (require.main === module) main();
module.exports = { grammar, classify, printTree, parseText, canonicalModule, renderGrammar, grammarByKeyword, LEXICAL };
