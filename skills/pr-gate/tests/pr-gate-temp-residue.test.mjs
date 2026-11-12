// pr-gate.mjs must not leave its temp work dir behind, even when a plain `rm -rf` cannot remove it.
//
// The cause is a directory without its execute bit: a test plants a non-empty DIRECTORY where
// code under test expects a secret file, and that code tightens the path to 0600 whatever it is.
// A 0600 directory cannot be entered, so its entries cannot be unlinked: fs.rmSync stops with
// EACCES at the TOP of the tree (removing nothing, not just that dir), `rm -rf` fails the same
// way, and a cleanup that swallows the error hides it. A run killed with SIGKILL never reaches
// cleanup at all.
//
// Handled in two places: the removal gives the tree's directories back their owner rwx when
// rmSync is refused (lib/test-temp-root.js › removeTree), and each gate run marks its work dir
// with its pid so the next run removes the dir of one whose process is gone (› staleGateDirs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTree, staleGateDirs, GATE_PREFIX, GATE_MARKER } from '../scripts/lib/test-temp-root.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'pr-gate.mjs');
const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
// Root ignores the missing execute bit, and Windows has none: there is nothing to reproduce.
const skip = process.platform === 'win32' || uid === 0 ? 'needs POSIX permissions as a non-root user' : false;
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const shut = p => path.join(p, 'credentials.1', '.token');

// The exact shape the gate's residue had: a 0600 directory holding a file, beside other files.
function plantResidue(dir) {
  const locked = shut(dir);
  fs.mkdirSync(locked, { recursive: true });
  fs.writeFileSync(path.join(locked, 'occupied'), 'x');
  fs.chmodSync(locked, 0o600);
  fs.writeFileSync(path.join(dir, 'beside.jsonl'), '{}');
  return locked;
}

test('a 0600 directory defeats fs.rmSync and rm -rf; removeTree removes the whole tree', { skip }, () => {
  const a = tmp('residue-'), b = tmp('residue-');
  plantResidue(a); plantResidue(b);
  assert.throws(() => fs.rmSync(a, { recursive: true, force: true, maxRetries: 3 }), { code: 'EACCES' });
  assert.ok(fs.existsSync(shut(a)), 'rmSync gave up and the tree is still there');
  assert.notEqual(spawnSync('rm', ['-rf', b]).status, 0, 'a plain rm -rf cannot remove it either');
  for (const d of [a, b]) {
    assert.equal(removeTree(fs, d, { uid }), null);
    assert.equal(fs.existsSync(d), false, `${d} is gone`);
  }
});

test('removeTree never follows a symlink out of the tree', { skip }, () => {
  const outside = tmp('residue-outside-');
  const locked = plantResidue(outside);
  const tree = tmp('residue-');
  plantResidue(tree);
  fs.symlinkSync(outside, path.join(tree, 'link'));
  assert.equal(removeTree(fs, tree, { uid }), null);
  assert.equal(fs.existsSync(tree), false);
  assert.equal(fs.statSync(locked).mode & 0o777, 0o600, 'a directory outside the tree keeps its mode');
  fs.chmodSync(locked, 0o700);
  assert.equal(fs.readFileSync(path.join(locked, 'occupied'), 'utf8'), 'x', 'and its contents');
  fs.rmSync(outside, { recursive: true, force: true });
});

test('removeTree leaves a directory it does not own unchanged', () => {
  // An injected fs: the tree's inner dir belongs to another uid, so it is never chmodded.
  const calls = [];
  const st = (dir, owner, mode) => ({ isDirectory: () => dir, isSymbolicLink: () => false, uid: owner, mode });
  const fake = {
    rmSync() { const e = new Error('denied'); e.code = 'EACCES'; throw e; },
    lstatSync: p => (p === '/t' ? st(true, 7, 0o40700) : st(true, 8, 0o40600)),
    readdirSync: p => (p === '/t' ? ['theirs'] : []),
    chmodSync: (p, m) => calls.push([p, m]),
  };
  assert.equal(removeTree(fake, '/t', { uid: 7 }).code, 'EACCES', 'the failure is returned, not swallowed');
  assert.deepEqual(calls, []);
});

test('staleGateDirs: only marked, owned gate work dirs whose run is gone', () => {
  const b = tmp('residue-base-');
  const mk = (name, marker) => {
    const d = path.join(b, name);
    fs.mkdirSync(d);
    if (marker !== undefined) fs.writeFileSync(path.join(d, GATE_MARKER), typeof marker === 'string' ? marker : JSON.stringify(marker));
    return d;
  };
  const dead = mk(`${GATE_PREFIX}AAAAAA`, { pid: 1001 });
  mk(`${GATE_PREFIX}BBBBBB`, { pid: 1002 }); // alive
  mk(`${GATE_PREFIX}CCCCCC`); // from before the marker existed: not ours to judge
  mk(`${GATE_PREFIX}DDDDDD`, '{not json');
  mk(`${GATE_PREFIX}EEEEEE`, { pid: 'x' });
  mk(`${GATE_PREFIX}cache`, { pid: 1001 }); // the base-result cache is never a work dir
  mk('node-test-root-1001', { pid: 1001 });
  if (process.platform !== 'win32') fs.symlinkSync(dead, path.join(b, `${GATE_PREFIX}FFFFFF`));
  const alive = pid => pid === 1002;
  assert.deepEqual(staleGateDirs({ fs, tmpBase: b, uid, alive }), [dead]);
  if (typeof uid === 'number') assert.deepEqual(staleGateDirs({ fs, tmpBase: b, uid: uid + 1, alive }), [], 'another user\'s dir is never ours');
  assert.deepEqual(staleGateDirs({ fs, tmpBase: path.join(b, 'missing'), uid, alive }), []);
  fs.rmSync(b, { recursive: true, force: true });
});

