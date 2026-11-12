# Generator scripts

Scripts are grouped by what they produce. Each generator's `command.ts` entry point sits beside it.

```text
shared/                   write-output.ts: changed-file writes, drift checks and stale-file removal;
                          zod.ts: zod expressions for declared fields; names.ts: derived names and headers
declarations/resources/   load and validate ../resources/, then check the declarations against each other
declarations/manifests/   load and validate ../manifests/ against the resources
contract/resources/       the resource contract, under the shared folder's generated/resources/
contract/actions/         the action contract, under the shared folder's generated/actions/
api/resources/            store, service and router per resource, and the barrel that wires them
api/actions/              each action's folder and the registry of enabled actions
```

A renderer is a pure function from declarations to text. An `output.ts` or `barrel.ts` decides which files exist and
writes them through `shared/write-output.ts`. A `command.ts` only parses arguments and reports.
