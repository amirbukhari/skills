#!/usr/bin/env node
"use strict";
/**
 * dsl — the readable SURFACE layer over the composition-tree IR.
 *
 * The JSON composition tree stays the internal IR; this adds a concrete,
 * declarative syntax the LLM emits and a human reviews. The grammar is NOT
 * hand-authored — it is DERIVED from the generator signatures in generators.js:
 * every composite already has a readable name + a typed param signature, and the
 * surface forms are generated from those. Opaque leaf ids never appear in the
 * surface (leaves stay internal); the surface is the readable-name layer.
 *
 * Value rendering is driven by each param's declared KIND:
 *   identifier / typeName / enumChoice -> bareword
 *   moduleSpecifier                    -> the quoted string, verbatim
 *   identifierList                     -> [a, b, c]
 *
 * Guarantees (see verify-dsl.js): print(tree) -> parse -> deep-equals tree, and
 * parse(dsl) -> expand produces the same native code as the tree.
 *
 * Usage:
 *   node dsl.js --grammar               # print the auto-derived grammar
 *   node dsl.js --print <tree.json>     # IR -> DSL text
 *   node dsl.js --parse <file.calc>     # DSL text -> IR (prints JSON)
 */

const fs = require("fs");
const path = require("path");
const { COMPOSITES } = require("./generators");

/** Derive the surface grammar from the composite signatures (not hand-written). */
function deriveGrammar() {
  const composites = Object.entries(COMPOSITES)
    .filter(([, c]) => !c.structural) // structural containers aren't a surface form
    .map(([name, c]) => ({
      name,
      patternId: c.patternId || null,
      tier: c.tier || "large",
      label: c.label || "",
      fields: Object.entries(c.params || {}).map(([field, kind]) => ({ field, kind })),
    }));
  return { composites };
}

function grammarFor(name) {
  const g = deriveGrammar().composites.find((c) => c.name === name);
  if (!g) throw new Error(`no surface form for "${name}" (not a non-structural composite)`);
  return g;
}

/* ------------------------------- render ----------------------------------- */

function renderValue(kind, val) {
  switch (kind) {
    case "moduleSpecifier": return String(val); // already quoted in the IR
    case "identifierList": return `[${val.join(", ")}]`;
    case "identifier":
    case "typeName":
    case "enumChoice": return String(val);
    default: throw new Error(`cannot render param kind "${kind}"`);
  }
}

/** IR composition tree -> DSL text. */
function printTree(tree) {
  if (!tree || !tree.composite) throw new Error("printTree expects a { composite, params } node");
  const g = grammarFor(tree.composite);
  const params = tree.params || {};
  const lines = [`${tree.composite} {`];
  for (const { field, kind } of g.fields) {
    if (!(field in params)) throw new Error(`tree missing param "${field}" for ${tree.composite}`);
    lines.push(`  ${field} = ${renderValue(kind, params[field])}`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

/* -------------------------------- parse ----------------------------------- */

function parseValue(kind, raw, field) {
  const s = raw.trim();
  const fail = (m) => { throw new Error(`param "${field}" ${m} (got ${JSON.stringify(s)})`); };
  switch (kind) {
    case "moduleSpecifier":
      if (!/^(['"]).*\1$/.test(s)) fail("must be a quoted module specifier");
      return s; // keep quotes verbatim
    case "identifierList": {
      const m = /^\[(.*)\]$/.exec(s);
      if (!m) fail("must be a [ ... ] list");
      return m[1].split(",").map((x) => x.trim()).filter((x) => x.length);
    }
    case "identifier":
    case "typeName":
    case "enumChoice":
      if (!/^[A-Za-z_$][\w$.]*$/.test(s)) fail("must be a bareword");
      return s;
    default:
      fail(`has unknown kind "${kind}"`);
  }
}

/** DSL text -> IR composition tree. */
function parseText(text) {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*\{([\s\S]*)\}\s*$/.exec(text.trim());
  if (!m) throw new Error("expected: <CompositeName> { field = value ... }");
  const name = m[1];
  const g = grammarFor(name); // grammar-driven: validates the name is a real composite
  const kindByField = Object.fromEntries(g.fields.map((f) => [f.field, f.kind]));
  const params = {};
  for (const rawLine of m[2].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue; // allow comments/blank lines
    const fm = /^([A-Za-z_$][\w$]*)\s*=\s*(.+?)\s*$/.exec(line);
    if (!fm) throw new Error(`cannot parse field line: ${line}`);
    const [, field, raw] = fm;
    if (!(field in kindByField)) throw new Error(`unknown field "${field}" for ${name}`);
    params[field] = parseValue(kindByField[field], raw, field);
  }
  const missing = g.fields.map((f) => f.field).filter((f) => !(f in params));
  if (missing.length) throw new Error(`${name}: missing fields ${missing.join(", ")}`);
  return { composite: name, params };
}

/* --------------------------- grammar pretty ------------------------------- */

function renderGrammar() {
  const g = deriveGrammar();
  const out = ["# Auto-derived DSL grammar (from generator signatures)\n"];
  for (const c of g.composites) {
    out.push(`${c.name}  [${c.tier}${c.patternId ? " · mined " + c.patternId : ""}]  — ${c.label}`);
    out.push(`  ${c.name} {`);
    for (const f of c.fields) out.push(`    ${f.field} = <${f.kind}>`);
    out.push(`  }\n`);
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
module.exports = { deriveGrammar, printTree, parseText };
