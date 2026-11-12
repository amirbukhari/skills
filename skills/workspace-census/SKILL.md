---
name: workspace-census
description: A read-only report of what coding agents left around a machine - git worktrees outside the sanctioned folder, folders that Claude transcripts show an agent creating in the home directory, untracked files at repository roots, and temp-directory entries grouped by name pattern. Use when disk is filling up, when the home directory has collected scratch folders and repo copies, before a cleanup, or when the user asks what agents have written outside their repositories. It changes nothing and recommends nothing.
---

# workspace-census

Prints what agents left outside the places meant for their work, with the
evidence for each item. It never writes, moves or removes anything, and the
report gives no advice: path, size, last modified, and why the item is listed.
What to do with an item is the user's decision.

## Run it

Needs Node 18+ and git. No dependencies, nothing to install.

```bash
node <skill>/scripts/workspace-census.mjs
node <skill>/scripts/workspace-census.mjs --no-sizes          # much faster
node <skill>/scripts/workspace-census.mjs --json
```

| Flag | Meaning |
| --- | --- |
| `--exclude <path>` | Never walk or report under this path. Repeatable. |
| `--managed <path>` | A tool's own state folder: worktrees and writes inside it are not clutter. Repeatable. |
| `--work-dir <path>` | Where agents are meant to keep output. Treated as managed, and its size is shown. |
| `--worktrees-dir <name>` | The folder inside each repository that holds its worktrees. Default `.worktrees`. |
| `--json` | The same data as JSON, including every single temp entry. |
| `--no-sizes` | Skip size totals. |

`~` is expanded in paths. An unknown argument is an error.

## The four sections

| Section | Source of evidence |
| --- | --- |
| 1. Worktrees | `git worktree list` for every repository a Claude profile has been run in, minus those under `<repo>/<worktrees-dir>/` and managed paths. |
| 2. Paths agents wrote | Claude's own transcripts: `Write` and `Edit` targets, and the targets of `mkdir`, `git clone`, `git worktree add`, `cp`, `mv`, `rsync`, `tee` and `>` in Bash commands. Each is rolled up to the folder the agent introduced. Paths inside a repository, the temp directory, a profile, a managed path, standard config folders and dotfiles in the home directory are left out. |
| 3. Repository roots | Untracked, un-ignored entries at the top of each known repository. |
| 4. Temp directory | Entries owned by the current user, grouped by name pattern, so thousands of `name-XXXXXX` folders are one row. |

Repositories are found from the `projects` keys of each profile's
`.claude.json`. Profiles are `~/.claude` and sibling `~/.claude*` folders that
hold one.

Only unambiguous write shapes are read from Bash commands. A computed path such
as `$(mktemp -d)` is not guessed at. Command excerpts in the report have tokens,
keys and long opaque strings removed.

## Read-only, by measurement

`git status` runs with `--no-optional-locks`, so it does not refresh the index.
The test suite takes a snapshot of a fixture home directory (every path, size,
modification time and content hash) before and after a real run and requires
them to be identical. It also checks the tool's own text contains no verdicts or
commands.

## Tests

```bash
node --test tests/*.test.mjs
```
