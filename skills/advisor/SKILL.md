---
name: advisor
description: A read-only reviewer subagent that a working agent consults for a second opinion - before committing to an approach, before declaring work done, when stuck, or when changing direction - and that checks whether tests can fail, whether populations are empty, and whether a measurement still measures what it names. Use when setting up a repository for agent work, when agents keep reporting confident wrong answers or vacuous green tests, or when the user asks for an advisor, reviewer or second-opinion agent.
---

# advisor

A Claude Code subagent definition (`templates/advisor.md`) and an installer. The
advisor has `Read`, `Grep`, `Glob` and `Bash`, and no tool that edits files. It
starts each call with no context, checks the caller's claims against the
repository itself, and ends with a verdict and one next action.

## What it checks on every call

1. Can this assertion fail? Has the test been seen red, or only green?
2. Is the population non-empty? A check over zero items passes for no reason.
3. Does the measurement read what its name says, or a proxy that drifted?
4. Is the claimed completion visible to the person who asked, with no further step?
5. Does this contradict what the repository's own instructions, specs or code say?

## Install into any repository

Needs Node 18+.

```bash
node <skill>/scripts/install.mjs                 # <checkout root>/.claude/agents/advisor.md
node <skill>/scripts/install.mjs --dir <repo>
node <skill>/scripts/install.mjs --user          # the user's Claude config, for every repository
node <skill>/scripts/install.mjs --model sonnet  # change the agent's model line
node <skill>/scripts/install.mjs --print         # show the file, write nothing
```

A second run changes nothing. An existing `advisor.md` that differs is left
alone unless `--force` is passed.

Then add the calling contract to the repository's `CLAUDE.md` (or `AGENTS.md`),
because the advisor only helps if agents are told when to call it:

```markdown
## Advisor

Consult the `advisor` subagent:
- before committing to an approach, on anything longer than a few steps;
- before declaring a piece of work done;
- when stuck (the same diagnosis has failed twice);
- when changing approach mid-task.

Paste your actual context into the prompt: what you are trying to do, what you
have read, and what you are about to do or have just done. The advisor has no
memory of your session.
```

## Adapting it

Edit the installed file. Useful additions are the repository's own house defect
(the mistake that keeps recurring there), the files that hold its rules, and any
limit on running tests. Keep the tool list read-only: an advisor that can edit
stops being an independent check.

## Tests

```bash
node --test tests/*.test.mjs
```
