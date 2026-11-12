// The version gate: semver ordering, the lockstep check, and — end to end, through the
// real CLI against a throwaway git repo — that a feature branch which edits the version or
// the logs FAILS, one that adds a changeset PASSES, and a release prep passes only exactly as
// release.mjs writes it. `node --test tests/version-gate.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareSemver, parseSemver, bumpVerdict, lockstepMismatches, readPackageVersion, gatePlan as gatePlanRaw } from '../scripts/lib/version.js';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const CLI = path.join(SCRIPTS, 'check-version.mjs');
const RELEASE = path.join(SCRIPTS, 'release.mjs');

test('semver compares numerically, not as strings', () => {
  assert.equal(compareSemver('0.10.0', '0.9.0'), 1);
  assert.equal(compareSemver('0.9.0', '0.10.0'), -1);
  assert.equal(compareSemver('1.0.0', '0.99.99'), 1);
  assert.equal(compareSemver('0.2.0', '0.2.0'), 0);
  assert.equal(compareSemver('0.2.1', '0.2.0'), 1);
});

test('a pre-release sorts below its release', () => {
  assert.equal(compareSemver('0.2.0-rc.1', '0.2.0'), -1);
  assert.equal(compareSemver('0.2.0-rc.2', '0.2.0-rc.10'), -1);
  assert.equal(compareSemver('0.2.0-1', '0.2.0-alpha'), -1);
});

test('release tag names parse', () => {
  assert.deepEqual(parseSemver('desktop-v0.2.0'), { major: 0, minor: 2, patch: 0, pre: [] });
  assert.equal(parseSemver('v1.2.3').major, 1);
  assert.equal(parseSemver('0.2'), null);
  assert.equal(parseSemver('0.02.0'), null);
  assert.throws(() => compareSemver('nope', '0.1.0'));
});

test('bumpVerdict: only strictly greater passes, garbage fails closed', () => {
  assert.equal(bumpVerdict('0.2.0', '0.2.0').ok, false);
  assert.equal(bumpVerdict('0.1.9', '0.2.0').ok, false);
  assert.equal(bumpVerdict('0.2.1', '0.2.0').ok, true);
  assert.equal(bumpVerdict('0.10.0', '0.9.0').ok, true);
  assert.equal(bumpVerdict('banana', '0.2.0').ok, false);
  assert.equal(bumpVerdict('0.3.0', undefined).ok, false);
});

const SUB = 'apps/desktop';
const LOCK_FIELDS = [['version'], ['packages', '', 'version']];
const COPIES = [
  { file: 'package.json', fields: [['version']] },
  { file: 'package-lock.json', fields: LOCK_FIELDS },
  { file: `${SUB}/package.json`, fields: [['version']] },
  { file: `${SUB}/package-lock.json`, fields: LOCK_FIELDS },
];

test('lockstep: every copy must equal the root; a missing field is a mismatch', () => {
  const good = {
    'package.json': { version: '0.2.0' },
    'package-lock.json': { version: '0.2.0', packages: { '': { version: '0.2.0' } } },
    [`${SUB}/package.json`]: { version: '0.2.0' },
    [`${SUB}/package-lock.json`]: { version: '0.2.0', packages: { '': { version: '0.2.0' } } },
  };
  assert.deepEqual(lockstepMismatches(good, COPIES), []);
  const drift = structuredClone(good);
  drift[`${SUB}/package.json`].version = '0.1.0';
  delete drift['package-lock.json'].packages[''].version;
  const bad = lockstepMismatches(drift, COPIES);
  assert.equal(bad.length, 2);
  assert.match(bad.map(b => b.where).join('|'), /apps\/desktop\/package\.json version/);
  assert.match(bad.map(b => b.where).join('|'), /package-lock\.json packages\.\[""\]\.version/);
});

// --- end to end through the CLI, against a throwaway repo -------------------------
//
// A feature branch must NOT touch the version or the logs and adds a changeset instead;
// only the release prep (release.mjs prepare) writes them, and the gate accepts it only
// byte-for-byte (changesets.js releaseGuard).

