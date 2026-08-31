# `.claude/` — scoped to `skills/sdd-engine` only

Minimal by intent. Three things and nothing else:

**`settings.json`** (tracked — these rules should travel with the skill, which is why this is
`settings.json` and not `settings.local.json`; the latter is for one person's uncommitted
preferences).

- **`deny`** turns the scope boundary in `../CLAUDE.md` §1 from prose into an enforced rule:
  `delonix`, `better-claude-cli-ui`, `delonix-notes` and `kraken-archive` are unreadable and
  unwritable from this project. The rules are `Read(...)` + `Edit(...)`: Claude Code's own settings
  validator rejects `Write(path)` deny rules — only `Edit(path)` is matched by file permission
  checks, and it covers every file-editing tool. Delonix was mistaken for the corpus for a long time and a stale
  pointer at it once masked a real failure as ENOENT. Prose did not prevent that; a deny rule does.
  `git commit` and `git push` are denied because Amir's standing rule is that neither happens
  without his explicit word in the moment.
- **`ask`** covers the expensive and destructive operations — a mine is tens of minutes, and
  `sdd-clean.js --wipe-sen` deletes the English tree. Both should be a deliberate yes.
- **`allow`** covers the cheap read-only loop (`npm test`, `npm run roots`, `git status`) so routine
  work is not a prompt queue.

**No hooks, no MCP config, no agents config.** Nothing here needs them, and each one would be a
second place where this project's behaviour is defined.

## CLAUDE.md is picked up automatically — not from here

`../CLAUDE.md` is discovered by directory nesting: Claude Code walks up from the working directory
and loads every `CLAUDE.md` it finds. Working anywhere at or below `skills/sdd-engine` — including
`tools/repo-dsl/`, where most work happens — loads it. It is NOT referenced from `settings.json`,
and it should not be; a path here would be a second source of truth for a thing that already works.
