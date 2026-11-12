// The skip guard (lib/skip-guard.js): a unit run in which any test is skipped or todo FAILS.
// The pure rules are checked directly; the wiring is checked by running run-tests.mjs for
// real over fixture test files, because "the runner fails on a skip" is a claim about a run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { platformOnly, declaredPlatforms, judgeSkips, censusArgs, verdictLines, parseCensus } from '../scripts/lib/skip-guard.js';

const ROOT = path.resolve(import.meta.dirname, '..');

test('judgeSkips refuses every plain skip and every todo', () => {
  const { accepted, refused } = judgeSkips([
    { name: 'a', skip: 'no browser' }, { name: 'b', skip: true }, { name: 'c', todo: 'later' }, { name: 'd', todo: true },
  ], 'linux');
  assert.equal(accepted.length, 0);
  assert.deepEqual(refused.map(e => [e.name, e.why]), [['a', 'skipped'], ['b', 'skipped'], ['c', 'todo'], ['d', 'todo']]);
});

test('a platform-only skip is accepted only OFF its platform, and named when it is', () => {
  const reason = platformOnly('darwin', '⌘V is a macOS paste gesture');
  assert.match(reason, /^PLATFORM-ONLY \(darwin\): /);
  assert.deepEqual(declaredPlatforms(reason), ['darwin']);
  const off = judgeSkips([{ name: 'paste', skip: reason }], 'linux');
  assert.equal(off.accepted.length, 1);
  assert.equal(off.refused.length, 0);
  assert.match(verdictLines(off).join('\n'), /1 platform-only skip\(s\) accepted on this OS:\n  - paste/);
  const on = judgeSkips([{ name: 'paste', skip: reason }], 'darwin');
  assert.equal(on.accepted.length, 0);
  assert.match(on.refused[0].why, /skipped ON it/);
});

test('a reason that only MENTIONS platform-only somewhere else is a plain skip', () => {
  assert.equal(declaredPlatforms('see PLATFORM-ONLY (darwin): later'), null);
  assert.equal(judgeSkips([{ name: 'x', skip: 'needs PLATFORM-ONLY (win32): x' }], 'linux').refused.length, 1);
  assert.throws(() => platformOnly([], 'r'));
  assert.throws(() => platformOnly('darwin', ''));
});

test('censusArgs puts the census reporter first and keeps every caller reporter paired', () => {
  const o = { reporter: 'file:///c.mjs', destination: '/r/c.jsonl' };
  assert.deepEqual(censusArgs(['t.test.mjs'], o),
    ['--test-reporter=file:///c.mjs', '--test-reporter-destination=/r/c.jsonl', '--test-reporter=spec', '--test-reporter-destination=stdout', 't.test.mjs']);
  // A lone caller reporter with no destination meant stdout; it is said explicitly.
  assert.deepEqual(censusArgs(['--test-reporter=tap', 't.test.mjs'], o),
    ['--test-reporter=file:///c.mjs', '--test-reporter-destination=/r/c.jsonl', '--test-reporter-destination=stdout', '--test-reporter=tap', 't.test.mjs']);
  // A paired caller reporter is left as it was.
  assert.deepEqual(censusArgs(['--test-reporter', 'tap', '--test-reporter-destination', 'o.tap', 't.test.mjs'], o),
    ['--test-reporter=file:///c.mjs', '--test-reporter-destination=/r/c.jsonl', '--test-reporter', 'tap', '--test-reporter-destination', 'o.tap', 't.test.mjs']);
  assert.deepEqual(parseCensus('{"name":"a","skip":"x"}\n\n'), [{ name: 'a', skip: 'x' }]);
});

// ---- the real runner ---------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skip-guard-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function fixture(name, body) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, `import test from 'node:test';\n${body}\n`);
  return f;
}
// stdio is PIPED: the inner run's output must not reach this file's own reporter stream.
// NODE_TEST_CONTEXT is dropped so the inner `node --test` runs as a top-level runner, not as a
// child of this one.
function runTests(...args) {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/run-tests.mjs'), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000, env,
  });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

test('run-tests FAILS a run whose only "problem" is a skip, a t.skip() in a body, a todo, or a skipped suite', () => {
  const f = fixture('skips.test.mjs', [
    "test('ran', () => {});",
    "test('declared skip', { skip: 'no browser here' }, () => {});",
    "test('skipped in its body', (t) => { t.skip('decided at run time'); });",
    "test('todo', { todo: 'write me' }, () => {});",
    "test.describe('whole suite', { skip: 'suite reason' }, () => { test('inner', () => {}); });",
  ].join('\n'));
  const r = runTests(f);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /\[skip-guard\] FAIL: 4 test\(s\) skipped or todo/);
  for (const s of ['declared skip — no browser here', 'skipped in its body — decided at run time', 'todo — write me', 'whole suite — suite reason']) {
    assert.ok(r.out.includes(s), `expected the guard to name "${s}":\n${r.out}`);
  }
});

test('run-tests passes a clean run, and still fails a red one on its own exit code', () => {
  assert.equal(runTests(fixture('clean.test.mjs', "test('ok', () => {});")).status, 0);
  const red = runTests(fixture('red.test.mjs', "test('no', () => { throw new Error('boom'); });"));
  assert.equal(red.status, 1, red.out);
  assert.doesNotMatch(red.out, /\[skip-guard\]/);
});

test('run-tests keeps a caller\'s own reporter working alongside the census', () => {
  const dest = path.join(tmp, 'out.tap');
  const r = runTests('--test-reporter=tap', `--test-reporter-destination=${dest}`,
    fixture('tap.test.mjs', "test('a', () => {});\ntest('b', { skip: 'x' }, () => {});"));
  assert.equal(r.status, 1, r.out);
  assert.match(fs.readFileSync(dest, 'utf8'), /^# skipped 1$/m);
  assert.match(r.out, /\[skip-guard\] FAIL: 1 test\(s\)/);
});

test('a platform-only declaration is accepted off its platform by the real runner, and printed', () => {
  const other = process.platform === 'darwin' ? 'linux' : 'darwin';
  const r = runTests(fixture('platform.test.mjs',
    `test('os-bound', { skip: ${JSON.stringify(platformOnly(other, 'only that OS has it'))} }, () => {});`));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /1 platform-only skip\(s\) accepted on this OS:/);
});
