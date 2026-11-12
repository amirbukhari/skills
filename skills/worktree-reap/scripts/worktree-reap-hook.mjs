#!/usr/bin/env node
// Claude Code PostToolUse hook (register it for Bash in a settings file): when a session merges a
// PR, sweep the worktrees whose work has landed with worktree-reap.mjs.
//
// Why here. Work lands on the forge, so no local git hook ever sees it: a `post-merge` hook fires
// on a local merge, never on a PR merging server-side. A branch's own session also cannot clean
// up after itself — it is usually gone by the time its PR merges, and someone else often does
// the merge. So the trigger is the merge itself, wherever a session runs `gh pr merge` (or the
// REST merge endpoint via `gh api`), and the reaper cleans up after EVERY landed worktree, not
// only the one merging. Merges made in the web UI are swept by the next merge made from a session.
//
// Dry run until the repo opts in. The hook passes --apply only when the main checkout's LOCAL
// git config says so:
//     git config worktreeReap.mode apply      # remove
//     git config --unset worktreeReap.mode    # back to dry run
// Otherwise it runs the dry run and logs what it would have removed. Either way the report is
// appended to <git common dir>/worktree-reap.log (inside .git, so never committed).
//
// It never blocks the session: it returns at once and the reaper runs detached (it may check
// hundreds of worktrees). The reaper is started from the main checkout, and a checkout this
// hook's own files live in is excluded as "self" — so a worktree is never removed from under
// the tool. Overlapping runs are safe: each re-checks every worktree just before removing
// it, and one already removed by another run is reported as already gone.
//
// Test seams: WORKTREE_REAP_WAIT=1 runs the reaper in the foreground;
// WORKTREE_REAP_PRS_FILE is passed through as --prs-file.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeGitArgsSync } from './lib/safe-git.js';
import { isMergeCommand, parseWorktreeList } from './lib/worktree-reap.js';

const REAPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worktree-reap.mjs');

function git(cwd, args) {
  const p = safeGitArgsSync(cwd, args);
  if (p.refusal) return null;
  const r = spawnSync('git', p.args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

function main(input) {
  let payload;
  try { payload = JSON.parse(input); } catch { return; }
  if (payload?.tool_name !== 'Bash' || !isMergeCommand(payload?.tool_input?.command)) return;

  const cwd = payload.cwd && fs.existsSync(payload.cwd) ? payload.cwd : process.cwd();
  const list = git(cwd, ['worktree', 'list', '--porcelain']);
  const repo = list && parseWorktreeList(list)[0]?.path;
  if (!repo) return;
  const apply = (git(repo, ['config', '--local', '--get', 'worktreeReap.mode']) || '').trim() === 'apply';

  const args = [REAPER, '--repo', repo, ...(apply ? ['--apply'] : [])];
  if (process.env.WORKTREE_REAP_PRS_FILE) args.push('--prs-file', process.env.WORKTREE_REAP_PRS_FILE);

  const common = (git(repo, ['rev-parse', '--git-common-dir']) || '').trim();
  if (!common) return;
  const log = path.join(path.resolve(repo, common), 'worktree-reap.log');
  fs.appendFileSync(log, `\n=== ${new Date().toISOString()} after: ${String(payload.tool_input.command).slice(0, 200)}\n` +
    (apply ? '' : '(dry run: `git config worktreeReap.mode apply` in the main checkout to remove)\n'));
  const fd = fs.openSync(log, 'a');
  if (process.env.WORKTREE_REAP_WAIT === '1') {
    spawnSync(process.execPath, args, { cwd: repo, stdio: ['ignore', fd, fd] });
  } else {
    spawn(process.execPath, args, { cwd: repo, stdio: ['ignore', fd, fd], detached: true }).unref();
  }
  fs.closeSync(fd);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  try { main(input); } catch (e) { process.stderr.write(`worktree-reap-hook: ${e.message}\n`); }
  process.exit(0);
});
