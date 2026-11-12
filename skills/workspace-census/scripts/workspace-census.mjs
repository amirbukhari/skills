#!/usr/bin/env node
// Report what coding agents have left outside the sanctioned places. READ ONLY: it runs
// `git worktree list` and `git --no-optional-locks status` (which skips git's opportunistic
// index refresh, the one write a plain `git status` can make), reads Claude's transcripts and
// stats files. It never writes, moves or removes anything, and its report makes no
// recommendation. What the sections mean and how items are attributed is in
// lib/workspace-census.js.
//
//   workspace-census.mjs                       the report
//   workspace-census.mjs --exclude ~/dev       never walk or report under a path (repeatable)
//   workspace-census.mjs --managed ~/.mytool   a tool's own state: not clutter, not walked (repeatable)
//   workspace-census.mjs --work-dir ~/.mytool/work   where agents are meant to keep output; its size is shown
//   workspace-census.mjs --worktrees-dir .wt   the folder inside each repo that holds its worktrees (default .worktrees)
//   workspace-census.mjs --json                the same data as JSON
//   workspace-census.mjs --no-sizes            skip size totals (much faster)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import * as census from './lib/workspace-census.js';

const argv = process.argv.slice(2);
const home = path.resolve(os.homedir());
const tmpBase = path.resolve(os.tmpdir());
const expand = p => path.resolve(String(p).replace(/^~(?=\/|$)/, home));
const excludes = [], managed = [];
let workPath = null, worktreesDir = '.worktrees';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i], v = argv[i + 1];
  if (a === '--json' || a === '--no-sizes') continue;
  if (!['--exclude', '--managed', '--work-dir', '--worktrees-dir'].includes(a)) { console.error(`workspace-census: unknown argument ${a}`); process.exit(2); }
  if (v === undefined) { console.error(`workspace-census: ${a} needs a value`); process.exit(2); }
  i++;
  if (a === '--exclude') excludes.push(expand(v));
  else if (a === '--managed') managed.push(expand(v));
  else if (a === '--work-dir') workPath = expand(v);
  else worktreesDir = v;
}
if (workPath) managed.push(workPath);
managed.sort();
const asJson = argv.includes('--json');
const sizes = !argv.includes('--no-sizes');
const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;

const git = (cwd, args) => {
  try { return execFileSync('git', ['--no-optional-locks', '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); }
  catch { return null; }
};
const statOf = p => { try { return fs.lstatSync(p); } catch { return null; } };
const measure = p => (sizes ? census.sizeOf(fs, p) : null);

const profiles = census.profileDirs(fs, home);
const projectDirs = census.knownProjectDirs(fs, home, profiles);

// Known repos: the main checkout of every project folder that is (inside) a git checkout.
const repoSet = new Set();
for (const d of projectDirs) {
  if (!fs.existsSync(d) || excludes.some(e => census.isInside(d, e))) continue;
  const r = census.findRepo(fs, d);
  if (r && fs.existsSync(r.root)) repoSet.add(r.root);
}
const repos = [...repoSet].sort();

// 1. worktrees, and every checkout (main or linked) so section 2 can leave them out.
const worktrees = [];
const checkouts = new Set(repos);
let inPlaceWorktrees = 0, inPlaceRepos = 0;
for (const r of repos) {
  const list = census.parseWorktreeList(git(r, ['worktree', 'list', '--porcelain']) || '');
  for (const w of list) checkouts.add(w.path);
  const inside = list.slice(1).filter(w => census.isInside(w.path, path.join(r, worktreesDir)));
  if (inside.length) { inPlaceWorktrees += inside.length; inPlaceRepos++; }
  for (const w of census.worktreesOutside(list, managed, worktreesDir)) {
    if (excludes.some(e => census.isInside(w.path, e))) continue;
    const st = statOf(w.path);
    if (!st) continue;
    worktrees.push({ ...w, mtime: st.mtimeMs, size: measure(w.path) });
  }
}

// 2. transcript attribution.
const writes = [];
let transcripts = 0;
for (const p of profiles) {
  const proj = path.join(p, 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(proj); } catch { continue; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(proj, d)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      transcripts++;
      const rl = readline.createInterface({ input: fs.createReadStream(path.join(proj, d, f)), crlfDelay: Infinity });
      for await (const line of rl) for (const w of census.writesFromLine(line, home)) writes.push(w);
    }
  }
}
const ctx = { home, tmpBase, profiles, repos: [...checkouts], excludes, managed };
const written = [];
for (const e of census.attribute(writes, ctx)) {
  const st = statOf(e.path);
  if (!st) continue;
  written.push({ ...e, mtime: st.mtimeMs, isGitCheckout: st.isDirectory() && fs.existsSync(path.join(e.path, '.git')), size: measure(e.path) });
}

// 3. repo roots.
const rootEntries = [];
for (const r of repos) {
  const out = git(r, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
  if (out == null) continue;
  const names = census.untrackedAtRoot(out, worktreesDir);
  if (!names.length) continue;
  rootEntries.push({ repo: r, entries: names.map(n => { const p = path.join(r, n); const st = statOf(p); return { name: n, mtime: st?.mtimeMs, size: measure(p) }; }) });
}

// 4. temp dir, grouped by pattern.
const groups = new Map();
let tnames = [];
try { tnames = fs.readdirSync(tmpBase); } catch {}
for (const n of tnames) {
  const p = path.join(tmpBase, n);
  const st = statOf(p);
  if (!st || (typeof uid === 'number' && st.uid !== uid)) continue;
  if (excludes.some(e => census.isInside(p, e))) continue;
  const k = census.tempPattern(n);
  let g = groups.get(k);
  if (!g) groups.set(k, g = { pattern: k, count: 0, oldest: null, newest: null, size: sizes ? { bytes: 0, capped: false } : null });
  g.count++;
  g.oldest = g.oldest == null ? st.mtimeMs : Math.min(g.oldest, st.mtimeMs);
  g.newest = g.newest == null ? st.mtimeMs : Math.max(g.newest, st.mtimeMs);
  if (sizes) { const s = census.sizeOf(fs, p); g.size.bytes += s.bytes; g.size.capped ||= s.capped; }
}
const bySize = (a, b) => (b.size?.bytes || 0) - (a.size?.bytes || 0) || String(a.path || a.pattern).localeCompare(String(b.path || b.pattern));
const temp = [...groups.values()].sort((a, b) => b.count - a.count || bySize(a, b));

const excluded = [...excludes, ...managed.filter(m => !excludes.includes(m))];

const result = {
  home, tmpBase, generatedAt: new Date().toISOString(), profiles, repos, transcripts, worktreesDir,
  worktrees: worktrees.sort(bySize), written: written.sort(bySize), rootEntries, temp, excluded,
  inPlace: {
    work: workPath ? { path: workPath, size: fs.existsSync(workPath) ? measure(workPath) : { bytes: 0, capped: false } } : null,
    worktrees: inPlaceWorktrees, worktreeRepos: inPlaceRepos,
  },
};
process.stdout.write(asJson ? JSON.stringify(result, null, 2) + '\n' : census.formatReport(result));