// The fixture repository's own settings: nothing here is a default of the tool.
const GATE_CONFIG = { integrationBranch: 'trunk', releaseBranch: 'stable', tagPrefix: 'app-v', versionCopies: ['package-lock.json', `${SUB}/package.json`, `${SUB}/package-lock.json`] };
const VERSION_FILES = v => ({
  'package.json': { name: 'x', version: v },
  'package-lock.json': { name: 'x', version: v, lockfileVersion: 3, packages: { '': { name: 'x', version: v } } },
  [`${SUB}/package.json`]: { name: 'e', version: v },
  [`${SUB}/package-lock.json`]: { name: 'e', version: v, lockfileVersion: 3, packages: { '': { name: 'e', version: v } } },
});
const CHANGELOG = v => `# Changelog\n\nHeader prose.\n\n## ${v}\n\n- the first entry\n`;
// A changeset: the customer-facing what/why, then the engineering changelog text.
const CHANGE = '---\nwhat: The app opens noticeably faster.\nwhy: Less waiting every time you start your day.\n---\n- **Faster boot** (`startSession`).\n';

function writeTree(dir, files) {
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
  }
}
const baseTree = v => ({ '.version-gate.json': GATE_CONFIG, ...VERSION_FILES(v), 'CHANGELOG.md': CHANGELOG(v), 'release-notes.json': { releases: [note(v)] }, 'src.js': 'x\n' });

function gitRepo(baseVersion) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-gate-'));
  const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, env, stdio: 'pipe' });
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/trunk'); // git < 2.28 ignores init.defaultBranch
  writeTree(dir, baseTree(baseVersion));
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
  return {
    dir, env,
    write: files => writeTree(dir, files),
    setVersion: v => writeTree(dir, VERSION_FILES(v)),
    setNotes: releases => writeTree(dir, { 'release-notes.json': { releases } }),
    prepare: (...a) => spawnSync(process.execPath, [RELEASE, 'prepare', ...a], { cwd: dir, env, encoding: 'utf8' }),
  };
}
// A release note a user could read (release-notes.js).
const note = v => ({ version: v, title: 'Faster start-up', changes: [{ what: 'The app opens noticeably faster.', why: 'Less waiting every time you start your day.' }] });
const gate = (repo, ref = 'trunk') =>
  spawnSync(process.execPath, [CLI, 'guard', ref], { cwd: repo.dir, env: repo.env, encoding: 'utf8' });

test('guard PASSES a feature branch that leaves the version alone and adds a changeset', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  repo.write({ 'src.js': 'y\n', '.changes/faster-boot.md': CHANGE });
  const r = gate(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /guard ok \(feature\): changeset\(s\): \.changes\/faster-boot\.md/);
});

test('guard FAILS a feature branch that raises the version itself — the conflict, by construction', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  repo.write({ 'src.js': 'y\n', '.changes/faster-boot.md': CHANGE });
  repo.setVersion('0.2.1');
  repo.setNotes([note('0.2.1'), note('0.2.0')]);
  const r = gate(repo);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /edits a version field, release-notes\.json directly/);
  assert.match(r.stderr, /add a NEW file \.changes\/<branch-name>\.md/);
});

test('guard FAILS each guarded file on its own: one version copy, a CHANGELOG entry, a release note', (t) => {
  const cases = {
    'one version copy': repo => repo.write({ [`${SUB}/package.json`]: { name: 'e', version: '0.2.1' } }),
    'a CHANGELOG entry': repo => repo.write({ 'CHANGELOG.md': CHANGELOG('0.2.0').replace('## 0.2.0', '## 0.2.0\n\n- my entry') }),
    'a release note': repo => repo.setNotes([{ ...note('0.2.0'), title: 'Something else' }]),
  };
  for (const [label, edit] of Object.entries(cases)) {
    const repo = gitRepo('0.2.0');
    t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
    repo.write({ 'src.js': 'y\n', '.changes/x.md': CHANGE });
    edit(repo);
    const r = gate(repo);
    assert.equal(r.status, 1, `${label}: ${r.stdout}`);
    assert.match(r.stderr, /directly/, label);
  }
});

