"use strict";
/* GUARD: the DSL surface layer is LOSSLESS — the three guarantees named in dsl.js's header.
 *
 *   1. print(tree) -> parse  deep-equals the original tree      (IR round-trip)
 *   2. parse -> print        is string-identical                (surface round-trip)
 *   3. expand(tree) === expand(parse(print(tree)))              (code round-trip, byte-exact)
 *
 * WHY THIS FILE EXISTS, and why it does not use a fixture.
 *
 * These guarantees had a guard — `verify-dsl.js` — and it was DEAD, dying at load on a missing
 * `compositions/*.json`. Its inputs were tracked once (f7ba5f3, ade30c3) and are gitignored today
 * (root `.gitignore:10` and `:22`). Its producer, `build-compositions.js`, sits in `archive/`.
 *
 * THE FIXTURE IS NOT AN OPTION THAT EXISTS. It was not lost to tooling. `801d704`,
 * "security: scrub all Hydra-derived material from the skills repo" (2026-08-30), deleted
 * `catalog/`, `results/`, `compositions/` and `surface/` from the index AND the working tree — 85
 * pure deletions — on Amir's explicit word: "the skills repo should hold no copies." That commit
 * rewrote `.gitignore` as a guard so re-mined output could not be committed back, and this repo has
 * a PUBLIC remote (see `../.gitignore:7`). Measured: `git ls-tree -r 801d704^` holds 3 composition
 * fixtures, `801d704` holds 0. The skill extraction (e95ca17, 2026-08-31 12:46) came thirteen hours
 * later, so `git mv` semantics never entered into it.
 *
 * Read that carefully before "fixing" this: restoring the fixture is not a matter of tracking it
 * properly this time. It would re-add Hydra-derived bytes to a public repo against a standing
 * instruction. The guarantee is worth keeping; the fixture is forbidden as the way to keep it.
 *
 * This file therefore builds its own trees IN MEMORY from the live grammar. It hardcodes no
 * composite, no keyword and no param: for every surface form `dsl.grammar()` reports, it synthesises
 * a legal value per role from that role's own kind. A composite added to generators.js is covered
 * here the day it is added, with no edit — and a form that stops round-tripping fails immediately.
 *
 * No corpus prerequisite: the import map is optional to every path exercised here (see R1).
 */
const assert = require("assert");
const DSL = require("../dsl");
const { expand } = require("../expander");
const { COMPOSITES } = require("../generators");

const sortKeys = (o) => Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {});

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

/**
 * A legal composition tree for one surface form, built from its roles.
 *
 * Values are chosen to satisfy the parser's own lexical rules (dsl.LEXICAL): barewords for
 * identifiers and types, a quoted specifier for a module. A `const` role's value MUST carry the
 * SCREAMING_SNAKE prefix the printer strips and the parser re-adds — that prefix is read off the
 * role rather than assumed, so a change to the const convention shows up here as a failure.
 */
