---
name: git-guard
description: Install a PreToolUse hook that refuses destructive git forms in Claude Code sessions (reset, stash, force push, checkout --, restore, clean, add -A / add ., --no-verify, branch -f/-D, update-ref), however they are chained or spelled. Use when several agent sessions or worktrees share one machine or one remote, when an agent has thrown away or over-staged work, or when the user asks to "ban", "block" or "guard" dangerous git commands.
---

# git-guard

A Bash-only PreToolUse hook. It tokenizes each command the way a shell would and
refuses the git forms that destroy work someone else may depend on. A prompt rule
saying "don't force push" does not hold across a long session; a hook does.

## What it refuses, and what it leaves alone

| Refused | Why |
| --- | --- |
| `git reset`, `git checkout -- <path>`, `checkout -f`, `checkout <pathspec>`, `git restore` (except `--staged` alone), `git clean` | throws away a working tree |
| `git stash` | the stash stack is shared by every worktree of a repository |
| `git push --force` / `-f` / `--force-with-lease` / `+refspec`, `git update-ref`, `git branch -f` / `-D` / `-M` | rewrites or drops a ref others build on |
| `git add -A` / `--all` / `.` / `./` / `:/` | stages files nobody looked at |
| `--no-verify`, `git commit -n` | skips the hooks that guard the repository |

Allowed on purpose: `checkout <branch>` / `-b` / `-B`, `restore --staged`,
`branch -d`, `rebase`, and every read-only command.

It finds git in every command position: after `&&`, `||`, `;`, `|`, newlines,
inside `( )`, `$( )`, backticks, `sh -c` and `eval` strings, behind `sudo`, `env`,
`VAR=x` prefixes and an absolute path to git, and past git's own options
(`-C <dir>`, `-c k=v`). Heredoc bodies, comments and quoted strings are text, so a
commit message that names a banned command is not one.

It is a classifier, not a sandbox. A command built at run time (a variable holding
`reset`, an alias, a script file) is not seen. It fails open on input it cannot
parse, so a parse slip never takes the session's shell away.

## Install into any repository

Needs Node 18+. No dependencies.

1. Copy this skill's `scripts/` folder somewhere stable — the repository
   (`tools/git-guard/`) or the user's config directory. The settings file will hold
   an absolute path to it.
2. Wire it in:

   ```bash
   node <copied>/install.mjs                      # <cwd>/.claude/settings.json
   node <copied>/install.mjs --settings <file>    # user, project or local settings
   node <copied>/install.mjs --print              # show the result, write nothing
   ```

   The installer adds one `PreToolUse` group with matcher `Bash`, keeps every other
   key and hook, and is idempotent. It refuses a settings file that is not JSON.
3. Start a new session and confirm: ask for `git stash` and read the deny reason.

To wire it by hand, add this to `hooks.PreToolUse` in a settings file:

```json
{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "\"node\" \"<abs path>/git-guard-hook.mjs\"" }] }
```

## Configuration

`GIT_GUARD_ALLOW` — comma-separated rule names to switch off, set in the
environment the session runs in. Rule names are the ones a deny reason prints:
`git reset`, `git stash`, `git update-ref`, `--no-verify`, `git push --force`,
`git checkout --`, `git checkout -f`, `git checkout <pathspec>`, `git restore`,
`git clean`, `git add -A`, `git add .`, `git branch -f`, `git branch -D/-M`.

Example: a single-session repository that wants its stash back runs with
`GIT_GUARD_ALLOW="git stash"`. Every other rule still holds.

## Tests

```bash
node --test tests/*.test.mjs
```

The tests cover each refused and allowed form, the hook's stdin/stdout contract,
and a real install: the command string `install.mjs` writes is run through a shell
and must deny a force push.
