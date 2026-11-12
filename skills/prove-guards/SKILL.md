---
name: prove-guards
description: Prove that each guard test, lint rule or CI check can actually fail, by planting one violation per guard, expecting red, removing it and expecting green, then restoring the tree. Use after writing or changing guard tests, when a check has only ever been seen green, when auditing whether a repository's rules are really enforced, or when the user asks to prove, verify or mutation-check the guards.
---

# prove-guards

A guard that has never been seen red has an unknown failure mode. This tool
plants one violation per guard, runs the guard and expects it to fail, removes
the violation, runs it again and expects it to pass. Only both together count
as `PROVEN`.

This repository's `generator-scaffold` skill does not include this step, so it
is a separate skill. It works with any guard that is a command with an exit
code: a test file, a lint run, a script.

## Declare the proofs

`prove-guards.json` in the project root:

```json
{
  "evidence": "FAIL|✖|error",
  "proofs": [
    { "guard": "line limit",
      "run": ["node", "--test", "tests/guards/line-limit.test.js"],
      "plant": { "create": "src/pages/too-long.js", "text": "//\n", "repeat": 301 } },

    { "guard": "generated-output drift",
      "run": ["npx", "vitest", "run", "tests/guards/generated-drift.test.ts"],
      "plant": { "append": "src/generated/enums.ts", "text": "// hand edit\n" } },

    { "guard": "layer fence (lint)",
      "run": ["npx", "eslint", "src/pages"],
      "plant": { "create": "src/pages/sneaky.ts", "text": "export * from '../features/billing/domain/rules.ts';\n" } },

    { "guard": "debug flag off",
      "run": ["node", "tests/guards/config.test.js"],
      "plant": { "replace": "src/config.js", "find": "debug: false", "with": "debug: true" } },

    { "guard": "change note",
      "run": ["node", "scripts/check-changes.js", "--branch", "feat/example"],
      "plant": { "absent": ".changes/feat-example.md", "text": "bump: patch\nExample.\n" } }
  ]
}
```

| Plant | The violation |
| --- | --- |
| `create` | A new file. Refused if the file already exists. |
| `append` | Text added to the end of an existing file. |
| `replace` | One exact piece of text swapped in an existing file. It must occur exactly once. |
| `absent` | A file that is missing. Red runs without it; green runs with it written; it is removed afterwards. |

`run` is a command as a list, started in the project root without a shell.
`evidence` is an optional regex choosing which output lines are quoted in the
report; without it the last three lines are shown. `note` on a proof replaces
the generated description of the plant.

## Run it

Needs Node 18+. No dependencies.

```bash
node <skill>/scripts/prove-guards.mjs
node <skill>/scripts/prove-guards.mjs --only "line limit"     # repeatable
node <skill>/scripts/prove-guards.mjs --config ci/proofs.json
node <skill>/scripts/prove-guards.mjs --list
```

```
## line limit: PROVEN
planted: add src/pages/too-long.js
command: node --test tests/guards/line-limit.test.js
RED   exit=1  ✖ src/pages/too-long.js has 301 lines
GREEN exit=0  ✔ no source file is over 300 lines

prove:guards: every guard went red with its violation and green without it (5/5)
```

| Exit | Meaning |
| --- | --- |
| 0 | Every guard proven. |
| 1 | A guard was not proven, or a file could not be restored. |
| 2 | Bad usage or a bad config, including an empty proof list and an `--only` name that matches nothing. |

A guard is `NOT PROVEN` when it stays green with the violation planted, when it
is red without the violation (so its red run proves nothing), or when its
command cannot be started.

## What it does to the working tree

Each planted change is undone in a `finally`, and on SIGINT, SIGTERM or SIGHUP.
Folders created for a planted file are removed. After each proof the touched
file's hash is compared with its hash before; a difference fails the run and
names the file. A planted path cannot leave the project folder.

Run it on a clean tree, and do not run two at once in one checkout: the guards
see whatever else is in the tree.

## Install into any repository

Copy `scripts/prove-guards.mjs` to, for example, `tools/`, add
`prove-guards.json`, and a script:

```json
{ "scripts": { "prove:guards": "node tools/prove-guards.mjs" } }
```

Add one proof whenever a guard is added. A guard with no proof is unproven.

## Tests

```bash
node --test tests/*.test.mjs
```
