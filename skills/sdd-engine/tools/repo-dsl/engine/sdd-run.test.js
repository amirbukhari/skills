"use strict";
/* CONTRACT GUARD for sdd-run.js — the machine-callable front end a UI drives.
 *
 * WHY THIS EXISTS. sdd-run.js is the one interface built to be consumed by something other than a
 * person, and until now NOTHING guarded it. Every other file in this engine is checked by the thing
 * downstream of it: a bad dictionary fails the round-trip, a bad artifact header fails stamp:check.
 * The manifest has no such consumer yet — the UI is being wired next week — so a step whose `npm`
 * name was renamed in package.json, or whose `needs` names an artifact kind that does not exist,
 * would break in the UI and nowhere else. That is a bug found by a person clicking a button, which
 * is the most expensive place to find one.
 *
 * WHAT THIS PINS, and what it deliberately does NOT. It pins the SHAPE of the contract and the
 * REFERENTIAL INTEGRITY of the manifest — every script named exists, every npm script named exists,
 * every artifact kind named is registered. It does NOT pin the step list, the timings, or the prose:
 * those change legitimately and a test that froze them would be noise. Adding a step must not fail
 * this test; renaming a script out from under a step must.
 *
 * §10.4: this pins an inventory only where the inventory is a CROSS-REFERENCE that can silently rot.
 *
 * TIER: unit. Runs the wrapper's --list/--status paths, which read roots and the artifact registry
 * but need no mined corpus and no .en — absent artifacts are a reported state, not a failure. */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

let pass = 0;
const ok = (n, fn) => { try { fn(); pass++; console.log(`  ok  ${n}`); } catch (e) { console.error(`FAIL  ${n}\n      ${e.stack}`); process.exitCode = 1; } };

const R = path.join(__dirname, "..");
const RUN = path.join(R, "sdd-run.js");
const AC = require("./artifact-contract");