test('guard leaves CHANGELOG.md\'s prose header editable — only the log is shared', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  repo.write({ 'CHANGELOG.md': CHANGELOG('0.2.0').replace('Header prose.', 'Better header prose.'), '.changes/x.md': CHANGE });
  const r = gate(repo);
  assert.equal(r.status, 0, r.stderr);
});

// A Windows checkout (core.autocrlf — the windows-latest runner) has CRLF in the working tree
// and LF in git. Un-normalized, the byte comparison read every PR as a hand edit of both logs.
test('guard reads a CRLF working tree as the LF it is in git (Windows checkouts)', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  const crlf = f => fs.writeFileSync(path.join(repo.dir, f), fs.readFileSync(path.join(repo.dir, f), 'utf8').replace(/\n/g, '\r\n'));
  repo.write({ 'src.js': 'y\n', '.changes/x.md': CHANGE });
  for (const f of ['CHANGELOG.md', 'release-notes.json', 'package.json', 'package-lock.json', '.changes/x.md']) crlf(f);
  const r = gate(repo);
  assert.equal(r.status, 0, r.stderr);
});

test('guard FAILS a branch that changes something but adds no changeset', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  repo.write({ 'src.js': 'y\n' });
  const r = gate(repo);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /adds no changeset/);
});

test('guard FAILS a changeset whose note is commit-speak rather than something a user can read', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  repo.write({ '.changes/bad.md': '---\nwhat: fix(sessions): keep sid on resume (#12)\nwhy: see lib/stable-ids.js\n---\nbody\n' });
  const r = gate(repo);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /commit-type prefix/);
  assert.match(r.stderr, /PR\/issue number/);
  assert.match(r.stderr, /names a source file/);
});

test('guard PASSES a changeset that declares "no user-facing changes" explicitly', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  repo.write({ '.changes/tests-only.md': '---\nnoUserFacingChanges: true\n---\n- Tests only.\n' });
  assert.equal(gate(repo).status, 0);
});

test('release prep: release.mjs prepare writes exactly what the guard accepts (0.9.0 -> 0.10.0 included)', (t) => {
  const repo = gitRepo('0.9.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  repo.write({ '.changes/a.md': CHANGE, '.changes/b.md': '---\nnoUserFacingChanges: true\n---\n- **Tests** only.\n' });
  execFileSync('git', ['add', '-A'], { cwd: repo.dir, env: repo.env });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'changesets'], { cwd: repo.dir, env: repo.env });
  execFileSync('git', ['branch', '-f', 'trunk', 'HEAD'], { cwd: repo.dir, env: repo.env });
  const p = repo.prepare('--title', 'Faster start-up', '--version', '0.10.0');
  assert.equal(p.status, 0, p.stderr);
  assert.ok(!fs.existsSync(path.join(repo.dir, '.changes/a.md')) && !fs.existsSync(path.join(repo.dir, '.changes/b.md')), 'consumed changesets are deleted');
  for (const f of Object.keys(VERSION_FILES('x'))) assert.match(fs.readFileSync(path.join(repo.dir, f), 'utf8'), /"version": "0\.10\.0"/, f);
  const notes = JSON.parse(fs.readFileSync(path.join(repo.dir, 'release-notes.json'), 'utf8'));
  assert.deepEqual(notes.releases[0], { version: '0.10.0', title: 'Faster start-up', changes: [{ what: 'The app opens noticeably faster.', why: 'Less waiting every time you start your day.' }] });
  const log = fs.readFileSync(path.join(repo.dir, 'CHANGELOG.md'), 'utf8');
  assert.ok(log.startsWith('# Changelog\n\nHeader prose.\n\n## 0.10.0\n\n- **Faster boot** (`startSession`).\n- **Tests** only.\n\n## 0.9.0'), log);
  const r = gate(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /release prep 0\.9\.0 -> 0\.10\.0, consuming 2 changeset/);
  // ...and a hand touch-up after it is not the prep any more (the title is --title's, so free;
  // the changes are the changesets', so not).
  repo.setNotes([{ ...notes.releases[0], changes: [{ ...notes.releases[0].changes[0], what: 'The app opens a lot faster.' }] }, ...notes.releases.slice(1)]);
  const tampered = gate(repo);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /release-notes\.json is not what "release\.mjs prepare" writes/);
});

