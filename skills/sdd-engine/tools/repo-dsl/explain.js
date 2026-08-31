#!/usr/bin/env node
"use strict";
/**
 * explain — walk a COMPOSITION TREE into the GENERATOR TREE it actually invokes.
 *
 * Where the expander turns a composition into code, this turns it into the
 * *shape of generators* underneath it: the readable composites and, beneath
 * them, the opaque leaf IDs — each annotated with its typed param SIGNATURE (the
 * declared kinds) and the concrete ARGS bound at this call site — in nesting
 * order (large composite -> mid composite -> leaf). This is what the Kraken
 * panel's "Generators" section renders: only the generators THIS composition
 * uses, with the full library one click away.
 *
 * Structural scaffolding (blank-line `gap`s and `indent` wrappers) is elided so
 * the tree is purely the generator vocabulary; indentation is transparent (its
 * children are hoisted to the enclosing generator).
 *
 * Output is stable, documented machine JSON (see README) — Kraken parses it:
 *
 *   {
 *     schema, module, composite,
 *     tree:  <node>,                       // nested generators, large -> leaf
 *     generators: {                        // flat de-duplicated inventory
 *       composites: [{ name, tier, label, signature }],
 *       leaves:     [{ id,   tier, label, signature }]
 *     },
 *     counts: { composites, leaves, leafInstances, maxDepth }
 *   }
 *
 * where <node> is
 *   { kind:"composite", name, tier, label, signature:{param:kind}, args:{param:val}, children:[<node>] }
 *   { kind:"leaf",      id,   tier, label, signature:{param:kind}, args:{param:val} }
 */

const fs = require("fs");
const path = require("path");
const { LEAVES, COMPOSITES } = require("./generators");

function tierOf(def, fallback) {
  if (def && def.tier) return def.tier;
  if (def && def.structural) return "structural";
  if (def && def.trivia) return "trivia";
  return fallback;
}

/** Expand one composition node into generator-tree node(s), eliding gap/indent. */
function walk(node, depth, stats) {
  if (node == null) return [];
  if (node.gap != null) return [];               // whitespace, not a generator
  if (node.indent != null) {                     // transparent: hoist children
    const out = [];
    for (const c of node.children || []) out.push(...walk(c, depth, stats));
    return out;
  }
  if (node.leaf) {
    const def = LEAVES[node.leaf];
    if (!def) throw new Error(`unknown leaf generator: ${node.leaf}`);
    stats.leafInstances++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    stats.leaves.set(node.leaf, { id: node.leaf, tier: tierOf(def, "leaf"), label: def.label || null, signature: def.params || {} });
    return [{
      kind: "leaf", id: node.leaf, tier: tierOf(def, "leaf"), label: def.label || null,
      signature: def.params || {}, args: node.params || {},
    }];
  }
  if (node.composite) {
    const def = COMPOSITES[node.composite];
    if (!def) throw new Error(`unknown composite generator: ${node.composite}`);
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    stats.composites.set(node.composite, { name: node.composite, tier: tierOf(def, "composite"), label: def.label || null, signature: def.params || {} });
    const built = def.build(node.params || {});
    const children = [];
    for (const c of built) children.push(...walk(c, depth + 1, stats));
    return [{
      kind: "composite", name: node.composite, tier: tierOf(def, "composite"), label: def.label || null,
      signature: def.params || {}, args: node.params || {}, children,
    }];
  }
  throw new Error(`unrecognized node (no leaf/composite/gap/indent): ${JSON.stringify(node)}`);
}

/** Build the machine-JSON generator tree for a composition tree. */
function explainTree(tree) {
  if (!tree || !tree.composite) throw new Error("explain expects a { composite, params } root node");
  const stats = { composites: new Map(), leaves: new Map(), leafInstances: 0, maxDepth: 0 };
  const roots = walk(tree, 0, stats);
  if (roots.length !== 1) throw new Error("composition root did not expand to a single generator");
  return {
    schema: "sdd-repo-dsl/explain/1",
    module: tree.params && tree.params.exportName ? tree.params.exportName : null,
    composite: tree.composite,
    tree: roots[0],
    generators: {
      composites: [...stats.composites.values()],
      leaves: [...stats.leaves.values()],
    },
    counts: {
      composites: stats.composites.size,
      leaves: stats.leaves.size,
      leafInstances: stats.leafInstances,
      maxDepth: stats.maxDepth,
    },
  };
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: explain.js <file.calc|composition.json>"); process.exit(1); }
  let tree;
  if (file.endsWith(".json")) tree = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  else tree = require("./dsl").parseText(fs.readFileSync(path.resolve(file), "utf8"));
  process.stdout.write(JSON.stringify(explainTree(tree), null, 2) + "\n");
}

if (require.main === module) main();
module.exports = { explainTree };
