// The pure half of worktree-reap.mjs: which linked worktrees under the worktrees folder
// (<repo>/.worktrees/ unless configured) have had their work LAND, and may therefore be removed.
// Nothing here touches git, the disk or /proc; the runner gathers that and hands it in, so every
// rule is testable on its own.
//
// A worktree is removed only when ALL of these hold, checked cheapest first:
//   - it lives under the worktrees folder (worktrees made elsewhere by other tools can appear in
//     the same `git worktree list`; they are someone else's state), and is neither the main
//     checkout nor the checkout the reaper itself runs from;
//   - it is on a branch (detached review checkouts are skipped unless --include-detached);
//   - it is not `git worktree lock`-ed (removing one needs --force, which is never used);
//   - its tip LANDED: it is an ancestor of a base branch on the remote, or it is exactly the head
//     of a MERGED PR whose merge commit is an ancestor of one. The second path is the one that
//     matters where PRs are squash-merged, so a branch tip is never an ancestor of the base. A
//     tip that moved on after its PR merged has unlanded commits and does not qualify; nor does a
//     PR merged into some other branch that has not reached a base yet; nor anything at all when
//     the PR list could not be read;
//   - it is not FRESH: a branch with no commits since it was created, created less than
//     `freshHours` ago, is an ancestor of the base by construction and is about to be worked in.
//     (An older one with nothing in it is clutter like any other.);
//   - `git status --porcelain --untracked-files=all` prints nothing;
//   - no git lock file sits in its admin dir (`<common>/worktrees/<id>/*.lock`). Measured on
//     git 2.25: `git worktree remove` deletes the admin dir with a live index.lock in it and
//     exits 0, so a lock never surfaces as an error — it has to be looked for first, waited
//     on, and the worktree skipped if it does not clear;
//   - no process has its cwd inside it;
//   - no RESERVED path is inside it. A caller that knows of folders about to be used again (a
//     session it will reopen there, say) passes them: they have no process yet, so the /proc scan
//     cannot see them, and a tree removed now would be gone when that work comes back.
// Removal is `git worktree remove` without --force. Branches are never deleted.
import path from 'node:path';

export function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// `git worktree list --porcelain`. The first entry is always the main checkout.
export function parseWorktreeList(text) {
  const out = [];
  let cur = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false }; out.push(cur); }
    else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
    else if (line === 'locked' || line.startsWith('locked ')) cur.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true;
  }
  return out;
}

