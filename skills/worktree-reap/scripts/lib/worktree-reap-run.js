// The impure half of the worktree reaper: gather the facts (git, /proc, the disk, the merged-PR
// list), hand them to worktree-reap.js's rules, and — only when `apply` is true — remove what
// passes. The command line (../worktree-reap.mjs) is a thin wrapper, so another program can call
// runReap() directly.
//
// runReap() is DRY BY DEFAULT: without `apply: true` it removes nothing. The rules, and why each
// exists, are in worktree-reap.js. Branches are never deleted, the main checkout and the
// checkout this code runs from are never removed, removal is `git worktree remove` without
// --force, and a git lock is waited on, never forced or deleted. Space freed is measured with
// `df` (available bytes before and after), not `du`: worktrees share storage, and `du`
// over-counted by 1 GB on a real pass. The per-tree `bytes` is a `du`-style estimate for the
// preview, and is labelled so.
//
// It is synchronous (spawnSync, and Atomics.wait to sleep out a git lock): a long-running server
// should call it from a child process, not its own.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeGitArgsSync } from './safe-git.js';
import * as R from './worktree-reap.js';

const OWN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export class ReapUsageError extends Error {}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

function sizeOf(p) {
  let st;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (st.isSymbolicLink() || !st.isDirectory()) return st.isSymbolicLink() ? 0 : st.size;
  let n = 0;
  try { for (const e of fs.readdirSync(p)) n += sizeOf(path.join(p, e)); } catch {}
  return n;
}