test('release prep: refuses a version that is not above package.json, and writes nothing', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  const p = repo.prepare('--version', '0.2.0');
  assert.equal(p.status, 1);
  assert.match(p.stderr, /0\.2\.0 is not above 0\.2\.0/);
  assert.equal(gate(repo).status, 0, 'the tree is untouched');
});

test('guard FAILS CLOSED on an unresolvable base ref or a malformed version', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  const noRef = gate(repo, 'no-such-branch');
  assert.equal(noRef.status, 1);
  assert.match(noRef.stderr, /cannot resolve no-such-branch/);
  repo.setVersion('0.3');
  assert.equal(gate(repo).status, 1);
});

const BRANCHES = { integrationBranch: 'trunk', releaseBranch: 'stable' };
const gatePlan = o => gatePlanRaw({ ...BRANCHES, ...o });

// --- which events are gated (version.js gatePlan) ------------------------------

test('gatePlan: a PR into trunk and a PUSH to trunk are both enforced', () => {
  assert.deepEqual(gatePlan({ event: 'pull_request', baseBranch: 'trunk' }), { mode: 'pr', baseBranch: 'trunk' });
  assert.deepEqual(gatePlan({ event: 'workflow_dispatch', baseBranch: 'trunk' }), { mode: 'pr', baseBranch: 'trunk' });
  assert.deepEqual(gatePlan({ event: 'push', refName: 'trunk', before: 'abc123' }), { mode: 'push', before: 'abc123' });
});

test('gatePlan: other bases and branches are skipped with a reason, never silently', () => {
  for (const p of [
    gatePlan({ event: 'pull_request', baseBranch: 'some/other-branch' }),
    gatePlan({ event: 'workflow_dispatch', baseBranch: '' }),
    gatePlan({ event: 'push', refName: 'stable', before: 'abc123' }),
  ]) {
    assert.equal(p.mode, 'skip');
    assert.ok(p.reason.length > 0);
  }
});

test('gatePlan: a push to trunk with no previous commit fails closed', () => {
  assert.equal(gatePlan({ event: 'push', refName: 'trunk', before: '0000000000000000000000000000000000000000' }).mode, 'error');
  assert.equal(gatePlan({ event: 'push', refName: 'trunk', before: '' }).mode, 'error');
});

// --- `gate` end to end: a real `origin`, a shallow checkout, a real fetch ----------
//
// Mirrors CI: `origin` holds trunk; the job checks out ONE commit at depth 1 and
// the gate must fetch the commit it compares against. Each step is one commit on origin.

const step = {
  base: v => dir => writeTree(dir, baseTree(v)),
  // An ordinary merged PR: code plus its changeset, version untouched.
  feature: name => dir => writeTree(dir, { 'src.js': `${name}\n`, [`.changes/${name}.md`]: CHANGE }),
  // The old habit: code plus a hand bump and a hand-written note.
  handBump: v => dir => writeTree(dir, { ...VERSION_FILES(v), 'src.js': `${v}\n`, 'release-notes.json': { releases: [note(v)] } }),
};

