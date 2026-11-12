// worktree-reap.mjs + lib/worktree-reap.js: remove linked worktrees under <repo>/.worktrees/
// whose work has LANDED, and nothing else. Every behaviour here is measured against a real git
// fixture (a bare origin, a main checkout, real worktrees), never read off the source:
//   - a dry run (the default) leaves the worktree list and the disk byte-identical;
//   - a SQUASH-merged branch (tip not an ancestor of the base) is removed only on the evidence
//     of a merged PR whose head is that tip and whose merge commit is on a base branch;
//   - dirty, untracked, unmerged, moved-on, merged-elsewhere, in-use (a process cwd inside),
//     locked, lock-file-holding, fresh, detached (by default), outside-.worktrees/, the main
//     checkout and the reaper's own checkout are all kept, each with a stated reason;
//   - no branch is ever deleted, and a node_modules symlink's target survives.
// The PR list is injected with --prs-file, so no test touches the network or GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as reap from '../scripts/lib/worktree-reap.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'scripts', 'worktree-reap.mjs');
const HOOK = path.join(REPO, 'scripts', 'worktree-reap-hook.mjs');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
const commit = (cwd, file, body) => { fs.writeFileSync(path.join(cwd, file), body); git(cwd, 'add', file); git(cwd, 'commit', '-q', '-m', `${file}: ${body}`); return git(cwd, 'rev-parse', 'HEAD'); };

// Build the fixture. Returns { root, main, prs, wt(name) }.
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-reap-')));
  assert.ok(root.startsWith(fs.realpathSync(os.tmpdir())), 'fixture must live under the temp dir');
  const origin = path.join(root, 'origin.git');
  const main = path.join(root, 'main');
  git(root, 'init', '-q', '--bare', origin);
  git(root, 'init', '-q', main);
  fs.writeFileSync(path.join(main, '.gitignore'), 'node_modules\n.worktrees/\nbuild/\n');
  git(main, 'add', '.gitignore');
  git(main, 'commit', '-q', '-m', 'root');
  git(main, 'branch', '-M', 'development');
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'push', '-q', 'origin', 'development');
  git(main, 'branch', 'main');
  git(main, 'push', '-q', 'origin', 'main');
  fs.mkdirSync(path.join(main, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(main, 'node_modules', 'dep', 'sentinel'), 'keep');

  const wt = name => path.join(main, '.worktrees', name);
  const add = (name, ...extra) => { git(main, 'worktree', 'add', '-q', ...extra); return wt(name); };
  const prs = [];
  // A branch with its own commits, then landed on development the way `how` says.
  const landed = (name, how) => {
    const p = add(name, wt(name), '-b', name, 'origin/development');
    const tip = commit(p, `${name}.txt`, name);
    if (how === 'ancestor') {
      git(main, 'merge', '-q', '--no-ff', '-m', `merge ${name}`, name);
    } else if (how === 'squash') {
      git(main, 'merge', '-q', '--squash', name);
      git(main, 'commit', '-q', '-m', `${name} (#${prs.length + 1})`);
      prs.push({ number: prs.length + 1, headRefOid: tip, baseRefName: 'development', mergeCommit: { oid: git(main, 'rev-parse', 'HEAD') } });
    }
    return { p, tip };
  };

  landed('anc', 'ancestor');
  landed('squash', 'squash');
  landed('squash-untracked', 'squash');
  fs.writeFileSync(path.join(wt('squash-untracked'), 'notes.md'), 'unsaved work');
  landed('squash-modified', 'squash');
  fs.writeFileSync(path.join(wt('squash-modified'), 'squash-modified.txt'), 'edited');
  landed('busy', 'squash');
  landed('locked', 'squash');
  git(main, 'worktree', 'lock', wt('locked'));
  landed('lockfile', 'squash');
  landed('moved-on', 'squash');
  commit(wt('moved-on'), 'later.txt', 'after the merge');
  landed('self', 'squash');
  landed('ignored', 'squash');
  fs.mkdirSync(path.join(wt('ignored'), 'build'));
  fs.writeFileSync(path.join(wt('ignored'), 'build', 'out.bin'), 'x'.repeat(1000));
  fs.symlinkSync(path.join(main, 'node_modules'), path.join(wt('ignored'), 'node_modules'));
  landed('unmerged', 'none');

  // Merged, but into a base that has not reached development/main.
  const other = landed('other-base', 'none');
  git(main, 'branch', 'feature', 'development');
  prs.push({ number: 90, headRefOid: other.tip, baseRefName: 'feature', mergeCommit: { oid: git(main, 'commit-tree', '-p', 'feature', '-m', 'm', 'feature^{tree}') } });
  // A merged PR with no merge commit recorded.
  const nomc = landed('no-merge-commit', 'none');
  prs.push({ number: 91, headRefOid: nomc.tip, baseRefName: 'development', mergeCommit: null });

  git(main, 'push', '-q', 'origin', 'development');

  // A fresh branch: a branch made a moment ago from development, no commits of its own.
  add('fresh', wt('fresh'), '-b', 'fresh', 'origin/development');
  // A detached review checkout of a landed commit.
  add('det', '--detach', wt('det'), 'origin/development');
  // A landed branch whose worktree is outside .worktrees/.
  const outside = path.join(root, 'elsewhere');
  git(main, 'worktree', 'add', '-q', outside, '-b', 'outside', 'origin/development');
  commit(outside, 'outside.txt', 'o');
  git(main, 'merge', '-q', '--no-ff', '-m', 'merge outside', 'outside');
  git(main, 'push', '-q', 'origin', 'development');

  const prsFile = path.join(root, 'prs.json');
  fs.writeFileSync(prsFile, JSON.stringify(prs));
  return { root, main, prs, prsFile, wt, outside };
}

