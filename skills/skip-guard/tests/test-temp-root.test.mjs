// lib/test-temp-root.js + run-tests.mjs: one temp root per `npm test`, removed on exit,
// and a sweep of roots left by killed runs that touches nothing it did not make.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRoot, staleRoots, rootEnv, testArgs, rootPath, MARKER, DEFAULT_GLOB } from '../scripts/lib/test-temp-root.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;

function base() { return fs.mkdtempSync(path.join(os.tmpdir(), 'ttr-')); }

test('createRoot makes a private stamped dir and refuses to adopt an existing one', () => {
  const b = base();
  const r = createRoot(fs, b, 4242, Date.UTC(2026, 8, 30));
  assert.equal(r, rootPath(b, 4242));
  if (process.platform !== 'win32') assert.equal(fs.statSync(r).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r, MARKER), 'utf8')), { pid: 4242, startedAt: '2026-09-30T00:00:00.000Z' });
  assert.throws(() => createRoot(fs, b, 4242), /EEXIST/);
});

test('staleRoots picks only our marked, owned, dead-pid roots', () => {
  const b = base();
  const dead = createRoot(fs, b, 1001);
  createRoot(fs, b, 1002); // alive
  fs.mkdirSync(path.join(b, 'node-test-root-1003')); // no marker → not ours
  const wrong = path.join(b, 'node-test-root-1004'); fs.mkdirSync(wrong);
  fs.writeFileSync(path.join(wrong, MARKER), JSON.stringify({ pid: 9 })); // marker names another pid
  fs.mkdirSync(path.join(b, 'node-test-root-abc')); // not a pid
  fs.mkdirSync(path.join(b, 'other-home-1005')); // someone else's
  const target = createRoot(fs, fs.mkdtempSync(path.join(b, 'elsewhere-')), 1006);
  fs.symlinkSync(target, path.join(b, 'node-test-root-1006')); // a symlink is never followed
  const alive = pid => pid === 1002;
  assert.deepEqual(staleRoots({ fs, tmpBase: b, uid, alive }), [dead]);
  // Nothing was removed by the planner.
  assert.equal(fs.readdirSync(b).length, 8);
});

test('staleRoots skips a root owned by another uid', { skip: typeof uid !== 'number' }, () => {
  const b = base();
  createRoot(fs, b, 1001);
  assert.deepEqual(staleRoots({ fs, tmpBase: b, uid: uid + 1, alive: () => false }), []);
});

test('staleRoots on a missing base is empty, not a throw', () => {
  assert.deepEqual(staleRoots({ fs, tmpBase: path.join(base(), 'nope'), uid, alive: () => false }), []);
});

test('rootEnv points every temp variable at the root', () => {
  assert.deepEqual(rootEnv('/r'), { TMPDIR: '/r', TMP: '/r', TEMP: '/r', TEST_TMP_ROOT: '/r' });
});

test('testArgs keeps every argument in order and adds the default glob whenever no path is given', () => {
  assert.deepEqual(testArgs([]), ['--test', DEFAULT_GLOB]);
  assert.deepEqual(testArgs(['tests/a.test.mjs']), ['--test', 'tests/a.test.mjs']);
  // A value-taking flag in its space form stays a flag + value, never a path.
  assert.deepEqual(testArgs(['tests/**/*.test.mjs', '--test-concurrency', '1']), ['--test', 'tests/**/*.test.mjs', '--test-concurrency', '1']);
  assert.deepEqual(testArgs(['--test-concurrency', '1', 'tests/a.test.mjs']), ['--test', '--test-concurrency', '1', 'tests/a.test.mjs']);
  // Flags alone are not a path: they used to replace the glob and run nothing at all.
  assert.deepEqual(testArgs(['--test-concurrency', '4']), ['--test', '--test-concurrency', '4', DEFAULT_GLOB]);
  assert.deepEqual(testArgs(['--test-concurrency=4']), ['--test', '--test-concurrency=4', DEFAULT_GLOB]);
  assert.deepEqual(testArgs(['--test-name-pattern', 'picker']), ['--test', '--test-name-pattern', 'picker', DEFAULT_GLOB]);
  assert.deepEqual(testArgs(['--test-reporter-destination', 'out/x.txt', '--test-reporter', 'tap']),
    ['--test', '--test-reporter-destination', 'out/x.txt', '--test-reporter', 'tap', DEFAULT_GLOB]);
  assert.deepEqual(testArgs(['-r', './setup.cjs', '--experimental-test-coverage']), ['--test', '-r', './setup.cjs', '--experimental-test-coverage', DEFAULT_GLOB]);
  // Everything after `--` is a path.
  assert.deepEqual(testArgs(['--test-concurrency', '1', '--', 'tests/a.test.mjs']), ['--test', '--test-concurrency', '1', '--', 'tests/a.test.mjs']);
});

