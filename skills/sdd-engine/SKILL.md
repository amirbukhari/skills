---
name: sdd-engine
description: The spec-driven-development engine — generates code from a spec folder, checks a regeneration against committed fixtures and provenance, and runs the repo-DSL mine/expand/gate/verify pipeline that renders a TypeScript corpus to English `.en` source and compiles it back byte-identically. Use when generating or re-generating code from a spec, verifying that generated code still matches its spec, or working on the English-as-source repo-DSL (mining a word dictionary, rendering `.en` files, or gating byte-identity).
---

# SDD Engine

This skill is the **executable engine**. It is not a rubric and it does not score
anything — for that, see the sibling `scrutinize-spec` skill. The engine's job is to
turn a spec into code, prove a regeneration is still valid, and run the repo-DSL
that makes English the source of a TypeScript repo.

It is invoked as CLI subprocesses (by a human, by an agent, or by an external
cockpit), not imported as a library. Every script is dependency-free Node using
built-ins only, except `tools/repo-dsl/`, which has its own `package.json`.

## The three lanes

### 1. Generate — `tools/sdd-generate.js`
Assembles a generator prompt from a spec folder and invokes a pluggable generator
(default: the `claude` CLI) to emit arbitrary code, typically TypeScript. Unlike a
deterministic template renderer, a model does not emit byte-identical output, so a
regeneration is treated as valid **iff the fixtures pass**. Shared helpers live in
`tools/sdd-lib.js`.

### 2. Check — `tools/sdd-check.js`
Verifies committed generated code against its spec: content hashes, the
fixtures-pass provenance manifest, and drift between what the spec says and what
the tree holds. This is the gate that makes regeneration safe.

`tools/sdd-build.js` chains the two behind a scrutiny gate —
`scrutinize → (gate) → generate → check` — and **refuses to generate** unless the
score clears the threshold. It is the one place the engine reads the sibling
`scrutinize-spec` skill (its `scripts/score.js` and `references/rubric.md`); the
dependency is one-directional, engine → scrutinizer, never the reverse.

### 3. repo-DSL — `tools/repo-dsl/`
The English-as-source pipeline, and the largest surface here. It mines a recursive
LZW word dictionary over a corpus's AST node stream, renders every `.ts` file to an
editable `.en`, and compiles the `.en` back — asserting **byte-identity on every
file**, which is the project's hard floor and never a gate to relax.

    repo-dsl <mine|publish|gate|verify|verify-expand|expand|explain|refine-language|report>

`mine` builds the recursive word dictionary from a corpus; `verify` and
`verify-expand` assert the byte-exact gate; `expand` and `explain` walk a word back
to the bytes it abstracts; `gate` and `report` are the measurement surface.
Rendering the corpus to `.en` is a separate entry point, `write-en-files.js`.

`tools/repo-dsl/README.md` names the live pipeline step by step and distinguishes
it from the measurement and panel pipelines; `tools/repo-dsl/PRD.md` is the
specification, including the artifact contract (§8B) and the three-roots model
(§1A). `tools/repo-dsl/archive/` holds retired scripts — **retired, not deleted**;
its README says why each one was retired.

## Artifacts live with the corpus, never here

The engine is **corpus-agnostic and publishable**. Every corpus-derived artifact —
mined dictionaries, word names, coverage results — is written under the corpus tree
(`<corpus>/spec/catalog/`), resolved through `tools/repo-dsl/engine/artifact-contract.js`
and pinned to the tree it was mined from. `engine/artifact-location.test.js` fails
if the engine ever writes corpus-derived bytes back into this repo. Do not
reintroduce a catalog here; the remote is public.

The corpus root comes from `HYDRA_CORPUS` or an explicit `--corpus` flag. Nothing
resolves a corpus by guessing from `__dirname`.

## Reading an artifact

Never read an engine artifact by joining a path yourself. Go through the contract:

    const AC = require("./engine/artifact-contract");
    const j = AC.load(kind, AC.pathFor(kind, corpusRoot), { corpus: corpusRoot });

`load` validates the header (`schema`, `artifactVersion`, `corpus`, `generated`,
`fingerprint`) and **refuses loudly** on a mismatch. There is no silent fallback:
a producer/consumer schema drift must fail at the read, not decode against the
wrong vocabulary. This rule exists because it was violated six times in one day.

## Running the checks

The suites are per-module and are run individually — the full corpus pass is
expensive and has been OOM-killed on shared machines. Scope what you run.

    node tools/repo-dsl/engine/<module>.test.js
    node tools/repo-dsl/test-gen-roundtrip.js     # full corpus byte-identity, expensive
