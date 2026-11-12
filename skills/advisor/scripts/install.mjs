#!/usr/bin/env node
// Install the advisor subagent into a repository (or the user's Claude config).
//
//   install.mjs                    -> <git checkout root, else cwd>/.claude/agents/advisor.md
//   install.mjs --dir <repo>       -> <repo>/.claude/agents/advisor.md
//   install.mjs --user             -> <CLAUDE_CONFIG_DIR, else ~/.claude>/agents/advisor.md
//   install.mjs --model <name>     set the agent's `model:` line (default: the template's)
//   install.mjs --force            replace an advisor.md that differs
//   install.mjs --print            write nothing; print the file that would be installed
//
// Idempotent. It never overwrites a different advisor.md without --force: that file may carry
// a repository's own edits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'advisor.md');
const argv = process.argv.slice(2);
const die = (msg) => { console.error(`advisor install: ${msg}`); process.exit(2); };
let dir = null, user = false, force = false, print = false, model = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--user') user = true;
  else if (a === '--force') force = true;
  else if (a === '--print') print = true;
  else if (a === '--dir' || a === '--model') {
    if (argv[i + 1] === undefined) die(`${a} needs a value`);
    if (a === '--dir') dir = path.resolve(argv[++i]); else model = argv[++i];
  } else die(`unknown argument ${a}`);
}
if (user && dir) die('--user and --dir are two different places; pass one');
if (model !== null && !/^[A-Za-z0-9._-]+$/.test(model)) die(`not a model name: ${model}`);

let text = fs.readFileSync(TEMPLATE, 'utf8');
if (model) {
  const next = text.replace(/^model: .*$/m, `model: ${model}`);
  if (next === text && !text.includes(`model: ${model}\n`)) die('the template has no model line to set');
  text = next;
}
if (print) { process.stdout.write(text); process.exit(0); }

let base;
if (user) base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
else {
  let root = dir || process.cwd();
  if (!dir) {
    try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || root; } catch {}
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) die(`not a directory: ${root}`);
  base = path.join(root, '.claude');
}
const target = path.join(base, 'agents', 'advisor.md');
let existing = null;
try { existing = fs.readFileSync(target, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (existing === text) { console.log(`advisor already installed: ${target}`); process.exit(0); }
if (existing !== null && !force) {
  console.error(`advisor install: ${target} exists and differs; left alone. Pass --force to replace it.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, text);
console.log(`${existing === null ? 'installed' : 'replaced'}: ${target}`);
