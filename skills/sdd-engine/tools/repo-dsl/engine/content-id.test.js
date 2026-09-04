"use strict";
/**
 * content-id.test.js — pins R-PAY-6's id derivation against the SHIPPED dictionary.
 *
 * WHY IT RUNS ON THE REAL ARTIFACT AND NOT ON FIXTURES. The two questions this module has to
 * answer — what the id is a function of, and what it collides on — are questions about 244,795 real
 * dictionary entries. A fixture can show the construction is well-formed; only the corpus can show
 * it is INJECTIVE. Both are asserted here, and the corpus one is the reason this file is slow.
 *
 * IT CARRIES ITS OWN NEGATIVE CONTROL, and that is the point. Section 3 asserts that the width
 * MATTERS by showing the id DOES collide at 24 bits — the width `engine/pipeline.js:93` uses today.
 * Without it, "0 collisions at 64 bits" is a number with nothing to compare it to, and a check that
 * cannot fail is the defect class this tree has spent a day removing.
 *
 * Read-only: no mine, no render, no corpus write, no artifact write.
 */
const crypto = require("crypto");
const CID = require("./content-id.js");
const EL = require("./enlzw.js");
const AC = require("./artifact-contract.js");
const CR = require("./corpus-root.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`);

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/* ---- 1. SEPARATOR INJECTION, proved on a constructed pair rather than asserted ---- */
{
  /* Two genuinely different patterns whose elements concatenate to the same bytes. A leaf skeleton
   * may contain any literal the source contained, so there is no joiner byte that is safe by
   * inspection — the encoding has to be injective by CONSTRUCTION. */
  const p1 = ["A", "BC"], p2 = ["AB", "C"];
  eq(p1.join(""), p2.join(""), "the naive join DOES collide on this pair — the hazard is real, not hypothetical");
  ok(CID.contentOf(p1) !== CID.contentOf(p2),
    `length-prefixing separates them: ${JSON.stringify(CID.contentOf(p1))} vs ${JSON.stringify(CID.contentOf(p2))}`);

  /* And the separator itself appearing INSIDE an element must not matter. */
  const q1 = ["1:A", "B"], q2 = ["1", "A2:B"];
  ok(CID.contentOf(q1) !== CID.contentOf(q2), "an element containing the prefix delimiter still separates");
}

/* ---- 2. rekeyAxis REFUSES a collision — the guard is shown to fire (§10.3) ---- */
{
  /* Two entries, one pattern. Under any content-addressed scheme they derive the same id, which is
   * exactly the case that must refuse rather than silently keep one. */
  const words = { 0: { len: 1, d: 0, sym: "same" }, 1: { len: 1, d: 0, sym: "same" } };
  let threw = null;
  try { CID.rekeyAxis({ words }); } catch (e) { threw = e.message; }
  ok(threw && /CONTENT ID COLLISION/.test(threw), "rekeyAxis refuses two patterns sharing an id" + (threw ? "" : " (did not throw)"));
  ok(threw && /never tie-break/.test(threw), "and the refusal says what to do instead");
}

/* ---- 3. THE SHIPPED DICTIONARY: injectivity, and the width that is NOT enough ---- */
const cat = AC.load("generators-lzw", AC.pathFor("generators-lzw", CR.corpusRoot()));
for (const axisName of ["narrow", "wide"]) {
  const axis = cat[axisName];
  const words = axis.words;
  const ids = Object.keys(words);
  const memo = new Map();

  const contents = new Map();   // content -> first id
  const at64 = new Map();       // 16 hex -> first id
  const at24 = new Map();       // 6 hex  -> first id  (pipeline.js:93's width)
  let dupContent = 0, coll64 = 0, coll24 = 0;
  let example24 = null;

  for (const id of ids) {
    const content = CID.contentOf(CID.patternOf(words, id, memo));
    if (contents.has(content)) dupContent++; else contents.set(content, id);
    const h = sha256(content);
    const k64 = h.slice(0, 16), k24 = h.slice(0, 6);
    if (at64.has(k64)) coll64++; else at64.set(k64, id);
    if (at24.has(k24)) { coll24++; if (!example24) example24 = [at24.get(k24), id]; } else at24.set(k24, id);
  }

  console.log(`  ${axisName}: ${ids.length} words   distinct patterns ${contents.size}` +
    `   collisions @64 ${coll64}   @24 ${coll24}`);

  eq(contents.size, ids.length, `${axisName}: the PATTERN is injective — no two dictionary entries share one`);
  eq(coll64, 0, `${axisName}: 0 collisions at 64 bits (artifact-contract.js:96's width)`);
  /* THE NEGATIVE CONTROL. If this ever reads 0 the corpus has shrunk or the derivation changed,
   * and "0 collisions at 64 bits" above stops meaning anything — it would no longer be a width
   * that was CHOSEN over one that fails. Do not delete this to make the file quieter. */
  ok(coll24 > 0, `${axisName}: 24 bits — pipeline.js:93's width today — DOES collide, ${coll24} times` +
    (example24 ? ` (e.g. words ${example24[0]} and ${example24[1]})` : ""));
}

/* ---- 4. REKEY IS MEANING-PRESERVING: every word expands to the same bytes ---- */
for (const axisName of ["narrow", "wide"]) {
  const axis = cat[axisName];
  const { words, map } = CID.rekeyAxis(axis);
  const rekeyed = { words };
  let checked = 0, moved = 0, firstMove = null;
  for (const [oldId, cid] of map) {
    const before = EL.expandKey(axis, oldId);
    const after = EL.expandKey(rekeyed, cid);
    checked++;
    if (before !== after && !firstMove) firstMove = oldId;
    if (before !== after) moved++;
  }
  console.log(`  ${axisName}: rekeyed ${checked} words   expandKey moved on ${moved}`);
  eq(moved, 0, `${axisName}: rekeying preserves expandKey on every word` + (firstMove ? ` (first move: ${firstMove})` : ""));
  eq(checked, Object.keys(axis.words).length, `${axisName}: every word was rekeyed, none dropped`);
}

console.log(`content-id.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