function originWithHistory(steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'version-gate-origin-'));
  const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
  const origin = path.join(dir, 'origin');
  fs.mkdirSync(origin);
  git(origin, 'init', '-q');
  git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
  git(origin, 'config', 'uploadpack.allowReachableSHA1InWant', 'true'); // GitHub serves fetch-by-SHA
  const shas = steps.map((apply, i) => {
    apply(origin);
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '--allow-empty', '-m', `c${i}`);
    return git(origin, 'rev-parse', 'HEAD');
  });
  const work = path.join(dir, 'work');
  git(dir, 'clone', '-q', '--depth=1', '--branch', 'trunk', 'file://' + origin, work);
  return { dir, env, work, shas, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const runGate = (repo, gateEnv) =>
  spawnSync(process.execPath, [CLI, 'gate'], { cwd: repo.work, env: { ...repo.env, ...gateEnv }, encoding: 'utf8' });

test('gate PASSES a push to trunk that is an ordinary merge (no version move, one changeset)', (t) => {
  const repo = originWithHistory([step.base('0.2.0'), step.feature('a')]);   // before, after
  t.after(repo.cleanup);
  const r = runGate(repo, { GATE_EVENT: 'push', GATE_REF: 'trunk', GATE_BEFORE: repo.shas[0] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /enforcing: push to trunk/);
  assert.match(r.stdout, /guard ok \(feature\): changeset\(s\): \.changes\/a\.md/);
});

test('gate FAILS a push to trunk that raises the version by hand', (t) => {
  const repo = originWithHistory([step.base('0.9.0'), step.handBump('0.10.0')]);
  t.after(repo.cleanup);
  const r = runGate(repo, { GATE_EVENT: 'push', GATE_REF: 'trunk', GATE_BEFORE: repo.shas[0] });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /directly/);
});

test('gate FAILS a PR into trunk that raises the version by hand', (t) => {
  const repo = originWithHistory([step.base('0.2.0')]);
  t.after(repo.cleanup);
  writeTree(repo.work, { ...VERSION_FILES('0.2.1'), 'src.js': 'y\n', '.changes/x.md': CHANGE });
  const r = runGate(repo, { GATE_EVENT: 'pull_request', GATE_BASE: 'trunk' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /edits a version field directly/);
});

test('gate FAILS a PR into stable while a changeset is still pending, and passes once the release is prepared', (t) => {
  const repo = originWithHistory([step.base('0.2.0'), step.feature('a')]);
  t.after(repo.cleanup);
  const pending = runGate(repo, { GATE_EVENT: 'pull_request', GATE_BASE: 'stable' });
  assert.equal(pending.status, 1, pending.stdout);
  assert.match(pending.stderr, /1 changeset\(s\) are still pending \(\.changes\/a\.md\)/);
  fs.rmSync(path.join(repo.work, '.changes'), { recursive: true });
  const clear = runGate(repo, { GATE_EVENT: 'pull_request', GATE_BASE: 'stable' });
  assert.equal(clear.status, 0, clear.stderr);
});

test('gate FAILS CLOSED when the replaced commit cannot be fetched', (t) => {
  const repo = originWithHistory([step.base('0.2.0'), step.feature('a')]);
  t.after(repo.cleanup);
  const r = runGate(repo, { GATE_EVENT: 'push', GATE_REF: 'trunk', GATE_BEFORE: 'f'.repeat(40) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cannot fetch/);
});

// Run by hand in a developer's FULL checkout (people imitate the CI step locally), the gate
// must not truncate it. A `--depth=1` fetch into a complete repo makes the whole repo
// shallow, and the shallow file is shared by every worktree, hiding history from every
// ancestry check after it. Depth-limited fetching is for checkouts that are ALREADY shallow.
test('gate leaves a full checkout full (and still gates it)', (t) => {
  const repo = originWithHistory([step.base('0.2.0'), step.feature('a')]);
  t.after(repo.cleanup);
  const full = path.join(repo.dir, 'full');
  execFileSync('git', ['clone', '-q', '--branch', 'trunk', 'file://' + path.join(repo.dir, 'origin'), full], { env: repo.env, stdio: 'pipe' });
  const shallow = () => execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: full, env: repo.env, encoding: 'utf8' }).trim();
  assert.equal(shallow(), 'false');
  const r = runGate({ ...repo, work: full }, { GATE_EVENT: 'push', GATE_REF: 'trunk', GATE_BEFORE: repo.shas[0] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /guard ok \(feature\)/);
  assert.equal(shallow(), 'false', 'the gate made a full checkout shallow');
  assert.ok(!fs.existsSync(path.join(full, '.git', 'shallow')));
});

test('gate in a shallow checkout still fetches shallowly (CI)', (t) => {
  const repo = originWithHistory([step.base('0.1.0'), step.feature('a'), step.feature('b')]);
  t.after(repo.cleanup);
  const r = runGate(repo, { GATE_EVENT: 'push', GATE_REF: 'trunk', GATE_BEFORE: repo.shas[1] });
  assert.equal(r.status, 0, r.stderr);
  const g = (...a) => spawnSync('git', a, { cwd: repo.work, env: repo.env, encoding: 'utf8' });
  assert.equal(g('cat-file', '-e', `${repo.shas[1]}^{commit}`).status, 0, 'the compared commit was fetched');
  assert.equal(g('rev-parse', '--is-shallow-repository').stdout.trim(), 'true', 'a shallow CI checkout stays shallow: nothing deepened');
  assert.equal(g('rev-list', '--count', repo.shas[1]).stdout.trim(), '1', 'fetched at depth 1, not its whole history');
});

// --- release prep with no hand steps: prepare --branch [--open] ----------------------
//
// A bare `origin` whose trunk carries two changesets, and a clone sitting on an
// unrelated branch with a dirty file. `gh` is a stub on PATH that records its argv.
function releaseOrigin(baseVersion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-branch-'));
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const run = (cwd, ...a) => execFileSync('git', a, { cwd, env, stdio: 'pipe', encoding: 'utf8' });
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  run(root, 'init', '-q', '--bare', origin);
  fs.mkdirSync(seed);
  run(seed, 'init', '-q');
  run(seed, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
  writeTree(seed, { ...baseTree(baseVersion), '.changes/a.md': CHANGE, '.changes/b.md': '---\nnoUserFacingChanges: true\n---\n- **Tests** only.\n' });
  run(seed, 'add', '-A');
  run(seed, 'commit', '-qm', 'base');
  run(seed, 'push', '-q', origin, 'trunk');
  const work = path.join(root, 'work');
  run(root, 'clone', '-q', '-b', 'trunk', origin, work);
  run(work, 'checkout', '-q', '-b', 'my-feature');
  fs.writeFileSync(path.join(work, 'src.js'), 'uncommitted\n');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${path.join(root, 'gh-argv')}"\necho https://example.invalid/pull/1\n`, { mode: 0o755 });
  return {
    root, origin, work, env, git: (...a) => run(work, ...a),
    release: (...a) => spawnSync(process.execPath, [RELEASE, 'prepare', ...a],
      { cwd: work, env: { ...env, PATH: `${bin}${path.delimiter}${env.PATH}` }, encoding: 'utf8' }),
    ghArgv: () => (fs.existsSync(path.join(root, 'gh-argv')) ? fs.readFileSync(path.join(root, 'gh-argv'), 'utf8').trim().split('\n') : null),
  };
}

test('release prep --branch --open: cuts, prepares, commits, pushes and opens the PR, touching nothing else', { skip: process.platform === 'win32' && 'the gh stub is a sh script' }, (t) => {
  const r = releaseOrigin('0.9.0');
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  const p = r.release('--title', 'Faster start-up', '--branch', 'rp-0.9.1', '--open');
  assert.equal(p.status, 0, p.stderr + p.stdout);
  const dir = path.join(r.work, '.worktrees', 'rp-0.9.1');
  // The checkout it ran from is untouched: same branch, same dirty file, nothing new staged.
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'my-feature');
  assert.equal(fs.readFileSync(path.join(r.work, 'src.js'), 'utf8'), 'uncommitted\n');
  assert.equal(r.git('diff', '--cached', '--name-only').trim(), '');
  // One commit on top of origin/trunk, exactly the prep, and a clean worktree.
  const wt = (...a) => execFileSync('git', a, { cwd: dir, env: r.env, encoding: 'utf8' });
  assert.equal(wt('rev-list', '--count', 'origin/trunk..HEAD').trim(), '1');
  assert.equal(wt('log', '-1', '--format=%s').trim(), 'Prepare release 0.9.1', 'next patch above package.json and every tag');
  assert.equal(wt('status', '--porcelain').trim(), '');
  assert.deepEqual(wt('diff', '--name-status', 'origin/trunk..HEAD').trim().split('\n').sort(), [
    'D\t.changes/a.md', 'D\t.changes/b.md', 'M\tCHANGELOG.md',
    `M\t${SUB}/package-lock.json`, `M\t${SUB}/package.json`,
    'M\tpackage-lock.json', 'M\tpackage.json', 'M\trelease-notes.json',
  ].sort());
  // ...which is exactly what the gate accepts as a release prep.
  const g = spawnSync(process.execPath, [CLI, 'guard', 'origin/trunk', 'HEAD'], { cwd: dir, env: r.env, encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  assert.match(g.stdout, /release prep 0\.9\.0 -> 0\.9\.1, consuming 2 changeset/);
  // No upstream (a bare push could not aim at trunk), pushed under its own name, PR into trunk.
  assert.equal(spawnSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], { cwd: dir, env: r.env }).status !== 0, true, 'no upstream');
  assert.equal(execFileSync('git', ['rev-parse', 'refs/heads/rp-0.9.1'], { cwd: r.origin, env: r.env, encoding: 'utf8' }).trim(), wt('rev-parse', 'HEAD').trim());
  assert.equal(execFileSync('git', ['rev-parse', 'refs/heads/trunk'], { cwd: r.origin, env: r.env, encoding: 'utf8' }).trim(),
    wt('rev-parse', 'origin/trunk').trim(), 'trunk itself is not pushed to');
  const gh = r.ghArgv();
  assert.deepEqual(gh.slice(0, 8), ['pr', 'create', '--base', 'trunk', '--head', 'rp-0.9.1', '--title', 'Prepare release 0.9.1']);
});

test('release prep --branch without --open stops after the commit, and refuses a branch that exists', { skip: process.platform === 'win32' && 'the gh stub is a sh script' }, (t) => {
  const r = releaseOrigin('0.9.0');
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  const p = r.release('--title', 'Faster start-up', '--branch');
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /committed "Prepare release 0\.9\.1" on release-prep/);
  assert.equal(r.ghArgv(), null, 'no PR without --open');
  assert.equal(execFileSync('git', ['ls-remote', '--heads', r.origin, 'release-prep'], { env: r.env, encoding: 'utf8' }).trim(), '', 'nothing pushed without --open');
  const again = r.release('--title', 'Faster start-up', '--branch');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /branch release-prep already exists locally/);
});

