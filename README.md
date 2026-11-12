# [MOCK] AI Agent Ecosystem

> [!WARNING]
> This is a **MOCK REPOSITORY** designed for testing and demonstrating a skills-browser UI. The contents within (agents, skills, mcp, hooks) are simulated configurations used to ensure the frontend renders agent-ecosystem files correctly.

This repository acts as the central intelligence hub for our customized and curated AI environment, leveraging standard integration patterns from the open-source agent ecosystem.

## Directory Structure

To ensure consistency with standard `.github` agent configurations (such as those used by the `skills.sh` CLI), this repository is organized logically into primary capability folders:

*   **`/skills/`**: Curated procedural knowledge and coding guidelines for agents. Currently containing Vercel React Best Practices, Anthropic Frontend Design, and elite UI/UX rules.
*   **`/examples/`**: Real output produced by the skills in this repository, kept as reference material.
*   **`/agents/`**: Core agent instructions, system prompts, and personas spanning multiple workflows.
*   **`/mcp/`**: Model Context Protocol configurations, defining how our local AI agents interface with internal services and data sources.
*   **`/hooks/`**: Automated scripts and hooks that execute before or after specific agent actions.

## Agents

| Agent | Purpose |
| --- | --- |
| [Frontend Engineer](agents/frontend-engineer.agent.md) | Builds React front-end applications from a design system, using the debugging, subagent and verification skills, and verifies before every commit. |

## Integration
Our internal AI agents automatically load these configuration directories during initialization. Engineers can explore and securely browse these standards via the internal skills-browser application.

## Skills

| Skill | Purpose |
| --- | --- |
| [scrutinize-spec](skills/scrutinize-spec/) | Scores a spec — one document or a whole spec folder acting as source of truth — against a deterministic gate, and loops until it is ready to hand to an AI coding agent. Formerly the standalone `PRDScrutinizer` plugin (v2.0.0); consolidated here. |
| [mcp-builder](skills/mcp-builder/) | Building MCP servers, with evaluation tooling. |
| [subagent-driven-development](skills/subagent-driven-development/) | Splitting implementation across specialised subagents. |
| [systematic-debugging](skills/systematic-debugging/) | Root-cause tracing and defence-in-depth debugging practice. |
| [verification-before-completion](skills/verification-before-completion/) | Requires evidence before any claim that work is complete. |
| [guide-builder](skills/guide-builder/) | Authoring user-facing explainers and guided tours with every selector resolved against real render code, so guide content cannot silently rot. |
| [video-guide](skills/video-guide/) | Writing, recording and publishing a feature's narrated video guide, with every caption spoken and every step checked against the real screens. |
| [autocompact](skills/autocompact/) | Viewing or changing Claude Code's auto-compaction window for the active account, with a helper script. |
| [generator-scaffold](skills/generator-scaffold/) | Scaffolding a new declaration-driven TypeScript project: resource and feature manifests, a tested generator, a runtime that consumes its output, and one example resource end to end. |
| [git-guard](skills/git-guard/) | A Claude Code PreToolUse hook that refuses destructive git forms (reset, stash, force push, `checkout --`, restore, clean, `add -A`, `--no-verify`, branch deletion, `update-ref`) however they are chained or spelled, with an installer for any settings file. |
| [worktree-reap](skills/worktree-reap/) | Removing linked git worktrees whose work has landed, squash merges included: dry run by default, never forced, with a hook that sweeps after each PR merge. |
| [pr-gate](skills/pr-gate/) | Gating a pull request by running the whole node:test suite on the base and on the base with the PR merged, and comparing per test. |
| [skip-guard](skills/skip-guard/) | A node:test runner (and Playwright reporter) that fails any run with a skipped or todo test, and confines the suite's temp files to one root it removes. |
| [subject-mutation](skills/subject-mutation/) | Finding tests that still pass when the code they claim to test is stubbed out or its source reads are emptied. |
| [assert-tree-clean](skills/assert-tree-clean/) | Asserting that both the git index and the working tree match HEAD after a cycle that changes tracked files and puts them back, including the case where only the index differs. |
| [test-report](skills/test-report/) | A POSIX sh wrapper that runs a test command and ends with one unambiguous `TEST-RESULT: PASS` or `FAIL` line, exiting with the command's real code. |
| [version-gate](skills/version-gate/) | Changesets instead of per-PR version bumps: a CI gate that rejects hand edits to the version, changelog and release notes, and one release command that writes all three. |
| [workspace-census](skills/workspace-census/) | A read-only report of what coding agents left around a machine: stray worktrees, folders they created, untracked files at repository roots, temp-directory clutter. |
| [branch-protection](skills/branch-protection/) | Branch protection as a checked-in file, compared with the live settings, applying only the "up to date before merging" switch so nothing else is overwritten. |
| [advisor](skills/advisor/) | A read-only reviewer subagent consulted before committing to an approach or declaring work done, with an installer. |
| [cheap-floor](skills/cheap-floor/) | A pre-commit hook that runs a short named list of fast guard suites and refuses red, missing or empty. |
| [capture-harness](skills/capture-harness/) | Driving a running web app or browser game through a scripted flow in a real browser and saving named screenshots with a manifest, failing on console errors. |
| [prove-guards](skills/prove-guards/) | Proving each guard can fail: plant one violation, expect red, remove it, expect green, restore the tree. |
