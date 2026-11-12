// The advisor agent file is a valid, read-only Claude Code subagent that still carries its
// five checks, and the installer puts it where Claude Code reads agents from without ever
// overwriting a repository's own copy. `node --test tests/advisor.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = fs.readFileSync(path.join(SKILL, 'templates', 'advisor.md'), 'utf8');
const INSTALL = path.join(SKILL, 'scripts', 'install.mjs');

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, 'the file starts with a --- frontmatter block');
  return { fields: Object.fromEntries(m[1].split('\n').map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })), body: text.slice(m[0].length) };
}
const run = (args, opts = {}) => spawnSync(process.execPath, [INSTALL, ...args], { encoding: 'utf8', ...opts });
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'advisor-test-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('the agent file is a subagent definition: name, a description that tells callers to paste context, a model', () => {
  const { fields } = frontmatter(TEMPLATE);
  assert.equal(fields.name, 'advisor');
  assert.match(fields.description, /MUST paste in its own context/);
  assert.ok(fields.model);
});

test('the advisor is read-only: it is given no tool that edits or writes files', () => {
  const tools = frontmatter(TEMPLATE).fields.tools.split(',').map(s => s.trim());
  assert.deepEqual(tools.sort(), ['Bash', 'Glob', 'Grep', 'Read']);
  assert.match(TEMPLATE, /you do not edit files, you do not commit/);
  assert.match(TEMPLATE, /\*\*Stay read-only\.\*\*/);
});

test('all five checks, the verdict rule and the four moments to consult are present', () => {
  const { body } = frontmatter(TEMPLATE);
  const checks = body.match(/^\d\. \*\*.+?\*\*/gm);
  assert.equal(checks.length, 5, 'five numbered checks');
  for (const phrase of ['able to FAIL', 'population non-empty', 'measure the thing it names', 'actually visible', 'contradict something the repository']) {
    assert.ok(checks.some(c => c.includes(phrase)), phrase);
  }
  assert.match(body, /Give a verdict, not a survey/);
  assert.match(body, /not a rubber stamp/);
  for (const when of ['Before committing to an approach', 'Before declaring a piece of work done', 'When stuck', 'When changing approach mid-task']) assert.ok(body.includes(when), when);
});

test('the agent file names no particular repository, person or rule number', () => {
  assert.doesNotMatch(TEMPLATE, /R-[A-Z]+-\d+|§\s*\d|\/home\/|section \d/i);
});

test('install writes <repo>/.claude/agents/advisor.md, and a second run changes nothing', (t) => {
  const repo = tmp(t);
  const first = run(['--dir', repo]);
  assert.equal(first.status, 0, first.stderr);
  const target = path.join(repo, '.claude', 'agents', 'advisor.md');
  assert.equal(fs.readFileSync(target, 'utf8'), TEMPLATE);
  const mtime = fs.statSync(target).mtimeMs;
  const again = run(['--dir', repo]);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already installed/);
  assert.equal(fs.statSync(target).mtimeMs, mtime);
});

test('install never overwrites a different advisor.md unless --force', (t) => {
  const repo = tmp(t);
  const target = path.join(repo, '.claude', 'agents', 'advisor.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'the repository\'s own advisor\n');
  const r = run(['--dir', repo]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /exists and differs; left alone/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'the repository\'s own advisor\n');
  assert.equal(run(['--dir', repo, '--force']).status, 0);
  assert.equal(fs.readFileSync(target, 'utf8'), TEMPLATE);
});

test('with no --dir it installs at the root of the checkout it runs in, not in a subfolder', (t) => {
  const repo = tmp(t);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.mkdirSync(path.join(repo, 'deep', 'er'), { recursive: true });
  const r = run([], { cwd: path.join(repo, 'deep', 'er') });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(fs.realpathSync(repo), '.claude', 'agents', 'advisor.md')));
  assert.ok(!fs.existsSync(path.join(repo, 'deep', 'er', '.claude')));
});

test('--user installs under CLAUDE_CONFIG_DIR; --model changes only the model line; --print writes nothing', (t) => {
  const cfg = tmp(t);
  const r = run(['--user', '--model', 'sonnet'], { env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(r.status, 0, r.stderr);
  const got = fs.readFileSync(path.join(cfg, 'agents', 'advisor.md'), 'utf8');
  assert.equal(frontmatter(got).fields.model, 'sonnet');
  assert.equal(got.replace(/^model: .*$/m, ''), TEMPLATE.replace(/^model: .*$/m, ''));
  const empty = tmp(t);
  const p = run(['--print'], { cwd: empty });
  assert.equal(p.stdout, TEMPLATE);
  assert.deepEqual(fs.readdirSync(empty), []);
});

test('a mistyped flag, or --user with --dir, stops before anything is written', (t) => {
  const repo = tmp(t);
  assert.equal(run(['--dir', repo, '--forse']).status, 2);
  assert.equal(run(['--dir', repo, '--user']).status, 2);
  assert.equal(run(['--dir', repo, '--model', 'bad model\nx: y']).status, 2);
  assert.deepEqual(fs.readdirSync(repo), []);
});
