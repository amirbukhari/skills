---
name: worktree-reap
description: Remove linked git worktrees whose work has landed, with a dry run by default and a PostToolUse hook that sweeps after each PR merge. Use when a repository accumulates worktrees (one per agent session or branch), when disk fills up with stale checkouts, or when the user asks to clean up, prune or reap worktrees safely — including squash-merged branches whose tips are never ancestors of the base.
---

# worktree-reap

Removes linked worktrees under one folder (default `<repo>/.worktrees/`) once
their work is on a base branch. It is a dry run unless `--apply` is passed. It
never deletes a branch, never uses `--force`, and never removes the main checkout
or the checkout it runs from.

## When a worktree is removed

All of these must hold. Each skip is printed with its reason.

- It lives under the worktrees folder, is on a branch (detached checkouts need
  `--include-detached`) and is not `git worktree lock`-ed.
- **Its tip landed.** Either the tip is an ancestor of a base branch on the
  remote, or it is exactly the head of a merged PR whose merge commit is on a base.
  The second rule is what makes squash merges work. A tip that moved on after its
  PR merged does not qualify. If the PR list cannot be read, nothing is assumed
  landed.
- It is not fresh: a branch with no commits, created less than `--fresh-hours`
  ago (24), is about to be worked in.
- `git status --porcelain --untracked-files=all` prints nothing.
- No git lock file sits in its admin directory. A lock is waited on, never deleted.
- No process has its working directory inside it (read from `/proc`).
- No `--reserve`d folder is inside it.

Linux only for removal: without `/proc` the in-use check cannot be made, so every
candidate is kept. A shallow clone is read through a throwaway bare repository, so
hidden history is not mistaken for unlanded work; the repository stays shallow.

## Install into any repository

Needs Node 18+ and git. The merged-PR list comes from the `gh` CLI, or from a
JSON file for any other forge.

1. Copy this skill's `scripts/` folder into the repository, for example
   `tools/worktree-reap/`.
2. Tell it where work lands, unless the remote's default branch is the only base:

   ```bash
   git config --add worktreeReap.base main        # repeat for each base branch
   git config worktreeReap.dir .worktrees          # only if the folder differs
   git config worktreeReap.remote origin           # only if the remote differs
   ```

   With no `--base` and no config, the base is the remote's default branch as
   recorded in `refs/remotes/<remote>/HEAD` (`git remote set-head origin --auto`
   records it). With none of the three the tool stops; it never guesses a base.
3. Run a dry run and read it:

   ```bash
   node tools/worktree-reap/worktree-reap.mjs
   node tools/worktree-reap/worktree-reap.mjs --apply
   ```

Useful flags: `--base <branch>` (repeatable), `--remote`, `--worktrees-dir`,
`--branch <name>`, `--include-detached`, `--no-fetch`, `--prs-file <json>`,
`--reserve <dir>` (repeatable), `--only <file>` (apply exactly the paths a dry
run listed), `--json`. The header of `worktree-reap.mjs` lists them all.

`--prs-file` takes `[{ "number", "headRefOid", "baseRefName", "mergeCommit": { "oid" } }]`.

## The merge hook (optional)

A local `post-merge` hook never fires for a PR merged on the forge. The hook
here is a Claude Code PostToolUse hook: when a session runs `gh pr merge` (or the
REST merge endpoint through `gh api`), it starts the reaper detached and returns
at once. Register it in a settings file:

```json
{ "hooks": { "PostToolUse": [ { "matcher": "Bash", "hooks": [
  { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/worktree-reap/worktree-reap-hook.mjs\"" }
] } ] } }
```

The hook is a dry run until the repository opts in, in the main checkout's local
config:

```bash
git config worktreeReap.mode apply       # remove
git config --unset worktreeReap.mode     # back to dry run
```

Each run appends its report to `worktree-reap.log` inside the git directory.

## Calling it from code

`scripts/lib/worktree-reap-run.js` exports `runReap(opts)` and `formatReport(out)`.
It is synchronous; call it from a child process in a long-running server.
`scripts/lib/safe-git.js` plans every git call so a checkout's own config
(`core.fsmonitor`, filters, hooks) cannot run a program.

## Tests

```bash
node --test tests/*.test.mjs
```

The fixture tests build a real bare origin, a main checkout and real worktrees in
the temp directory, and inject the PR list from a file. They touch no network.
