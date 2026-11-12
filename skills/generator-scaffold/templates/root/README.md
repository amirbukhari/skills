# __PROJECT__

A generator-style project: resources and features are **declared** as plain data under `generators/`, and the
code that serves them is **generated** from those declarations.

```text
generators/
├── resource.ts, manifest.ts   the declaration formats (types only)
├── resources/<name>.ts        one declaration per resource: fields and operations
├── manifests/<key>.ts         one declaration per feature: the resources it uses and the actions it owns
└── scripts/                   the generators, grouped by what they produce
__API_DIR__/
├── generated/                 gitignored: store, service and router per resource
├── actions/index.ts           generated and committed: the registry of enabled actions
├── features/<key>/actions/    action.ts is generated; handler.ts is yours
└── http/, actions/define.ts   the hand-written runtime that consumes the generated output
__SHARED_DIR__/generated/      the contract: zod schemas and types for resources and actions
```

## Commands

| Command | Does |
|---|---|
| `__PM_RUN__ generate` | Writes everything the declarations produce. |
| `__PM_RUN__ check:generated` | Fails when a committed generated file is out of date; writes nothing. |
| `__PM_RUN__ test` | Generates, then runs the generator tests and the generated-code tests. |
| `__PM_RUN__ typecheck` | Generates, then typechecks declarations, generators, runtime and generated code. |
| `__PM_RUN__ dev` | Generates, then serves the API on `$PORT` (any free port when unset). |

Start with [generators/README.md](generators/README.md): it says how to add a resource, a field, an action.
