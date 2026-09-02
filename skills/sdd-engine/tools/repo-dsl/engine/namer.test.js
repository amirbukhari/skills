"use strict";
/**
 * namer.test.js — PINS THE MODEL'S BLAST RADIUS (PRD §5D.3A, R-LANG-11/15; Q-9).
 *
 * §5D.3A: "The grammar, the syntax, the template and the slot boundaries are DETERMINISTIC and
 * produced by code. The model supplies WORDS ... It never writes a sentence, never chooses a
 * connective, never decides where a slot begins or ends, and never emits prose." That is a claim
 * about a CHANNEL, so the assertions here are about the channel: what shape may come back, what is
 * refused, and that a refusal costs a re-ask rather than a corpus edit.
 *
 * Every assertion runs with ZERO model calls — `--stub` is the transport in this file — which is
 * also the property that makes the naming stage testable at all (§10.2: the model is an INPUT).
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const NM = require("./namer");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "namer-"));
const stubOf = (obj) => { const f = path.join(dir, `stub-${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

const leafRows = [
  { key: "w:aaaa", axis: "w", depth: 0, sym: "const ‹id› = await ‹id›.‹m›(‹args›);", sites: 12, files: ["a.ts"], snippets: ["const rows = await db.load(id);"] },
  { key: "w:bbbb", axis: "w", depth: 0, sym: "throw new ‹ctor›(‹args›);", sites: 4, files: ["b.ts"], snippets: ["throw new BadRequest('no');"] },
];

/* ---- WHAT MAY COME BACK ------------------------------------------------------------------- */
ok("a well-formed batch is accepted and carries its content key, never an id", () => {
  const stub = stubOf([{ index: 0, name: "await a method call and keep the result", rationale: "assignment of an awaited call" },
                       { index: 1, name: "reject the request with an error", rationale: "throw" }]);
  const r = NM.nameBatch(leafRows, NM.makeInjectivityLedger({}), { stub });
  assert.strictEqual(r.accepted.length, 2);
  assert.strictEqual(r.calls, 0, "a stub run must spend no model call");
  assert.deepStrictEqual(r.accepted.map((a) => a.key), ["w:aaaa", "w:bbbb"]);
});

ok("anything that is not [{index,name}] is a hard failure, not a salvage", () => {
  assert.throws(() => NM.parseProposals("here are your names: none"), /did not return a JSON array/);
  assert.throws(() => NM.parseProposals("[{index: 0}]"), /unparseable JSON/);
  assert.deepStrictEqual(NM.parseProposals('[{"index":"0","name":"x"},{"index":1,"name":"y"}]').length, 1,
    "a row without a numeric index is dropped rather than guessed at");
});

ok("extra fields the model invents are IGNORED — there is no channel for structure", () => {
  const stub = stubOf([{ index: 0, name: "await a method call and keep the result", production: "Entity -> «X» is an entity.", slots: ["a", "b"], holes: ["evil"] }]);
  const r = NM.nameBatch([leafRows[0]], NM.makeInjectivityLedger({}), { stub, retries: 0 });
  assert.deepStrictEqual(Object.keys(r.accepted[0]).sort(),
    ["axis", "depth", "key", "leaves", "name", "rationale", "sites", "sym"].sort(),
    "only name + rationale survive; production/slots/holes have nowhere to land");
});

/* ---- WHAT IS REFUSED --------------------------------------------------------------------- */
ok("a name that is a SENTENCE is refused — code owns the sentence", () => {
  assert.strictEqual(NM.validateName("Loads the rows from the database.").ok, false);
  assert.match(NM.validateName("load the rows.").reason, /sentence punctuation/);
  assert.match(NM.validateName("Load the rows").reason, /starts with a capital/);
});

ok("a name carrying a render sentinel or a hole marker is refused, never sanitized", () => {
  for (const bad of ["load ⟪payload⟫", "load ▶ rows", "load ‹id› rows", "load «x»"]) {
    const v = NM.validateName(bad);
    assert.strictEqual(v.ok, false, `${bad} should be refused`);
    assert.match(v.reason, /sentinel or hole marker/);
  }
});

ok("a paragraph, a newline, and an empty string are all refused", () => {
  assert.match(NM.validateName("x".repeat(NM.MAX_LEN + 1)).reason, /longer than/);
  assert.match(NM.validateName("load rows\nand more").reason, /newline/);
  assert.match(NM.validateName("  ").reason, /too short/);
  assert.match(NM.validateName(42).reason, /not a string/);
});

