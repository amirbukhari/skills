#!/usr/bin/env node
// Remove linked worktrees under <repo>/.worktrees/ whose work has landed. DRY RUN BY DEFAULT:
// without --apply it prints what it would remove and why, and removes nothing.
//
//   node worktree-reap.mjs                       what would be removed, and every skip with its reason
//   node worktree-reap.mjs --apply               remove them (`git worktree remove`, never --force)
//   node worktree-reap.mjs --base <branch>       a branch work lands on; repeat for several. Default:
//                                                git config worktreeReap.base, else the remote's default branch
//   node worktree-reap.mjs --remote <name>       the remote the bases live on (origin)
//   node worktree-reap.mjs --worktrees-dir <dir> where linked worktrees live (.worktrees)
//   node worktree-reap.mjs --branch <name>       only the worktree on that branch
//   node worktree-reap.mjs --include-detached    also consider detached-HEAD checkouts (skipped by default)
//   node worktree-reap.mjs --repo <main checkout>   default: the repo the cwd is in
//   node worktree-reap.mjs --no-fetch            use the remote refs as they are
//   node worktree-reap.mjs --prs-file <json>     merged PRs from a file instead of `gh pr list`
//   node worktree-reap.mjs --fresh-hours <n>     age under which a commit-less branch is fresh (24)
//   node worktree-reap.mjs --lock-wait-ms <n> --lock-retries <n>   how long to wait on a git lock (2000 x 15)
//   node worktree-reap.mjs --reserve <dir>       a folder about to be used again; a tree holding it is kept (repeatable)
//   node worktree-reap.mjs --only <file>         only the worktree paths listed in <file>, one per line —
//                                                apply exactly the set a dry run showed, not what became
//                                                eligible since (a review checkout made a minute ago)
//   node worktree-reap.mjs --json                the report as JSON
//
// This file is only the command line: the run itself is lib/worktree-reap-run.js. The rules, and
// why each exists, are in lib/worktree-reap.js. Branches are never deleted, the main checkout and
// the checkout this script runs from are never removed, and a git lock is waited on, never forced
// or deleted. Space freed is measured with `df` (available bytes before and after), not `du`:
// worktrees share storage, and `du` over-counts. worktree-reap-hook.mjs runs this after a PR
// merge; see that file.
import fs from 'node:fs';
import path from 'node:path';
import { runReap, formatReport, ReapUsageError } from './lib/worktree-reap-run.js';

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const all = f => argv.flatMap((a, i) => (a === f && argv[i + 1] != null ? [argv[i + 1]] : []));
const die = msg => { console.error(`worktree-reap: ${msg}`); process.exit(2); };

const onlyFile = opt('--only', null);
let only = null;
if (onlyFile) {
  try { only = fs.readFileSync(onlyFile, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).map(l => path.resolve(l)); }
  catch (e) { die(`--only ${onlyFile}: ${e.message}`); }
}

let out;
try {
  out = runReap({
    repo: opt('--repo', null),
    bases: all('--base'),
    remote: opt('--remote', null),
    worktreesDir: opt('--worktrees-dir', null),
    reserved: all('--reserve'),
    apply: flag('--apply'),
    includeDetached: flag('--include-detached'),
    branch: opt('--branch', null),
    fetch: !flag('--no-fetch'),
    prsFile: opt('--prs-file', null),
    only, onlyLabel: onlyFile ? `--only ${onlyFile}` : undefined,
    freshHours: Number(opt('--fresh-hours', 24)),
    lockWaitMs: Number(opt('--lock-wait-ms', 2000)),
    lockRetries: Number(opt('--lock-retries', 15)),
  });
} catch (e) {
  if (e instanceof ReapUsageError) die(e.message);
  throw e;
}

// No process.exit() after a write: piped stdout is async, and exiting cuts it off at 64 KB.
process.stdout.write(flag('--json') ? JSON.stringify(out, null, 2) + '\n' : formatReport(out));
