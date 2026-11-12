#!/usr/bin/env node
// PreToolUse hook (matcher: Bash) — see lib/git-guard.mjs for what it refuses and why. Reads the
// hook event on stdin; prints a deny decision for a banned git form, and nothing at all
// otherwise. Local and synchronous: it costs a node start per Bash call and nothing more.
// GIT_GUARD_ALLOW=<rule>[,<rule>] switches named rules off (e.g. "git stash,git clean").
// Fails open: input it cannot read is let through (lib/git-guard.mjs says why).
import { gitBanVerdict, denyReason, allowedRules } from './lib/git-guard.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => {
  let event;
  try { event = JSON.parse(raw || '{}'); } catch { process.exit(0); }
  if (!event || event.tool_name !== 'Bash') process.exit(0);
  const v = gitBanVerdict(event.tool_input && event.tool_input.command, { allow: allowedRules(process.env.GIT_GUARD_ALLOW) });
  if (!v.blocked) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denyReason(v),
    },
  }));
  process.exit(0);
});