// ---- end to end: the CLI against a throwaway one-test repo, never this repo's suite ----------

// The planted test does what such code does to its home: it leaves a
// non-empty 0600 directory in the test temp root, which the gate points TMPDIR at.
const PLANT = "import { test } from 'node:test'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';\n" +
  "test('plants a dir without its execute bit', async () => {\n" +
  "  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plant-')), '.token');\n" +
  "  fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'occupied'), 'x'); fs.chmodSync(d, 0o600);\n" +
  "  if (process.env.PLANT_READY) { fs.writeFileSync(process.env.PLANT_READY, 'planted'); await new Promise(r => setTimeout(r, 120000)); }\n" +
  "});\n";

function sandboxRepo() {
  const dir = tmp('pr-gate-residue-repo-');
  const g = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (msg, files) => {
    for (const [f, s] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); }
    g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD');
  };
  g('init', '-q');
  const base = commit('base', {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node tools/run-tests.mjs "tests/**/*.test.mjs"' } }),
    'tests/ok.test.mjs': "import { test } from 'node:test'; test('ok', () => {});\n",
  });
  // The gate gets a temp dir of its own, so "what did it leave" is a readdir of one directory.
  const gateTmp = tmp('pr-gate-residue-tmp-');
  const env = { ...process.env, TMPDIR: gateTmp, TMP: gateTmp, TEMP: gateTmp, PR_GATE_CACHE: path.join(dir, '.git', 'pr-gate-cache') };
  const workDirs = () => fs.readdirSync(gateTmp).filter(n => n.startsWith(GATE_PREFIX)).map(n => path.join(gateTmp, n));
  const done = () => { for (const d of [dir, gateTmp]) removeTree(fs, d, { uid }); };
  return { dir, g, commit, base, gateTmp, env, workDirs, done };
}
const gate = (r, ...args) => spawnSync(process.execPath, [CLI, ...args, '--fresh', '--runs', '1'], { cwd: r.dir, encoding: 'utf8', env: r.env });

test('CLI: a suite that leaves a directory without its execute bit leaves no work dir behind', { skip }, () => {
  const r = sandboxRepo();
  try {
    const pr = r.commit('pr', { 'tests/plant.test.mjs': PLANT });
    const out = gate(r, r.base, pr);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.deepEqual(r.workDirs(), [], out.stderr);
    assert.doesNotMatch(out.stderr, /could not remove/);
  } finally { r.done(); }
});

test('CLI: a SIGKILLed run\'s work dir, residue and worktree included, is removed by the next run', { skip, timeout: 120000 }, async () => {
  const r = sandboxRepo();
  try {
    const ready = path.join(r.dir, '.git', 'planted');
    const pr = r.commit('pr', { 'tests/plant.test.mjs': PLANT });
    // Detached, so the gate leads its own process group and one kill takes its suite with it.
    const child = spawn(process.execPath, [CLI, r.base, pr, '--fresh', '--runs', '1'], { cwd: r.dir, env: { ...r.env, PLANT_READY: ready }, detached: true, stdio: 'ignore' });
    const exited = new Promise(res => child.on('exit', res));
    const t0 = Date.now();
    while (!fs.existsSync(ready)) {
      assert.ok(Date.now() - t0 < 90000, 'the planted test never ran');
      await new Promise(res => setTimeout(res, 50));
    }
    process.kill(-child.pid, 'SIGKILL');
    await exited;

    const [left] = r.workDirs();
    assert.ok(left, 'a SIGKILLed run cannot clean up: its work dir is there');
    assert.ok(fs.existsSync(path.join(left, GATE_MARKER)), 'and carries the marker naming its pid');
    assert.match(r.g('worktree', 'list'), new RegExp(`${GATE_PREFIX}\\w+/tree`), 'and its worktree is still registered');

    r.g('checkout', '-q', '--detach', r.base);
    const harmless = r.commit('harmless', { 'tests/more.test.mjs': "import { test } from 'node:test'; test('more', () => {});\n" });
    const out = gate(r, r.base, harmless);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.ok(out.stderr.includes(`removed ${left} (its run is gone)`), out.stderr);
    assert.equal(fs.existsSync(left), false, 'the dead run\'s work dir is gone');
    assert.deepEqual(r.workDirs(), [], 'and the new run left none of its own');
    assert.equal(r.g('worktree', 'list').split('\n').length, 1, 'git no longer lists either run\'s worktree');
  } finally { r.done(); }
});