// opts:
//   repo            the main checkout (default: the repo `cwd` is in)
//   cwd             where the run is "from" (default process.cwd()); a checkout containing it is "self"
//   apply           remove (default false: a dry run)
//   includeDetached also consider detached-HEAD checkouts
//   branch          only the worktree on that branch
//   remote          the remote the bases live on (default: git config worktreeReap.remote, else "origin")
//   bases           branch names work lands on (default: git config --get-all worktreeReap.base,
//                   else the remote's default branch from refs/remotes/<remote>/HEAD)
//   worktreesDir    the folder linked worktrees live in, relative to the main checkout or absolute
//                   (default: git config worktreeReap.dir, else ".worktrees")
//   fetch           fetch the bases from the remote first (default true)
//   prsFile         merged PRs from a JSON file instead of `gh pr list`
//   only            iterable of worktree paths: consider nothing else (apply exactly a previewed set)
//   onlyLabel       how to name that list in a skip detail
//   reserved        iterable of folders the caller will use again — a tree holding one is kept
//   freshHours, lockWaitMs, lockRetries
export function runReap(opts = {}) {
  const apply = opts.apply === true;
  const includeDetached = !!opts.includeDetached;
  const branch = opts.branch ?? null;
  const freshHours = Number(opts.freshHours ?? 24);
  const lockWaitMs = Number(opts.lockWaitMs ?? 2000);
  const lockRetries = Number(opts.lockRetries ?? 15);
  const only = opts.only ? new Set([...opts.only].map(p => path.resolve(p))) : null;
  const onlyLabel = opts.onlyLabel || 'the list given';
  const reserved = [...(opts.reserved || [])].filter(p => typeof p === 'string' && p).map(real);

  // Every git call goes through safe-git.js: these may be hundreds of checkouts whose config is
  // not ours to trust. Optional locks are off, so `status` never writes an index.lock into a live checkout.
  const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  function git(cwd, args) {
    const planned = safeGitArgsSync(cwd, args, { env: gitEnv });
    if (planned.refusal) return { status: -1, stdout: '', stderr: planned.refusal };
    const r = spawnSync('git', planned.args, { cwd, env: gitEnv, encoding: 'utf8', maxBuffer: 256 << 20 });
    return { status: r.error ? -1 : r.status, stdout: r.stdout || '', stderr: r.error ? r.error.message : (r.stderr || '') };
  }
  // The same, waiting out another git process's lock instead of failing on it.
  function gitWaiting(cwd, args) {
    let r;
    for (let i = 0; i <= lockRetries; i++) {
      r = git(cwd, args);
      if (r.status === 0 || !R.isLockError(r.stderr)) return r;
      sleep(lockWaitMs);
    }
    return r;
  }

  // ---- the repo -----------------------------------------------------------------------------
  const startCwd = real(opts.cwd || process.cwd());
  const probe = opts.repo ? real(opts.repo) : startCwd;
  if (!fs.existsSync(probe)) throw new ReapUsageError(`not a git repository: ${probe} (no such folder)`);
  const listed = git(probe, ['worktree', 'list', '--porcelain']);
  if (listed.status !== 0) throw new ReapUsageError(`not a git repository: ${probe} (${listed.stderr.trim()})`);
  const first = R.parseWorktreeList(listed.stdout)[0]?.path;
  if (!first) throw new ReapUsageError('empty worktree list');
  const main = real(first);
  if (opts.repo && main !== probe) throw new ReapUsageError(`the repo must be the main checkout (${main}), not ${probe}`);
  const commonDir = real(path.resolve(main, git(main, ['rev-parse', '--git-common-dir']).stdout.trim()));
  const selves = [startCwd, real(OWN_ROOT)];

  function dfAvail() {
    const r = spawnSync('df', ['-B1', '--output=avail', main], { encoding: 'utf8' });
    return r.status === 0 ? R.parseDfAvail(r.stdout) : null;
  }
  const dfBefore = dfAvail();

  // ---- what has landed ----------------------------------------------------------------------
  const cfg = (key, all) => {
    const r = git(main, ['config', all ? '--get-all' : '--get', key]);
    return r.status === 0 ? r.stdout.split('\n').map(x => x.trim()).filter(Boolean) : [];
  };
  const remote = opts.remote || cfg('worktreeReap.remote')[0] || 'origin';
  const worktreesDir = real(path.resolve(main, opts.worktreesDir || cfg('worktreeReap.dir')[0] || '.worktrees'));
  // The bases: named by the caller, else by the repo's config, else the remote's default branch
  // as git itself records it. Never guessed: a wrong base would call unlanded work landed.
  let baseNames = [...(opts.bases || [])].filter(Boolean);
  let basesFrom = 'given';
  if (!baseNames.length) { baseNames = cfg('worktreeReap.base', true); basesFrom = 'git config worktreeReap.base'; }
  if (!baseNames.length) {
    const head = git(main, ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]);
    if (head.status === 0 && head.stdout.trim().startsWith(`${remote}/`)) { baseNames = [head.stdout.trim().slice(remote.length + 1)]; basesFrom = `${remote}/HEAD`; }
  }
  if (!baseNames.length) throw new ReapUsageError(`no base branch: pass --base <branch>, set \`git config --add worktreeReap.base <branch>\`, or record the remote's default with \`git remote set-head ${remote} --auto\``);
  const baseList = baseNames.map(b => `${remote}/${b}`).join(' or ');

  let fetchNote = 'skipped';
  if (opts.fetch !== false) {
    const f = gitWaiting(main, ['fetch', '--quiet', remote, ...baseNames]);
    fetchNote = f.status === 0 ? 'ok' : `FAILED, using the refs already here: ${f.stderr.trim().split('\n').pop()}`;
  }
  const BASES = baseNames.map(b => `${remote}/${b}`);
  const tipOf = new Map();
  for (const b of BASES) {
    const r = git(main, ['rev-parse', '--verify', '--quiet', `${b}^{commit}`]);
    if (r.status === 0) tipOf.set(b, r.stdout.trim());
  }
  if (!tipOf.size) throw new ReapUsageError(`${baseList} does not resolve; nothing can be shown to have landed`);
  const baseTips = new Set(tipOf.values());
  const revList = cwd => {
    const m = new Map();
    for (const [b, sha] of tipOf) {
      const r = git(cwd, ['rev-list', sha]);
      if (r.status !== 0) return null;
      m.set(b, new Set(r.stdout.split('\n').filter(Boolean)));
    }
    return m;
  };
  // A SHALLOW checkout hides every commit past its boundary from rev-list, so a branch that landed
  // long enough ago reads as unlanded. One `git fetch --depth` from any worktree does this to all
  // of them (the shallow file is shared). Hidden is not gone: the objects usually stay. So when
  // the repo is shallow, walk the history from a throwaway bare repo that borrows the objects
  // through `objects/info/alternates` and has no shallow file — reading the real repo, changing
  // nothing in it. If the walk hits a missing object the history really is truncated, and the
  // shallow answer stands: it can only under-count what landed, never over-count it.
  const shallow = git(main, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
  let reachable = null, history = 'complete';
  if (shallow) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-reap-history-'));
    try {
      if (git(tmp, ['init', '--quiet', '--bare', '.']).status === 0) {
        fs.writeFileSync(path.join(tmp, 'objects', 'info', 'alternates'), path.join(commonDir, 'objects') + '\n');
        reachable = revList(tmp);
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    if (!reachable) history = 'incomplete (shallow, and the objects past its boundary are not here): ancestry is under-counted';
  }
  reachable ||= revList(main);
  if (!reachable) throw new ReapUsageError(`could not list the history of ${baseList}`);
  const landedOn = sha => { for (const [b, set] of reachable) if (set.has(sha)) return b; return null; };

  let prs = null, prError = null;
  const PR_LIMIT = 5000;
  try {
    let list;
    if (opts.prsFile) list = JSON.parse(fs.readFileSync(opts.prsFile, 'utf8'));
    else {
      const r = spawnSync('gh', ['pr', 'list', '--state', 'merged', '--limit', String(PR_LIMIT), '--json', 'number,headRefOid,baseRefName,mergeCommit'], { cwd: main, encoding: 'utf8', maxBuffer: 64 << 20 });
      if (r.status !== 0) throw new Error(`gh pr list: ${(r.stderr || r.error?.message || '').trim().split('\n').pop()}`);
      list = JSON.parse(r.stdout);
      // A full page may have cut off older PRs; a truncated list must not read as "never merged"…
      // but it cannot make anything removable either, so it is only noted.
      if (list.length >= PR_LIMIT) prError = `gh returned ${list.length} PRs, the --limit; older ones may be missing`;
    }
    if (!Array.isArray(list)) throw new Error('PR list is not an array');
    prs = R.indexPrs(list);
  } catch (e) { prs = null; prError = e.message; }

  // ---- per worktree -------------------------------------------------------------------------
  function adminDir(wtPath) {
    try {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(path.join(wtPath, '.git'), 'utf8'));
      return m ? real(path.resolve(wtPath, m[1].trim())) : null;
    } catch { return null; }
  }
  function locksIn(dir) {
    const out = [];
    const walk = d => {
      let es = [];
      try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.lock')) out.push(path.relative(commonDir, p));
      }
    };
    if (dir) walk(dir);
    return out;
  }
  // A branch with no commits since `git worktree add -b` made it, made less than freshHours ago.
  function freshness(wt) {
    const now = Date.now();
    let lines = null;
    try { lines = fs.readFileSync(path.join(commonDir, 'logs', 'refs', 'heads', ...wt.branch.split('/')), 'utf8').split('\n').filter(Boolean); } catch {}
    if (lines && lines.length > 1) return { fresh: false };
    let created = null;
    if (lines && lines.length === 1) { const m = /\s(\d{9,})\s[+-]\d{4}\t/.exec(lines[0]); if (m) created = Number(m[1]) * 1000; }
    if (created == null) { try { const s = fs.statSync(wt.admin); created = s.birthtimeMs || s.ctimeMs; } catch {} }
    if (created == null) return { fresh: true, detail: 'no commits recorded on the branch and its age is unknown' };
    const hours = (now - created) / 3.6e6;
    return hours < freshHours ? { fresh: true, detail: `no commits since the branch was created ${hours.toFixed(1)}h ago (< ${freshHours}h): fresh` } : { fresh: false };
  }

  function procCwds() {
    let pids;
    try { pids = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)); } catch { return null; }
    const out = [];
    for (const pid of pids) {
      if (Number(pid) === process.pid) continue;
      try { out.push({ pid: Number(pid), cwd: fs.readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, '') }); } catch {}
    }
    return out;
  }

  // Without /proc (macOS, Windows) the in-use check cannot be made, so every candidate is kept as
  // in-use — failing closed. Said once at the top of the report, not only per tree.
  const processCheck = procCwds() ? 'ok' : 'unavailable';
  const ctx = { main, worktreesDir, baseNames: baseList, selves, includeDetached, branch, landedOn, prs, prError, freshness };
  const items = [];
  for (const w of R.parseWorktreeList(listed.stdout)) {
    const wt = { ...w, path: w.path === listed.stdout.split('\n')[0].slice(9) ? main : w.path };
    if (fs.existsSync(wt.path)) wt.path = real(wt.path); else wt.prunable = true;
    wt.admin = wt.prunable ? null : adminDir(wt.path);
    if (wt.admin && fs.existsSync(path.join(wt.admin, 'locked'))) wt.locked = true;
    const base = { path: wt.path, branch: wt.branch, head: wt.head, detached: wt.detached };
    const p = only && !only.has(wt.path) && wt.path !== main ? { action: 'skip', reason: 'not-in-list', detail: `not in ${onlyLabel}` } : R.plan(wt, ctx);
    if (p.action !== 'candidate') { items.push({ ...base, ...p }); continue; }
    const landed = { via: p.via, pr: p.pr ?? null, evidence: p.detail, atBaseTip: baseTips.has(wt.head) };

    // The checks that read the worktree, made just before removing it, waiting out a git lock.
    let verdict;
    for (let attempt = 0; ; attempt++) {
      const st = git(wt.path, ['status', '--porcelain', '--untracked-files=all']);
      const procs = procCwds();
      verdict = R.finalCheck({
        statusLines: st.status === 0 ? st.stdout.split('\n').filter(Boolean) : [],
        statusError: st.status === 0 ? null : `git status failed: ${st.stderr.trim().split('\n').pop()}`,
        locks: locksIn(wt.admin),
        holders: procs ? R.cwdHolders(procs, wt.path) : ['(cannot read /proc)'],
        reserved: reserved.filter(r => R.isInside(r, wt.path)),
      });
      if (verdict?.reason === 'git-lock' && attempt < lockRetries) { sleep(lockWaitMs); continue; }
      break;
    }
    if (verdict) { items.push({ ...base, ...landed, ...verdict }); continue; }

    // Ignored files are invisible to the status check and `git worktree remove` deletes them; say how many.
    const ign = git(wt.path, ['status', '--porcelain', '--ignored', '--untracked-files=all']);
    const ignored = ign.status === 0 ? ign.stdout.split('\n').filter(l => l.startsWith('!! ')).map(l => l.slice(3).replace(/\/$/, '')) : [];
    const report = { ...landed, bytes: sizeOf(wt.path), ignoredEntries: ignored.length, ignoredBytes: ignored.reduce((n, e) => n + sizeOf(path.join(wt.path, e)), 0) };

    if (!apply) { items.push({ ...base, ...report, action: 'would-remove' }); continue; }
    const rm = gitWaiting(main, ['worktree', 'remove', wt.path]);
    if (rm.status === 0) items.push({ ...base, ...report, action: 'removed' });
    else if (/is not a working tree/.test(rm.stderr)) items.push({ ...base, ...report, action: 'skip', reason: 'already-gone', detail: 'removed by someone else meanwhile' });
    else items.push({ ...base, ...report, action: 'failed', reason: R.isLockError(rm.stderr) ? 'git-lock' : 'remove-failed', detail: rm.stderr.trim().split('\n').join(' | ') });
  }

  const dfAfter = dfAvail();
  return {
    apply, repo: main, remote, bases: BASES.filter(b => tipOf.has(b)), basesFrom, worktreesDir, fetch: fetchNote, shallow, history, processCheck, prList: prs ? (prError ? `read, but ${prError}` : 'read') : `UNAVAILABLE (${prError})`,
    counts: R.summarize(items), df: { availBefore: dfBefore, availAfter: dfAfter, freedBytes: dfBefore != null && dfAfter != null ? dfAfter - dfBefore : null },
    items,
  };
}

