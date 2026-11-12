// The git-guard PreToolUse hook (scripts/lib/git-guard.mjs + scripts/git-guard-hook.mjs), in both directions:
// the banned forms are refused, however they are chained or spelled, and ordinary git is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { gitBanVerdict, gitBanHookGroup, withGitGuard, allowedRules } from '../scripts/lib/git-guard.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(REPO, 'scripts', 'git-guard-hook.mjs');
const INSTALL = path.join(REPO, 'scripts', 'install.mjs');

const BLOCKED = [
  'git reset --hard HEAD~1',
  'git reset',
  'git reset --soft origin/development',
  'git stash',
  'git stash push -u -m wip',
  'git stash pop',
  'git push --force',
  'git push -f origin main',
  'git push --force-with-lease origin x',
  'git push --force-with-lease=x:abc origin x',
  'git push -uf origin x',
  'git push origin +main',
  'git checkout -- server.js',
  'git checkout main -- lib/a.js',
  'git update-ref refs/heads/x HEAD',
  'git add -A',
  'git add .',
  'git add ./',
  'git add --all',
  'git add -Av',
  'git add :/',
  'git commit --no-verify -m x',
  'git commit -nm "msg"',
  'git push --no-verify',
  'git merge --no-verify feature',
  'git branch -f main HEAD~2',
  'git branch --force x y',
  // chained, piped, and every way of naming git or its repo
  'git status && git reset --hard',
  'git status; git stash',
  'git log | head; git push -f',
  'cd /tmp/x && git add . && git commit --only a -m b',
  'git fetch || git reset --hard origin/main',
  'sleep 1 & git stash',
  'git -C /some/dir reset --hard',
  'git -C "/dir with space" stash',
  'git -c core.editor=true -C . push --force',
  'git --git-dir=.git --work-tree=. reset',
  '/usr/bin/git reset --hard',
  'GIT_TRACE=1 git reset --hard',
  'sudo git reset --hard',
  'env FOO=1 git stash',
  'bash -c "git reset --hard"',
  "sh -lc 'git stash'",
  'echo $(git stash)',
  'echo `git reset --hard`',
  '(cd x && git reset --hard)',
  'if true; then git stash; fi',
  'git status\ngit reset --hard',
  'git push origin x 2>&1 && git push -f',
  // Claude Code's own commit shape: a heredoc inside $( ). A lone apostrophe or ) in the message
  // must not hide what is chained after it.
  'git commit --only a -m "$(cat <<\'EOF\'\ndon\'t do it\nEOF\n)" && git reset --hard',
  'git commit --only a -m "$(cat <<\'EOF\'\nfix: x) y\nEOF\n)" && git stash',
  'git commit --only a -m "$(cat <<\'EOF\'\nit\'s (fine\nEOF\n)"; git push --force',
  // checkout that discards: a pathspec with or without --, and -f
  'git checkout .',
  'git checkout ./lib',
  'git checkout :/',
  'git checkout "*.js"',
  'git checkout HEAD server.js',
  'git checkout main lib/a.js',
  'git checkout HEAD -- server.js',
  'git checkout --theirs lib/a.js',
  'git checkout --pathspec-from-file=list.txt',
  'git checkout -f',
  'git checkout -f main',
  'git checkout --force main',
  'git checkout -fb x main',
  // restore of the working tree
  'git restore server.js',
  'git restore .',
  'git restore --worktree lib/a.js',
  'git restore -W lib/a.js',
  'git restore --source=HEAD~1 lib/a.js',
  'git restore -s HEAD~1 lib/a.js',
  'git restore --staged --worktree lib/a.js',
  'git restore -SW lib/a.js',
  // clean, any form
  'git clean -fd',
  'git clean -n',
  'git clean',
  'git -C /some/dir clean -xfd',
  // forced branch delete / rename
  'git branch -D gone',
  'git branch -M old new',
  'git branch -M new',
  'git branch -Dr origin/x',
  'git status && git branch -D x',
];

const ALLOWED = [
  'git status',
  'git status --short',
  'git log --oneline -5',
  'git diff HEAD~1 -- lib/a.js',
  'git commit --only lib/a.js -m "fix: x"',
  'git commit --only a b -F msg.txt',
  'git push',
  'git push origin feature-x:feature-x',
  'git push -u origin x',
  'git push origin x 2>&1',
  'git merge origin/development',
  'git merge --no-ff -m "Merge x" x',
  'git fetch origin',
  'git branch',
  'git branch -d gone',
  'git branch new-branch land-three',
  'git checkout main',
  'git checkout -b feature land-three',
  'git checkout -B feature land-three',
  'git checkout -b feature',
  'git checkout origin/development',
  'git checkout -',
  'git checkout --track origin/x',
  'git checkout --orphan fresh main',
  'git restore --staged lib/a.js',
  'git restore -S lib/a.js tests/a.test.mjs',
  'git restore --staged --source=HEAD~1 lib/a.js',
  'git restore --staged .',
  'git branch -d -r origin/gone',
  'git branch --delete gone',
  'git branch -m new-name',
  'git commit --only a -m "never git clean, git restore or git branch -D"',
  'git switch -c x land-three',
  'git add lib/a.js tests/a.test.mjs',
  'git add ./lib/a.js',
  'git -C /some/dir status',
  'git -C /some/dir log -1',
  'git rev-parse HEAD',
  'git ls-remote origin x',
  'git show HEAD:lib/a.js',
  // the commit message is not a command
  'git commit --only a -m "never git reset or git stash here; no --no-verify"',
  'git commit --only a -m "-n is not a flag here"',
  'git commit --only a -mnew-thing',
  "git commit --only a -m 'git push --force was the old way'",
  'git commit --only a -F - <<\'EOF\'\nBan git reset, git stash and git push --force.\ngit add -A too.\nEOF',
  'cat <<EOF > notes.txt\ngit reset --hard\nEOF\ngit status',
  'git commit --only a.js -m "$(cat <<\'EOF\'\nBan git reset (and git stash) — don\'t use git push --force :)\nIt\'s fine.\n\nCo-Authored-By: X <x@y>\nEOF\n)"',
  'git commit --only a -m "$(cat <<\'EOF\'\ndon\'t git add -A\nEOF\n)" && git push origin x:x',
  'echo "git reset --hard" | wc -c',
  'grep -rn "git stash" lib/',
  'npm test # git reset is banned',
  'resetter --hard',
  'my-git reset',
  'ls stash',
];

