// The census library and CLI: the census reports what agents left
// outside the sanctioned places, and CHANGES NOTHING. The read-only property is measured, not
// asserted from the source: a fixture HOME is snapshotted (every path, size, mtime and content
// hash) before and after a real run of the CLI and must be identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as c from '../scripts/lib/workspace-census.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'workspace-census.mjs');

test('parseWorktreeList + worktreesOutside: only linked worktrees outside .worktrees/ and outside managed places', () => {
  const list = c.parseWorktreeList([
    'worktree /r', 'HEAD 1', 'branch refs/heads/trunk', '',
    'worktree /r/.worktrees/a', 'HEAD 2', 'branch refs/heads/a', '',
    'worktree /elsewhere/b', 'HEAD 3', 'branch refs/heads/feat/b', '',
    'worktree /tmp/x', 'HEAD 4', 'detached', '',
    'worktree /h/.mytool/previews/one', 'HEAD 5', 'branch refs/heads/p', '',
  ].join('\n'));
  assert.equal(list.length, 5);
  const out = c.worktreesOutside(list, ['/h/.mytool']);
  assert.deepEqual(out.map(w => [w.path, w.branch, w.detached, w.repo]), [
    ['/elsewhere/b', 'feat/b', false, '/r'],
    ['/tmp/x', null, true, '/r'],
  ]);
});

test('untrackedAtRoot keeps only top-level untracked entries', () => {
  assert.deepEqual(c.untrackedAtRoot('?? .spike.png\0?? frames/\0?? docs/x.md\0 M server.js\0?? .worktrees/\0'), ['.spike.png', 'frames']);
});

test('tempPattern folds mkdtemp suffixes and trailing pids into one pattern', () => {
  assert.equal(c.tempPattern('app-home-a1B2c3'), 'app-home-*');
  assert.equal(c.tempPattern('app-static-44313-3287759'), 'app-static-*');
  assert.equal(c.tempPattern('suite-test-4242'), 'suite-test-*');
  assert.equal(c.tempPattern('plainname'), 'plainname');
});

test('bashWriteTargets reads the unambiguous write shapes and nothing else', () => {
  const t = s => c.bashWriteTargets(s);
  assert.deepEqual(t('mkdir -p ~/scratch/film && cd ~/scratch/film'), ['~/scratch/film']);
  assert.deepEqual(t('git worktree add ../wt -b feat/x origin/dev --no-track'), ['../wt']);
  assert.deepEqual(t('git worktree add -b feat/x ../wt2 HEAD'), ['../wt2']);
  assert.deepEqual(t('git clone -q https://x/y.git copy'), ['copy']);
  assert.deepEqual(t('git clone https://x/y.git'), []);
  assert.deepEqual(t('cp a.png b.png ~/shots/'), ['~/shots/']);
  assert.deepEqual(t('echo hi > ~/out.txt; ls | tee -a ~/log.txt'), ['~/out.txt', '~/log.txt']);
  assert.deepEqual(t('cmd 2>/dev/null >&2'), []);
  assert.deepEqual(t('ls ~/scratch; cat ~/notes'), [], 'reads are not writes');
  assert.deepEqual(t('mkdir "$(mktemp -d)"'), [], 'a computed path is not guessed at');
});

test('writesFromLine resolves ~, $HOME and cwd-relative targets, and redacts secrets', () => {
  const line = JSON.stringify({ timestamp: '2030-01-18T10:00:00Z', cwd: '/h/code/r', message: { content: [
    { type: 'tool_use', name: 'Bash', input: { command: 'APP_TOKEN=abcdefabcdefabcdefabcdefabcdefabcdef mkdir -p $HOME/scratch ../r-copy' } },
    { type: 'tool_use', name: 'Write', input: { file_path: '/h/notes/a.md' } },
    { type: 'text', text: 'mkdir ~/nope' },
  ] } });
  const w = c.writesFromLine(line, '/h');
  assert.deepEqual(w.map(x => x.path), ['/h/scratch', '/h/code/r-copy', '/h/notes/a.md']);
  assert.ok(!w[0].excerpt.includes('abcdefabcdef'), w[0].excerpt);
  assert.equal(c.writesFromLine('{"no":"tool"}', '/h').length, 0);
  assert.equal(c.writesFromLine('not json "tool_use"', '/h').length, 0);
});

test('candidateFor rolls a path up to the folder the agent introduced', () => {
  const anchors = c.anchorSet('/h', ['/h/Documents/work/repo']);
  assert.equal(c.candidateFor('/h/scratch/a/b.png', { home: '/h', anchors }), '/h/scratch');
  assert.equal(c.candidateFor('/h/Documents/work/repo-copy/x', { home: '/h', anchors }), '/h/Documents/work/repo-copy');
  assert.equal(c.candidateFor('/h/Downloads/thing/y', { home: '/h', anchors }), '/h/Downloads/thing');
  assert.equal(c.candidateFor('/h/Documents/report.md', { home: '/h', anchors }), '/h/Documents/report.md');
  assert.equal(c.candidateFor('/etc/x', { home: '/h', anchors }), null);
});