// End to end: a flag-only run must run the default glob and nothing else. Without a path,
// `node --test` falls back to its OWN discovery, which matches *.test.mjs anywhere in the tree
// (other worktrees included), so a stray file outside tests/ tells the two apart.
test('run-tests.mjs with only a flag still runs the default glob', { skip: !!process.env.TEST_TMP_ROOT_INNER }, () => {
  const b = base();
  const proj = fs.mkdtempSync(path.join(b, 'proj-'));
  const ran = path.join(proj, 'ran');
  const stray = path.join(proj, 'stray-ran');
  fs.mkdirSync(path.join(proj, 'tests'));
  fs.mkdirSync(path.join(proj, 'other'));
  fs.writeFileSync(path.join(proj, 'tests', 'x.test.mjs'),
    `import fs from 'node:fs'; import test from 'node:test'; test('x', () => fs.writeFileSync(${JSON.stringify(ran)}, '1'));\n`);
  fs.writeFileSync(path.join(proj, 'other', 'y.test.mjs'),
    `import fs from 'node:fs'; import test from 'node:test'; test('y', () => fs.writeFileSync(${JSON.stringify(stray)}, '1'));\n`);
  const env = { ...process.env, TMPDIR: b, TMP: b, TEMP: b, TEST_TMP_ROOT_INNER: '1' };
  delete env.RUN_TESTS_KEEP_TMP;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'run-tests.mjs'), '--test-concurrency', '1'], { cwd: proj, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(ran), 'the fixture test under tests/ ran:\n' + r.stdout + r.stderr);
  assert.ok(!fs.existsSync(stray), 'a test file outside tests/ did not run:\n' + r.stdout + r.stderr);
  assert.match(r.stdout, /\btests 1\b/);
});

// The two knobs a repo sets instead of editing the runner: the default glob, and the variables
// a live instance of the app exports that the suite must never inherit.
test('RUN_TESTS_GLOB replaces the default glob, and RUN_TESTS_UNSET keeps named variables from the tests', { skip: !!process.env.TEST_TMP_ROOT_INNER }, () => {
  const b = base();
  const proj = fs.mkdtempSync(path.join(b, 'proj-'));
  const seen = path.join(proj, 'seen.json');
  fs.mkdirSync(path.join(proj, 'spec'));
  fs.writeFileSync(path.join(proj, 'spec', 'a.check.mjs'),
    `import fs from 'node:fs'; import test from 'node:test'; test('a', () => fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ live: process.env.LIVE_STATE_DIR ?? null, kept: process.env.KEPT_VAR ?? null })));\n`);
  const env = { ...process.env, TMPDIR: b, TMP: b, TEMP: b, TEST_TMP_ROOT_INNER: '1', RUN_TESTS_GLOB: 'spec/*.check.mjs', RUN_TESTS_UNSET: 'LIVE_STATE_DIR, OTHER', LIVE_STATE_DIR: '/live', KEPT_VAR: 'yes' };
  delete env.RUN_TESTS_KEEP_TMP;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'run-tests.mjs')], { cwd: proj, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(seen, 'utf8')), { live: null, kept: 'yes' });
});

// The runner itself, end to end, under a throwaway TMPDIR so the real temp dir is untouched.
// The inner suite is a single file that records the TMPDIR it saw and leaves a file behind.
test('run-tests.mjs runs the suite inside one root and removes it', { skip: !!process.env.TEST_TMP_ROOT_INNER }, () => {
  const b = base();
  const work = fs.mkdtempSync(path.join(b, 'suite-'));
  const seen = path.join(work, 'seen.json');
  const probe = path.join(work, 'probe.test.mjs');
  fs.writeFileSync(probe, `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
fs.mkdtempSync(path.join(os.tmpdir(), 'leak-'));
fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ tmp: os.tmpdir(), root: process.env.TEST_TMP_ROOT }));
`);
  // A root left by a run that died: marked, pid that cannot be alive.
  const stale = path.join(b, 'node-test-root-999999999');
  fs.mkdirSync(stale); fs.writeFileSync(path.join(stale, MARKER), JSON.stringify({ pid: 999999999 }));
  fs.writeFileSync(path.join(stale, 'junk'), 'x');

  const env = { ...process.env, TMPDIR: b, TMP: b, TEMP: b, TEST_TMP_ROOT_INNER: '1' };
  delete env.RUN_TESTS_KEEP_TMP;
  delete env.NODE_TEST_CONTEXT; // else the nested `node --test` reports to THIS runner, not its exit code
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'run-tests.mjs'), probe], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const got = JSON.parse(fs.readFileSync(seen, 'utf8'));
  assert.match(got.tmp, new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\\\/]node-test-root-\\d+$`));
  assert.equal(got.root, got.tmp);
  assert.equal(fs.existsSync(got.tmp), false, 'the root (and the leak inside it) is gone');
  assert.equal(fs.existsSync(stale), false, 'the dead run\'s root was swept');
  assert.match(r.stdout, /removed .*node-test-root-999999999/);
  // Only the suite dir we made is left in the base.
  assert.deepEqual(fs.readdirSync(b), [path.basename(work)]);
});

test('run-tests.mjs keeps the root with RUN_TESTS_KEEP_TMP=1 and passes the exit code', { skip: !!process.env.TEST_TMP_ROOT_INNER }, () => {
  const b = base();
  const probe = path.join(fs.mkdtempSync(path.join(b, 'suite-')), 'fail.test.mjs');
  fs.writeFileSync(probe, `import test from 'node:test'; test('x', () => { throw new Error('boom'); });\n`);
  const env = { ...process.env, TMPDIR: b, TMP: b, TEMP: b, RUN_TESTS_KEEP_TMP: '1', TEST_TMP_ROOT_INNER: '1' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'run-tests.mjs'), probe], { cwd: repo, env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  const m = /run-tests: kept (\S+)/.exec(r.stdout);
  assert.ok(m, r.stdout);
  assert.ok(fs.existsSync(path.join(m[1], MARKER)));
});
