#!/usr/bin/env node
// assert-tree-clean — end-of-cycle check for anything that mutates tracked files and
// then puts them back (mutation harnesses, bisect scripts, codemod dry-runs).
//
// WHY THIS EXISTS. A harness that mutates with `sed` and restores with `cp` verifies
// itself by comparing the file on disk against its backup. That comparison is honest
// and it passes — and it is answering a different question than the one that matters,
// because `git checkout <sha> -- <path>` (a natural way to snap files back to an older
// revision mid-run) writes the INDEX as well as the working tree, and no `cp` restore
// undoes that. What is left behind is:
//
//     index:     the old blob        <- invisible to every file-content check
//     worktree:  the correct bytes   <- what cmp/diff sees, and it matches
//
// `git status` shows `MM`. A plain `git commit` then ships the old blob — the exact
// state the mutation was proving broken — inside a commit whose diff looks intentional.
// This happened for real; it was caught by eye, not by any check.
//
// So: at the end of a cycle, assert both surfaces agree with HEAD, not just the one
// you can see. The case this is really here for is the silent one — a path where the
// INDEX differs from HEAD while the WORKTREE matches it, which no content comparison
// against the restored file can ever notice.
//
// Usage:
//   node assert-tree-clean.mjs                 # whole repo
//   node assert-tree-clean.mjs public tests    # limited to these pathspecs
//
// Exit 0 clean, 1 divergence (paths printed), 2 usage / not a git worktree.
//
// UNTRACKED FILES ARE IGNORED, deliberately: harnesses write backups and logs beside
// the repo and those are not the hazard. Only tracked content is compared.

import { spawnSync } from 'node:child_process';

const pathspecs = process.argv.slice(2).filter(a => a !== '--');

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.error) return { ok: false, out: '', err: String(r.error.message) };
  return { ok: r.status === 0, out: r.stdout || '', err: r.stderr || '' };
}

function names(args) {
  const r = git([...args, ...(pathspecs.length ? ['--', ...pathspecs] : [])]);
  if (!r.ok) return null;
  return r.out.split('\n').map(s => s.trim()).filter(Boolean);
}

const top = git(['rev-parse', '--show-toplevel']);
if (!top.ok) {
  process.stderr.write('assert-tree-clean: not inside a git worktree\n');
  process.exit(2);
}
if (!git(['rev-parse', '--verify', 'HEAD']).ok) {
  process.stderr.write('assert-tree-clean: no HEAD commit to compare against\n');
  process.exit(2);
}

// index vs HEAD, and worktree vs HEAD. The difference between the two sets is the
// point of this tool: a path in the first and not the second is index-only drift.
const indexVsHead = names(['diff', '--cached', '--name-only']);
const treeVsHead = names(['diff', 'HEAD', '--name-only']);
if (indexVsHead === null || treeVsHead === null) {
  process.stderr.write('assert-tree-clean: git diff failed\n');
  process.exit(2);
}

const inTree = new Set(treeVsHead);
const indexOnly = indexVsHead.filter(f => !inTree.has(f));
const visible = treeVsHead;

if (!indexOnly.length && !visible.length) {
  process.stdout.write(
    `assert-tree-clean: OK — index and working tree both match HEAD${
      pathspecs.length ? ` (${pathspecs.join(' ')})` : ''
    }\n`
  );
  process.exit(0);
}

if (indexOnly.length) {
  process.stderr.write(
    'assert-tree-clean: STAGED-ONLY DIVERGENCE — the working tree matches HEAD, so every\n' +
      'file-content check passes, but the index holds different blobs for:\n'
  );
  for (const f of indexOnly) process.stderr.write(`    ${f}\n`);
  process.stderr.write(
    'A commit from here would ship the staged blobs, not the bytes you verified.\n' +
      'Fix with:  git restore --staged ' + indexOnly.join(' ') + '\n'
  );
}
if (visible.length) {
  process.stderr.write('assert-tree-clean: working tree differs from HEAD for:\n');
  for (const f of visible) process.stderr.write(`    ${f}\n`);
}
process.exit(1);