test('sanctioned places, profiles, repos, excludes and dotfiles are never candidates', () => {
  const ctx = { home: '/h', tmpBase: '/tmp', profiles: ['/h/.claude'], repos: ['/h/code/r'], excludes: ['/h/dev'], managed: ['/h/.mytool', '/h/.mytool-previews'] };
  assert.equal(c.sanctioned('/tmp/x', ctx), 'temp');
  assert.equal(c.sanctioned('/h/.claude/projects/x', ctx), 'profile');
  assert.equal(c.sanctioned('/h/code/r/.spike.png', ctx), 'repo');
  assert.equal(c.sanctioned('/h/dev/thing', ctx), 'excluded');
  assert.equal(c.sanctioned('/h/.mytool-previews/one', ctx), 'managed');
  assert.equal(c.sanctioned('/h/.mytool/work/r/shot.png', ctx), 'managed');
  assert.equal(c.sanctioned('/h/.bashrc', ctx), 'config');
  assert.equal(c.sanctioned('/h/.mytool.agent-mistake-1/x', ctx), null, 'a stray dot-DIRECTORY is still reported');
  assert.equal(c.sanctioned('/h/scratch', ctx), null);
});

// ---- the CLI against a fixture HOME ------------------------------------------------------------

function snapshot(root) {
  const out = [];
  const walk = d => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      const rel = path.relative(root, p);
      if (st.isSymbolicLink()) out.push(`L ${rel} -> ${fs.readlinkSync(p)}`);
      else if (st.isDirectory()) { out.push(`D ${rel} ${st.mtimeMs}`); walk(p); }
      else out.push(`F ${rel} ${st.size} ${st.mtimeMs} ${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')}`);
    }
  };
  walk(root);
  return out;
}

const g = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', cwd, ...args], { stdio: 'pipe' });

