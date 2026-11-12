#!/usr/bin/env node
// Compare a repository's live branch protection with a checked-in JSON file, and (with
// --apply, as a repo admin) set the one field the file manages: `strict`, "Require branches to
// be up to date before merging". Rules and the reason only `strict` is written: lib/branch-protection.js.
//
//   branch-protection.mjs                  read-only: prints want / have per field
//   branch-protection.mjs --apply          PATCHes `strict` only; refuses without admin
//   branch-protection.mjs --config <file>  default: <checkout root>/.github/branch-protection.json
//   branch-protection.mjs --repo <owner/name>   default: "repo" in the file, else `gh repo view`
//
// The file: { "repo"?: "owner/name", "branches": { "<branch>": { "required_status_checks":
//   { "strict": false, "checks": [{ "context": "...", "app_id": 15368 }] } } } }
//
// Reads go through `gh api`, so it runs as whoever `gh` is logged in as. Without admin the
// protection endpoints 404 and `strict` prints as "unknown (needs admin)": that is the
// expected answer for a non-admin, not an error.
//
// BRANCH_PROTECTION_GH: a node script to run in place of `gh` (the test seam).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planBranch, applyDecision } from './lib/branch-protection.js';

const argv = process.argv.slice(2);
const die = msg => { console.error(`branch-protection: ${msg}`); process.exit(2); };
let apply = false, configPath = null, repoArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--apply') apply = true;
  else if (argv[i] === '--config' || argv[i] === '--repo') {
    if (argv[i + 1] === undefined) die(`${argv[i]} needs a value`);
    if (argv[i] === '--config') configPath = path.resolve(argv[++i]); else repoArg = argv[++i];
  } else die(`unknown argument ${argv[i]}`);
}
if (!configPath) {
  let root = process.cwd();
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || root; } catch {}
  configPath = path.join(root, '.github', 'branch-protection.json');
}

function gh(args, input) {
  const [cmd, argv] = process.env.BRANCH_PROTECTION_GH
    ? [process.execPath, [process.env.BRANCH_PROTECTION_GH, ...args]]
    : ['gh', args];
  return execFileSync(cmd, argv, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
}
const tryJson = args => { try { return JSON.parse(gh(args)); } catch { return null; } };

let config;
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { die(`cannot read ${configPath}: ${e.message}`); }
const branches = config?.branches;
if (!branches || typeof branches !== 'object' || !Object.keys(branches).length) die(`${configPath} names no branches`);
// The repository is never guessed: the flag, the file, or what `gh` says this checkout is.
let repo = repoArg || config.repo || null;
if (!repo) { try { repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']).trim(); } catch {} }
if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) die('cannot tell which repository: pass --repo <owner/name> or set "repo" in the file');
const admin = tryJson(['api', `repos/${repo}`])?.permissions?.admin ?? null;
console.log(`${repo}: this account is ${admin === true ? 'an admin' : admin === false ? 'NOT an admin' : 'of unknown permission'}`);

let failed = false;
for (const [branch, desired] of Object.entries(branches)) {
  const visible = tryJson(['api', `repos/${repo}/branches/${branch}`])?.protection?.required_status_checks;
  const rsc = tryJson(['api', `repos/${repo}/branches/${branch}/protection/required_status_checks`]);
  const observed = {
    checks: visible?.checks ?? rsc?.checks ?? null,
    strict: typeof rsc?.strict === 'boolean' ? rsc.strict : null,
  };
  const { rows, patch } = planBranch(desired, observed);
  console.log(`\n${branch}`);
  for (const r of rows) {
    const have = r.have === null ? 'unknown (needs admin)' : JSON.stringify(r.have);
    console.log(`  ${r.status.padEnd(7)} ${r.field}${r.managed ? '' : ' (recorded, never written)'}\n          want ${JSON.stringify(r.want)}\n          have ${have}`);
  }
  if (!apply) { if (patch) console.log(`  --apply would PATCH required_status_checks ${JSON.stringify(patch)}`); continue; }

  const d = applyDecision({ patch, admin });
  if (!d.write) {
    console.log(`  ${d.refuse ? 'REFUSED' : 'skip'}: ${d.reason}`);
    if (d.refuse) failed = true;
    continue;
  }
  try {
    gh(['api', '-X', 'PATCH', `repos/${repo}/branches/${branch}/protection/required_status_checks`, '--input', '-'], JSON.stringify(patch));
    const after = tryJson(['api', `repos/${repo}/branches/${branch}/protection/required_status_checks`]);
    console.log(`  applied: strict is now ${JSON.stringify(after?.strict ?? null)}`);
    if (after?.strict !== patch.strict) failed = true;
  } catch (e) {
    console.log(`  FAILED: ${String(e.stderr || e.message).trim()}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
