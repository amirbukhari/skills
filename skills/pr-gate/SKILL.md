---
name: pr-gate
description: Gate a pull request by running the whole node:test suite on the base and on the base with the PR merged, then comparing per test. Use before merging or approving a PR when CI does not cover the target branch, when the base is already red, when repo-wide guard tests keep getting broken by "unrelated" PRs, or when the user asks "does merging this break anything?".
---

# pr-gate

Answers one question: does merging `<pr>` into `<base>` make any existing test
fail that did not fail before? It runs the whole suite twice, in throwaway
worktrees, and compares the two runs test by test.

It never chooses tests by topic. The tests a PR breaks are usually the
repo-wide guards, which are named after the rule they keep and not after the
feature the PR touches, so "the related suites" never include them.

## Run it

```bash
node <skill>/scripts/pr-gate.mjs <base> <pr>                   # any commit-ish: sha, branch, origin/x
node <skill>/scripts/pr-gate.mjs <base> <pr> --fresh           # re-run the base instead of using its cache
node <skill>/scripts/pr-gate.mjs <base> <pr> --runs 5          # alone re-runs per side (default 3)
node <skill>/scripts/pr-gate.mjs <base> <pr> --tests 'test/**/*.test.js'   # the suite; repeatable
```

Run it from inside the repository. Fetch both commits first.

| Exit | Meaning |
| --- | --- |
| 0 | No test newly fails, no already-failing test fails differently, no test stopped running. |
| 1 | The merge breaks something. The report lists each test under `BREAKS`. |
| 2 | Could not gate: unknown commit, merge conflict, PR already in the base, or a run produced an incomplete record. Never read 2 as a pass. |

## Which tests it runs

The suite is read from the **base** tree and used for both runs, so a PR that
narrows its own test script is still gated on the base's tests. First match wins:

1. `--tests <pattern>` on the command line.
2. `"prGate": { "tests": ["..."] }` in the base's `package.json`.
3. The path arguments of the base's `"test"` script, when it is `node --test …` or
   `node <runner>.mjs <paths>`.
4. Otherwise node's own test discovery.

Requires Node 20+ and a suite that runs under `node --test`. For another runner,
keep the comparison (`scripts/lib/pr-gate.js` is pure) and replace the two runs.

## What it compares, and why

- **Per test, not per file.** Results are keyed `file › test name` from the
  runner's own events, recorded by `pr-gate-reporter.mjs`. On a base that is
  already red, a PR can add a second failure inside a failing file; the set of
  failing files does not change.
- **Already-failing tests are compared by message**, after removing what differs
  between any two runs: checkout paths, temp paths, loopback ports, pids, uuids,
  timestamps, durations, colour codes and source line numbers.
- **A test that stops running is not a pass.** A file that still exists but
  produced no merged result, and a test that ran on the base and is skipped
  merged, both block. A renamed test is reported and does not block.
- **A failure seen once is a candidate.** Each candidate's file is re-run alone,
  `--runs` times on each side, merged and base alternating so a busy stretch on
  the machine lands on both. A new failure blocks only if it fails alone merged
  and never alone on the base. An alone run that recorded nothing counts as a
  failed run on the merged side.
- **An incomplete record is refused.** If the runner's own totals differ from the
  results read, the gate exits 2.

## What it touches

Nothing in the checkout it runs from: no checkout, merge or stash there. The
worktrees and each run's `HOME` and temp root live in a work directory under the
system temp directory and are removed on exit, including after a failed merge. A
run killed with SIGKILL leaves its work directory; the next run removes it,
identified by a marker file holding the dead run's pid.

`node_modules` from the current checkout is symlinked into the worktrees. The
base result is cached per base commit and suite in `<tmp>/pr-gate-cache`;
`PR_GATE_CACHE` moves it.

## Install into any repository

Copy `scripts/` to, for example, `tools/pr-gate/` and add a script:

```json
{ "scripts": { "gate": "node tools/pr-gate/pr-gate.mjs" } }
```

Then `npm run gate -- origin/main my-branch`.

## Tests

```bash
node --test tests/*.test.mjs
```

The end-to-end tests run the CLI against throwaway repositories in the temp
directory. One of them kills a run with SIGKILL and takes about 90 seconds.