test('the CLI reports each kind of item, excludes what it must, and changes nothing', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'census-'));
  const home = path.join(base, 'home');
  const tmp = path.join(base, 'tmp');
  fs.mkdirSync(tmp);
  const repo = path.join(home, 'code', 'repo');
  fs.mkdirSync(repo, { recursive: true });
  g(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'README'), 'x');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.log\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-qm', 'init');
  g(repo, 'worktree', 'add', '-q', path.join(repo, '.worktrees', 'inside'), '-b', 'inside');
  g(repo, 'worktree', 'add', '-q', path.join(home, 'code', 'repo-wt'), '-b', 'feat/out');
  fs.mkdirSync(path.join(home, '.mytool-previews'));
  g(repo, 'worktree', 'add', '-q', path.join(home, '.mytool-previews', 'one'), '-b', 'preview');
  fs.writeFileSync(path.join(repo, '.spike.png'), 'png');
  fs.writeFileSync(path.join(repo, 'ignored.log'), 'log');

  for (const d of ['scratch/film', 'notes-dir', 'dev/mine', '.mytool/work/repo']) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.writeFileSync(path.join(home, 'scratch', 'film', 'a.mp4'), Buffer.alloc(2048));
  fs.writeFileSync(path.join(home, 'notes-dir', 'a.md'), 'n');
  fs.writeFileSync(path.join(home, '.bashrc'), '#');

  const prof = path.join(home, '.claude');
  const proj = path.join(prof, 'projects', '-code-repo');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ projects: { [repo]: {} } }));
  const tu = (at, name, input) => JSON.stringify({ timestamp: at, cwd: repo, message: { content: [{ type: 'tool_use', name, input }] } });
  fs.writeFileSync(path.join(proj, 's.jsonl'), [
    tu('2030-01-18T01:00:00Z', 'Bash', { command: 'mkdir -p ~/scratch/film' }),
    tu('2030-01-19T01:00:00Z', 'Bash', { command: 'cp x.mp4 ~/scratch/film/a.mp4' }),
    tu('2030-01-18T02:00:00Z', 'Write', { file_path: path.join(home, 'notes-dir', 'a.md') }),
    tu('2030-01-18T03:00:00Z', 'Write', { file_path: path.join(repo, 'src.js') }),
    tu('2030-01-18T04:00:00Z', 'Write', { file_path: path.join(home, 'dev', 'mine', 'x') }),
    tu('2030-01-18T05:00:00Z', 'Write', { file_path: path.join(home, '.bashrc') }),
    tu('2030-01-18T06:00:00Z', 'Write', { file_path: path.join(home, '.mytool', 'state', 'y') }),
    tu('2030-01-18T07:00:00Z', 'Write', { file_path: path.join(home, 'gone', 'z') }),
    tu('2030-01-18T08:00:00Z', 'Bash', { command: `mkdir ${tmp}/t1` }),
  ].join('\n') + '\n');

  for (const n of ['app-home-aaaaaa', 'app-home-bbbbbb', 'suite-test-77']) fs.mkdirSync(path.join(tmp, n));

  const FLAGS = ['--exclude', '~/dev', '--managed', '~/.mytool-previews', '--work-dir', '~/.mytool/work'];
  const before = [...snapshot(home), ...snapshot(tmp)];
  const r = spawnSync(process.execPath, [CLI, ...FLAGS],
    { env: { ...process.env, HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const after = [...snapshot(home), ...snapshot(tmp)];
  assert.deepEqual(after, before, 'the census wrote, moved or removed something');

  const out = r.stdout;
  const section = (n) => out.split(/\n(?=\d\. |Not walked:)/).find(s => s.startsWith(`${n}. `)) || '';
  // 1. the outside worktree, not the .worktrees one, not the managed tool's own preview.
  assert.match(section(1), /~\/code\/repo-wt\s+— worktree of ~\/code\/repo, branch feat\/out/);
  assert.doesNotMatch(section(1), /inside|previews/);
  // 2. agent writes, rolled up; nothing from the repo, excluded paths, dotfiles, managed state, temp or gone paths.
  assert.match(section(2), /~\/scratch\b/);
  assert.match(section(2), /2 write\(s\) in transcripts, 2030-01-18 → 2030-01-19; first: mkdir -p ~\/scratch\/film/);
  assert.match(section(2), /~\/notes-dir\b/);
  for (const bad of ['src.js', '~/dev', '.bashrc', '.mytool', '~/gone', 't1']) assert.ok(!section(2).includes(bad), `${bad} in section 2`);
  // 3. repo root: the untracked file, not the ignored one.
  assert.match(section(3), /\.spike\.png/);
  assert.doesNotMatch(section(3), /ignored\.log/);
  // 4. temp dir grouped.
  assert.match(section(4), /2 ×.*app-home-\*/);
  assert.match(section(4), /1 single entries under 100M/, 'the one-off suite-test-77 is folded');
  // exclusions are named, not walked.
  assert.match(out, /Not walked:\n\s+~\/dev\n\s+~\/\.mytool-previews\n\s+~\/\.mytool\/work\n/);
  assert.match(out, /Already in the sanctioned places:\n\s+~\/\.mytool\/work\s+\S+\n\s+<repo>\/\.worktrees\/\s+1 worktree\(s\) across 1 repo/);
  // A report, not advice: no verdicts and no commands anywhere in what the tool itself says.
  const own = out.split('\n').filter(l => !/first: /.test(l)).join('\n');
  assert.doesNotMatch(own, /\b(delete|remove|rm|clean|safe to|stale|should|recommend|prune)\b/i);

  const j = spawnSync(process.execPath, [CLI, '--json', '--no-sizes', ...FLAGS],
    { env: { ...process.env, HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp }, encoding: 'utf8' });
  const data = JSON.parse(j.stdout);
  assert.deepEqual(data.worktrees.map(w => path.relative(home, w.path)), [path.join('code', 'repo-wt')]);
  assert.deepEqual(data.written.map(w => path.relative(home, w.path)).sort(), ['notes-dir', 'scratch']);
  assert.equal(data.inPlace.worktrees, 1);
  fs.rmSync(base, { recursive: true, force: true });
});

test('the CLI refuses an argument it does not know, and --worktrees-dir moves the sanctioned folder', () => {
  const bad = spawnSync(process.execPath, [CLI, '--exlude', '~/dev'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown argument --exlude/);
  const list = c.parseWorktreeList(['worktree /r', '', 'worktree /r/.wt/a', '', 'worktree /r/.worktrees/b', ''].join('\n'));
  assert.deepEqual(c.worktreesOutside(list, [], '.wt').map(w => w.path), ['/r/.worktrees/b']);
  assert.deepEqual(c.untrackedAtRoot('?? .wt/\0?? .worktrees/\0', '.wt'), ['.worktrees']);
});

test('findRepo: a linked worktree resolves to the main checkout, a plain folder to nothing', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'census-repo-'));
  const repo = path.join(base, 'r');
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  g(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'f'), 'x');
  g(repo, 'add', '.');
  g(repo, 'commit', '-qm', 'init');
  g(repo, 'worktree', 'add', '-q', path.join(base, 'wt'), '-b', 'other');
  assert.equal(c.findRepo(fs, path.join(repo, 'sub')).root, repo);
  assert.equal(c.findRepo(fs, path.join(base, 'wt')).root, repo);
  fs.rmSync(base, { recursive: true, force: true });
});
