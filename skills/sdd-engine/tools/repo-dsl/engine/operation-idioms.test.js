"use strict";
/* Tests for the STEP 4 operation-idiom + function-archetype catalogs. For every named
 * idiom that carries an example, the example must reproduce its ORIGINAL bytes from the
 * frozen template + its own hole fills (the byte-exact refill gate), and the recomputed
 * anti-unified template must equal the stored one. Catalog invariants are checked too.
 * Deterministic; runnable; exits non-zero on failure. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const { useSF, canonStmt, keyOf, fillOf } = require("./operations");
const CR = require("./corpus-root");

/* These two are STEP 4 catalogs in the corpus's legacy root `catalog/`, not §8B artifacts under
 * sen/catalog/, so they are joined here rather than resolved via artifact-contract.pathFor. */
const CATALOG = path.join(CR.corpusRoot(), "catalog");
/* A missing prerequisite must EXPLAIN ITSELF, never surface as a raw ENOENT stack — the same rule
 * `{ optional: true }` follows everywhere else in this engine (CLAUDE.md §8: a reason, never a bare
 * null). Measured 2026-08-31: neither file exists in the corpus, and the ONLY producer is
 * `archive/build-operation-idioms.js`, which hardcodes `/home/amir/Documents/Rentsync/delonix/...`
 * — the root CLAUDE.md §1 forbids and `.claude/settings.json` denies — and does not load anyway.
 * So this test cannot be satisfied from the live tree by anyone, and `run-tests.js` (which lists
 * both files as its prerequisites) reports it SKIPPED against a prerequisite nobody can produce.
 * Exit 2, not 1: nothing was tested and nothing failed. Reviving the producer or retiring this
 * test is a decision, not a fix — it is not made here. */
function required(file) {
  const abs = path.join(CATALOG, file);
  if (fs.existsSync(abs)) return JSON.parse(fs.readFileSync(abs, "utf8"));
  console.error(`SKIPPED — ${file} is absent, so no assertion in this file ran.`);
  console.error(`  looked in : ${CATALOG}   (the LEGACY STEP-4 catalog, not the §8B sen/catalog tree)`);
  console.error(`  producer  : archive/build-operation-idioms.js — ARCHIVED, hardcodes a forbidden`);
  console.error(`              corpus root at line 26, and does not load. There is no live producer.`);
  console.error(`  this is a STATE, not a failure. Whether to revive the producer or retire this`);
  console.error(`  test needs Amir; see ASSUMPTIONS.md.`);
  process.exit(2);
}
const ops = required("operation-idioms.json");
const fns = required("function-archetypes.json");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

function firstStmt(src) {
  const sf = useSF(ts.createSourceFile("s.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  return { st: sf.statements[0], sf };
}

/* 1. catalog shape + provenance */
ok("catalogs are zero-model, deterministic exports", () => {
  assert.equal(ops.foldModelCalls, 0);
  assert.equal(ops.buildModelCalls, 0);
  assert.equal(fns.foldModelCalls, 0);
  assert.ok(ops.idiomCount === ops.idioms.length && ops.idiomCount > 0, "idiom count");
  assert.ok(fns.archetypeCount === fns.archetypes.length && fns.archetypeCount > 0, "archetype count");
});

/* 2. every claimed idiom's example round-trips BYTE-EXACT and recomputes its template */
let checked = 0;
for (const it of ops.idioms) {
  if (!it.example) continue;
  ok(`${it.id} "${it.name}" — example refills byte-exact + template matches`, () => {
    const { st } = firstStmt(it.example);
    const parts = canonStmt(st, "op");
    assert.ok(parts, `example is not a simple statement: ${it.example}`);
    assert.equal(keyOf(parts), it.template, "recomputed template differs from catalog");
    assert.equal(fillOf(parts), it.example, "byte-exact refill failed (template + fills !== source)");
    checked++;
  });
}
ok("a substantial share of idioms carry a verifiable example", () => {
  assert.ok(checked >= Math.min(20, ops.idioms.length), `only ${checked} idioms had round-trippable examples`);
});

/* 3. claimed sites never exceed seen; claimed subset is byte-exact by construction */
ok("sitesClaimed <= sitesSeen and claimedByteExact == 100 for every idiom", () => {
  for (const it of ops.idioms) {
    assert.ok(it.sitesClaimed <= it.sitesSeen, `${it.id} claims more than seen`);
    assert.equal(it.claimedByteExact, 100, `${it.id} claimed subset not 100% byte-exact`);
    assert.ok(it.sitesClaimed >= 20, `${it.id} below min-site floor`);
  }
});

/* 4. the headline named-operation measure is internally consistent */
ok("namedOperationPct == sum(sitesClaimed) / productionSimpleStatements", () => {
  const sum = ops.idioms.reduce((a, it) => a + it.sitesClaimed, 0);
  assert.equal(sum, ops.namedOperationStatements);
  assert.equal(+(100 * sum / ops.productionSimpleStatements).toFixed(1), ops.namedOperationPct);
});

/* 5. function archetypes are well-formed and recurring */
ok("each archetype names a recurring shape with a control-flow skeleton", () => {
  for (const a of fns.archetypes) {
    assert.ok(a.functions >= 3, `${a.id} not recurring`);
    assert.ok(a.skeleton && a.skeleton.length, `${a.id} empty skeleton`);
    assert.ok(a.examples.length >= 1, `${a.id} no examples`);
  }
  assert.equal(fns.namedArchetypeFunctions, fns.archetypes.reduce((s, a) => s + a.functions, 0));
});

console.log(`\noperation-idioms.test: ${pass} passed (${checked} idiom examples byte-exact)`);
