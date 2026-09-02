"use strict";
/* THE NDJSON PROGRESS STREAM (engine/progress.js, PRD §5D.5, R-UI-1..3).
 *
 * What must hold for a UI to consume this without a heuristic:
 *   1. with --json, stdout is NDJSON and NOTHING else — every line parses, on its own;
 *   2. without --json, stdout is byte-identical to what it was before this existed;
 *   3. the gate result is a first-class event, and it can be FALSE (§10.3 — a gate that cannot be
 *      shown to fire is not a gate);
 *   4. both scripts speak the same schema, because they import the same emitter.
 *
 * The two scripts are run as SUBPROCESSES against temporary roots, which is how a UI runs them and
 * the only way to observe the actual stdout/stderr split. No corpus is written: the render runs
 * --dry-run with no --out, and the mine writes into a temp CORPUS. */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const P = require("./progress");
const CR = require("./corpus-root");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const RD = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sdd-progress-"));
const run = (script, args, env) => spawnSync(process.execPath, [path.join(RD, script), ...args],
  { env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const parseNd = (s) => s.split("\n").filter(Boolean).map((line, i) => {
  try { return JSON.parse(line); } catch (e) { throw new assert.AssertionError({ message: `stdout line ${i + 1} is not JSON: ${JSON.stringify(line.slice(0, 120))}` }); }
});

/* a tiny SOURCE tree, so the render case is a test and not a corpus run */
const SRC = path.join(TMP, "src");
fs.mkdirSync(path.join(SRC, "sub"), { recursive: true });
const REAL = CR.sourceRoot();
const pick = fs.readdirSync(path.join(REAL, "src")).filter((f) => f.endsWith(".ts")).slice(0, 3);
for (const f of pick) fs.copyFileSync(path.join(REAL, "src", f), path.join(SRC, f));
assert.ok(pick.length > 0, "fixture: no source files to copy");

/* ---- 1. the emitter's own contract ---- */
ok("emits nothing at all without --json, and the prose stays on stdout", () => {
  const p = P.open({ step: "t", argv: ["node", "x.js"] });
  assert.strictEqual(p.enabled, false);
  const writes = [];
  const real = process.stdout.write;
  process.stdout.write = (s) => { writes.push(s); return true; };
  try { p.start({ a: 1 }); p.gate({ pass: true }); p.end({ exitCode: 0 }); } finally { process.stdout.write = real; }
  assert.strictEqual(writes.length, 0, `emitted ${writes.length} lines with --json absent`);
});

ok("the event vocabulary is closed — an unknown event name is REFUSED, not emitted", () => {
  const p = P.open({ step: "t", argv: ["--json"] });
  const writes = [];
  const real = process.stdout.write;
  process.stdout.write = (s) => { writes.push(s); return true; };
  let threw = null;
  try { p.emit("tick", { a: 1 }); } catch (e) { threw = e; } finally { process.stdout.write = real; }
  assert.ok(!P.EVENTS.includes("tick"), "fixture: 'tick' must not be a real event or this proves nothing");
  assert.ok(threw, "an unknown event name was accepted — a consumer would meet a name it cannot switch on");
  assert.match(threw.message, /vocabulary is closed/);
  assert.strictEqual(writes.length, 0, "the bad event was written to stdout before throwing");
  /* and the control: a KNOWN name goes through, so the guard is not simply refusing everything */
  process.stdout.write = (s) => { writes.push(s); return true; };
  try { p.emit("gate", { pass: true }); } finally { process.stdout.write = real; }
  assert.strictEqual(writes.length, 1, "a valid event did not emit — the guard refuses everything");
  assert.strictEqual(JSON.parse(writes[0]).event, "gate");
});

/* ---- 2. render: --json ---- */
const R = run("write-en-files.js", ["--dry-run", "--json"], { SOURCE: SRC, CORPUS: CR.corpusRoot() });
ok("render --json: stdout is pure NDJSON, prose is on stderr", () => {
  assert.strictEqual(R.status, 0, `exit ${R.status}\n${R.stderr}`);
  const docs = parseNd(R.stdout);
  assert.ok(docs.length >= 4, `only ${docs.length} events`);
  for (const d of docs) {
    assert.strictEqual(d.schema, P.SCHEMA, `wrong schema ${d.schema}`);
    assert.strictEqual(d.step, "render");
    assert.ok(P.EVENTS.includes(d.event), `unknown event ${d.event}`);
    assert.strictEqual(typeof d.seq, "number");
    assert.strictEqual(typeof d.ms, "number");
  }
  assert.deepStrictEqual(docs.map((d) => d.seq), docs.map((_, i) => i), "seq is not monotonic from 0");
  assert.ok(/BYTE-IDENTICAL/.test(R.stderr), "the prose did not go to stderr");
  console.log(`      ${docs.length} events over ${pick.length} files; prose ${R.stderr.split("\n").length} lines on stderr`);
});

ok("render --json: start / file / gate / summary / end are all present and shaped", () => {
  const docs = parseNd(R.stdout);
  const by = (e) => docs.filter((d) => d.event === e);
  assert.strictEqual(by("start").length, 1, "expected exactly one start");
  assert.strictEqual(by("end").length, 1, "expected exactly one end");
  assert.strictEqual(by("summary").length, 1, "expected exactly one summary");
  assert.strictEqual(by("file").length, pick.length, `expected one file event per source file`);
  const g = by("gate")[0];
  assert.ok(g, "no gate event — the byte-identity result is not machine-readable");
  assert.strictEqual(g.name, "byte-identity");
  assert.strictEqual(g.requirement, "R-REND-1");
  assert.strictEqual(g.pass, true);
  assert.strictEqual(g.total, pick.length);
  assert.strictEqual(g.passed, pick.length);
  assert.ok(Array.isArray(g.failures), "failures must be a list, so a UI can name the failing file");
  const f = by("file")[0];
  for (const k of ["rel", "done", "total", "byteIdentical"]) assert.ok(k in f, `file event has no ${k}`);
  const e = by("end")[0];
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.exitCode, 0);
  const s = by("summary")[0];
  assert.ok(s.reviewSurface && s.generators && s.gate, "summary must carry the manifest's own numbers");
});

/* ---- 3. render: the prose mode is untouched ---- */
ok("render without --json: stdout is prose, byte-identical to the prose --json puts on stderr", () => {
  const plain = run("write-en-files.js", ["--dry-run"], { SOURCE: SRC, CORPUS: CR.corpusRoot() });
  assert.strictEqual(plain.status, 0, `exit ${plain.status}\n${plain.stderr}`);
  assert.strictEqual(plain.stdout.indexOf(P.SCHEMA), -1, "a JSON document leaked onto stdout without --json");
  assert.strictEqual(plain.stderr, "", `stderr should be empty without --json, got ${plain.stderr.length} bytes`);
  assert.strictEqual(plain.stdout, R.stderr,
    "the prose differs between modes — --json must move it, never change it");
  console.log(`      ${plain.stdout.length} bytes of prose, identical in both modes`);
});

/* ---- 4. mine: --json, into a temp corpus ---- */
const MC = path.join(TMP, "corpus");
fs.mkdirSync(MC, { recursive: true });
const M = run("build-lzw-generators.js", ["--json"], { SOURCE: SRC, CORPUS: MC });
ok("mine --json: same schema, phases named, gate present", () => {
  assert.strictEqual(M.status, 0, `exit ${M.status}\n${M.stderr}`);
  const docs = parseNd(M.stdout);
  for (const d of docs) { assert.strictEqual(d.schema, P.SCHEMA); assert.strictEqual(d.step, "mine"); }
  const phases = docs.filter((d) => d.event === "phase");
  const names = [...new Set(phases.map((p) => p.name))];
  for (const n of ["parse", "build", "write"]) assert.ok(names.includes(n), `no '${n}' phase — a UI has one stalling bar`);
  for (const p of phases) assert.ok(p.state === "begin" || p.state === "end", `phase state ${p.state}`);
  const g = docs.find((d) => d.event === "gate");
  assert.ok(g && g.name === "non-empty-mine" && g.pass === true, "the mine's gate is missing or did not pass");
  assert.strictEqual(docs.filter((d) => d.event === "end")[0].ok, true);
  console.log(`      ${docs.length} events, phases: ${names.join(", ")}`);
});

/* ---- 5. THE GATE CAN BE FALSE (§10.3). Without this the gate is decoration. ---- */
ok("mine --json: an empty SOURCE makes the gate FAIL, and the stream says so before exit 1", () => {
  const empty = path.join(TMP, "empty");
  fs.mkdirSync(empty, { recursive: true });
  const F = run("build-lzw-generators.js", ["--json"], { SOURCE: empty, CORPUS: MC });
  assert.strictEqual(F.status, 1, `expected exit 1, got ${F.status}`);
  const docs = parseNd(F.stdout);
  const g = docs.find((d) => d.event === "gate");
  assert.ok(g, "no gate event on the failing path");
  assert.strictEqual(g.pass, false, "the gate reported PASS on a mine that parsed nothing");
  assert.ok(g.problems.length > 0, "a failing gate must say what failed");
  const err = docs.find((d) => d.event === "error");
  assert.ok(err && err.requirement === "R-PIN-6", "no error event citing the requirement");
  const e = docs.find((d) => d.event === "end");
  assert.strictEqual(e.ok, false, "end.ok must be false when the exit code is non-zero");
  assert.strictEqual(e.exitCode, 1);
  console.log(`      gate pass:false, error reason:${err.reason}, end.ok:false, exit 1`);
});

/* ---- 6. one schema, two scripts ---- */
ok("both scripts emit the same schema string, from the same module", () => {
  assert.strictEqual(parseNd(R.stdout)[0].schema, parseNd(M.stdout)[0].schema);
  assert.strictEqual(parseNd(R.stdout)[0].schema, P.SCHEMA);
});

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* best effort */ }
console.log(`\nPASS ${pass} assertions — NDJSON on stdout under --json, prose untouched without it, gates machine-readable and falsifiable.`);
