# sdd-engine

**English is the source. TypeScript is derived. The derivation is byte-exact for every file.**

This is a working toolchain, not a document. It walks a TypeScript tree, mines a recursive
LZW word dictionary out of its AST, renders every `.ts` file to an editable `.en`, and
compiles the `.en` back to the **original bytes, exactly**. Byte-identity is the hard floor
and is never a gate to relax.

---

## Start here — 60 seconds

```bash
npm run roots     # WHERE is the engine pointed, and which layer decided it? Run this first.
npm test          # UNIT tier. Green on a fresh clone, no corpus, no mine.
```

`npm run roots` is the first thing to run whenever anything looks wrong. Every "the engine
measured the wrong tree" incident in this project was a root question.

### The two roots

| var | role | holds |
|---|---|---|
| `SOURCE` | **READ** root, never written, never wiped | the `.ts` tree that is walked, parsed, mined |
| `CORPUS` | **WRITE** root | `sen/` (the `.en` files + mined artifacts), `catalog/`, `.cache/` |

Both are set in **`.env`** (template: `.env.example`). They are independent: same directory =
self-hosting (the default); different directories = render a forked codebase into a fresh tree.
**Repointing either root is one line in `.env` and nothing else** — that is a hard acceptance
test, not an aspiration. A root that is set but missing **refuses loudly**, naming the path and
the layer that supplied it. There is no silent fallback.

Resolution happens in exactly one module: `tools/repo-dsl/engine/corpus-root.js`.
Nothing else in the live tree may name a root literal; `engine/corpus-root.test.js` enforces that.

### The pipeline

```bash
npm run mine      # SOURCE .ts  ->  the recursive word dictionary   (expensive: tens of minutes)
npm run name      # propose stable domain names for words           (worksheet only, never applies)
npm run render    # dictionary  ->  <CORPUS>/sen/files/**/*.en      (byte-gated per file)
npm run measure   # THE SCOREBOARD: byte-identity, vacuous clauses, English-completeness

npm run build     # mine -> name -> render -> measure, in order
```

On a fresh corpus every artifact is **ABSENT** — that is a state, not a failure. `npm run roots`
lists which ones exist, and the corpus-tier tests report SKIPPED with the command that would
produce them.

### Everything else that is runnable from here

| command | does |
|---|---|
| `npm run test:unit` | unit tier only — needs nothing but the source |
| `npm run test:corpus` | tests that need mined artifacts under `<CORPUS>/sen/catalog/` |
| `npm run test:slow` | full-corpus round-trips, **minutes each** |
| `npm run test:all` | everything, round-trips included |
| `npm run stamp:check` | every artifact honours the §8B header contract |
| `npm run gate` | the measurement gate |
| `npm run clean` | dry-run: names what a wipe *would* delete, deletes nothing |
| `npm run clean:sen` | still a dry-run. Deleting `sen/` also requires `--go`, typed by hand |

> **Never run the full suite casually.** `test:all` and `test:slow` have OOM-killed on shared
> machines. Run the module you changed: `node tools/repo-dsl/engine/<module>.test.js`.

---

## Where things are

```
skills/sdd-engine/
├── README.md               <- you are here: the front door
├── CLAUDE.md                  operating rules + the landmines that produced them. READ IT.
├── SKILL.md                   the agent-facing skill definition (frontmatter + the three lanes)
├── .env / .env.example        the two root vars. One line repoints either root.
├── .claude/                   project settings scoped to this skill — see .claude/README.md
├── Examples/hydra-source/     the CORPUS: a real TypeScript billing system. Gitignored here.
└── tools/
    ├── prd/                   THE SPECIFICATION, one file per section. Start at prd/README.md.
    │                          Section labels are cited from the code (§1B roots, §7 gates,
    │                          §8A/§8B the artifact contract) and did not change.
    ├── PRD.md                 a pointer at prd/, plus the §-label -> file lookup table.
    ├── sdd-*.js               lane 1+2: spec -> code generation, and the drift check
    └── repo-dsl/              lane 3: the English-as-source engine. See its README for the map.
        ├── README.md          THE MAP — the live pipeline, and which of the 40 root scripts is what
        ├── engine/            the library modules + their .test.js suites
        ├── archive/           retired, NOT deleted. archive/README.md says why each one was.
        └── run-tests.js       the three-tier test runner (`npm test` lands here)
```

## The three lanes

1. **Generate** — `tools/sdd-generate.js` assembles a prompt from a spec folder and invokes a
   pluggable generator. A model does not emit byte-identical output, so a regeneration is valid
   **iff the fixtures pass**.
2. **Check** — `tools/sdd-check.js` verifies committed generated code against its spec: content
   hashes, the fixtures-pass provenance manifest, and spec↔tree drift.
   `tools/sdd-build.js` chains both behind a scrutiny gate and **refuses to generate** below
   threshold — the one place this engine reads the sibling `scrutinize-spec` skill.
3. **repo-DSL** — `tools/repo-dsl/`, the English-as-source pipeline and by far the largest
   surface. This is what `npm run build` drives.

## Two rules worth knowing before you touch anything

**Artifacts live with the corpus, never in this repo.** Mined dictionaries, word names and
coverage results are written under `<CORPUS>/sen/catalog/`, resolved through
`tools/repo-dsl/engine/artifact-contract.js`. `engine/artifact-location.test.js` fails if the
engine ever writes corpus-derived bytes back here. This remote is public.

**Never read an artifact by joining a path yourself.** Go through the contract:

```js
const AC = require("./engine/artifact-contract");
const j = AC.load(kind, AC.pathFor(kind, corpusRoot), { corpus: corpusRoot });
```

`load` validates the header (`schema`, `artifactVersion`, `corpus`, `generated`, `fingerprint`)
and **refuses loudly** on mismatch. A producer/consumer schema drift must fail at the read, not
decode against the wrong vocabulary. This rule exists because it was violated six times in one day.

## Where to look next

| you want | read |
|---|---|
| to run something | this file, then `npm run roots` |
| the design and every §-number cited in the code | `tools/prd/README.md` (`tools/PRD.md` is the breadcrumb) |
| which script is live and which is a one-off | `tools/repo-dsl/README.md` |
| why a rule exists / what has already gone wrong | `CLAUDE.md` |
| why a script was retired | `tools/repo-dsl/archive/README.md` |
| the deterministic spec→TypeScript CLI | `tools/repo-dsl/engine/SDD.md` |

Dependency-free Node (built-ins only) everywhere except `tools/repo-dsl/package.json`,
which pins `typescript` for AST parsing. Node >= 18.
