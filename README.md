# Claude Code skills & agent configuration

A personal collection of [Claude Code](https://claude.com/claude-code) skills and
supporting agent/MCP/hook configuration. The skills are self-contained procedural
knowledge Claude Code loads on demand; the flagship is **`scrutinize-spec`**,
which has grown from a spec scorer into an experimental **spec-driven-development
harness** (spec folder as source, generated code as build output).

## Skills

| Skill | Purpose |
| --- | --- |
| [scrutinize-spec](skills/scrutinize-spec/) | Scores a spec — one document or a whole spec folder acting as source of truth — against a deterministic gate, and loops until it is ready to hand to an AI coding agent. Now also hosts an experimental **spec-driven-dev mode**: the scrutinize gate as the precondition for regenerating code from the spec. Formerly the standalone `PRDScrutinizer` plugin. |
| [sdd-engine](skills/sdd-engine/) | The English-as-source repo-DSL engine: mines a TypeScript tree into a recursive LZW word dictionary, renders it to `.en`, and compiles back byte-identically. Extracted out of `scrutinize-spec` on 2026-08-31. See `skills/sdd-engine/CLAUDE.md` and `skills/sdd-engine/tools/PRD.md`. |

## Spotlight: `scrutinize-spec` → spec-driven development

`scrutinize-spec` scores a spec deterministically (Node scripts compute the gated
confidence, never the model) in two modes:

- **Document mode** — one PRD/spec across 13 weighted dimensions. *Could someone build this without asking questions?*
- **Folder mode** — a spec tree as source of truth across 8 folder dimensions. *If the code were deleted and rebuilt from this folder, would the system come back?*

**Spec-driven-dev mode** acts on a passing folder: the `spec/` tree is the real
source, generated code is a compiled build artifact, and the scrutinize gate is
the precondition for generation — *you cannot compile a spec that hasn't earned
it.* A complete runnable example lives in
[`skills/scrutinize-spec/examples/money-cart/`](skills/scrutinize-spec/examples/money-cart/):
a deterministic generator, a fixture verifier, drift detection, and a gated build
(`scrutinize → gate → generate → verify`). The staged design is in
[`skills/scrutinize-spec/ROADMAP.md`](skills/scrutinize-spec/ROADMAP.md).

## Repository layout

- **`skills/`** — the skills above; each is a folder with a `SKILL.md` plus any references and scripts.
- **`examples/`** — reference output produced by the skills (e.g. a refined PRD and an extracted standards document).
- **`.github/agents/`** — agent definitions (system prompts / personas) used with Claude Code.
- **`mcp/`** — Model Context Protocol server configuration (`servers.json`).
- **`hooks/`** — hook configuration (`security.json`).

## Using a skill

Copy a skill folder into your Claude Code skills directory, e.g.:

```
cp -r skills/scrutinize-spec ~/.claude/skills/scrutinize-spec
```

Then invoke it by name (`/scrutinize-spec ...`) or just describe the task; Claude
Code loads the matching `SKILL.md` when it is relevant.
