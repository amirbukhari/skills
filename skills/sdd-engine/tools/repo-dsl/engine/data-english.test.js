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

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

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
  assert.equal(english("{ a: x, b: y }"), "an object with a = `x`, b = `y`");
  assert.ok(roundtrips("{ a: x, b: y }"));
});
ok("empty object", () => { assert.equal(english("{}"), "an empty object"); assert.ok(roundtrips("{}")); });
ok("object with string / number / member-path atoms", () => {
  assert.ok(roundtrips("{ name: 'foo', count: 3, id: ctx.state.userId }"));
});
ok("shorthand + spread properties", () => {
  assert.equal(english("{ ...base, a, b: y }"), "an object with spread `base`, a, b = `y`");
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

/* 5. out-of-domain bails — non-canonical spacing must NOT be claimed byte-exact */
ok("non-canonical spacing bails (dataByteExact === false)", () => {
  const cases = ["{a:x}", "{ a: x, }", "[ x, y ]", "[x,y]", "{ a: x,b: y }"];
  for (const c of cases) { const { node, sf } = expr(c); assert.equal(dataByteExact(node, sf), false, `should bail: ${c}`); }
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

console.log(`\ndata-english.test: ${pass} passed`);