function sdd(args) {
  const r = spawnSync(process.execPath, [RUN, ...args], { cwd: R, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
/* The contract is "stdout is EXACTLY ONE JSON document". Parsing it is the test of that claim —
 * a second document, or one byte of prose, makes JSON.parse throw. */
const parseOne = (s) => JSON.parse(s);

/* WHY THIS IS GUARDED. The manifest is parsed at module scope so every later assertion can read it,
 * which means a wrapper that CRASHES leaves this file throwing at load — printing a stack trace and
 * running zero assertions, which reads as "no failures" to anything grepping for FAIL. That is the
 * exact shape that let test-lzw-roundtrip.js sit dead for hours (a TDZ ReferenceError at load, every
 * static check green). So a broken wrapper must surface as a FAILING assertion, not as an
 * unhandled throw. */
const listRes = sdd(["--list"]);
let manifest = null, listParseError = null;
try { manifest = parseOne(listRes.out); } catch (e) { listParseError = e; }
ok("--list is parseable at all — a crashing wrapper fails here, it does not kill the suite", () => {
  assert.strictEqual(listParseError, null,
    `sdd-run --list did not emit parseable JSON (exit ${listRes.code}). stderr:\n${listRes.err.slice(0, 600)}`);
});
if (listParseError) { console.error("\n  ABORTING: the manifest could not be read; later assertions would be meaningless."); process.exit(1); }
const STEPS = manifest.steps;

ok("--list emits exactly one JSON document on stdout, and exits 0", () => {
  assert.strictEqual(listRes.code, 0);
  assert.strictEqual(manifest.schema, "sdd-run/v1");
  assert.strictEqual(manifest.kind, "manifest");
  assert.ok(Array.isArray(STEPS) && STEPS.length > 0, "manifest carries steps");
});

ok("--status emits exactly one JSON document, with roots and artifact state", () => {
  const r = sdd(["--status"]);
  const s = parseOne(r.out);
  assert.strictEqual(s.kind, "status");
  assert.ok(s.roots.source && s.roots.corpus, "both roots reported");
  assert.ok(s.artifacts && typeof s.artifacts === "object", "artifact state reported");
  /* Absent is a STATE, not a failure — the same rule run-tests.js learned the hard way. A fresh
   * corpus has no mined artifacts and --status must still exit 0 and describe them. */
  assert.strictEqual(r.code, 0, "--status exits 0 even with artifacts absent");
});

ok("every step declares the fields a UI renders before it dares run anything", () => {
  for (const s of STEPS) {
    assert.ok(s.id, "step has an id");
    assert.ok(s.title, `${s.id}: has a title`);
    assert.ok(s.phase, `${s.id}: has a phase`);
    assert.ok(Array.isArray(s.cmd) && s.cmd.length > 0, `${s.id}: has a cmd`);
    assert.ok(Array.isArray(s.needs), `${s.id}: needs is an array (absent means "none", never undefined)`);
    assert.strictEqual(typeof s.expensive, "boolean", `${s.id}: expensive is declared, not inferred`);
    assert.strictEqual(typeof s.destructive, "boolean", `${s.id}: destructive is declared, not inferred`);
  }
});

ok("step ids are unique — a UI keys on them", () => {
  const ids = STEPS.map((s) => s.id);
  assert.deepStrictEqual(ids, [...new Set(ids)], "no duplicate step id");
});

/* THE THREE CROSS-REFERENCES THAT CAN ROT SILENTLY. Each one names something owned by another
 * file; each one breaks in the UI and nowhere else if that file moves. */

ok("every script a step runs exists on disk", () => {
  for (const s of STEPS) {
    const script = s.cmd[0];
    assert.ok(fs.existsSync(path.join(R, script)),
      `${s.id}: cmd names ${script}, which does not exist — a rename broke the manifest`);
  }
});

ok("every npm script a step names exists in package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(R, "package.json"), "utf8"));
  for (const s of STEPS) {
    if (!s.npm) continue;
    assert.ok(Object.prototype.hasOwnProperty.call(pkg.scripts, s.npm),
      `${s.id}: names npm script "${s.npm}", which package.json does not define`);
  }
});

ok("every artifact kind in a step's `needs` is registered in the artifact contract", () => {
  const kinds = new Set(AC.kindsOf());
  for (const s of STEPS) {
    for (const k of s.needs) {
      assert.ok(kinds.has(k),
        `${s.id}: needs "${k}", which is not a registered artifact kind — this step could never ` +
        `become ready, and would report a prerequisite a UI can never satisfy`);
    }
  }
});

/* THE TWO REFUSALS. Both are safety, not convenience, so both are pinned. */

ok("an unknown step is refused with exit 2 and a JSON error naming the known steps", () => {
  const r = sdd(["no-such-step"]);
  assert.strictEqual(r.code, 2, "2 means sdd-run itself refused");
  const e = parseOne(r.out);
  assert.strictEqual(e.error, "unknown-step");
  assert.ok(Array.isArray(e.known) && e.known.length > 0, "the refusal names what IS valid");
});

ok("a destructive step REFUSES without --allow-destructive, and deletes nothing", () => {
  const destructive = STEPS.filter((s) => s.destructive);
  assert.ok(destructive.length > 0, "at least one step is marked destructive (clean:sen)");
  for (const s of destructive) {
    const r = sdd([s.id]);
    assert.strictEqual(r.code, 2, `${s.id}: refused with 2`);
    assert.strictEqual(parseOne(r.out).error, "refused-destructive", `${s.id}: refused for the right reason`);
  }
});

/* THE ROT GUARD. This paragraph of the contract rotted twice in one day, in two files, and both
 * times the rotted text was a COVERAGE COUNT for the requirements register asserting zero failures
 * on a day a row failed. The register's coverage moves every time a row is mechanized, so any count
 * written into the manifest is stale by the next commit. The fix was to defer to the runner's own
 * `--json summary`; this keeps it deferred. */
ok("the register step does not hardcode a coverage count — it defers to the runner's own summary", () => {
  const reg = STEPS.find((s) => s.id === "register");
  assert.ok(reg, "the register step exists");
  const text = [reg.coverageWarning, reg.detail, reg.note].filter(Boolean).join(" ");
  assert.ok(/summary|--json/.test(text),
    "the warning must point a UI at the runner's own summary as authoritative");
  const undated = text.replace(/measured[^.]*\./gi, "");
  assert.ok(!/mechaniz\w*\s+\d+\s+rows?/i.test(undated),
    "an undated 'mechanizes N rows' claim rots the moment a row is mechanized — date it or drop it");
});

/* THE DEFAULTLESS-POSITIONAL CLASS. reconcile-names.js:25 reads `process.argv[2]` as a mandatory
 * census file with no default, and nothing in the live pipeline writes one — so `sdd-run reconcile`
 * used to spawn a child that died at LOAD with ERR_INVALID_ARG_TYPE. A UI would have rendered a
 * one-click step that can never work, and the failure would read as "the tool crashed" rather than
 * "you must supply a census". CLAUDE.md §9 records the identical bug in author-names.js, which is
 * why this pins the CLASS: any step whose script reads a defaultless positional must declare it.
 *
 * The check is deliberately narrow — `const X = process.argv[N];` with no `||` fallback. A script
 * that defaults its positional is fine and must not trip this. */
ok("a step whose script reads a defaultless positional must declare requiresArgv", () => {
  let checked = 0;
  for (const s of STEPS) {
    const src = fs.readFileSync(path.join(R, s.cmd[0]), "utf8");
    const m = src.match(/^\s*const\s+(\w+)\s*=\s*process\.argv\[(\d)\]\s*;/m);
    if (!m) continue;
    checked++;
    assert.ok(Array.isArray(s.requiresArgv) && s.requiresArgv.length,
      `${s.id}: ${s.cmd[0]} reads process.argv[${m[2]}] as ${m[1]} with no default, but the step ` +
      `does not declare requiresArgv — a UI would offer it as one-click and the child would die at load`);
  }
  assert.ok(checked > 0, "the probe still finds at least one such script (reconcile); if not, the regex has rotted");
});

ok("a step declaring requiresArgv REFUSES with a reason, not a stack trace, when given none", () => {
  const needy = STEPS.filter((s) => Array.isArray(s.requiresArgv) && s.requiresArgv.length);
  assert.ok(needy.length > 0, "at least one step declares requiresArgv");
  for (const s of needy) {
    const r = sdd([s.id]);
    assert.strictEqual(r.code, 2, `${s.id}: sdd-run refused (2), rather than relaying a child crash`);
    const e = parseOne(r.out);
    assert.strictEqual(e.error, "missing-argv", `${s.id}: refused for the stated reason`);
    assert.ok(e.hint && e.hint.includes("--"), `${s.id}: the refusal shows HOW to supply it`);
    /* The refusal must precede the corpus-readiness check: an argument the caller never passed is
     * the caller's error and is true regardless of what is mined. Otherwise a UI author fixes
     * "not-ready" first and only then discovers the step could never run. */
    assert.notStrictEqual(e.kind, "not-ready", `${s.id}: argv refusal comes before the readiness check`);
  }
});

console.log(`\n${pass} assertions passed`);
