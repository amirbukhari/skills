---
name: test-report
description: A POSIX sh wrapper that runs a test command and ends with one unambiguous line, `TEST-RESULT: PASS (exit 0)` or `TEST-RESULT: FAIL (exit N)`, exiting with the command's real code. Use when an agent or script decides pass/fail by scraping test output or by an ad-hoc tally, when a clean run has been misread as red (or a red one as green), or when a test command's verdict must survive pipes and long logs.
---

# test-report

Runs a test command, prints one result line carrying the command's real exit
code, and exits with that same code.

## Why

A runner exits 0 when everything passes, but an ad-hoc follow-up tally such as
`[ -n "$failed" ]` returns 1 on an empty failure list. That fakes a red run
straight after a clean pass and triggers wasted re-verification. Scraping the
log for "fail" has the opposite problem. With this wrapper the last line is
always one of:

```
TEST-RESULT: PASS (exit 0)
TEST-RESULT: FAIL (exit 7)
```

and the wrapper's own exit code is the command's. The exact code is kept, not
flattened to 1.

## Run it

Needs a POSIX `sh`. No other dependency.

```bash
sh <skill>/scripts/test-report.sh                    # $TEST_REPORT_CMD, or `npm test` when unset
sh <skill>/scripts/test-report.sh pytest -q          # any command and its arguments
TEST_REPORT_CMD="cargo test --workspace" sh <skill>/scripts/test-report.sh
```

`TEST_REPORT_CMD` is run through `sh -c`, so it can be a whole command line.

## Install into any repository

Copy `scripts/test-report.sh` into the repository's `scripts/` folder and tell
agents to use it as the verdict. A line for `CLAUDE.md` or `AGENTS.md`:

```
Run tests with `sh scripts/test-report.sh`. The verdict is its last line and its
exit code; do not infer pass or fail from anything else in the output.
```

## Tests

```bash
node --test tests/*.test.mjs
```

The tests drive the wrapper with `true`, `false` and `exit 7` stubs. They skip on
Windows, where there is no POSIX `sh`.
