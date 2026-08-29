"use strict";
/* Tests for engine/cnl.js — controlled-English logic authoring. Runnable; exits
 * non-zero on failure. */
const assert = require("assert");
const { compile, render, CnlError, loadWordsIndex, renderStatement, compileStatement } = require("./cnl.js");

const WORDS = [
  { name: "isProduction", call: "isProduction()", englishPhrase: "it is production",
    define: "export const isProduction = (): boolean => (process.env.NODE_ENV === 'production');" },
];
const idx = loadWordsIndex(WORDS);

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const TARGET = `To sync when prod, taking a sync action:
  When it is production, run the sync and stop.
  Otherwise, warn "Not in production environment: sync skipped."`;

/* 1. the headline: target English compiles to the expected TS */
ok("compiles the syncWhenProd target to TS", () => {
  const { ts, fnName, params } = compile(TARGET, idx);
  assert.equal(fnName, "syncWhenProd");
  assert.equal(params[0].name, "syncAction");
  assert.equal(params[0].type, "() => Promise<void>");
  assert.ok(ts.includes("if (isProduction()) {"), ts);
  assert.ok(ts.includes("await syncAction();"), ts);
  assert.ok(ts.includes("return;"), ts);
  assert.ok(ts.includes("console.warn('Not in production environment: sync skipped.');"), ts);
  assert.ok(/export const syncWhenProd = async \(syncAction: \(\) => Promise<void>\): Promise<void> =>/.test(ts), ts);
});

/* 2. control words map to skeletons */
ok("When/Otherwise -> if/else; Stop/Return -> return; loop", () => {
  const src = `To do stuff, taking a list:
  For each item in \`list\`, \`use(item)\`.
  When \`ready\`, return \`1\`.
  Otherwise, stop.`;
  const { ts } = compile(src, idx);
  assert.ok(ts.includes("for (const item of list) {"), ts);
  assert.ok(ts.includes("use(item);"), ts);
  assert.ok(ts.includes("if (ready) {"), ts);
  assert.ok(ts.includes("return 1;"), ts);
  assert.ok(ts.includes("} else {"), ts);
  assert.ok(ts.includes("return;"), ts);
});

/* 3. rejection: malformed sentence points at the offending phrase */
ok("rejects an unknown control word with the phrase", () => {
  const bad = `To be bad:\n  Whenever it is production, stop.`;
  try { compile(bad, idx); assert.fail("should have thrown"); }
  catch (e) { assert.ok(e instanceof CnlError); assert.ok(/Whenever it is production/.test(e.phrase), e.phrase); }
});
ok("rejects an unknown condition phrase (not coined, not escaped)", () => {
  const bad = `To be bad:\n  When the moon is full, stop.`;
  try { compile(bad, idx); assert.fail("should have thrown"); }
  catch (e) { assert.ok(e instanceof CnlError); assert.ok(/moon is full/.test(e.phrase), e.phrase); }
});
ok("rejects a missing period", () => {
  try { compile(`To x:\n  stop`, idx); assert.fail(); }
  catch (e) { assert.ok(e instanceof CnlError && /end with/.test(e.message)); }
});

/* 4. render (TS -> English) is the inverse */
ok("renders the coined-phrase guard back to English", () => {
  const tsSrc = `export const syncWhenProd = async (syncAction: () => Promise<void>): Promise<void> => {
  if (isProduction()) {
    await syncAction();
    return;
  } else {
    console.warn('Not in production environment: sync skipped.');
  }
};`;
  const eng = render(tsSrc, idx);
  assert.ok(eng.includes("When it is production, run the sync and stop."), eng);
  assert.ok(eng.includes('Otherwise, warn "Not in production environment: sync skipped."'), eng);
});

/* 5. round-trip English -> TS -> English (structure-identical) */
ok("round-trips syncWhenProd English -> TS -> English", () => {
  const { ts } = compile(TARGET, idx);
  const back = render(ts, idx);
  const norm = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  assert.equal(norm(back), norm(TARGET), `\n--- back ---\n${back}\n--- target ---\n${TARGET}`);
});

/* 6. bespoke escape survives verbatim both ways */
ok("bespoke `backtick` ships verbatim and renders back", () => {
  const src = `To net it, taking an amount:\n  return \`floatVal(amount) - credits\`.`;
  const { ts } = compile(src, idx);
  assert.ok(ts.includes("return floatVal(amount) - credits;"), ts);
});

/* 7. GRAMMAR RULES: each accepted rule round-trips a real statement byte-for-byte
 *    (renderStatement -> compileStatement), and renders the expected English frame. */
