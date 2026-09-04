"use strict";
/**
 * payload.test.js — the 53-bit DECIMAL id dialect, and the guard that keeps it closed.
 *
 * WHY THIS FILE EXISTS. `payload.js` had no test at all, and its word-id guard was
 * `Number.isInteger(obj.w) && obj.w >= 0` — which is measurably NOT enough. JavaScript rounds an
 * out-of-range integer literal BEFORE the guard ever sees it, so `Number.isInteger` returns true
 * for `2**53` and true for `18446744073709551615` (which has already become ...552000). Two
 * distinct 64-bit ids therefore produced ONE marker, with no error raised anywhere and no metric
 * able to see the difference. `c30eb59` added a MAX_SAFE_INTEGER refusal on both encode and decode;
 * this file is the proof that it fires.
 *
 * THE DISCIPLINE THIS FILE IS WRITTEN TO. A guard that has never been shown able to fail is not a
 * guard. Section 1 asserts the raw JavaScript facts that make the OLD guard insufficient — those
 * assertions pass with or without the fix and are what give the section-2 refusals something to be
 * measured against. If section 1 ever goes red, the language changed and section 2 is meaningless.
 *
 * WHY DECIMAL AND NOT HEX (R-PAY-6, and why it is NOT an R-PAY-1 dialect change). Measured:
 * `payload.js:233` interpolates a NUMBER into the marker and `payload.js:272` scans DIGITS back
 * out, while `word-names.js:100,103` do `+id`. `+"126347"` is exact; `+"3f2a1b9c"` is NaN. The
 * decimal leg survives every shipped consumer untouched; the hex leg does not. Section 3 pins that.
 *
 * Read-only: no mine, no render, no corpus write, no artifact write.
 */
const P = require("./payload.js");
const CID = require("./content-id.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`);
const threw = (fn, re, m) => {
  let e = null;
  try { fn(); } catch (err) { e = err; }
  ok(e && re.test(e.message), m + (e ? `\n    threw: ${e.message}` : "\n    DID NOT THROW"));
};

/* ---- 1. THE HAZARD IS REAL — the facts that make `Number.isInteger` insufficient ---- */
{
  ok(Number.isInteger(Math.pow(2, 53)),
    "Number.isInteger accepts 2**53 — one past the safe range, so the old guard admitted it");
  ok(Number.isInteger(18446744073709551615),
    "Number.isInteger accepts a 64-bit literal — because it was already rounded to a float");
  ok(18446744073709551615 === 18446744073709552000,
    "and that rounding is lossy: the 64-bit literal IS a different number by the time it is read");
  /* THE COLLISION, stated as an identity rather than described: two distinct ids, one marker. */
  ok(Math.pow(2, 53) === Math.pow(2, 53) + 1,
    "2**53 and 2**53+1 are the SAME double — so under the old guard they encoded to one marker");
}

/* ---- 2. THE GUARD FIRES — encode and decode, both edges ---- */
{
  threw(() => P.encode({ a: "n", w: Math.pow(2, 53) }), /exceeds Number\.MAX_SAFE_INTEGER/,
    "encode REFUSES 2**53 (the value section 1 proved the old guard admitted)");
  threw(() => P.encode({ a: "n", w: 18446744073709551615 }), /exceeds Number\.MAX_SAFE_INTEGER/,
    "encode REFUSES a rounded 64-bit id");
  threw(() => P.decode("lzw1 n9007199254740993"), /exceeds Number\.MAX_SAFE_INTEGER/,
    "decode REFUSES an out-of-dialect id rather than silently rounding it to ...992");
  /* The read side matters on its own: an .en already on disk reaches decode without ever
   * passing through encode, so guarding encode alone would leave the corruption reachable. */

  /* AND IT STOPS EXACTLY AT THE EDGE, not before it. A guard that is merely conservative would
   * pass these tests too, and would silently shrink the id space. */
  const edge = Number.MAX_SAFE_INTEGER;
  eq(P.decode(P.encode({ a: "n", w: edge })).w, edge,
    "MAX_SAFE_INTEGER itself round-trips — the guard refuses PAST the edge, not AT it");
  eq(P.decode(P.encode({ a: "w", w: 0 })).w, 0,
    "id 0 round-trips — the lower bound is untouched");
}

/* ---- 3. THE DIALECT IS DECIMAL, and hex is what would break it ---- */
{
  eq(+"126347", 126347, "a decimal id survives the `+id` coercion at word-names.js:100,103");
  ok(Number.isNaN(+"3f2a1b9c"),
    "a hex id becomes NaN under the same coercion — THIS is what makes hex a dialect change");

  const enc = P.encode({ a: "n", w: 126347, h: ["x"] });
  ok(/^lzw1 n126347/.test(enc), "the marker carries the id as DIGITS, so the decoder can scan it back");
  eq(P.decode(enc).w, 126347, "and it decodes to the same number");
}

/* ---- 4. A CONTENT-ADDRESSED 53-BIT ID IS CARRIABLE BY THIS DIALECT ---- */
{
  /* The whole point of R-PAY-6 slice 2: the id stops being an allocation order and becomes a
   * function of the word's content. This asserts the OUTPUT of that derivation is payload-legal,
   * on a constructed dictionary so the test needs no artifact. */
  const words = { "0": { len: 1, d: 0, sym: "alpha" }, "1": { len: 1, d: 0, sym: "beta" },
                  "2": { len: 2, d: 1, m: [0, 1] } };
  const memo = new Map();
  for (const id of ["0", "1", "2"]) {
    const dec = CID.contentIdDecimal(words, id, memo);
    ok(Number.isSafeInteger(dec) && dec >= 0, `content id for word ${id} is a safe non-negative integer`);
    eq(P.decode(P.encode({ a: "n", w: dec })).w, dec, `content id for word ${id} round-trips through the payload unchanged`);
    /* Derived from the SAME bytes as the 64-bit content address, so the two cannot disagree. */
    ok((BigInt("0x" + CID.contentId(words, id, memo)) >> BigInt(64 - CID.CID_BITS)) === BigInt(dec),
      `content id for word ${id} is exactly the top ${CID.CID_BITS} bits of its 64-bit content address`);
  }
  /* THE ID SPACE AND THE GUARD'S CEILING COINCIDE EXACTLY — no slack, no unreachable region. */
  eq(Math.pow(2, CID.CID_BITS) - 1, Number.MAX_SAFE_INTEGER,
    "the widest 53-bit id IS Number.MAX_SAFE_INTEGER — the dialect edge and the id space are the same number");
}

console.log(`payload.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
