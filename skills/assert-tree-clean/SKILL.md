---
name: assert-tree-clean
description: Assert that both the git index and the working tree match HEAD, catching the silent case where the index holds different blobs while every file on disk looks restored. Use at the end of any cycle that mutates tracked files and puts them back — mutation testing, bisect scripts, codemod dry-runs, "revert the fix to prove the test fails" checks — and before committing after such a cycle.
---

# assert-tree-clean

An end-of-cycle check for anything that changes tracked files and then restores
them.

## The hazard

A harness that mutates with `sed` and restores with `cp` checks itself by
comparing the file on disk with its backup. That comparison is honest, and it
passes. It also answers the wrong question, because `git checkout <sha> -- <path>`
(a natural way to snap a file back to an older revision mid-run) writes the
**index** as well as the working tree, and no `cp` restore undoes that. What is
left:

```
index:     the old blob        <- invisible to every file-content check
worktree:  the correct bytes   <- what cmp/diff sees, and it matches
```

`git status` shows `MM`. A plain `git commit` then ships the old blob — the state
the mutation was proving broken — in a commit whose diff looks intentional.

So the check compares both surfaces with HEAD, not only the one you can see.

## Run it

Needs Node 18+ and git. One file, no dependencies.

```bash
node <skill>/scripts/assert-tree-clean.mjs                 # whole repository
node <skill>/scripts/assert-tree-clean.mjs src tests       # limited to these pathspecs
```

| Exit | Meaning |
| --- | --- |
| 0 | Index and working tree both match HEAD. |
| 1 | Divergence. Paths are printed; index-only drift is called out as `STAGED-ONLY DIVERGENCE` with the `git restore --staged` line that fixes it. |
| 2 | Usage error, not a git worktree, or no HEAD commit. |

Untracked files are ignored on purpose: harnesses write backups and logs beside
the repository, and those are not the hazard.

## Install into any repository

Copy `scripts/assert-tree-clean.mjs` to `tools/` and call it as the last step of
the harness:

```bash
./mutate-and-restore.sh && node tools/assert-tree-clean.mjs src
```

An agent that reverts a fix to prove a test fails should run it before its next
commit.

## Tests

```bash
node --test tests/*.test.mjs
```

Each fixture is a real repository in the temp directory with the machine's git
config masked. The staged-only case first proves the fixture reproduces the shape
(`git diff HEAD` empty, `git diff --cached` non-empty) before asserting on the tool.
