// Two-sided control for assert-tree-clean.mjs.
//
// The hazard it guards is a VERIFICATION THAT PASSES WHILE BLIND: a harness mutates
// tracked files, restores them with `cp`, and compares the restored bytes against its
// backup — an honest comparison that passes — while the index still holds blobs put
// there by a `git checkout <sha> -- <path>` earlier in the run. No amount of care in
// the byte comparison reaches the index; it is a second surface the check cannot see.
//
// So the important case here is #2: index differs from HEAD, working tree matches HEAD.
// It carries an ANCHOR — the fixture must first prove it actually reproduces that shape
// (`git diff HEAD` empty, `git diff --cached` non-empty). Without it, a fixture that
// quietly stopped staging anything would leave this test asserting over an ordinary
// dirty tree and passing for the wrong reason, which is the same failure it exists to
// catch, one level up.
//
// Every fixture repo is created under os.tmpdir() with GIT_CONFIG_GLOBAL and
// GIT_CONFIG_SYSTEM pointed at /dev/null, so the machine's git config (hooks,
// templates, rerere, signing, identity) cannot reach in and change the result.
//
// Zero-dep: `node --test tests/assert-tree-clean.test.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'scripts', 'assert-tree-clean.mjs');

const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

const made = [];
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, env: ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

// A repo with one commit: a.txt = "v1", b.txt = "v1".
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-'));
  made.push(dir);
  // `git init -b <name>` needs git >= 2.28. Ubuntu 20.04 still ships 2.25, where this
  // fixture threw "unknown switch `b'" and took all seven tests in this file down with
  // it — a suite-wide red that says nothing about the tool under test. Set the initial
  // branch through symbolic-ref instead, which every version supports.
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v1\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'v1\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  return dir;
}

function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd, env: ENV, encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// Reproduce the real shape: stage a different blob, then put HEAD's bytes back on
// disk — exactly what `git checkout <sha> -- path` followed by a `cp` restore leaves.
function stageOnly(dir, file, staged) {
  const head = fs.readFileSync(path.join(dir, file));
  fs.writeFileSync(path.join(dir, file), staged);
  git(dir, 'add', file);
  fs.writeFileSync(path.join(dir, file), head);
}

test.after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

test('a clean tree passes', () => {
  const dir = fixture();
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /OK/);
});

test('anchor: the staged-only fixture really is invisible to file-content checks', () => {
  const dir = fixture();
  stageOnly(dir, 'a.txt', 'STAGED\n');
  // The whole point: on disk a.txt is byte-identical to HEAD…
  assert.equal(git(dir, 'diff', 'HEAD', '--name-only').trim(), '');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1\n');
  // …while the index holds something else.
  assert.equal(git(dir, 'diff', '--cached', '--name-only').trim(), 'a.txt');
  // And a commit from here would ship the staged blob, which is the actual damage.
  git(dir, 'commit', '-q', '-m', 'what a plain commit would do');
  assert.equal(git(dir, 'show', 'HEAD:a.txt'), 'STAGED\n');
});

test('staged-only divergence fails, and says so specifically', () => {
  const dir = fixture();
  stageOnly(dir, 'a.txt', 'STAGED\n');
  const r = run(dir);
  assert.equal(r.code, 1, `expected failure, got ${r.code}: ${r.out}`);
  assert.match(r.err, /STAGED-ONLY DIVERGENCE/);
  assert.match(r.err, /a\.txt/);
  assert.doesNotMatch(r.err, /b\.txt/);
});

test('an ordinary dirty working tree fails too', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'b.txt'), 'edited\n');
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.err, /working tree differs from HEAD/);
  assert.match(r.err, /b\.txt/);
});

test('untracked files are ignored — harness backups and logs are not the hazard', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'a.txt.bak'), 'v1\n');
  fs.mkdirSync(path.join(dir, 'scratch'));
  fs.writeFileSync(path.join(dir, 'scratch', 'run.log'), 'noise\n');
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
});

test('pathspecs scope the assertion in both directions', () => {
  const dir = fixture();
  stageOnly(dir, 'a.txt', 'STAGED\n');
  assert.equal(run(dir, 'b.txt').code, 0, 'divergence outside the pathspec must not fail');
  assert.equal(run(dir, 'a.txt').code, 1, 'divergence inside the pathspec must fail');
});

test('outside a git worktree it exits 2, not a false OK', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-bare-'));
  made.push(dir);
  const r = run(dir);
  assert.equal(r.code, 2, `expected usage exit, got ${r.code}: ${r.out}${r.err}`);
});

test('a repo with no commits exits 2 rather than comparing against nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atc-empty-'));
  made.push(dir);
  // `git init -b <name>` needs git >= 2.28. Ubuntu 20.04 still ships 2.25, where this
  // fixture threw "unknown switch `b'" and took all seven tests in this file down with
  // it — a suite-wide red that says nothing about the tool under test. Set the initial
  // branch through symbolic-ref instead, which every version supports.
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
  const r = run(dir);
  assert.equal(r.code, 2, `expected usage exit, got ${r.code}: ${r.out}${r.err}`);
});
