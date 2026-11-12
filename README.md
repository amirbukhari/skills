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

| [Researcher](agents/rentsync-agent-builder.agent.md) | Research context and return findings to parent agent. | Deep context gathering |

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
