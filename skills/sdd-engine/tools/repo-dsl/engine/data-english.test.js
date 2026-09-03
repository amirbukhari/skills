"use strict";
/* Tests for the STEP 6 DATA-AS-ENGLISH layer (engine/data-english). Each render must
 * reconstruct the EXACT source bytes: compileData(renderData(node)) === source. Unit cases
 * cover objects / arrays / ${}-templates, nesting, spread, shorthand, empties, and the
 * out-of-domain bails; a corpus property test asserts the byte-exact GATE never lies —
 * every leaf dataByteExact() accepts really does round-trip. Deterministic; exits non-zero
 * on failure. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { renderData, compileData, dataByteExact } = require("./data-english");
const CR = require("./corpus-root");

let pass = 0, fail = 0;
/* THE SUMMARY MUST NAME FAILURES. This printed `data-english.test: 9 passed` while one test was
 * FAILING -- the exit code was correctly 1, but every human-readable line said green. A summary
 * that can only count successes is a detector that cannot fire (CLAUDE.md SS3), and it fails in
 * the reassuring direction. Found 2026-09-03 when a deliberate change to the English form broke
 * two pinned strings and the footer still read `9 passed`. */
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { fail++; console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

// parse the first expression out of `const _ = <expr>;`
function expr(src) {
  const sf = ts.createSourceFile("s.ts", "const _ = " + src + ";", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const d = sf.statements[0].declarationList.declarations[0];
  return { node: d.initializer, sf };
}
const roundtrips = (src) => { const { node, sf } = expr(src); const eng = renderData(node, sf); return eng != null && compileData(eng) === src; };
const english = (src) => { const { node, sf } = expr(src); return renderData(node, sf); };

/* 1. object literals */
ok("object renders as 'an object with …' and refills byte-exact", () => {
  /* THE TRAILING SPACE IS THE SOURCE'S OWN, and it is load-bearing rather than sloppy. As of
   * 2026-09-03 this form carries the literal's LAYOUT -- the bytes between `{` and the first
   * field, between fields, and between the last field and `}` -- so that multi-line literals
   * round-trip byte-exact instead of bailing. `{ a: x, b: y }` has a space before its `}`, so the
   * English ends with one. The byte-exact assertion below is the property that matters and is
   * unchanged; this line pins the shape it produces. */
  assert.equal(english("{ a: x, b: y }"), "an object with a = `x`, b = `y` ");
  assert.ok(roundtrips("{ a: x, b: y }"));
});
ok("empty object", () => { assert.equal(english("{}"), "an empty object"); assert.ok(roundtrips("{}")); });
ok("object with string / number / member-path atoms", () => {
  assert.ok(roundtrips("{ name: 'foo', count: 3, id: ctx.state.userId }"));
});
ok("shorthand + spread properties", () => {
  assert.equal(english("{ ...base, a, b: y }"), "an object with spread `base`, a, b = `y` ");
  assert.ok(roundtrips("{ ...base, a, b: y }"));
});
ok("string / computed keys stay verbatim", () => {
  assert.ok(roundtrips("{ 'a-b': x, [k]: y }"));
});

/* 2. array literals */
ok("array renders as 'a list of …' and refills byte-exact", () => {
  assert.equal(english("[x, y, z]"), "a list of `x`, `y`, `z`");
  assert.ok(roundtrips("[x, y, z]"));
});
ok("empty array + spread element + string atoms", () => {
  assert.equal(english("[]"), "an empty list");
  assert.ok(roundtrips("[]"));
  assert.ok(roundtrips("['client', 'group', 'monthly']"));
  assert.ok(roundtrips("[...base, x]"));
});

/* 3. ${} templates */
ok("template renders as 'text: “…⟨e⟩…”' and refills byte-exact", () => {
  assert.equal(english("`Total: ${amount} USD`"), "text: “Total: ⟨amount⟩ USD”");
  assert.ok(roundtrips("`Total: ${amount} USD`"));
});
ok("template with leading/trailing/adjacent interpolations", () => {
  assert.ok(roundtrips("`${a}`"));
  assert.ok(roundtrips("`${a}${b}`"));
  assert.ok(roundtrips("`${previousValue + 1}-${value}`"));
});

/* 4. nesting (object of arrays of objects, template inside object) */
ok("nested collections parenthesise and refill byte-exact", () => {
  assert.ok(roundtrips("{ items: [a, b], meta: { k: v } }"));
  assert.ok(roundtrips("[{ a: x }, { b: y }]"));
  assert.ok(roundtrips("{ range: `${lo} - ${hi}`, n: 3 }"));
});

/* 5. LAYOUT IS CARRIED; CONTENT THIS FORM CANNOT HOLD STILL BAILS.
 * This test used to read "non-canonical spacing bails" and asserted that all five shapes below
 * were NOT byte-exact. That was pinning a LIMITATION as though it were a contract: the English
 * was re-emitted on one canonical line, so anything laid out differently failed the gate and fell
 * back to raw TypeScript. Corpus cost, measured 2026-09-03: 6,170 of 18,044 data leaves and 30,890
 * braces -- 64% of every brace left on the reading surface by the-goal.test.js.
 *
 * The separators now come from the source, so layout round-trips and these shapes are accepted.
 * The test is INVERTED rather than deleted, because "does the gate still refuse what it cannot
 * carry?" is the assertion that was actually load-bearing, and a gate that accepts everything is
 * the failure this whole layer is guarding against. */
ok("layout variants now round-trip byte-exact (the gate widened for a measured reason)", () => {
  const nowExact = ["{ a: x, }", "[ x, y ]", "[x,y]", "{ a: x,b: y }", "{\n  a: x,\n}", "[\n  x,\n]"];
  for (const c of nowExact) { const { node, sf } = expr(c); assert.equal(dataByteExact(node, sf), true, `should round-trip: ${c}`); }
});
ok("what the gate still REFUSES: comments, and a brace with no gap to fold", () => {
  /* A comment is real content this form has no way to say, so it must bail rather than drop it --
   * 365 corpus nodes, and dropping them would have been a silent wrong-bytes bug rather than a
   * missed opportunity. `{a:x}` is the one deliberate cost of folding the canonical single space
   * into the English word boundary: with no gap after `{`, the round trip re-inserts one. */
  const mustBail = ["{ a: 1, // note\n}", "{ /*c*/ a: 1 }", "{a:x}"];
  for (const c of mustBail) { const { node, sf } = expr(c); assert.equal(dataByteExact(node, sf), false, `should bail: ${c}`); }
});
ok("atoms containing a structural delimiter bail to null", () => {
  // a template atom carrying a backtick cannot nest inside an escape
  const { node, sf } = expr("[`a`, b]");
  // the array's first element is a NoSubstitutionTemplateLiteral -> atom() sees a backtick -> null
  assert.equal(renderData(node, sf), null);
});

/* 6. CORPUS PROPERTY: the gate never lies — accepted leaves always round-trip */
ok("corpus: every dataByteExact-accepted leaf reconstructs its exact source", () => {
  const CORPUS = CR.sourceRoot();
  const { SKIP } = require("./walk-skip");   // the ONE canonical corpus walk-skip set
  const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (SKIP.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, o); else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) o.push(p); } return o; };
  let accepted = 0, checked = 0;
  for (const abs of walk(CORPUS)) {
    let src; try { src = fs.readFileSync(abs, "utf8"); } catch (_) { continue; }
    const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (n) => {
      if (ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n) || ts.isTemplateExpression(n)) {
        checked++;
        if (dataByteExact(n, sf)) { accepted++; assert.equal(compileData(renderData(n, sf)), n.getText(sf), "gate accepted a leaf that does NOT round-trip"); }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  assert.ok(accepted > 5000, `expected thousands of accepted leaves, got ${accepted}/${checked}`);
  console.log(`      (corpus: ${accepted}/${checked} data leaves accepted + verified byte-exact)`);
});

console.log(`\ndata-english.test: ${pass} passed, ${fail} failed`);