// stderr of a git command that failed because another git process holds a lock.
export function isLockError(stderr) {
  return /\.lock'?:? File exists|Unable to create '[^']*\.lock'|another git process seems to be running/i.test(String(stderr || ''));
}

// A shell command that merges a PR: `gh pr merge …`, or the REST merge endpoint via `gh api`.
export function isMergeCommand(command) {
  const c = String(command || '');
  return /(^|[\s;&|(])gh\s+pr\s+merge\b/.test(c) || /(^|[\s;&|(])gh\s+api\b[^\n]*\/pulls\/\d+\/merge\b/.test(c);
}

// Pids whose cwd is the worktree or inside it. `procs` is [{ pid, cwd }] with resolved paths.
export function cwdHolders(procs, dir) {
  return procs.filter(p => p.cwd && isInside(p.cwd, dir)).map(p => p.pid);
}

// `df -B1 --output=avail <path>` → bytes available, or null.
export function parseDfAvail(text) {
  const n = String(text || '').trim().split('\n').pop().trim();
  return /^\d+$/.test(n) ? Number(n) : null;
}

// Index merged PRs by head SHA. `prs` is gh's `[{ number, headRefOid, baseRefName, mergeCommit: { oid } }]`.
export function indexPrs(prs) {
  const m = new Map();
  for (const p of prs || []) {
    if (!p || !p.headRefOid) continue;
    if (!m.has(p.headRefOid)) m.set(p.headRefOid, []);
    m.get(p.headRefOid).push(p);
  }
  return m;
}

const skip = (reason, detail) => ({ action: 'skip', reason, detail });

// Everything decidable without touching the worktree itself (no status, no lock, no cwd scan).
// ctx: { main, worktreesDir, baseNames, selves[], includeDetached, branch, landedOn(sha) -> base name | null,
//        prs: Map | null, prError, freshness(wt) -> { fresh, detail } }
export function plan(wt, ctx) {
  if (wt.path === ctx.main) return skip('main', 'the main checkout');
  const dir = ctx.worktreesDir || path.join(ctx.main, '.worktrees');
  if (!isInside(wt.path, dir) || wt.path === dir) return skip('outside', `not under ${path.relative(ctx.main, dir) || dir}/`);
  if (ctx.branch != null && wt.branch !== ctx.branch) return skip('out-of-scope', `--branch ${ctx.branch}`);
  if (ctx.selves.some(s => isInside(s, wt.path))) return skip('self', 'the reaper is running from this checkout');
  if (wt.prunable) return skip('missing', 'its directory is gone (git worktree prune territory)');
  if (wt.bare) return skip('bare', 'bare entry');
  if (wt.detached && !ctx.includeDetached) return skip('detached', 'detached HEAD (pass --include-detached)');
  if (!wt.branch && !wt.detached) return skip('no-head', 'no branch and not detached');
  if (wt.locked) return skip('locked', 'git worktree lock is set; removing needs --force, which is never used');
  if (!wt.head) return skip('no-head', 'no HEAD recorded');

  let landed = null;
  const base = ctx.landedOn(wt.head);
  if (base) landed = { via: 'ancestor', detail: `tip ${wt.head.slice(0, 10)} is on ${base}` };
  else {
    const prs = ctx.prs ? (ctx.prs.get(wt.head) || []) : null;
    if (prs === null) return skip('pr-list-unavailable', `tip is not on the base, and the merged-PR list could not be read (${ctx.prError || 'unknown error'})`);
    if (!prs.length) return skip('not-landed', `tip ${wt.head.slice(0, 10)} is not on the base and is not the head of any merged PR`);
    for (const p of prs) {
      const mc = p.mergeCommit?.oid;
      const on = mc ? ctx.landedOn(mc) : null;
      if (on) { landed = { via: 'squash', pr: p.number, detail: `tip is the head of merged PR #${p.number}; its merge commit ${mc.slice(0, 10)} is on ${on}` }; break; }
    }
    if (!landed) {
      const p = prs[0];
      if (!prs.some(x => x.mergeCommit?.oid)) return skip('not-landed', `PR #${p.number} is merged but records no merge commit`);
      return skip('merged-elsewhere', `PR #${p.number} merged into ${p.baseRefName || 'another base'}; its merge commit is not on ${ctx.baseNames || 'a base branch'} yet`);
    }
  }
  if (wt.branch) {
    const f = ctx.freshness(wt);
    if (f && f.fresh) return skip('fresh', f.detail);
  }
  return { action: 'candidate', ...landed };
}

// The checks that read the worktree, made immediately before removal. A lock is handled by the
// caller (it waits and re-checks); this only says which one blocks.
export function finalCheck({ statusLines, statusError, locks, holders, reserved = [] }) {
  if (statusError) return skip('status-failed', statusError);
  if (statusLines.length) return skip('status', `status: ${statusLines.length} ${statusLines.length === 1 ? 'entry' : 'entries'} (first: ${statusLines[0]})`);
  if (locks.length) return skip('git-lock', `lock held: ${locks.join(', ')}`);
  if (reserved.length) return skip('reserved', `a reserved folder is inside (the caller will use it again): ${reserved.slice(0, 3).join(', ')}${reserved.length > 3 ? ` (+${reserved.length - 3})` : ''}`);
  if (holders.length) return skip('in-use', `process cwd inside: pid ${holders.slice(0, 5).join(', ')}${holders.length > 5 ? ` (+${holders.length - 5})` : ''}`);
  return null;
}

// Summaries for the report.
export function summarize(items) {
  const counts = { total: items.length, removed: 0, wouldRemove: 0, skipped: 0, failed: 0, removedVia: { ancestor: 0, squash: 0 }, wouldRemoveVia: { ancestor: 0, squash: 0 }, skipReasons: {} };
  for (const i of items) {
    if (i.action === 'removed') { counts.removed++; counts.removedVia[i.via]++; }
    else if (i.action === 'would-remove') { counts.wouldRemove++; counts.wouldRemoveVia[i.via]++; }
    else if (i.action === 'failed') counts.failed++;
    else { counts.skipped++; counts.skipReasons[i.reason] = (counts.skipReasons[i.reason] || 0) + 1; }
  }
  return counts;
}
