#!/bin/sh
# test-report.sh — run the test command, then print ONE unambiguous result line
# carrying the command's REAL exit code, and exit with that same code.
#
# Why this exists: `node --test` exits 0 on all-pass, but an ad-hoc follow-up tally
# like `[ -n "$failed" ]` returns 1 on an EMPTY failure list — faking a "red" run
# straight after a clean pass and triggering wasted re-verification. This wrapper
# removes the ambiguity: the last line is always `TEST-RESULT: PASS (exit 0)` or
# `TEST-RESULT: FAIL (exit N)`, and the script's own exit code mirrors the command.
#
# Usage:
#   test-report.sh                      # runs $TEST_REPORT_CMD, or `npm test` when it is unset
#   test-report.sh <cmd> [args]         # runs that command instead
#
# TEST_REPORT_CMD is run through `sh -c`, so it may be a whole command line
# (TEST_REPORT_CMD="pytest -q", "cargo test", "make check").
set -u

if [ "$#" -eq 0 ]; then
  if [ -n "${TEST_REPORT_CMD:-}" ]; then
    set -- sh -c "$TEST_REPORT_CMD"
  else
    set -- npm test
  fi
fi

"$@"
code=$?

if [ "$code" -eq 0 ]; then
  echo "TEST-RESULT: PASS (exit 0)"
else
  echo "TEST-RESULT: FAIL (exit $code)"
fi

exit "$code"
