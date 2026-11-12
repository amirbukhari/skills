#!/usr/bin/env node
// Wire git-guard into a Claude Code settings file.
//
//   node install.mjs                         <cwd>/.claude/settings.json
//   node install.mjs --settings <file>       any settings file (user, project or local)
//   node install.mjs --node <path>           the node binary the hook runs with (default: this one)
//   node install.mjs --print                 print the result, write nothing
//
// Idempotent: running it twice leaves one group. Every other key and hook is kept. A settings
// file that exists but is not JSON is refused, never overwritten.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withGitGuard } from './lib/git-guard.mjs';

const argv = process.argv.slice(2);
const val = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const file = path.resolve(val('--settings') || path.join(process.cwd(), '.claude', 'settings.json'));
const nodeCmd = val('--node') || process.execPath;
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'git-guard-hook.mjs');

let current = {};
if (fs.existsSync(file)) {
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    console.error(`git-guard: ${file} is not valid JSON (${e.message}); nothing written`);
    process.exit(1);
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    console.error(`git-guard: ${file} is not a JSON object; nothing written`);
    process.exit(1);
  }
}
const next = JSON.stringify(withGitGuard(current, nodeCmd, script), null, 2) + '\n';
if (argv.includes('--print')) { process.stdout.write(next); process.exit(0); }
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, next);
console.log(`git-guard: wired into ${file}`);
