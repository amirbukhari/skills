# [MOCK] Rentsync AI Agent Ecosystem

> [!WARNING]
> This is a **MOCK REPOSITORY** designed for testing and demonstrating the `rentsync-ai-skills-browser` UI. The contents within (agents, skills, mcp, hooks) are simulated configurations used to ensure the frontend renders agent-ecosystem files correctly.

This repository acts as the central intelligence hub for our customized and curated AI environment, leveraging standard integration patterns from the open-source agent ecosystem.

## Directory Structure

To ensure consistency with standard `.github` agent configurations (such as those used by the `skills.sh` CLI), this repository is organized logically into primary capability folders:

*   **`/skills/`**: Curated procedural knowledge and coding guidelines for agents. Currently containing Vercel React Best Practices, Anthropic Frontend Design, and elite UI/UX rules.
*   **`/agents/`**: Core agent instructions, system prompts, and personas spanning multiple workflows.
*   **`/mcp/`**: Model Context Protocol configurations, defining how our local AI agents interface with internal Rentsync services and data sources.
*   **`/hooks/`**: Automated scripts and hooks that execute before or after specific agent actions.

| [Researcher](agents/rentsync-agent-builder.agent.md) | Research context and return findings to parent agent. | Deep context gathering |

## Integration
Our internal AI agents automatically load these configuration directories during initialization. Engineers can explore and securely browse these standards via the internal `rentsync-ai-skills-browser` application.