test('release prep --branch: a prep that fails leaves no worktree and no branch behind', { skip: process.platform === 'win32' && 'the gh stub is a sh script' }, (t) => {
  const r = releaseOrigin('0.9.0');
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  const p = r.release('--version', '0.1.0', '--branch', 'rp-bad', '--open');
  assert.equal(p.status, 1);
  assert.match(p.stderr, /0\.1\.0 is not above 0\.9\.0/);
  assert.equal(fs.existsSync(path.join(r.work, '.worktrees', 'rp-bad')), false);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/rp-bad'], { cwd: r.work, env: r.env }).status, 1);
  assert.equal(r.ghArgv(), null);
});

test('gatePlan: a merge_group into trunk is enforced like a PR into it', () => {
  assert.deepEqual(gatePlan({ event: 'merge_group', baseBranch: 'trunk' }), { mode: 'pr', baseBranch: 'trunk' });
});

// --- the repository's settings (.version-gate.json) -----------------------------------
test('lockstep CLI: passes in step, names the copy that drifted', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  const run = () => spawnSync(process.execPath, [CLI, 'lockstep'], { cwd: repo.dir, env: repo.env, encoding: 'utf8' });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /0\.2\.0 in all 4 files/);
  assert.equal(readPackageVersion(repo.dir), '0.2.0');
  repo.write({ [`${SUB}/package.json`]: { name: 'e', version: '0.2.1' } });
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /apps\/desktop\/package\.json version: found "0\.2\.1", expected "0\.2\.0"/);
});

