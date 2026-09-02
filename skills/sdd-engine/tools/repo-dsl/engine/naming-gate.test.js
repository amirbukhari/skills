"use strict";
/**
 * naming-gate.test.js — THE GATE MUST BE ABLE TO FAIL (PRD §5D.2, §10.3).
 *
 * chunk-naming.test.js states the standard this file is held to: "a gate that cannot be shown to
 * FIRE is not a gate". Names are cosmetic by construction, so against the real renderer this gate
 * passes unconditionally — which means a broken comparison would look exactly like a working one.
 * The renderer is therefore INJECTED, and each of the four checks is shown failing against a
 * renderer that breaks precisely that one property, and passing against one that does not.
 *
 * UNIT tier: a fake renderer, a temp file, no corpus, no artifacts.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const GATE = require("./naming-gate");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
fs.writeFileSync(path.join(dir, "a.ts"), "const x = 1;\n");
const FILES = ["a.ts"];
const applied = [{ key: "w:aaaa", axis: "w", depth: 0, name: "hold a constant", sym: "const ‹id› = ‹num›;", sites: 3 }];

/* A renderer whose output depends on the live name map exactly as enfile's does: the label region
 * varies with the name, the payload does not. `break` selects which invariant it violates. */
function fakeEN(mode) {
  const NAMES = { names: {}, chunks: {} };
  return {
    NAMES,
    renderFileEn(src) {
      const named = NAMES.names["w:aaaa"];
      const label = named ? named.en : "assign a number";
      const payload = mode === "payload" && named ? "⟪MOVED⟫" : "⟪p1⟫";
      /* THE PILOT'S SHAPE: unnamed, a node-kind rule quotes what the source actually said; named,
       * one hole-free name stands in its place and the two identifiers are simply gone. */
      const detail = mode === "detail" && !named ? " calling `getManager` on `partnerRepo`" : "";
      if (mode === "detail") return { en: `▶ ${label}${detail} ${payload}`, stats: { genSpans: 1, genStmtsCollapsed: 3 } };
      return { en: `▶ ${label} ${payload}`, stats: { genSpans: 1, genStmtsCollapsed: mode === "coverage" && named ? 2 : 3 } };
    },
    compileFileEn(en, _index) { return mode === "bytes" && /hold a constant/.test(en) ? "DIFFERENT BYTES" : "const x = 1;\n"; },
  };
}

ok("a clean renderer PASSES, and reports that the prose actually changed", () => {
  const r = GATE.gateNames(fakeEN("clean"), {}, dir, FILES, applied);
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.checked, 1);
  assert.strictEqual(r.proseChanged, 1, "non-vacuity: the name reached the label");
});

ok("BYTE-IDENTITY: a name that changes a compiled byte FAILS the gate", () => {
  const r = GATE.gateNames(fakeEN("bytes"), {}, dir, FILES, applied);
  assert.strictEqual(r.passed, false);
  assert.match(r.failures[0].why, /byte-identity broke/);
});

ok("PAYLOAD IDENTITY: a name that moves a payload FAILS — even though the bytes came back", () => {
  const r = GATE.gateNames(fakeEN("payload"), {}, dir, FILES, applied);
  assert.strictEqual(r.passed, false);
  assert.match(r.failures[0].why, /payload moved/);
});

ok("COVERAGE INVARIANCE: a name that changes what collapsed FAILS", () => {
  const r = GATE.gateNames(fakeEN("coverage"), {}, dir, FILES, applied);
  assert.strictEqual(r.passed, false);
  assert.match(r.failures[0].why, /coverage moved/);
});

ok("DETAIL RETENTION: a name that eats identifiers the rule was quoting FAILS", () => {
  const r = GATE.gateNames(fakeEN("detail"), {}, dir, FILES, applied);
  assert.strictEqual(r.passed, false, "this is the pilot: 27,673 -> 7,644 identifiers, gated clean before this check existed");
  assert.match(r.failures[0].why, /detail lost: 2 -> 0/);
  assert.strictEqual(r.detailBefore, 2, "and the totals are reported, so a caller sees the size of the loss");
  assert.strictEqual(r.detailAfter, 0);
});

ok("... while a name that leaves the rule's identifiers alone still PASSES", () => {
  const r = GATE.gateNames(fakeEN("clean"), {}, dir, FILES, applied);
  assert.strictEqual(r.passed, true, "check 4 must not simply reject every name");
});

/* Payloads are verbatim SOURCE. Counting them would let an untouched payload mask a real loss. */
ok("detailOf ignores identifiers inside a payload and counts only what the PROSE supplies", () => {
  assert.strictEqual(GATE.detailOf("says `a` and `b` ⟪const x = `c` + `d`;⟫"), 2);
});

ok("a batch that reaches no label is reported as VACUOUS rather than passing quietly", () => {
  const EN = fakeEN("clean");
  const r = GATE.gateNames(EN, {}, dir, FILES, [{ key: "w:unused", axis: "w", depth: 0, name: "never rendered", sym: "x", sites: 1 }]);
  assert.strictEqual(r.passed, true, "nothing is WRONG — nothing happened");
  assert.strictEqual(r.proseChanged, 0, "and the caller is told so, so it can refuse to bank it");
});

/* ---- THE GATE LEAVES NO TRACE ------------------------------------------------------------ */
ok("names applied for measurement are restored — the gate never half-applies", () => {
  const EN = fakeEN("clean");
  EN.NAMES.names["w:preexisting"] = { en: "was here first" };
  GATE.gateNames(EN, {}, dir, FILES, applied);
  assert.deepStrictEqual(Object.keys(EN.NAMES.names), ["w:preexisting"], "the batch is gone, the prior names remain");
});

ok("... including when the gate throws part way through", () => {
  const EN = fakeEN("clean");
  EN.NAMES.names["w:preexisting"] = { en: "was here first" };
  EN.compileFileEn = () => { throw new Error("boom"); };
  assert.throws(() => GATE.gateNames(EN, {}, dir, FILES, applied), /boom/);
  assert.deepStrictEqual(Object.keys(EN.NAMES.names), ["w:preexisting"]);
});

/* ---- ONE DEFINITION OF WHAT A NAME LOOKS LIKE ON DISK ------------------------------------ */
ok("recordFor routes a leaf to `names` and a chunk to `chunks`, with the fields the contract declares", () => {
  const leaf = GATE.recordFor({ depth: 0, sym: "S", name: "do a thing", sites: 2 });
  assert.strictEqual(leaf.map, "names");
  assert.deepStrictEqual(Object.keys(leaf.rec).sort(), ["en", "named", "sites", "sym"]);
  const chunk = GATE.recordFor({ depth: 3, leaves: ["a", "b"], name: "set up the request", rationale: "why" });
  assert.strictEqual(chunk.map, "chunks");
  assert.strictEqual(chunk.rec.len, 2);
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} assertions passed`);