for (const cmd of BLOCKED) {
  test(`blocked: ${JSON.stringify(cmd)}`, () => {
    const v = gitBanVerdict(cmd);
    assert.equal(v.blocked, true, JSON.stringify(v));
    assert.ok(v.rule && v.reason, 'a block names its rule and reason');
  });
}
for (const cmd of ALLOWED) {
  test(`allowed: ${JSON.stringify(cmd)}`, () => {
    const v = gitBanVerdict(cmd);
    assert.equal(v.blocked, false, JSON.stringify(v));
  });
}

test('garbage never throws and never blocks', () => {
  for (const x of [null, undefined, '', '   ', 42, '"unterminated', "'x", '$(', '`', 'git']) {
    assert.equal(gitBanVerdict(x).blocked, false, String(x));
  }
});

test('the hook group is a Bash-only PreToolUse group running scripts/git-guard-hook.mjs', () => {
  const g = gitBanHookGroup('/usr/bin/node', HOOK);
  assert.equal(g.matcher, 'Bash');
  assert.equal(g.hooks.length, 1);
  assert.equal(g.hooks[0].type, 'command');
  assert.match(g.hooks[0].command, /git-guard-hook\.mjs"$/);
});

const runHook = input => spawnSync(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', timeout: 10000 });

test('hook script: a banned Bash command is denied with a PreToolUse deny decision', () => {
  const r = runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status && git reset --hard' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /git reset/);
});

test('hook script: ordinary git, other tools and unreadable input pass through silently', () => {
  for (const input of [
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit --only a -m "x"' } },
    { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'git reset' } },
    'not json',
    '',
  ]) {
    const r = runHook(input);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', JSON.stringify(input));
  }
});

test('GIT_GUARD_ALLOW switches off exactly the named rule', () => {
  const allow = allowedRules('git stash, git clean');
  assert.equal(gitBanVerdict('git stash', { allow }).blocked, false);
  assert.equal(gitBanVerdict('git stash && git reset --hard', { allow }).rule, 'git reset');
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git stash' } }),
    encoding: 'utf8', timeout: 10000, env: { ...process.env, GIT_GUARD_ALLOW: 'git stash' },
  });
  assert.equal(r.stdout, '');
});

test('withGitGuard adds one group, keeps other hooks, and is idempotent', () => {
  const before = { model: 'x', hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'other' }] }], Stop: [{ hooks: [] }] } };
  const once = withGitGuard(before, '/usr/bin/node', HOOK);
  const twice = withGitGuard(once, '/usr/bin/node', HOOK);
  assert.deepEqual(twice, once);
  assert.equal(once.model, 'x');
  assert.equal(once.hooks.PreToolUse.length, 2);
  assert.equal(once.hooks.PreToolUse[0].hooks[0].command, 'other');
  assert.deepEqual(once.hooks.Stop, before.hooks.Stop);
  assert.equal(before.hooks.PreToolUse.length, 1, 'the input is not mutated');
});

// Real install: the settings file install.mjs writes carries the group, and the EXACT command
// string it wrote refuses a banned form and lets ordinary git through — run the way the CLI
// would run it: through a shell, with the hook event on stdin.
test('install.mjs writes a settings file whose command enforces the guard', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-guard-install-'));
  try {
    const file = path.join(dir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'true' }] }] } }));
    for (let n = 0; n < 2; n++) {
      const r = spawnSync(process.execPath, [INSTALL], { cwd: dir, encoding: 'utf8', timeout: 10000 });
      assert.equal(r.status, 0, r.stderr);
    }
    const written = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(written.permissions, { allow: ['Read'] });
    assert.equal(written.hooks.PreToolUse[0].matcher, '*', 'the existing group stays first');
    const ours = written.hooks.PreToolUse.filter(g => g.matcher === 'Bash' && g.hooks.some(h => /git-guard-hook\.mjs"$/.test(h.command)));
    assert.equal(ours.length, 1, 'exactly one guard group after two installs');
    const run = toolCommand => spawnSync('/bin/sh', ['-c', ours[0].hooks[0].command], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: toolCommand } }),
      encoding: 'utf8', timeout: 15000,
    });
    const denied = run('git -C /x status && git push --force');
    assert.equal(denied.status, 0, denied.stderr);
    assert.equal(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const allowed = run('git commit --only a.js -m "x" && git push origin b:b');
    assert.equal(allowed.stdout, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('install.mjs refuses a settings file that is not JSON and leaves it untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-guard-install-'));
  try {
    const file = path.join(dir, 's.json');
    fs.writeFileSync(file, '{ not json');
    const r = spawnSync(process.execPath, [INSTALL, '--settings', file], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