// Everything a run could change: the worktree list, every branch, and every path + content on disk.
function snapshot(fx) {
  const files = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // The one write a dry run makes is the fetch it starts with; FETCH_HEAD is that record.
      if (e.name === 'FETCH_HEAD') continue;
      if (e.isSymbolicLink()) files.push(`${p} -> ${fs.readlinkSync(p)}`);
      else if (e.isDirectory()) walk(p);
      else files.push(`${p} ${fs.readFileSync(p).toString('base64')}`);
    }
  };
  walk(fx.root);
  return { list: git(fx.main, 'worktree', 'list', '--porcelain'), refs: git(fx.main, 'for-each-ref', '--format=%(refname) %(objectname)'), files: files.sort() };
}

function run(fx, args, { cwd = fx.main, env = {} } = {}) {
  assert.ok(fx.main.startsWith(fs.realpathSync(os.tmpdir())), 'never aim the reaper at a non-fixture repo');
  const r = spawnSync(process.execPath, [TOOL, '--repo', fx.main, '--base', 'development', '--base', 'main', '--prs-file', fx.prsFile, '--json', '--lock-wait-ms', '50', '--lock-retries', '2', ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, `reaper exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const byName = (out, fx) => Object.fromEntries(out.items.map(i => [path.relative(path.join(fx.main, '.worktrees'), i.path), i]));
const exists = p => fs.existsSync(p);

// The reaper reads /proc for process cwds and `df` for space; elsewhere it fails closed (every
// candidate reads as in use), so the fixture runs are Linux-only. The pure tests run everywhere.
const linuxOnly = process.platform === 'linux' ? false : 'the reaper reads /proc and df -B1: Linux only, and fails closed elsewhere';

function holdCwd(dir) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, stdio: 'ignore' });
  return child;
}

test('dry run is the default and changes nothing — not the worktree list, not a ref, not a byte on disk', { skip: linuxOnly }, () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.main, '.git', 'worktrees', 'lockfile', 'index.lock'), '');
  const before = snapshot(fx);
  const out = run(fx, []);
  assert.equal(out.apply, false);
  assert.equal(out.counts.removed, 0);
  assert.ok(out.counts.wouldRemove >= 3, `expected candidates, got ${JSON.stringify(out.counts)}`);
  assert.deepEqual(snapshot(fx), before);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('--apply removes exactly the landed, clean, unused worktrees — including the SQUASH-merged one', { skip: linuxOnly }, () => {
  const fx = fixture();
  const lock = path.join(fx.main, '.git', 'worktrees', 'lockfile', 'index.lock');
  fs.writeFileSync(lock, '');
  const holder = holdCwd(fx.wt('busy'));
  // The reaper runs from inside a landed worktree: that one is its own and must survive.
  let out;
  try { out = run(fx, ['--apply'], { cwd: fx.wt('self') }); } finally { holder.kill(); }
  const it = byName(out, fx);

  assert.equal(it.anc.action, 'removed'); assert.equal(it.anc.via, 'ancestor');
  assert.equal(it.squash.action, 'removed'); assert.equal(it.squash.via, 'squash'); assert.equal(it.squash.pr, 1);
  assert.equal(it.ignored.action, 'removed');
  assert.ok(!exists(fx.wt('anc')) && !exists(fx.wt('squash')) && !exists(fx.wt('ignored')));

  const kept = {
    'squash-untracked': 'status', 'squash-modified': 'status', unmerged: 'not-landed', 'moved-on': 'not-landed',
    'other-base': 'merged-elsewhere', 'no-merge-commit': 'not-landed', busy: 'in-use', locked: 'locked', lockfile: 'git-lock',
    self: 'self', fresh: 'fresh', det: 'detached',
  };
  for (const [name, reason] of Object.entries(kept)) {
    assert.equal(it[name]?.action, 'skip', `${name} should be kept: ${JSON.stringify(it[name])}`);
    assert.equal(it[name].reason, reason, `${name}: ${it[name].detail}`);
    assert.ok(it[name].detail, `${name} skip carries a detail`);
    assert.ok(exists(fx.wt(name)), `${name} still on disk`);
  }
  assert.match(it['squash-untracked'].detail, /1 entr/);
  const outside = out.items.find(i => i.path === fx.outside);
  assert.equal(outside.reason, 'outside'); assert.ok(exists(fx.outside));
  assert.ok(!out.items.some(i => i.path === fx.main && i.action === 'removed'));

  // The git lock was waited on, never removed.
  assert.ok(exists(lock), 'the reaper must never delete a lock file');
  // No branch deleted; the symlinked node_modules target intact.
  for (const b of ['anc', 'squash', 'ignored', 'self', 'busy']) git(fx.main, 'rev-parse', '--verify', `refs/heads/${b}`);
  assert.equal(fs.readFileSync(path.join(fx.main, 'node_modules', 'dep', 'sentinel'), 'utf8'), 'keep');

  assert.equal(out.counts.removed, 3);
  assert.equal(out.counts.removedVia.squash, 2);
  assert.equal(out.counts.removedVia.ancestor, 1);
  assert.equal(out.counts.total, out.items.length);
  assert.equal(out.counts.skipped, out.items.filter(i => i.action === 'skip').length);
  assert.equal(typeof out.df.freedBytes, 'number');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('without the PR list a squash-merged worktree is NOT assumed landed (fail closed)', { skip: linuxOnly }, () => {
  const fx = fixture();
  fs.writeFileSync(fx.prsFile, 'not json');
  const it = byName(run(fx, ['--apply', '--branch', 'squash']), fx);
  assert.equal(it.squash.action, 'skip');
  assert.equal(it.squash.reason, 'pr-list-unavailable');
  assert.ok(exists(fx.wt('squash')));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('--branch scopes the run to one branch', { skip: linuxOnly }, () => {
  const fx = fixture();
  const out = run(fx, ['--apply', '--branch', 'anc']);
  assert.equal(out.counts.removed, 1);
  assert.ok(!exists(fx.wt('anc')));
  assert.ok(exists(fx.wt('squash')));
  assert.ok(out.items.filter(i => i.action === 'skip').every(i => i.reason !== 'status'), 'out-of-scope items are not inspected');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('--only limits --apply to the listed paths, even when others are eligible', { skip: linuxOnly }, () => {
  const fx = fixture();
  const list = path.join(fx.root, 'only.txt');
  fs.writeFileSync(list, fx.wt('squash') + '\n' + fx.wt('squash-untracked') + '\n');
  const out = run(fx, ['--apply', '--only', list]);
  const it = byName(out, fx);
  assert.equal(it.squash.action, 'removed');
  assert.equal(it['squash-untracked'].reason, 'status', 'listed is necessary, not sufficient');
  assert.equal(it.anc.reason, 'not-in-list');
  assert.ok(exists(fx.wt('anc')));
  assert.equal(out.counts.removed, 1);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('--include-detached opts detached review checkouts in, still under the landed + clean rules', { skip: linuxOnly }, () => {
  const fx = fixture();
  const it = byName(run(fx, ['--apply', '--include-detached']), fx);
  assert.equal(it.det.action, 'removed');
  assert.ok(!exists(fx.wt('det')));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('a git lock that clears while the reaper waits is waited out, not forced', { skip: linuxOnly }, async () => {
  const fx = fixture();
  const lock = path.join(fx.main, '.git', 'worktrees', 'lockfile', 'index.lock');
  fs.writeFileSync(lock, '');
  const child = spawn(process.execPath, [TOOL, '--repo', fx.main, '--base', 'development', '--base', 'main', '--prs-file', fx.prsFile, '--json', '--apply', '--branch', 'lockfile', '--lock-wait-ms', '400', '--lock-retries', '10'], { cwd: fx.main });
  let stdout = '';
  child.stdout.on('data', d => { stdout += d; });
  setTimeout(() => fs.rmSync(lock), 700);
  await new Promise(r => child.on('exit', r));
  const it = byName(JSON.parse(stdout), fx);
  assert.equal(it.lockfile.action, 'removed');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('the hook acts only on a PR merge, is dry-run until the repo opts in, and then removes', { skip: linuxOnly }, () => {
  const fx = fixture();
  const hook = (command) => spawnSync(process.execPath, [HOOK], {
    cwd: fx.main, encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, cwd: fx.main }),
    env: { ...process.env, WORKTREE_REAP_WAIT: '1', WORKTREE_REAP_PRS_FILE: fx.prsFile },
  });
  // The hook is given no bases: it reads them from the repo's own config.
  git(fx.main, 'config', '--add', 'worktreeReap.base', 'development');
  git(fx.main, 'config', '--add', 'worktreeReap.base', 'main');
  const log = path.join(fx.main, '.git', 'worktree-reap.log');

  assert.equal(hook('git status').status, 0);
  assert.ok(!exists(log), 'a non-merge command does not run the reaper');

  assert.equal(hook('gh pr merge 12 --squash').status, 0);
  assert.match(fs.readFileSync(log, 'utf8'), /DRY RUN/);
  assert.ok(exists(fx.wt('anc')), 'not opted in: nothing removed');

  git(fx.main, 'config', 'worktreeReap.mode', 'apply');
  assert.equal(hook('gh pr merge 12 --squash').status, 0);
  assert.ok(!exists(fx.wt('anc')) && !exists(fx.wt('squash')));
  assert.ok(exists(fx.wt('squash-untracked')));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

// A common shape: a branch squash-merged into an integration branch, which then
// landed on development with a real merge. Full history proves it; a SHALLOW clone hides it.
// The shared checkout was found shallow (a --depth fetch from any one worktree truncates history
// for all of them), with every commit still present locally. The reaper must see through the
// shallow marker — read-only, never by unshallowing the repo — and say that it did.
test('a shallow checkout does not hide a branch that landed through an integration branch', { skip: linuxOnly }, () => {
  const fx = fixture();
  const lane = fx.wt('via-integration');
  git(fx.main, 'branch', 'integration', 'development');
  git(fx.main, 'worktree', 'add', '-q', lane, '-b', 'via-integration', 'origin/development');
  const tip = commit(lane, 'lane.txt', 'lane');
  git(fx.main, 'checkout', '-q', 'integration');
  git(fx.main, 'merge', '-q', '--squash', 'via-integration');
  git(fx.main, 'commit', '-q', '-m', 'lane (#77)');
  const squashSha = git(fx.main, 'rev-parse', 'HEAD');
  git(fx.main, 'checkout', '-q', 'development');
  git(fx.main, 'merge', '-q', '--no-ff', '-m', 'consolidation', 'integration');
  const boundary = commit(fx.main, 'after.txt', 'after the consolidation');
  commit(fx.main, 'later.txt', 'later still');
  git(fx.main, 'push', '-q', 'origin', 'development');
  const prs = JSON.parse(fs.readFileSync(fx.prsFile, 'utf8'));
  prs.push({ number: 77, headRefOid: tip, baseRefName: 'integration', mergeCommit: { oid: squashSha } });
  fs.writeFileSync(fx.prsFile, JSON.stringify(prs));
  // Shallow, with the boundary above the consolidation merge: the objects stay, history is hidden.
  fs.writeFileSync(path.join(fx.main, '.git', 'shallow'), boundary + '\n');
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', squashSha, 'origin/development'], { cwd: fx.main }).status, 1, 'the fixture really hides it');
  const shallowBefore = fs.readFileSync(path.join(fx.main, '.git', 'shallow'), 'utf8');

  const out = run(fx, ['--apply', '--no-fetch', '--branch', 'via-integration']);
  const it = byName(out, fx);
  assert.equal(it['via-integration'].action, 'removed', JSON.stringify(it['via-integration']));
  assert.equal(it['via-integration'].via, 'squash');
  assert.equal(out.shallow, true);
  assert.equal(out.history, 'complete');
  assert.equal(fs.readFileSync(path.join(fx.main, '.git', 'shallow'), 'utf8'), shallowBefore, 'the repo is left shallow: read-only');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

// No --base and no config: the base is the remote's default branch as git records it, and with
// nothing recorded the reaper refuses to guess rather than call anything landed.
test('the base is discovered from the remote default branch, and never guessed', { skip: linuxOnly }, () => {
  const fx = fixture();
  const bare = args => spawnSync(process.execPath, [TOOL, '--repo', fx.main, '--prs-file', fx.prsFile, '--json', '--no-fetch', ...args], { cwd: fx.main, encoding: 'utf8' });
  const none = bare([]);
  assert.equal(none.status, 2, 'no base anywhere is a usage error');
  assert.match(none.stderr, /no base branch/);
  assert.ok(exists(fx.wt('anc')));

  git(fx.main, 'remote', 'set-head', 'origin', 'development');
  const found = bare([]);
  assert.equal(found.status, 0, found.stderr);
  const out = JSON.parse(found.stdout);
  assert.deepEqual(out.bases, ['origin/development']);
  assert.equal(out.basesFrom, 'origin/HEAD');
  assert.equal(byName(out, fx).anc.action, 'would-remove');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('--worktrees-dir moves the folder the reaper may remove from; --reserve keeps a tree', { skip: linuxOnly }, () => {
  const fx = fixture();
  const out = run(fx, ['--worktrees-dir', path.dirname(fx.outside), '--reserve', path.join(fx.wt('anc'), 'src')]);
  assert.equal(out.items.find(i => i.path === fx.outside).action, 'would-remove');
  const again = byName(run(fx, ['--reserve', path.join(fx.wt('anc'), 'src')]), fx);
  assert.equal(again.anc.reason, 'reserved');
  assert.equal(again.squash.action, 'would-remove');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('pure: lock detection, merge-command detection, cwd holders, df parsing', () => {
  assert.equal(reap.isLockError("fatal: Unable to create '/r/.git/index.lock': File exists."), true);
  assert.equal(reap.isLockError('fatal: cannot remove a locked working tree'), false);
  assert.equal(reap.isMergeCommand('gh pr merge 12 --squash'), true);
  assert.equal(reap.isMergeCommand('cd x && gh  pr merge --auto 3'), true);
  assert.equal(reap.isMergeCommand('gh api -X PUT repos/o/r/pulls/7/merge'), true);
  assert.equal(reap.isMergeCommand('gh pr view 12'), false);
  assert.equal(reap.isMergeCommand('git merge origin/development'), false);
  assert.deepEqual(reap.cwdHolders([{ pid: 1, cwd: '/r/.worktrees/a/src' }, { pid: 2, cwd: '/r/.worktrees/ab' }, { pid: 3, cwd: '/r/.worktrees/a' }], '/r/.worktrees/a'), [1, 3]);
  assert.equal(reap.parseDfAvail('Avail\n123456\n'), 123456);
  assert.equal(reap.parseDfAvail('garbage'), null);
});
