---
name: skip-guard
description: A node --test runner that fails any run in which a test was skipped or marked todo, and confines the suite's temp files to one root that is removed afterwards; with a matching Playwright reporter. Use when skipped tests hide behind "0 failures", when an agent "fixes" a failing test by skipping it, when test runs leave thousands of temp directories behind, or when setting up `npm test` for a node:test suite.
---

# skip-guard

A skipped test verified nothing, and a run that skipped tests still prints
"0 fail". This runner fails such a run and names every skipped or todo test with
its reason.

It counts what the runner reports at run time, not what the source says. A grep
for `.skip(` misses `t.skip()` inside a test body, a conditional
`{ skip: cond && '…' }` that fires on one machine only, and a `describe` skipped
above its tests.

## What is in `scripts/`

| File | Role |
| --- | --- |
| `run-tests.mjs` | The runner for a `"test"` script. Wraps `node --test`. |
| `skip-census-reporter.mjs` | A node:test reporter added to every run: one JSON line per skipped or todo test. |
| `lib/skip-guard.js` | The rule (`judgeSkips`), the one exception (`platformOnly`) and the reporter wiring. |
| `lib/test-temp-root.js` | One temp root per run, and the sweep of roots left by killed runs. |
| `playwright-skip-guard-reporter.mjs` | The same rule as a Playwright reporter. |

## Install into any repository

Needs Node 20+. No dependencies.

1. Copy `scripts/` to, for example, `tools/skip-guard/`.
2. Point the test script at the runner, keeping the glob in the script:

   ```json
   { "scripts": { "test": "node tools/skip-guard/run-tests.mjs \"tests/**/*.test.mjs\"" } }
   ```

3. Run `npm test`. A clean run behaves as before. A run with a skip exits 1 and
   prints, for example:

   ```
   [skip-guard] FAIL: 2 test(s) skipped or todo — a skipped test verified nothing:
     - [skipped] tests/a.test.mjs › needs a browser — no browser here
     - [todo] tests/b.test.mjs › later — write me
   ```

Arguments pass through to `node --test` in order, so
`npm test -- --test-name-pattern=picker` and a caller's own `--test-reporter`
keep working. If no argument is a path, the default glob is appended, so a
flag-only run never falls back to node's own discovery (which also matches test
files in other worktrees under the folder).

| Variable | Effect |
| --- | --- |
| `RUN_TESTS_GLOB` | The glob used when no argument is a path. Default `tests/**/*.test.mjs`. |
| `RUN_TESTS_KEEP_TMP=1` | Keep the temp root and print its path. |
| `RUN_TESTS_UNSET=A,B` | Variables removed from the tests' environment. Use it for state-directory variables that a running instance of the application exports, so tests started from inside it never touch live state. |

## The one exception: platform-only tests

A test bound to one operating system declares it in its skip reason:

```js
import { platformOnly } from '../tools/skip-guard/lib/skip-guard.js';

test('paste with the command key', { skip: process.platform !== 'darwin' && platformOnly('darwin', 'the gesture exists only on macOS') }, () => { /* … */ });
```

That skip is accepted only on a platform the declaration excludes, and is printed
on every run. The same test skipped on its own platform fails the run.

## The temp root

The runner sets `TMPDIR`, `TMP` and `TEMP` to one fresh directory
(`node-test-root-<pid>` under the system temp directory) and removes it when the
suite exits. Tests need no changes. `TEST_TMP_ROOT` holds its path.

A run killed with SIGKILL cannot clean up. The next run removes such roots, under
narrow rules: the name matches, it is a real directory and not a symlink, it
carries the runner's marker file, the current user owns it, and the pid in the
marker is no longer alive. Removal copes with directories a test left without
their execute bit.

## Playwright

```js
// playwright.config.js
export default { reporter: [['list'], ['./tools/skip-guard/playwright-skip-guard-reporter.mjs']] };
```

A `--reporter` flag on the command line replaces the config's list, so name the
guard there too in CI. If the config switches a whole project off for a run that
selected it, set `SKIP_GUARD_PROJECT_OFF` to
`{"name":"<project>","notice":"<why>"}` and the reporter fails that run too.

## Tests

```bash
node --test tests/*.test.mjs
```

The tests run the real runner over fixture test files. The Playwright reporter is
driven through the reporter API's own shapes, so no browser is needed.
