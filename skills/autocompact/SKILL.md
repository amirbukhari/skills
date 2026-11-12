---
name: autocompact
description: View or change Claude Code's auto-compaction setting (autoCompactWindow / autoCompactEnabled) for the active account. Use when the user runs /autocompact, or asks to set/change/show their autocompact, auto-compact, compaction window or threshold (e.g. "/autocompact 400k", "set autocompact to 25%", "turn auto-compaction off", "what's my autocompact set to"), or when a SessionStart [autocompact] note asks whether they want to adjust it.
---

# Autocompact

Sets `autoCompactWindow` (and toggles `autoCompactEnabled`) in the **active
account's** `settings.json`, via the `autocompact.sh` helper. `autoCompactWindow`
is the token count at which Claude Code compacts the conversation — effectively
the working context window before compression. It is an integer clamped to
**[100000, 1000000]** and does **not** hot-reload: changes take effect in **new
sessions**. State is per-account: the active account is whichever config directory
`$CLAUDE_CONFIG_DIR` points at (default `~/.claude`), so separate accounts keep
independent values.

## No arguments → describe, don't change

If invoked with **no arguments**, don't change anything. Reply with a short
summary:

> **`/autocompact`** controls when Claude Code compacts the conversation (the
> working context window). You can:
> - **Set a size:** `/autocompact 400k` (also `400000`, `0.5m`, `1m`)
> - **Set a percentage:** `/autocompact 25%` — of your current model's context window
> - **Disable / enable:** `/autocompact off` / `/autocompact on`
> - **Check it:** `/autocompact status`
>
> Range is 100k–1m; changes apply to new sessions. Targets your active account.

## How to run it

`autocompact.sh` ships beside this `SKILL.md`. Run it from this skill's own
directory — the base directory Claude Code reports when the skill loads —
wherever the skill is installed (user config dir, a project's `.claude/skills/`,
or a plugin). Never assume an install path. The helper needs `jq`. It reads
`$CLAUDE_CONFIG_DIR` from the session, so it always targets the active account.
Report the result:

```bash
"<skill-dir>/autocompact.sh" <args>
```

## Mapping requests to commands

| User intent | command |
| --- | --- |
| Show current value | `autocompact.sh status` |
| Set absolute size | `autocompact.sh 400k` (or `400000` / `0.5m` / `1m`) |
| Set a percentage | `autocompact.sh 25% --window <live-window>` (see below) |
| Disable auto-compaction | `autocompact.sh off` |
| Enable auto-compaction | `autocompact.sh on` |
| (no arguments) | show the summary above; change nothing |

## Percentages: resolve the window yourself

The helper cannot see the live context-window size, so you must supply it for
a percentage. Determine the active model's context-window size and pass it via
`--window`:

- Prefer a value you've actually observed this session (e.g. the `/context`
  readout, or the status line's used/window figure — the denominator).
- Otherwise use the model's known window (most current Claude models are 200000;
  with the 1M-context beta active it is 1000000).
- If you genuinely can't determine it, ask the user rather than guessing.

Example: user says `/autocompact 40%` and the window is 1,000,000 →
`autocompact.sh 40% --window 1000000` (sets 400000). The helper clamps the result
to [100000, 1000000] and tells you if it clamped.

## Responding to the session-start check-in

This part is optional and applies only if the user has set up a SessionStart hook
that injects an `[autocompact] ...` note (typically when no value is set yet, or
the model changed since last session). When you see such a note,
ask the user — briefly, in one sentence — whether they'd like to adjust their
autocompact window, mentioning the current value from the note. If they say yes,
run the helper. If they decline or don't engage, drop it. Never block their real
request on this.

## After running

State the result in one line (e.g. "autoCompactWindow → 400000 (applies to new
sessions)"). Remind the user it takes effect in new sessions only, and that it
changed the active account only (if the user runs more than one config
directory, offer to mirror it — `settings.json` is per-account).

## Instant, zero-token path

For a change without spending a model turn, the user can run the helper directly
at the prompt with `!`:

```
!<skill-dir>/autocompact.sh 400k
```

Give them the resolved absolute path of the helper, not the placeholder.

(At the `!` prompt it inherits the session's `$CLAUDE_CONFIG_DIR`, so it targets
the right account.) Mention this only if relevant.
