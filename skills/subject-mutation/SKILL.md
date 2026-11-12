---
name: subject-mutation
description: Find tests that still pass when the code they claim to test is taken away, by running each node:test file once normally and once with its subject stubbed out or its source reads emptied. Use when auditing whether a test suite is real evidence, when agent-written tests look hollow, when a suite is green but bugs ship, or when the user asks which tests are vacuous, tautological or would pass against an empty implementation.
---

# subject-mutation

Runs each test file twice: once as it is, once under a mutation operator that
removes the subject. Every test that passes both times is printed. A test that
cannot tell its subject from nothing is not evidence about the subject.

Nothing on disk is changed. The operators live in the test process only, loaded
through `NODE_OPTIONS=--import`.

## The two operators

| Operator | What it does | What it catches |
| --- | --- | --- |
| `m1` | A test file's direct imports from the subject folders are replaced by stubs: every exported function returns `undefined`; a plain-object export keeps its data and has its function members stubbed. | Tests that call the code and assert nothing about the result. |
| `m2` | Every read of a repository source file from the test process returns empty. | Source-scanning tests whose assertion is true of an empty file. |
| `m12` | Both. | |

## Run it

Needs Node 20.6+ and a suite that runs under `node --test`. No dependencies.

```bash
node <skill>/scripts/run.mjs --op m1 --population lib
node <skill>/scripts/run.mjs --op m2 --population other
node <skill>/scripts/run.mjs --op m12 tests/foo.test.mjs tests/bar.test.mjs
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--repo <dir>` | The repository under test. | the git checkout the cwd is in |
| `--tests-dir <dir>` | Where `*.test.js` / `.mjs` / `.cjs` files live. | `tests`, else `test` |
| `--subjects a,b` | Folders whose modules are subjects for `m1`. | `lib,bin,tools,src` |
| `--population` | `lib` (imports a subject folder), `other` (imports no repository module), `child` (matches `--child-pattern`), `all`. | named files |
| `--child-pattern <regex>` | Source text that marks a test whose subject runs in another process, such as a server-boot helper's name. | none |
| `--unset-env <regex>` | Environment variable names removed for the runs. | none |
| `--jobs N`, `--timeout-ms N` | Files in parallel; per-test timeout. | 4; 20000 |

Each run gets a fresh temporary `HOME` and temp directory.

Output is one line per survivor, `file<TAB>test name`, then a summary:

```
tests/math.test.js	weak: only calls it

# m1 --population lib: 12 files, 148 tests pass unmutated, 9 still pass mutated, in 4 files
```

## Reading the result

A survivor is a lead, not a verdict. Read each one before changing it. Three
kinds survive by construction and are not weak tests:

- **The subject runs in a child process.** Neither operator reaches it. Put such
  files in the `child` population with `--child-pattern` and treat them as
  unmeasured.
- **A test of exported data.** `m1` stubs functions only, so a test of an exported
  set or constant survives.
- **An absence guard or fixture self-check.** "No file contains X" is true of an
  empty file by its nature.

For a real hollow test, the fix is an assertion on what the subject returned or
did, then a second run to confirm the test now dies.

## Install into any repository

Run it from the skill folder, or copy `scripts/` to `tools/subject-mutation/` and
add a script:

```json
{ "scripts": { "test:hollow": "node tools/subject-mutation/run.mjs --op m1 --population lib" } }
```

## Tests

```bash
node --test tests/*.test.mjs
```

The tests build a throwaway project with a strong test, a hollow test, a data
test and an absence guard, and assert exactly which survive under each operator.
