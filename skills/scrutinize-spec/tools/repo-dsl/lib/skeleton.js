"use strict";
/**
 * Structural skeletonizer over the TypeScript AST.
 *
 * A *skeleton* is a canonical string describing a node's SHAPE with every
 * identifier and literal abstracted into a typed slot (ID / TYPE / STR / NUM /
 * BOOL). Two nodes share a skeleton iff they are structurally identical up to
 * the names/values in those slots — which is exactly the equivalence the miner
 * groups by, and the set of typed params a generator for that shape needs.
 *
 * We also collect the concrete slot VALUES in source order, so a caller can see
 * what actually varies between two instances of the same skeleton (the leaf
 * params) and confirm they are all small + typed (never free prose).
 */

const ts = require("typescript");
const crypto = require("crypto");

function parse(fileName, source) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);
}

/** Classify a leaf token into a typed slot, or return null if it is structural. */
function slotFor(node) {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return { kind: "ID", text: node.getText() };
  if (ts.isStringLiteralLike(node)) return { kind: "STR", text: node.getText() };
  if (ts.isNumericLiteral(node)) return { kind: "NUM", text: node.getText() };
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "BOOL", text: node.getText() };
  }
  return null;
}

/**
 * Produce { skeleton, slots, nodeCount } for a node.
 * skeleton: canonical shape string. slots: ordered [{kind,text}]. nodeCount: size.
 */
function skeletonize(node) {
  const slots = [];
  let nodeCount = 0;

  function walk(n) {
    nodeCount++;
    const slot = slotFor(n);
    if (slot) {
      slots.push(slot);
      return slot.kind; // typed hole, not the concrete name/value
    }
    const kindName = ts.SyntaxKind[n.kind];
    const children = [];
    ts.forEachChild(n, (c) => { children.push(walk(c)); });
    // Keep structural keyword/punctuation kinds (they have no forEachChild children).
    return children.length ? `${kindName}(${children.join(" ")})` : kindName;
  }

  const skeleton = walk(node);
  return { skeleton, slots, nodeCount };
}

function idFor(skeleton) {
  return "p_" + crypto.createHash("sha256").update(skeleton).digest("hex").slice(0, 8);
}

/** Are every slot value small + typed (identifier / type / number / bool / short string)? */
function slotsAreTyped(slots) {
  return slots.every((s) => {
    if (s.kind === "ID" || s.kind === "NUM" || s.kind === "BOOL") return true;
    if (s.kind === "STR") return s.text.length <= 64 && !/\n/.test(s.text); // short string literal, not prose
    return false;
  });
}

module.exports = { ts, parse, skeletonize, idFor, slotFor, slotsAreTyped };