test('config: an unknown key or a non-JSON file fails closed', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  repo.write({ '.version-gate.json': { ...GATE_CONFIG, integrationBranhc: 'trunk' } });
  const typo = gate(repo);
  assert.notEqual(typo.status, 0);
  assert.match(typo.stderr, /unknown key "integrationBranhc"/);
  repo.write({ '.version-gate.json': 'not json' });
  const junk = gate(repo);
  assert.notEqual(junk.status, 0);
  assert.match(junk.stderr, /\.version-gate\.json is not JSON/);
});

test('config: with no integration branch named or discoverable, the gate fails closed and never guesses one', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  const { integrationBranch, ...rest } = GATE_CONFIG;
  repo.write({ '.version-gate.json': rest });
  const run = env => spawnSync(process.execPath, [CLI, 'gate'], { cwd: repo.dir, env: { ...repo.env, GATE_EVENT: 'pull_request', GATE_BASE: 'trunk', ...env }, encoding: 'utf8' });
  const none = run({});
  assert.equal(none.status, 1, none.stdout);
  assert.match(none.stderr, /no integration branch is known/);
  assert.equal(gatePlanRaw({ event: 'pull_request', baseBranch: 'trunk', integrationBranch: null }).mode, 'error');
  // Named in the environment, the same event is gated (and then fails on the missing remote, not on the name).
  const named = run({ VERSION_GATE_BRANCH: 'trunk' });
  assert.equal(named.status, 1);
  assert.match(named.stderr, /cannot fetch/);
});