function treeFor(form) {
  const params = {};
  for (const r of form.roles) {
    if (r.kind === "subject") params[r.param] = "someExportedThing";
    else if (r.kind === "type") params[r.param] = `Type${cap(r.param)}`;
    else if (r.kind === "const") params[r.param] = r.droppedPrefix + "SOMEVALUE";
    else params[r.param] = `some${cap(r.param)}`;
  }
  /* The derived module specifiers. These are the params the surface DROPS when the mined canonical
   * agrees, and KEEPS inline as `from '<module>'` when it does not. Either way the round-trip must
   * hold, which is the point of exercising them at all. */
  for (const imp of Object.keys(form.derived)) params[imp] = `'./${imp}'`;
  return { composite: form.composite, params };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* Built through language.js's published view so the roles carry `droppedPrefix` — the same live
 * classification dsl.js uses, reshaped, not a second reading of it. */
const FORMS = require("../language").grammar().forms;

assert.ok(FORMS.length > 0, "no surface forms — the grammar is empty, so this file would assert nothing");

/* ================================================================= the three guarantees */

ok("1. print -> parse deep-equals the original tree, for EVERY surface form", () => {
  for (const form of FORMS) {
    const tree = treeFor(form);
    const back = DSL.parseText(DSL.printTree(tree));
    assert.strictEqual(back.composite, tree.composite, `${form.keyword}: parsed to a different composite`);
    /* Key order is not semantic; shape and values are. */
    assert.deepStrictEqual(sortKeys(back.params), sortKeys(tree.params),
      `${form.keyword}: the surface lost or altered a param on the way back to the IR`);
  }
});

ok("2. parse -> print is string-identical, for EVERY surface form", () => {
  /* The other direction. (1) can hold while the printer emits a different-but-equivalent text each
   * time, which would make the surface unstable for anything diffing or reviewing it. */
  for (const form of FORMS) {
    const printed = DSL.printTree(treeFor(form));
    const reprinted = DSL.printTree(DSL.parseText(printed));
    assert.strictEqual(reprinted, printed, `${form.keyword}: printing a parsed tree produced different text`);
  }
});

ok("3. the expansion is BYTE-identical through the surface, for EVERY surface form", () => {
  /* The one that matters most: whatever the surface does to a tree, the CODE it expands to must not
   * move by a single byte. This is the property that lets the DSL be a review surface rather than a
   * lossy summary of one. */
  for (const form of FORMS) {
    const tree = treeFor(form);
    const viaSurface = DSL.parseText(DSL.printTree(tree));
    assert.strictEqual(expand(viaSurface), expand(tree),
      `${form.keyword}: expanding through the surface produced different bytes than expanding the tree`);
  }
});

/* ===================================================================== what must be REJECTED */

ok("prose is rejected, not silently accepted as a keyword", () => {
  assert.throws(() => DSL.parseText("this is a sentence about billing\n"),
    /expected "<keyword> <exportName>"|no surface form/,
    "a line of prose must not parse — the surface is a language, not a comment field");
});

ok("an unknown keyword names itself in the error", () => {
  assert.throws(() => DSL.parseText("notARealKeyword someName\n"), (e) => {
    assert.match(e.message, /notARealKeyword/, "the error must quote the keyword it could not resolve");
    return true;
  });
});

ok("an unknown MARKER is rejected rather than dropped", () => {
  /* Silently ignoring an unrecognised marker would lose a param and expand to different code — a
   * lossy parse that looks successful, which is the whole class this layer exists to avoid.
   *
   * THE SECOND MARKER, NOT THE FIRST, AND THE REASON IS THE POINT. parseText routes a line by its
   * FIRST token: a known marker sends it to parseMarkedLine, anything else to parseTypesLine.
   * Corrupting the first marker therefore never reaches the unknown-marker branch at all — the line
   * is read as a types line and dies with "expected N type(s)".
   *
   * Mutation-tested 2026-09-01 and this file FAILED that test: with parseMarkedLine changed to skip
   * unknown markers silently, the assertion still passed, because it corrupted the first marker and
   * accepted the types-line error via a loose `|expected \d+ type` alternative. Green for the wrong
   * reason is worse than red. The regex is now exact, and the corruption targets the second marker
   * so the line still routes into parseMarkedLine and the intended branch actually runs. */
  const form = FORMS.find((f) => f.markers.length > 1);
  if (!form) { console.log("      (no form carries two markers — the branch is unreachable from here)"); return; }
  const second = form.markers[1].marker;
  const printed = DSL.printTree(treeFor(form));
  const text = printed.replace(new RegExp(`\\b${second}\\b`), "notAMarker");
  assert.notStrictEqual(text, printed, "the corruption did not apply — the assertion would prove nothing");
  assert.throws(() => DSL.parseText(text), /unknown marker "notAMarker"/,
    "an unrecognised marker must be refused BY NAME, from the marked-line parser");
});

ok("an opaque leaf id is not a surface form", () => {
  /* Leaves stay internal (dsl.js header): the surface is the readable-name layer. A p_ id reaching
   * the parser means the internal IR has leaked into the human surface. */
  const leafish = Object.keys(COMPOSITES).length ? "p_2c6b9735 someName\n" : null;
  if (leafish) assert.throws(() => DSL.parseText(leafish), /no surface form/, "an opaque leaf id must not parse");
});

ok("a const value missing its required prefix is refused, not silently emitted", () => {
  const form = FORMS.find((f) => f.markers.some((m) => m.kind === "const"));
  if (!form) { console.log("      (no const role in the grammar — nothing to check)"); return; }
  const role = form.markers.find((m) => m.kind === "const");
  const tree = treeFor(form);
  tree.params[role.param] = "NOT_THE_EXPECTED_PREFIX_value";
  assert.throws(() => DSL.printTree(tree), /lacks expected prefix/,
    "the printer must refuse a const it cannot strip, rather than emit a value it cannot restore");
});

/* ============================================================== R1: the optional import map */

ok("R1: every guarantee above holds whether or not the import map is present", () => {
  /* dsl.js resolves derived imports through the mined map and DROPS them when the stored specifier
   * equals the canonical. That makes the printed text corpus-dependent — but the ROUND TRIP must not
   * be. Here the specifiers are deliberately unresolvable ('./importX'), so they are kept inline;
   * the assertions above therefore exercise the KEPT branch on any machine, mined or not.
   *
   * Asserting the branch explicitly, so this stays true rather than being true by luck: */
  for (const form of FORMS) {
    if (!Object.keys(form.derived).length) continue;
    const printed = DSL.printTree(treeFor(form));
    assert.match(printed, /from '\.\//, `${form.keyword}: an unresolvable import should be KEPT inline, not dropped`);
    return;
  }
});

console.log(`\n${pass} assertions passed`);
