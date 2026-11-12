// lib/safe-git.js — the planner every git call of the reaper goes through. The pure half is pinned here;
// the real-repo, real-boot proof is tests/git-repo-config-host-exec-boot.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FIXED_OVERRIDES, hardenArgs, overridesForRepoConfig, parseConfigList, runSafeGit, safeGitArgs, safeGitArgsSync } from '../scripts/lib/safe-git.js';

const pairs = (args) => { const o = []; for (let i = 0; i < args.length; i++) if (args[i] === '-c') o.push(args[++i]); return o; };

test('every call gets the fixed overrides, in front of the subcommand', () => {
  const a = hardenArgs(['status', '--porcelain']);
  assert.deepEqual(a.slice(-2), ['status', '--porcelain']);
  assert.deepEqual(pairs(a), FIXED_OVERRIDES);
  for (const k of ['core.fsmonitor=', 'core.hooksPath=/dev/null', 'diff.external=', 'protocol.ext.allow=never']) assert.ok(FIXED_OVERRIDES.includes(k), k);
});

test('fsmonitor is switched off with an EMPTY value: `false` on git 2.25 is a program name (/bin/false)', () => {
  assert.ok(FIXED_OVERRIDES.includes('core.fsmonitor='));
  assert.ok(!FIXED_OVERRIDES.includes('core.fsmonitor=false'));
});

test('diff-producing commands also get --no-ext-diff --no-textconv; others do not', () => {
  for (const sub of ['diff', 'show', 'log']) {
    const a = hardenArgs([sub, 'HEAD']);
    assert.deepEqual(a.slice(a.indexOf(sub)), [sub, '--no-ext-diff', '--no-textconv', 'HEAD']);
  }
  assert.ok(!hardenArgs(['status']).includes('--no-ext-diff'));
});

test('a driver the repo names is neutralized by that name, every program-naming field of it', () => {
  const r = overridesForRepoConfig([['filter.My-Drv.clean', '/x'], ['diff.pic.textconv', '/y'], ['merge.m.driver', '/z']]);
  assert.equal(r.refusal, null);
  for (const o of ['filter.My-Drv.clean=', 'filter.My-Drv.smudge=', 'filter.My-Drv.process=', 'filter.My-Drv.required=false',
    'diff.pic.textconv=', 'diff.pic.command=', 'merge.m.driver=']) assert.ok(r.overrides.includes(o), o);
});

test("a key the user needs keeps the user's OWN value, not the repo's — and the user's config is read only then", () => {
  const local = [['credential.helper', '/repo/evil'], ['core.sshcommand', '/repo/evil-ssh']];
  assert.deepEqual(overridesForRepoConfig(local), { needsUser: true });
  const r = overridesForRepoConfig(local, [['credential.helper', 'cache'], ['credential.helper', 'store'], ['core.sshcommand', 'ssh -i ~/.ssh/k']]);
  assert.deepEqual(r.overrides, ['credential.helper=', 'credential.helper=cache', 'credential.helper=store', 'core.sshcommand=ssh -i ~/.ssh/k']);
  // No value of the user's own: git's default, never the repo's.
  assert.deepEqual(overridesForRepoConfig([['core.sshcommand', '/evil']], []).overrides, ['core.sshcommand=ssh']);
  assert.deepEqual(overridesForRepoConfig([['remote.origin.uploadpack', '/evil']], []).overrides, ['remote.origin.uploadpack=git-upload-pack']);
});

test('data keys are left alone, and need no read of the user config', () => {
  assert.deepEqual(overridesForRepoConfig([['core.bare', 'false'], ['remote.origin.url', 'x'], ['user.name', 'n']]), { overrides: [], refusal: null });
});

test('what -c cannot override is refused, by name', () => {
  assert.match(overridesForRepoConfig([['core.gitproxy', '/evil for example.com']]).refusal, /core\.gitproxy/);
  // A driver name containing `=` cannot be spelled as a -c key (git splits at the first `=`).
  assert.match(overridesForRepoConfig([['filter.a=b.clean', '/evil']]).refusal, /cannot override/);
  assert.match(overridesForRepoConfig([['diff.a\tb.textconv', '/evil']]).refusal, /cannot override/);
});

test('parseConfigList reads `git config --list -z` (key, newline, value; NUL-separated; bare keys)', () => {
  assert.deepEqual(parseConfigList('a.b\n1\0c.d\nx\ny\0e.f\0'), [['a.b', '1'], ['c.d', 'x\ny'], ['e.f', null]]);
});

const SKIP = process.platform === 'win32' ? 'the planted programs are sh scripts' : false;

test('against a real repo: the sync and async planners agree, and planted config does not run', { skip: SKIP }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-git-'));
  try {
    const repo = path.join(root, 'r'), mark = path.join(root, 'ran');
    fs.mkdirSync(repo);
    const prog = path.join(root, 'prog');
    fs.writeFileSync(prog, `#!/bin/sh\necho ran >> '${mark}'\ncat\n`, { mode: 0o755 });
    const g = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
    g('init', '-q');
    g('config', 'core.fsmonitor', prog);
    g('config', 'filter.q.clean', prog);
    fs.writeFileSync(path.join(repo, '.gitattributes'), '* filter=q\n');
    const sync = safeGitArgsSync(repo, ['status', '--porcelain']);
    assert.deepEqual(await safeGitArgs(repo, ['status', '--porcelain']), sync);
    assert.ok(sync.args.includes('filter.q.clean='), 'the repo-named filter is discovered');
    const r = await runSafeGit(repo, ['status', '--porcelain']);
    assert.equal(r.ok, true, r.stderr);
    assert.equal(fs.existsSync(mark), false, 'nothing planted ran');
    g('status', '--porcelain');
    assert.equal(fs.existsSync(mark), true, 'control: plain git does run it');
    // Outside any repo there is no repo config: the fixed overrides alone, and git still runs.
    const outside = safeGitArgsSync(root, ['--version']);
    assert.equal(outside.refusal, null);
    // A directory that does not exist is a refusal, not a guess.
    assert.match(safeGitArgsSync(path.join(root, 'nope'), ['status']).refusal, /cannot read/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
