// The cheap-floor pre-commit hook, driven by real `git commit` runs in throwaway repositories:
// green commits, red is refused, and every way of running nothing (no list, an empty list, a
// listed suite that is gone) is refused too. `node --test tests/cheap-floor.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'pre-commit');
const PASS = 'process.exit(0);\n';
const FAIL = 'console.error("guard says: the thing is broken"); process.exit(1);\n';

function repo(t, files) {
  // A space in the path on purpose: the hook must quote everything it touches.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cheap floor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', TMPDIR: os.tmpdir(),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...a) => spawnSync('git', a, { cwd: dir, env, encoding: 'utf8' });
  const write = (fl) => { for (const [f, body] of Object.entries(fl)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); } };
  git('init', '-q');
  fs.mkdirSync(path.join(dir, 'hooks'));
  fs.copyFileSync(HOOK, path.join(dir, 'hooks', 'pre-commit'));
  fs.chmodSync(path.join(dir, 'hooks', 'pre-commit'), 0o755);
  git('config', 'core.hooksPath', 'hooks');
  write(files);
  let n = 0;
  const commit = () => { write({ 'change.txt': String(++n) }); git('add', '-A'); return git('commit', '-m', `c${n}`); };
  const commits = () => { const r = git('rev-list', '--count', 'HEAD'); return r.status === 0 ? Number(r.stdout.trim()) : 0; };
  return { dir, git, write, commit, commits };
}

test('green: every listed suite passes, the commit lands, and the hook says what it did NOT check', (t) => {
  const r = repo(t, { '.cheap-floor': '# the floor\n\ntest/a.test.js\ntest/b.test.js   # trailing comment\n', 'test/a.test.js': PASS, 'test/b.test.js': PASS });
  const c = r.commit();
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout + c.stderr, /ok {4}test\/a\.test\.js\n\s+ok {4}test\/b\.test\.js/);
  assert.match(c.stdout + c.stderr, /THIS IS NOT THE TEST RUN YOUR CHANGE NEEDS/);
  assert.equal(r.commits(), 1);
});

test('red: one failing suite refuses the commit, shows its output, and still runs the others', (t) => {
  const r = repo(t, { '.cheap-floor': 'test/a.test.js\ntest/b.test.js\ntest/c.test.js\n', 'test/a.test.js': PASS, 'test/b.test.js': FAIL, 'test/c.test.js': PASS });
  const c = r.commit();
  assert.equal(c.status, 1);
  const out = c.stdout + c.stderr;
  assert.match(out, /FAIL {2}test\/b\.test\.js/);
  assert.match(out, /guard says: the thing is broken/);
  assert.match(out, /ok {4}test\/c\.test\.js/, 'a red suite does not hide the ones after it');
  assert.match(out, /COMMIT REFUSED — the cheap guard tier is red/);
  assert.equal(r.commits(), 0, 'nothing was committed');
  r.write({ 'test/b.test.js': PASS });
  assert.equal(r.commit().status, 0);
  assert.equal(r.commits(), 1);
});

test('a listed suite that is not on disk refuses the commit and runs nothing', (t) => {
  const r = repo(t, { '.cheap-floor': 'test/a.test.js\ntest/moved.test.js\n', 'test/a.test.js': 'require("fs").writeFileSync("ran", "x");\n' });
  const c = r.commit();
  assert.equal(c.status, 1);
  assert.match(c.stderr + c.stdout, /names a suite that is not on disk: test\/moved\.test\.js/);
  assert.ok(!fs.existsSync(path.join(r.dir, 'ran')), 'no suite ran');
  assert.equal(r.commits(), 0);
});

test('no list, and a list that names nothing, are refusals — never a green over zero suites', (t) => {
  const none = repo(t, {});
  const a = none.commit();
  assert.equal(a.status, 1);
  assert.match(a.stderr + a.stdout, /has no suite list: \.cheap-floor is not a file/);
  const empty = repo(t, { '.cheap-floor': '# nothing yet\n\n   \n' });
  const b = empty.commit();
  assert.equal(b.status, 1);
  assert.match(b.stderr + b.stdout, /names no suites/);
  assert.equal(none.commits() + empty.commits(), 0);
});

test('a line may name its own runner, and git config moves the list and the default runner', (t) => {
  const runner = 'const fs = require("fs"); fs.appendFileSync("seen", process.argv.slice(2).join(" ") + "\\n"); process.exit(fs.readFileSync(process.argv.at(-1), "utf8").includes("bad") ? 1 : 0);\n';
  const r = repo(t, {
    'ci/floor.list': 'checks/one.txt\nchecks/two.txt | node tools/runner.js --strict\n',
    'tools/runner.js': runner, 'checks/one.txt': 'fine\n', 'checks/two.txt': 'fine\n',
  });
  r.git('config', 'cheapFloor.suites', 'ci/floor.list');
  r.git('config', 'cheapFloor.runner', 'node tools/runner.js');
  const ok = r.commit();
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.equal(fs.readFileSync(path.join(r.dir, 'seen'), 'utf8'), 'checks/one.txt\n--strict checks/two.txt\n');
  r.write({ 'checks/two.txt': 'bad\n' });
  const red = r.commit();
  assert.equal(red.status, 1);
  assert.match(red.stdout + red.stderr, /FAIL {2}checks\/two\.txt/);
});

test('it runs from the repository root when the commit is made in a subfolder, and leaves no temp file', (t) => {
  const r = repo(t, { '.cheap-floor': 'test/a.test.js\n', 'test/a.test.js': PASS, 'sub/x.txt': 'x' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cheap-floor-tmp-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  r.git('add', '-A');
  const c = spawnSync('git', ['commit', '-m', 'from sub'], { cwd: path.join(r.dir, 'sub'), encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: r.dir, GIT_CONFIG_NOSYSTEM: '1', TMPDIR: tmp, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  assert.equal(c.status, 0, c.stderr + c.stdout);
  assert.deepEqual(fs.readdirSync(tmp), [], 'the hook removed its output file');
});
