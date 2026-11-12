// Tests for scripts/test-report.sh — the opt-in wrapper that prints ONE unambiguous
// result line ("TEST-RESULT: PASS (exit 0)" / "TEST-RESULT: FAIL (exit N)") carrying
// the wrapped command's REAL exit code, so a clean run can't be misread as red by an
// ad-hoc tally. Driven with `true`/`false` stubs — deterministic, fast, non-recursive
// (never invokes `npm test`). Zero-dep: `node --test tests/test-report.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'test-report.sh');

// The script is POSIX sh, so on Windows every test here is a real node:test SKIP. (It was a
// printed line and process.exit(0), which the runner counted as a pass.)
const skip = process.platform === 'win32' && 'scripts/test-report.sh is POSIX sh';

// Run the wrapper with an explicit command; return { code, out }.
const run = (...cmd) => {
  try {
    const out = execFileSync('sh', [SCRIPT, ...cmd], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: (err.stdout || '') + (err.stderr || '') };
  }
};

test('a passing command reports PASS and exits 0', { skip }, () => {
  const { code, out } = run('true');
  assert.equal(code, 0);
  assert.match(out, /TEST-RESULT: PASS \(exit 0\)/);
});

test('a failing command reports FAIL with the real code and exits with it', { skip }, () => {
  const { code, out } = run('false');
  assert.equal(code, 1);
  assert.match(out, /TEST-RESULT: FAIL \(exit 1\)/);
});

test('the exact non-zero code is preserved, not flattened to 1', { skip }, () => {
  const { code, out } = run('sh', '-c', 'exit 7');
  assert.equal(code, 7);
  assert.match(out, /TEST-RESULT: FAIL \(exit 7\)/);
});

test('the empty-failure-list footgun is gone: a clean run never reads as red', { skip }, () => {
  // The original friction: `[ -n "$failed" ]` returns 1 on an empty list after a
  // genuine exit-0 run. Here a passing command yields PASS + exit 0, full stop.
  const { code, out } = run('true');
  assert.equal(code, 0);
  assert.doesNotMatch(out, /FAIL/);
});


test('with no arguments it runs TEST_REPORT_CMD as a whole command line', { skip }, () => {
  const at = cmd => {
    try { return { code: 0, out: execFileSync('sh', [SCRIPT], { encoding: 'utf8', env: { ...process.env, TEST_REPORT_CMD: cmd } }) }; }
    catch (err) { return { code: err.status, out: (err.stdout || '') + (err.stderr || '') }; }
  };
  const ok = at('echo ran with args && true');
  assert.equal(ok.code, 0);
  assert.match(ok.out, /ran with args\nTEST-RESULT: PASS \(exit 0\)\n$/);
  const bad = at('exit 3');
  assert.equal(bad.code, 3);
  assert.match(bad.out, /TEST-RESULT: FAIL \(exit 3\)\n$/);
});
