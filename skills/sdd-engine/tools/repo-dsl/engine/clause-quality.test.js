"use strict";
/* The two frozen metrics (engine/clause-quality.js). Both are label-region only and cannot move a
 * byte; what they CAN do is silently stop measuring, which is why each assertion below is paired
 * with a mutation recorded in the commit.
 *
 * §10 compliance: the non-vacuity assertions use strings taken from real rendered corpus output,
 * never from a mined artifact, so a metric that quietly stopped classifying goes red here. */
const assert = require("assert");
const Q = require("./clause-quality");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

/* ---- (i) the frozen vacuous set ---- */
ok("every frozen string classifies as vacuous", () => {
  assert.ok(Q.VACUOUS.length >= 13, "the frozen set should not have shrunk silently");
  for (const s of Q.VACUOUS) assert.strictEqual(Q.isVacuous(s), true, s);
});

ok("a clause carrying site content is NOT vacuous", () => {
  for (const s of ["return `row`", "await `rows` from get manager", "import one name from a module",
                   "set the HTTP response body", 'failing when “accountId cannot be null”'])
    assert.strictEqual(Q.isVacuous(s), false, s);
});

ok("the frozen set is genuinely immutable", () => {
  assert.throws(() => Q.VACUOUS.push("something convenient"), /read only|not extensible|object is not extensible/i);
  assert.strictEqual(Q.isVacuous("something convenient"), false);
});

/* NON-VACUITY: these are verbatim labels the renderer emits today. If a change makes the metric
 * stop counting them, the number would improve for free — this is the assertion that forbids it. */
ok("real emitted labels still count as vacuous (metric is live)", () => {
  const real = "compute `billingContactsRouter`, then call get";
  const cs = Q.clausesOf(real);
  assert.deepStrictEqual(cs, ["compute `billingContactsRouter`", "call get"]);
  const label = "get `accountId` from int val, compute a value, compute a value, run a step";
  assert.strictEqual(Q.clausesOf(label).filter(Q.isVacuous).length, 3);
});

ok("a collapsed run (×N) is prose, not a stray parenthesis", () => {
  assert.deepStrictEqual(Q.clausesOf("re-export one name from another module (×63)"),
    ["re-export one name from another module"]);
  assert.strictEqual(Q.isEnglishComplete("re-export one name from another module (×63)"), true);
});

/* ---- (ii) English-completeness ---- */
ok("prose with `identifiers` and “literals” is English-complete", () => {
  for (const s of ["await `rows` from get manager", "return `row`",
                   'failing when “accountId cannot be null”', "set the HTTP status code"])
    assert.strictEqual(Q.isEnglishComplete(s), true, s);
});

/* THE FAILURE MODE THIS METRIC EXISTS FOR: a template that quotes a hole so large the sentence is
 * code wearing a sentence's clothes. Each of these is a plausible bad production. */
ok("a sentence with code left in it is NOT English-complete", () => {
  for (const s of ["compute `x` = rows.map((r) => r.id)",
                   "call getManager('hydra').save(Payment, { id: payment.id })",
                   "define const escapeQuotes = (str: unknown) => `${str}`",
                   "return { valid: true, message: 'ok' }",
                   "branch on ctx.request.href.includes('notifications')"])
    assert.strictEqual(Q.isEnglishComplete(s), false, s);
});

/* Each forbidden token pinned on its OWN, by a case containing no other syntax. Without this a
 * mutation that drops one token from TS_SYNTAX goes green, because every multi-token example is
 * still caught by a different token — measured: dropping `=>` did not turn this suite red. */
ok("every forbidden token is independently pinned", () => {
  const cases = { "{": "return a value {", "}": "return a value }",
    "(": "call a helper ( twice", ")": "call a helper ) twice", "[": "index a list [ here",
    "]": "index a list ] here", ";": "do one thing ; then another", "=": "assign a value = here",
    "<": "compare a size < here", ">": "compare a size > here", "|": "combine flags | here",
    "&": "combine flags & here", "?.": "reach a field ?. safely", "member.access": "read ctx.body now" };
  // `=>` deliberately absent: it is caught by `>` and pinning it separately would assert coverage
  // the regex does not independently have.
  for (const [tok, s] of Object.entries(cases))
    assert.strictEqual(Q.isEnglishComplete(s), false, "token " + tok + " not caught in: " + s);
});

ok("member access survives the strip and is caught", () => {
  assert.strictEqual(Q.isEnglishComplete("await next from ctx.request.headers"), false);
  assert.strictEqual(Q.isEnglishComplete("await next from `ctx.request.headers`"), true);
});

console.log(`\n${pass} assertions passed`);