const rt = (src) => compileStatement(renderStatement(src, idx), idx).trim();
ok("assignment (const): `const x = f(a, b)` <-> Let `x` be call `f` with `a, b`", () => {
  const src = "const clientIds = distinct(subscriptions.map((s) => s.clientId));";
  assert.equal(renderStatement(src, idx), "Let `clientIds` be call `distinct` with `subscriptions.map((s) => s.clientId)`");
  assert.equal(rt(src), src);
});
ok("assignment (let): `let total = sumBy(rows, fn)` round-trips and frames with Set/to", () => {
  const src = "let total = sumBy(rows, (r) => r.amount);";
  assert.ok(renderStatement(src, idx).startsWith("Set `total` to call `sumBy` with "), renderStatement(src, idx));
  assert.equal(rt(src), src);
});
ok("method chain: `const active = xs.filter(fn)` <-> filter `xs` with `fn`", () => {
  const src = "const active = features.filter((f) => f.enabled);";
  assert.equal(renderStatement(src, idx), "Let `active` be filter `features` with `(f) => f.enabled`");
  assert.equal(rt(src), src);
});
ok("bare call: `logEvent(name, payload);` <-> Call `logEvent` with `name, payload`", () => {
  const src = "logEvent(name, payload);";
  assert.equal(renderStatement(src, idx), "Call `logEvent` with `name, payload`");
  assert.equal(rt(src), src);
});
ok("zero-arg forms round-trip: `const y = bar();` and `const z = obj.deep.value;`", () => {
  assert.equal(rt("const y = bar();"), "const y = bar();");
  assert.equal(rt("const z = obj.deep.value;"), "const z = obj.deep.value;"); // member access stays verbatim
});
ok("out-of-domain stays a verbatim bespoke escape (typed / template-literal / optional call)", () => {
  // A type annotation, a template literal, and an optional call must NOT engage the
  // rule (they would not reconstruct); they render as one backtick escape.
  for (const src of [
    "let toCopyFrom: PartCharge | null = null;",
    "const narration = `hello ${name}`;",
    "onSuccess?.();",
  ]) assert.ok(/^`[\s\S]*`$/.test(renderStatement(src, idx).replace(/\.$/, "")), `${src} -> ${renderStatement(src, idx)}`);
});

/* 8. STEP 2 productions: throw-error, ternary-value, member-assignment. */
ok("throw-error (single-quoted): `throw new Error('no data');` <-> Throw error \"no data\"", () => {
  const src = "throw new Error('no data in this file');";
  assert.equal(renderStatement(src, idx), 'Throw error "no data in this file"');
  assert.equal(rt(src), src);
});
ok("throw-error (double-quoted source) stays byte-exact via verbatim escape", () => {
  const src = 'throw new Error("ID must not be null");';
  assert.equal(renderStatement(src, idx), 'Throw error `"ID must not be null"`');
  assert.equal(rt(src), src); // re-emitted with the SAME double quotes, not single
});
ok("throw-error (template arg) is out of domain — stays a bespoke escape", () => {
  const src = "throw new Error(`missing ${input}`);";
  assert.ok(/^`[\s\S]*`$/.test(renderStatement(src, idx).replace(/\.$/, "")), renderStatement(src, idx));
  assert.equal(rt(src), src);
});
ok("ternary-value: `c ? a : b` <-> `a` if `c` otherwise `b`", () => {
  const src = "const msg = count === 0 ? 'none' : 'some';";
  assert.equal(renderStatement(src, idx), "Let `msg` be `'none'` if `count === 0` otherwise `'some'`");
  assert.equal(rt(src), src);
});
ok("ternary-value carries a nested ternary as one verbatim operand", () => {
  const src = "const r = a ? x : b ? y : z;";
  assert.equal(rt(src), src);
});
ok("member-assignment: `ctx.body = { ok: true };` <-> Set `ctx.body` to `{ ok: true }`", () => {
  const src = "ctx.body = { ok: true };";
  assert.equal(renderStatement(src, idx), "Set `ctx.body` to `{ ok: true }`");
  assert.equal(rt(src), src);
});
ok("member-assignment vs local let: dot in target -> plain assign, no `let`", () => {
  assert.equal(rt("obj.count = total;"), "obj.count = total;"); // member: no `let`
  assert.equal(rt("let count = total;"), "let count = total;");  // local: keeps `let`
});

console.log(`\ncnl.test: ${pass} passed`);
