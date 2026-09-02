"use strict";
/* GUARD: tools/sdd-check.js must never report a green for a run that verified nothing.
 *
 * sdd-check is the drift detector a UI polls, and it DEFINES validity as fixtures-pass. That makes
 * two states dangerous, because both look exactly like success from the outside:
 *
 *   - an example with no modules at all       -> nothing to check
 *   - a module whose example ships no verify  -> nothing to check it WITH
 *
 * Both reported OK / "in sync" / exit 0 until 2026-09-01. This file pins the fix. It exists because
 * of what the false green cost: `Examples/hydra-source` is a MINING CORPUS with no spec/ directory,
 * and asking sdd-check about it returned "=> in sync", exit 0 — a confident all-clear about a
 * directory the tool cannot answer questions about at all.
 *
 * The tool is a CLI that calls process.exit at module scope, so every case here SPAWNS it against a
 * purpose-built temp example rather than requiring it. That also means these assertions are about
 * real observed behaviour — stdout and an exit code — not about an internal the tool could stop
 * using. (Same approach as engine/sdd-run.test.js, which spawns the wrapper it guards.)
 *
 * No corpus prerequisite: every example is built here in a tmpdir.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CHECK = path.join(__dirname, "..", "..", "sdd-check.js");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const run = (dir) => {
  const r = spawnSync("node", [CHECK, dir], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

/** Build a temp example. `verify` null = ship no tools/verify.js; true/false = ship one that passes/fails. */
function example({ modules = [], verify = null, generated = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-check-"));
  const artifacts = [];
  for (const m of modules) {
    const md = path.join(dir, "spec", "modules", m);
    fs.mkdirSync(path.join(md, "fixtures"), { recursive: true });
    fs.writeFileSync(path.join(md, "spec.md"), `# ${m}\n`);
    fs.writeFileSync(path.join(md, "fixtures", "a.json"), `{"case":"${m}"}\n`);
    if (generated) {
      fs.mkdirSync(path.join(dir, "generated"), { recursive: true });
      fs.writeFileSync(path.join(dir, "generated", `${m}.ts`), `export const ${m} = 1;\n`);
    }
    artifacts.push(m);
  }
  if (verify !== null) {
    fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tools", "verify.js"),
      verify ? `console.log("fixtures pass");\nprocess.exit(0);\n`
             : `console.error("fixture case 'a' FAILED");\nprocess.exit(1);\n`);
  }
  return { dir, artifacts };
}

/* Provenance must record the spec-input hashes the tool will recompute, or every module reads
 * STALE and the verify branch is never reached. Built with the tool's own library so the hashing
 * rule has exactly one spelling — a second copy here would drift and quietly turn these into
 * STALE tests that assert nothing about verification. */
const lib = require(path.join(__dirname, "..", "..", "sdd-lib.js"));
function withProvenance(ex) {
  fs.writeFileSync(path.join(ex.dir, ".sdd-provenance.json"), JSON.stringify({
    artifacts: ex.artifacts.map((m) => ({
      module: m, path: path.join("generated", `${m}.ts`), lang: "ts",
      specInputs: lib.specInputsHashMap(ex.dir, m),
      fixturesHash: lib.fixturesHash(ex.dir, m),
    })),
  }, null, 2) + "\n");
  return ex;
}

/* ============================================ (1) THE EMPTY-SET FALSE GREEN */

ok("an example with NO modules refuses instead of reporting in sync", () => {
  /* `[].every(...)` is true. That one line of JavaScript is the whole bug: a tool that checked
   * nothing satisfied "every result is OK" and exited 0. */
  const { dir } = example({ modules: [] });
  const r = run(dir);
  assert.strictEqual(r.code, 2, `expected exit 2 (could not ask), got ${r.code}\n${r.out}`);
  assert.match(r.out, /NOTHING CHECKED/, "the verdict must say nothing was checked");
  /* Anchored to the VERDICT line, not the words. The refusal text itself contains the phrase
   * `This is not "in sync"`, and a bare /in sync/ matched that — caught by this assertion failing
   * on the fixed tool. The success verdict is the line beginning `=> in sync`, and that is what
   * must be absent. Narrowing here is not weakening: it is the difference between testing the
   * tool's verdict and testing its prose. */
  assert.doesNotMatch(r.out, /^\s*=> in sync/m, "an empty run must never print the success verdict");
});

ok("the refusal names the directory it looked in", () => {
  /* A refusal that does not say where it looked sends the reader to guess at the layout. */
  const { dir } = example({ modules: [] });
  const r = run(dir);
  assert.ok(r.out.includes(path.join(dir, "spec", "modules")), `refusal did not name the path it searched:\n${r.out}`);
});

