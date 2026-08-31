#!/usr/bin/env node
"use strict";
/**
 * expander — turns a COMPOSITION TREE (the LLM's output surface: readable
 * generator names + typed params) into real native code, by recursively
 * expanding composites into leaves and emitting each leaf's brick.
 *
 * Enforced invariants (this is what makes "no free-text hole" real):
 *   - Every leaf param is validated against its declared TYPE (identifier /
 *     typeName / moduleSpecifier / identifierList / enumChoice). A value that
 *     is not one of those — e.g. a sentence, a newline-bearing blob — is
 *     REJECTED. There is no param kind that accepts arbitrary code.
 *   - A composite may only return child nodes (leaves / composites / gap /
 *     indent). It cannot emit a raw string. So code can only come out of a leaf,
 *     and a leaf can only be fed typed params.
 *
 * Usage:
 *   node expander.js <composition.json>        # print expanded code
 *   node expander.js <composition.json> --out <file>
 *   (also exported as expand(tree) for programmatic use)
 */

const fs = require("fs");
const path = require("path");
const { LEAVES, COMPOSITES } = require("./generators");

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const TYPE_RE = /^[A-Za-z_$][\w$.]*$/; // identifier, optionally dotted (namespaced type)
const MODSPEC_RE = /^(['"])[^'"\n]{1,80}\1$/;

function validateParam(kind, value, ctx, leaf) {
  const fail = (msg) => { throw new Error(`param "${ctx}" ${msg} (got ${JSON.stringify(value)})`); };
  switch (kind) {
    case "identifier":
      if (typeof value !== "string" || !IDENT_RE.test(value)) fail("must be an identifier");
      break;
    case "typeName":
      if (typeof value !== "string" || !TYPE_RE.test(value)) fail("must be a type name");
      break;
    case "moduleSpecifier":
      if (typeof value !== "string" || !MODSPEC_RE.test(value)) fail("must be a quoted module specifier (no prose)");
      break;
    case "identifierList":
      if (!Array.isArray(value) || !value.length || !value.every((v) => typeof v === "string" && IDENT_RE.test(v))) fail("must be a non-empty list of identifiers");
      break;
    case "enumChoice":
      if (typeof value !== "string" || !leaf || !leaf.enum || !(value in leaf.enum)) fail(`must be one of the enumerated choices [${leaf && leaf.enum ? Object.keys(leaf.enum).join(", ") : ""}]`);
      break;
    default:
      fail(`has unknown param kind "${kind}" — no free-text kind exists`);
  }
}

function emitLeaf(node) {
  const leaf = LEAVES[node.leaf];
  if (!leaf) throw new Error(`unknown leaf generator: ${node.leaf}`);
  const spec = leaf.params || {};
  const params = node.params || {};
  for (const [name, kind] of Object.entries(spec)) {
    if (!(name in params)) throw new Error(`leaf ${node.leaf}: missing param "${name}"`);
    validateParam(kind, params[name], `${node.leaf}.${name}`, leaf);
  }
  const out = leaf.emit(params);
  if (typeof out !== "string") throw new Error(`leaf ${node.leaf} did not emit a string`);
  return out.split("\n");
}

/** Expand a node into an array of lines. */
function expandNode(node) {
  if (node == null) throw new Error("null node");
  if (node.gap != null) return Array(node.gap).fill("");
  if (node.indent != null) {
    const pad = "  ".repeat(node.indent);
    return expandChildren(node.children).map((l) => (l === "" ? "" : pad + l));
  }
  if (node.leaf) return emitLeaf(node);
  if (node.composite) {
    const comp = COMPOSITES[node.composite];
    if (!comp) throw new Error(`unknown composite generator: ${node.composite}`);
    const spec = comp.params || {};
    const params = node.params || {};
    for (const [name, kind] of Object.entries(spec)) {
      if (!(name in params)) throw new Error(`composite ${node.composite}: missing param "${name}"`);
      validateParam(kind, params[name], `${node.composite}.${name}`, null);
    }
    const children = comp.build(params);
    if (!Array.isArray(children)) throw new Error(`composite ${node.composite}.build must return child nodes`);
    return expandChildren(children);
  }
  throw new Error(`unrecognized node (no leaf/composite/gap/indent): ${JSON.stringify(node)}`);
}

function expandChildren(children) {
  const lines = [];
  for (const c of children) lines.push(...expandNode(c));
  return lines;
}

/** Expand a full composition tree into a code string (trailing newline). */
function expand(tree) {
  return expandChildren([tree]).join("\n") + "\n";
}

function main() {
  const args = process.argv.slice(2);
  let file = null, out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
    else if (!file) file = args[i];
  }
  if (!file) { console.error("usage: expander.js <composition.json> [--out file]"); process.exit(1); }
  const tree = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), "utf8"));
  const code = expand(tree);
  if (out) { fs.writeFileSync(path.resolve(process.cwd(), out), code); console.log(`expander: wrote ${out} (${code.split("\n").length - 1} lines)`); }
  else process.stdout.write(code);
}

if (require.main === module) main();
module.exports = { expand, expandNode, validateParam };
