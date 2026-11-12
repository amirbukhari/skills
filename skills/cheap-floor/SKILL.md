---
name: cheap-floor
description: A git pre-commit hook that runs a short, named list of fast guard suites one at a time and refuses the commit when any is red, when a listed suite is missing, or when the list is empty. Use when a repository needs a test rule nobody can skip, when the full suite is too slow or too heavy to run on every commit, when doc edits, renames and moves keep breaking guard tests, or when the user asks for a pre-commit hook.
---

# cheap-floor

A `pre-commit` hook in plain `sh`. It runs only the suites named in a list file,
one process at a time, and blocks the commit unless all pass.

It is a floor, not the test run. It cannot know which suites a change touches,
so a green hook says nothing about the edited files. The hook prints that
reminder every time it passes.

## What belongs on the list

Suites that need no built artifact, finish quickly, and break on the kinds of
change that slip through: a doc edit, a renamed or moved file, a dangling link, a
comment that points at something gone. Never the command that runs the whole
suite.

## Install into any repository

Needs git and a POSIX `sh`.

1. Copy `scripts/pre-commit` into a tracked folder, for example `hooks/`, and
   keep it executable.
2. Create `.cheap-floor` at the repository root:

   ```
   # one suite per line; blank lines and # comments are ignored
   test/guards/reachability.test.js
   test/guards/doc-links.test.js
   test/unit/paths.spec.js | npx jest
   ```

   A line is a path, run as `node <path>`, or `<path> | <command>`, run as
   `<command> <path>`.
3. Enable it once per clone:

   ```bash
   git config core.hooksPath hooks
   ```

| Setting | Effect | Default |
| --- | --- | --- |
| `git config cheapFloor.suites <path>` | Where the list is. | `.cheap-floor` |
| `git config cheapFloor.runner "<command>"` | The runner for lines with no `\|`. | `node` |

## What it refuses

| Situation | Result |
| --- | --- |
| A listed suite exits non-zero | Commit refused. The first 40 lines of its output are shown. The remaining suites still run. |
| A listed suite is not on disk | Commit refused before anything runs. A moved suite must be re-pointed in the same commit as the move. |
| The list file is missing | Commit refused. |
| The list names no suites | Commit refused. A hook that ran nothing must not print green. |

The hook runs from the repository root whichever folder the commit is made in,
and removes its temporary output file on exit.

## Tests

```bash
node --test tests/*.test.mjs
```

The tests install the hook in throwaway repositories and make real commits.