test('config: with no release branch, a PR into another branch is skipped, not treated as a release', () => {
  const p = gatePlanRaw({ event: 'pull_request', baseBranch: 'stable', integrationBranch: 'trunk', releaseBranch: null });
  assert.equal(p.mode, 'skip');
});

test('release prep: the next version is above every tag carrying the configured prefix, and other tags are ignored', (t) => {
  const repo = gitRepo('0.2.0');
  t.after(() => fs.rmSync(repo.dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo.dir, env: repo.env, stdio: 'pipe' });
  git('tag', 'app-v0.4.7');
  git('tag', 'other-v9.9.9');
  git('remote', 'add', 'origin', repo.dir);
  repo.write({ '.changes/a.md': CHANGE });
  const p = repo.prepare('--title', 'Faster start-up');
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /prepared 0\.2\.0 -> 0\.4\.8/);
});

// --- the suite test a repository copies in (scripts/version-files-untouched.test.mjs) ---
test('the suite test passes a branch with a changeset and fails one that bumps the version', (t) => {
  const r = releaseOrigin('0.9.0');
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  const suite = () => spawnSync(process.execPath, ['--test', path.join(SCRIPTS, 'version-files-untouched.test.mjs')],
    { cwd: r.work, env: r.env, encoding: 'utf8' });
  fs.mkdirSync(path.join(r.work, '.changes'), { recursive: true });
  fs.writeFileSync(path.join(r.work, '.changes/mine.md'), CHANGE);
  const ok = suite();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /pass 1\b/, 'it judged the branch, it did not skip');
  writeTree(r.work, VERSION_FILES('0.9.1'));
  const bad = suite();
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout + bad.stderr, /edits a version field directly/);
});