ok("exit 2, not 1 — 'nothing checked' is not 'drift detected'", () => {
  /* Collapsing them would trade one false claim for another: exit 1 asserts drift was FOUND, and a
   * caller that retries or alerts on drift would be reacting to a finding that does not exist. */
  const { dir } = example({ modules: [] });
  assert.strictEqual(run(dir).code, 2);
  const withDrift = withProvenance(example({ modules: ["alpha"], verify: false }));
  assert.strictEqual(run(withDrift.dir).code, 1, "a real fixture failure must still be exit 1");
});

/* ================================== (2) THE MISSING-VERIFY-TOOL FALSE GREEN */

ok("a module in an example with NO tools/verify.js is UNVERIFIED, not OK", () => {
  /* runVerify is tri-state: true / false / null. Only `=== false` was handled, so null — "this
   * example ships no fixture runner" — fell through to OK with the detail "fixtures pass". */
  const ex = withProvenance(example({ modules: ["alpha"], verify: null }));
  const r = run(ex.dir);
  assert.match(r.out, /UNVERIF/, `expected the UNVERIFIED state:\n${r.out}`);
  assert.doesNotMatch(r.out, /fixtures pass/, "no fixture ran, so nothing may claim they passed");
  assert.notStrictEqual(r.code, 0, "an unverifiable module must not exit clean");
});

ok("the UNVERIFIED line says WHY it could not be verified", () => {
  const ex = withProvenance(example({ modules: ["alpha"], verify: null }));
  const r = run(ex.dir);
  assert.match(r.out, /no tools\/verify\.js/, `the reason must name the absent tool:\n${r.out}`);
  assert.match(r.out, /validity is fixtures-pass/, "and must say why that makes the answer unknown");
});

ok("shipping a PASSING verify tool is what turns the same example green", () => {
  /* The control. Without it the assertions above could be satisfied by a tool that never reports OK
   * at all, and the guard would be pinning a broken checker rather than a fixed one. */
  const ex = withProvenance(example({ modules: ["alpha"], verify: true }));
  const r = run(ex.dir);
  assert.strictEqual(r.code, 0, `a verified module should exit 0:\n${r.out}`);
  assert.match(r.out, /in sync/);
  assert.match(r.out, /OK/);
});

ok("a FAILING verify tool is INVALID — the fix did not blunt real detection", () => {
  const ex = withProvenance(example({ modules: ["alpha"], verify: false }));
  const r = run(ex.dir);
  assert.match(r.out, /INVALID/, `a failing fixture must still read INVALID:\n${r.out}`);
  assert.strictEqual(r.code, 1);
});

ok("UNVERIFIED is distinct from every state that already existed", () => {
  /* If it collapsed into an existing label a consumer could not tell "no fixture runner" from
   * "fixtures failed" — opposite conditions needing opposite responses (ship a verify tool vs. fix
   * the artifact). */
  const unver = run(withProvenance(example({ modules: ["alpha"], verify: null })).dir).out;
  const invalid = run(withProvenance(example({ modules: ["alpha"], verify: false })).dir).out;
  assert.ok(unver.includes("UNVERIF") && !unver.includes("INVALID"), "UNVERIFIED must not read as INVALID");
  assert.ok(invalid.includes("INVALID") && !invalid.includes("UNVERIF"), "INVALID must not read as UNVERIFIED");
});

/* ===================================================== (3) THE REAL CORPUS */

ok("the real corpus reproduces the bug this file exists for", () => {
  /* Examples/hydra-source is the MINING corpus: a whole TypeScript repo walked read-only by the
   * repo-dsl pipeline. It has no spec/, so it is not an SDD example at all — and asking sdd-check
   * about it used to return "=> in sync", exit 0.
   *
   * Skipped rather than failed when the corpus is absent: its presence is a STATE of the machine,
   * and a guard that fails on a missing corpus is measuring the checkout, not the tool. */
  const corpus = path.join(__dirname, "..", "..", "..", "Examples", "hydra-source");
  if (!fs.existsSync(corpus)) { console.log("      SKIP — Examples/hydra-source is not present here"); return; }
  const r = run(corpus);
  assert.strictEqual(r.code, 2, `the mining corpus must refuse, not report in sync (got exit ${r.code}):\n${r.out}`);
  assert.match(r.out, /MINING CORPUS/, "the refusal should name the likely cause for this shape of directory");
});

console.log(`\n${pass} assertions passed`);
