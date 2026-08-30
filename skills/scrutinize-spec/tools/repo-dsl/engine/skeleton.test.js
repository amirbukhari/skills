"use strict";
/**
 * skeleton.test.js — runnable node test (exits non-zero on failure). Proves body
 * extraction, statement-kind labeling (incl. idiom recognition), skeleton
 * signatures, fetchAndValidate adjacency tagging, deterministic naming, and the
 * absolute rule: gaps + exact statement spans reproduce the body byte-for-byte.
 */
const { extractBodies, classifyStatement, nameSkeleton } = require("./skeleton.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error("  FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

/* ---- signature + kinds ---- */
{
  const src = `
function priceIt(items, rate) {
  const subtotal = sum(items);
  const total = subtotal * rate;
  return total;
}`;
  const { bodies } = extractBodies(src, "a.ts");
  eq(bodies.length, 1, "one body");
  eq(bodies[0].sig, "ASSIGN ASSIGN RETURN", "assignAssignReturn signature");
  eq(nameSkeleton(bodies[0].sig), "assignAssignReturn", "namer: assignAssignReturn");
}

/* ---- fetch -> guard -> return, idiom recognition + adjacency ---- */
{
  const src = `
async function load(id) {
  const invoice = await repo.findOne(id);
  if (!invoice) { throw new NotFoundError("no invoice"); }
  return invoice;
}`;
  const { bodies } = extractBodies(src, "b.ts");
  eq(bodies[0].sig, "FETCH GUARD_THROW RETURN", "fetchGuardReturn signature");
  eq(nameSkeleton(bodies[0].sig), "fetchGuardReturn", "namer: fetchGuardReturn");
  eq(bodies[0].stmts[0].kind, "FETCH", "stmt0 is FETCH");
  eq(bodies[0].stmts[1].idiom, "assertOrThrow", "stmt1 recognized as assertOrThrow");
  ok(bodies[0].stmts[0].fav && bodies[0].stmts[1].fav, "FETCH+GUARD tagged as fetchAndValidate pair");
  eq(bodies[0].favPairs.length, 1, "one fav pair");
}

/* ---- guard_throw return (assertOrThrow then return) ---- */
{
  const src = `function g(u){ if (!u) { throw new Err("x"); } return u.id; }`;
  const { bodies } = extractBodies(src, "c.ts");
  eq(bodies[0].sig, "GUARD_THROW RETURN", "guardReturn signature");
  eq(bodies[0].stmts[0].idiom, "assertOrThrow", "assertOrThrow idiom on guard");
  ok(!bodies[0].stmts[0].fav, "no fav pair without a preceding FETCH");
}

/* ---- try/catch, loop, call kinds ---- */
{
  const src = `
async function run(rows) {
  try { await commit(); } catch (e) { log(e); }
  for (const r of rows) { process(r); }
  emit("done");
  return;
}`;
  const { bodies } = extractBodies(src, "d.ts");
  eq(bodies[0].sig, "TRY LOOP CALL RETURN", "tryLoopCallReturn signature");
}

/* ---- throwError standalone ---- */
{
  const { bodies } = extractBodies(`function boom(){ throw new Error("k"); }`, "e.ts");
  eq(bodies[0].stmts[0].idiom, "throwError", "throwError idiom recognized");
  eq(bodies[0].sig, "THROW", "single THROW signature");
}

/* ---- ABSOLUTE RULE: gaps + statement spans reproduce the body byte-for-byte ---- */
{
  const src = `
async function complex(id, rows) {
  const inv = await repo.findOne(id);
  if (!inv) { throw new NotFoundError(\`missing \${id}\`); }
  let acc = 0;
  for (const r of rows) { acc += r.amount; }
  return { inv, acc };
}`;
  const { bodies } = extractBodies(src, "f.ts");
  const b = bodies[0];
  // rebuild body from bodyStart..bodyEnd using exact gaps + exact statement spans
  let rebuilt = "", cur = b.bodyStart;
  for (const s of b.stmts) { rebuilt += src.slice(cur, s.start) + src.slice(s.start, s.end); cur = s.end; }
  rebuilt += src.slice(cur, b.bodyEnd);
  eq(rebuilt, src.slice(b.bodyStart, b.bodyEnd), "body rebuilds byte-identical from gaps+statement spans");
}

/* ---- nested bodies are each analyzed ---- */
{
  const src = `function outer(){ const f = () => { return 1; }; return f(); }`;
  const { bodies } = extractBodies(src, "g.ts");
  ok(bodies.length === 2, "outer + nested arrow both extracted");
}

console.log(`skeleton.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
