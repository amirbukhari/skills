# Spec-Folder Rubric

Used in **folder mode**, when the spec tree is the source of truth and the code is build output.

Document mode asks: *could someone build this without asking questions?*
Folder mode asks a stricter question: *if the code were deleted and regenerated from this folder, would the system come back?*

A folder can contain a dozen individually excellent module specs and still fail that test.

## The canonical layout

```
spec/
  standards/          durable conventions, inherited by every module
  contracts/          interfaces between modules — the partition seams
  modules/
    <module-name>/
      spec.md         behaviour for this module only
      constants.md    every literal value this module needs
      fixtures/       executable input -> expected output pairs
  unspecified.md      what is deliberately NOT contractual
  provenance.md       which code paths are generated, from which module
  regenerate.md       how to build, and the command that proves it worked
```

Deviations are fine if the same roles are filled. Score the roles, not the filenames.

## Two-layer scoring

1. **Per module** — score each `modules/<name>/` against the 13-dimension document rubric (`rubric.md`), producing a `finalScore` per module via `scripts/score.js`. Module specs almost always declare `inherits` pointing at `standards/`.
2. **Folder level** — score the eight dimensions below via `scripts/score-folder.js`.

**The folder score is capped by its weakest module.** Any module that cannot be rebuilt from its own spec breaks the source-of-truth claim for the whole tree, however well the rest scores. This is reported as `weakest_module:<name>`.

## Folder dimensions

| # | id | Weight | What "complete" looks like |
|---|---|---|---|
| 1 | `partitionIntegrity` | 15 | Every module has a stated boundary, and no behaviour is specified in two modules. A reader can say which module owns any given behaviour without guessing. |
| 2 | `contractCompleteness` | 15 | Every inter-module dependency has an explicit contract in `contracts/`: signatures, types, error cases. A module's spec never reaches into another module's internals. |
| 3 | `fixtureExecutability` | 20 | Fixtures are committed input/expected-output pairs a test runner can execute. Prose acceptance criteria score at most 60 here regardless of quality. |
| 4 | `unspecifiedDeclared` | 10 | `unspecified.md` exists and names what is deliberately not contractual — iteration order, log wording, internal decomposition, error message text. |
| 5 | `regenerationContract` | 10 | `regenerate.md` states the build procedure, the blast radius rules, and the literal done-check command. |
| 6 | `statefulArtifactHandling` | 10 | Migrations, seeds, and anything else that cannot be regenerated are marked as frozen outputs-that-become-inputs, with the rule for producing the next one. |
| 7 | `provenanceCoverage` | 10 | Every generated path is claimed by exactly one module, and hand-written paths are listed explicitly as exempt. |
| 8 | `crossModuleConsistency` | 10 | No term is defined differently in two module specs, and no constant has two values across the tree. |

## Why `fixtureExecutability` carries the most weight

The generator is not deterministic. Regenerating from an unchanged spec produces different code — different helper names, different decomposition, different ordering.

Fixtures are what you substitute for compiler determinism. They are the only thing that makes "the folder is source of truth" a checkable claim rather than an aspiration: a regeneration is valid if and only if every fixture passes. A spec folder whose fixtures are prose has no acceptance test for its own build, which is why the gate caps at 84 below a score of 70 here.

## Hard gates

| Gate | Cap | Fires when |
|---|---|---|
| `orphan_code_detected` | 59 | Code exists that no module spec claims. Regeneration would silently drop or drift it — the most severe failure in this mode, because it is invisible until the code is gone |
| `contract_cycle` | 74 | Module contracts form a dependency cycle, so no module in the cycle regenerates independently. **Computed in code** from the declared `dependsOn` edges, not reported by the analyst |
| `fixtures_not_executable` | 84 | Any module's fixtures are prose, or `fixtureExecutability` scores below 70 |
| `regeneration_contract_missing` | 84 | No `regenerate.md`, or it omits the done-check command |
| `stateful_artifacts_unhandled` | 84 | The system has migrations or other frozen artifacts and the folder has no rule for them |
| `unspecified_not_declared` | 89 | No `unspecified.md`. Without it the spec has no stated boundary and grows toward the size of the code |
| `weakest_module:<name>` | that module's score | Always applied |

## Required output shape

```json
{
  "folderDimensionScores": {
    "partitionIntegrity": 0,
    "contractCompleteness": 0,
    "fixtureExecutability": 0,
    "unspecifiedDeclared": 0,
    "regenerationContract": 0,
    "statefulArtifactHandling": 0,
    "provenanceCoverage": 0,
    "crossModuleConsistency": 0
  },
  "modules": [
    {
      "name": "mr-gate",
      "finalScore": 88,
      "dependsOn": ["rule-catalog"],
      "analysisPath": "/tmp/spec-analysis-mr-gate.json"
    }
  ],
  "flags": {
    "orphanCodeDetected": false,
    "fixturesNotExecutable": false,
    "unspecifiedNotDeclared": false,
    "regenerationContractMissing": false,
    "statefulArtifactsUnhandled": false
  },
  "orphanPaths": ["src/legacy/ledger.ts"],
  "rationale": { "partitionIntegrity": "evidence-backed reasoning per dimension" },
  "gaps": [
    {
      "dimension": "contractCompleteness",
      "severity": "blocking | major | minor",
      "title": "short title",
      "description": "what is missing and why it matters",
      "suggestedFix": "concrete instruction",
      "locationHint": "path within the spec folder, or null"
    }
  ],
  "summary": "2-3 sentences on whether this folder can act as source"
}
```

`modules[].dependsOn` names other module names. The script resolves cycles from these edges and ignores names that are not modules, so a dependency on an external package is not a cycle.

## Finding orphan code

This is the gate that matters most and the one an analyst most often skips, because it requires looking outside the spec folder.

1. Read `provenance.md` to get the claimed path patterns.
2. List the actual source tree.
3. Every source path matching no claim, and not listed as a hand-written exemption, is an orphan.

Report orphans in `orphanPaths` with real paths, never a count alone. If the codebase is not available to check, say so in the summary and set `orphanCodeDetected` to `true` — an unverifiable claim of full coverage is not evidence of full coverage.

## What folder mode does not check

It does not verify that regeneration actually reproduces the system. Only running the generator and the fixtures does that. This rubric scores whether the folder is *structured* to make that possible — a high score means the attempt is worth making, not that it will succeed.