// The human-readable report the command-line tool prints.
export function formatReport(out) {
  const { apply, repo: main, items } = out;
  const rel = p => (R.isInside(p, main) ? path.relative(main, p) || '.' : p);
  const gb = n => (n == null ? '?' : `${(n / 1e9).toFixed(2)} GB`);
  const lines = [];
  lines.push(apply ? 'worktree-reap: APPLY' : 'worktree-reap: DRY RUN — nothing removed; pass --apply to remove');
  lines.push(`repo ${main}`, `bases ${(out.bases || []).join(', ')} (from ${out.basesFrom})`, `fetch ${out.fetch}`, `history ${out.shallow ? 'SHALLOW checkout; ' : ''}${out.history}`, `merged-PR list ${out.prList}`, '');
  const act = items.filter(i => ['removed', 'would-remove', 'failed'].includes(i.action));
  for (const i of act) {
    const tag = { removed: 'REMOVED', 'would-remove': 'WOULD REMOVE', failed: 'FAILED' }[i.action];
    lines.push(`${tag.padEnd(12)} ${rel(i.path)}  [${i.branch || `detached ${String(i.head).slice(0, 10)}`}]  ${i.evidence}` +
      `${i.atBaseTip ? '  (tip == a base tip: zero commits of its own)' : ''}${i.ignoredEntries ? `  (ignored: ${i.ignoredEntries} entries, ${i.ignoredBytes} bytes, deleted with it)` : ''}` +
      `${i.action === 'failed' ? `  — ${i.detail}` : ''}`);
  }
  if (act.length) lines.push('');
  for (const i of items.filter(i => i.action === 'skip')) lines.push(`SKIP ${i.reason.padEnd(20)} ${rel(i.path)}  [${i.branch || (i.detached ? 'detached' : '-')}]  ${i.detail}`);
  lines.push('');
  const c = out.counts;
  lines.push(`total ${c.total} worktrees (incl. the main checkout)`);
  lines.push(apply ? `removed ${c.removed} (ancestor ${c.removedVia.ancestor}, squash/PR ${c.removedVia.squash}), failed ${c.failed}`
    : `would remove ${c.wouldRemove} (ancestor ${c.wouldRemoveVia.ancestor}, squash/PR ${c.wouldRemoveVia.squash})`);
  lines.push(`skipped ${c.skipped}: ${Object.entries(c.skipReasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`);
  lines.push(apply
    ? `df available: before ${gb(out.df.availBefore)}, after ${gb(out.df.availAfter)}, freed ${out.df.freedBytes == null ? '?' : `${out.df.freedBytes} bytes (${gb(out.df.freedBytes)})`}`
    : `df available: ${gb(out.df.availBefore)} (freed: n/a, dry run)`);
  return lines.join('\n') + '\n';
}
