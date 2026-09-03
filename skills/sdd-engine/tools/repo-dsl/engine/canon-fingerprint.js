"use strict";
/**
 * canon-fingerprint.js — WHAT CANON WAS THIS CATALOG MINED UNDER?
 *
 * THE FAILURE THIS EXISTS FOR, which bit three times on 2026-09-02/03 and was invisible every time.
 * A dictionary is a map from SKELETON to word. The renderer computes a skeleton from source and
 * looks it up. Those two skeletons are produced by the same code — so when that code changes, every
 * catalog mined before the change silently stops matching, and NOTHING says so:
 *
 *   - byte-identity still reads 1037/1037, because a missed lookup falls through to the verbatim
 *     path, which is correct by construction. The floor we assert first cannot see this.
 *   - mtime staleness edges (preflight's STALE) cannot see it either. They catch "artifact B was
 *     rebuilt before artifact A it derives from". Here NO artifact moved — the CODE moved under an
 *     artifact whose mtime is honestly unchanged. It is not stale with respect to any file.
 *   - the only symptom is review surface, which is not asserted on the default path. SDD_BODY_SLOT
 *     shipped default-on in 2d83452 and the corpus has read 3,527/23,935 against a 1,582/20,999
 *     baseline ever since, with every other check green.
 *
 * WHY THE FINGERPRINT IS BEHAVIOURAL AND NOT A HASH OF THE SOURCE FILES. Hashing generators.js and
 * operations.js would fire on every comment edit and every refactor that changes nothing — a guard
 * that cries wolf gets turned off, and §10.3 asks for guards that fire for real reasons. So this
 * asks the canon what it DOES: it canonicalizes a fixed set of probe statements and hashes the
 * resulting skeletons. Two builds agree iff they would key the dictionary identically, which is the
 * only property that matters. Reformat freely; change what `if (x) { ... }` canonicalizes to and
 * this number moves.
 *
 * THE PROBES ARE FROZEN, and adding one is a breaking change to every catalog on disk, because the
 * fingerprint is taken over the whole set. Add a probe only alongside a re-mine, in a commit that
 * says so. They are chosen to span the hole taxonomy (§5C) rather than to be realistic code: each
 * one pins a canonicalization decision that has actually moved, or could.
 */
const crypto = require("crypto");
const ts = require("typescript");

/* One probe per canonicalization decision worth pinning. ORDER IS PART OF THE FINGERPRINT. */
const PROBES = [
  "const a = 1;",                                     // literal -> num hole
  "const s = 'x';",                                   // string literal -> str hole
  "export const r = b(c);",                           // callee: skeleton or slot? (SDD_EXPR_SLOT)
  "export const r = a(b(c));",                        // nested call: is the inner call opaque?
  "export const v = a.b;",                            // property name: skeleton or slot?
  "export const v = a.b.c.d;",                        // member chain depth
  "if (x > 0) { return x + 1; }",                     // nested body: baked or slot? (SDD_BODY_SLOT)
  "if (!ok) { throw new Error('no'); }",              // negation, and throw in a body
  "for (const x of xs) { f(x); }",                    // ForOf body
  "while (i < n) { i++; }",                           // While body
  "try { f(); } catch (e) { g(e); }",                 // two blocks under one statement
  "return await g();",                                // await in return position
  "const f = (x) => x + 1;",                          // arrow: one hole or expanded?
  "xs.map((x) => f(x));",                             // callback as an argument
  "function h(a: number, b: string): void { i(a); }", // signature, typed params, body
  "class K { m(): void { n(); } }",                   // class member body
  "import { a, b } from 'm';",                        // import shape
  "export default k;",                                // export shape
  "const o = { a: 1, b: 'two' };",                    // object literal -> obj hole
  "const l = [1, 2, 3];",                             // array literal -> arr hole
];

/* The skeleton of one statement at every level the dictionary keys on. A probe the canon cannot
 * handle is recorded AS TEXT rather than thrown: that is itself a canon fact, and a fingerprint
 * that throws would make the guard unavailable exactly when the canon is broken. */
function skeletonsOf(src) {
  const G = require("./generators");
  const sf = ts.createSourceFile("p.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const st = sf.statements[0];
  if (!st) return ["(no statement)"];
  const levels = [
    ["exact", () => G.stmtPartsExact(st, sf)],
    ["narrow", () => G.generalStmtParts(st, sf, false)],
    ["wide", () => G.generalStmtParts(st, sf, true)],
  ];
  const out = [];
  for (const [level, fn] of levels) {
    let k;
    try { const p = fn(); k = p ? G.keyOf(p) : "(none)"; }
    catch (e) { k = "(threw: " + e.message + ")"; }
    out.push(level + "=" + k);
  }
  return out;
}

/** fingerprint() -> 16 hex chars identifying the canon this process mines and renders with. */
function fingerprint() {
  const h = crypto.createHash("sha256");
  for (const p of PROBES) {
    h.update(p, "utf8");
    h.update("");
    h.update(skeletonsOf(p).join(""), "utf8");
    h.update("");
  }
  return h.digest("hex").slice(0, 16);
}

/** describe() -> the probe table, so two canons can be DIFFED rather than just compared. */
function describe() {
  return PROBES.map((p) => ({ probe: p, skeletons: skeletonsOf(p) }));
}

module.exports = { PROBES, fingerprint, describe };