/* ---- INJECTIVITY (§5E.4) ----------------------------------------------------------------- */
ok("two distinct words may not take the same phrase — within an axis", () => {
  const led = NM.makeInjectivityLedger({});
  assert.strictEqual(led.claim("w", "load the rows", "w:aaaa").ok, true);
  const second = led.claim("w", "Load The Rows", "w:bbbb");
  assert.strictEqual(second.ok, false, "case is not a distinction between two phrases");
  assert.match(second.reason, /injectivity/);
  assert.strictEqual(led.claim("w", "load the rows", "w:aaaa").ok, true, "re-claiming your OWN key is not a collision");
});

ok("the ledger is seeded from the names already on disk, so a new batch cannot shadow them", () => {
  const led = NM.makeInjectivityLedger({ "w:existing": { en: "load the rows" } });
  assert.strictEqual(led.claim("w", "load the rows", "w:new").ok, false);
});

ok("the two axes are separate ledgers — the same text under two axes is one word seen twice", () => {
  const led = NM.makeInjectivityLedger({});
  assert.strictEqual(led.claim("w", "load the rows", "w:aaaa").ok, true);
  assert.strictEqual(led.claim("n", "load the rows", "n:aaaa").ok, true);
});

ok("a colliding proposal is REJECTED and the word is left unnamed — never applied", () => {
  const stub = stubOf([{ index: 0, name: "load the rows" }, { index: 1, name: "load the rows" }]);
  const r = NM.nameBatch(leafRows, NM.makeInjectivityLedger({}), { stub, retries: 0 });
  assert.strictEqual(r.accepted.length, 1);
  assert.strictEqual(r.rejected.length, 1);
  assert.deepStrictEqual(r.unnamed, ["w:bbbb"], "the loser is unnamed, which renders as spanProse — the safe failure");
});

/* ---- REJECTION COSTS A RE-ASK, NOT A CORPUS EDIT ----------------------------------------- */
ok("a rejected batch is re-asked once, with the reason, and the retry can succeed", () => {
  const bad = stubOf([{ index: 0, name: "Load the rows." }, { index: 1, name: "reject the request" }]);
  const good = stubOf([{ index: 0, name: "load the rows from storage" }]);
  const r = NM.nameBatch(leafRows, NM.makeInjectivityLedger({}), { stub: bad, retryStub: good });
  assert.strictEqual(r.accepted.length, 2, "the retry recovered the rejected row");
  assert.deepStrictEqual(r.unnamed, []);
});

ok("a row that fails every attempt is left UNNAMED rather than failing the run", () => {
  const bad = stubOf([{ index: 0, name: "Load the rows." }, { index: 1, name: "reject the request" }]);
  const r = NM.nameBatch(leafRows, NM.makeInjectivityLedger({}), { stub: bad, retryStub: bad });
  assert.strictEqual(r.accepted.length, 1);
  assert.deepStrictEqual(r.unnamed, ["w:aaaa"]);
});

ok("the re-ask CARRIES the rejection reason — otherwise it is the same ask twice", () => {
  const p = NM.buildPrompt([leafRows[0]], { rejected: [{ index: 0, name: "Load rows.", reason: "ends with sentence punctuation" }] });
  assert.match(p.user, /rejected on the previous attempt/);
  assert.match(p.user, /ends with sentence punctuation/);
});

/* ---- THE PROMPT IS CODE-BUILT ------------------------------------------------------------ */
ok("the leaf prompt hands over the SHAPE and asks for a clause; the chunk prompt is a different ask", () => {
  const leaf = NM.buildPrompt([leafRows[0]], {});
  assert.match(leaf.user, /shape: const ‹id› = await/);
  assert.match(leaf.system, /STATEMENT SHAPES/);
  const chunkRow = { key: "wc:cccc", axis: "w", depth: 2, leaves: ["a", "b", "c"], sites: 3, files: ["x.ts"], snippets: [] };
  const chunk = NM.buildPrompt([chunkRow], { namesBySym: { a: "open a transaction" } });
  assert.match(chunk.system, /MULTI-STATEMENT PATTERNS/);
  assert.match(chunk.user, /a run of 3 statements/);
  assert.match(chunk.user, /\[named: open a transaction\]/, "R-LANG-20's payoff: the parts are already named when the whole is asked about");
});

ok("rows are addressed by #index only — the model never sees, and cannot return, a word id", () => {
  const p = NM.buildPrompt(leafRows, {});
  assert.match(p.user, /^#0 /m);
  assert.ok(!/w:aaaa/.test(p.user), "content keys stay on this side of the wire");
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} assertions passed`);
