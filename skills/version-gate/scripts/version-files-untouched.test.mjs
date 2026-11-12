// A suite test to copy next to the tools: THIS checkout's branch leaves the version and the
// two logs alone and carries a changeset. It is the local half of the gate, so the suite
// goes red on a branch that would conflict with every other open PR before anyone pushes it.
//
// The diff judged is merge-base(<remote>/<integration branch>, HEAD) -> the working tree:
// exactly this branch's own work, whatever it has merged in. VERSION_GUARD_BASE /
// VERSION_GUARD_HEAD name other refs, to judge a branch other than the one checked out.
//
// SKIPS (and says so) where the integration branch is not there to compare against, such as
// a depth-1 CI checkout. CI runs `check-version.mjs gate` as its own step instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG } from './lib/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.cwd();
const git = (...a) => spawnSync('git', a, { cwd: REPO, encoding: 'utf8' });

function baseRef() {
  if (process.env.VERSION_GUARD_BASE) return { ref: process.env.VERSION_GUARD_BASE };
  if (!CONFIG.integrationBranch) return { skip: 'no integration branch is configured or discoverable (.version-gate.json)' };
  const tip = `${CONFIG.remote}/${CONFIG.integrationBranch}`;
  if (git('rev-parse', '--verify', '--quiet', `${tip}^{commit}`).status !== 0) {
    return { skip: `${tip} is not in this checkout (a shallow CI clone) — the gate step guards CI` };
  }
  const head = process.env.VERSION_GUARD_HEAD || 'HEAD';
  const mb = git('merge-base', tip, head);
  if (mb.status !== 0) return { skip: `no merge base between ${tip} and ${head} (shallow history?)` };
  return { ref: mb.stdout.trim(), tip };
}

test('this branch edits no version field, no changelog entry and no release note, and adds a changeset', (t) => {
  const base = baseRef();
  if (base.skip) { t.skip(base.skip); return; }
  const args = [path.join(HERE, 'check-version.mjs'), 'guard', base.ref];
  if (process.env.VERSION_GUARD_HEAD) args.push(process.env.VERSION_GUARD_HEAD);
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stderr}\n(judged ${base.ref} -> ${process.env.VERSION_GUARD_HEAD || 'the working tree'}; if ${base.tip || 'the base'} is stale, fetch it first)`);
});
