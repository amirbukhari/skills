#!/usr/bin/env node
// The version gate (lib/version.js for the version rules, lib/changesets.js for why feature
// branches never touch the version or the logs, lib/config.js for the repository's settings).
//
//   check-version.mjs lockstep
//       every copy of the version agrees with the root package.json
//   check-version.mjs notes
//       the release-notes file is valid (shape, order, no commit-speak)
//   check-version.mjs guard <base-ref> [<head-ref>]
//       the diff base -> head (default: the working tree) moves no version field, no
//       changelog entry and no release note, and adds a valid changeset; OR it is exactly
//       the release prep `release.mjs prepare` writes from <base-ref>.
//       Run it before pushing: `check-version.mjs guard <remote>/<integration-branch>`.
//   check-version.mjs gate
//       what CI runs: decides from GATE_EVENT / GATE_BASE / GATE_REF / GATE_BEFORE
//       (lib/version.js gatePlan) whether this event is gated, fetches the commit to
//       compare against from the remote, and applies `guard`. A PR into the integration
//       branch compares against its tip; a PUSH to it against the commit it replaced. A PR
//       into the release branch fails while any changeset is still pending: the release it
//       tags would ship without those notes, so prepare the release first.
//
// Runs against the current directory's repo. FAILS CLOSED: an unreadable file, a
// ref git cannot resolve, or an unparsable version is exit 1, never a pass.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { VERSION_COPIES, lockstepMismatches, gatePlan } from './lib/version.js';
import { RELEASE_NOTES_FILE, validateReleaseNotes } from './lib/release-notes.js';
import { CHANGES_DIR, CHANGELOG_FILE, isChangeFile, releaseGuard } from './lib/changesets.js';
import { CONFIG } from './lib/config.js';

const [cmd, ref, headRef] = process.argv.slice(2);
const root = process.cwd();
const fail = msg => { console.error(`::error::${msg}`); process.exit(1); };
// Line endings are normalized on BOTH sides: a Windows checkout (core.autocrlf, the
// windows-latest runner) has CRLF in the working tree where `git show` gives LF, and the
// guard compares bytes — un-normalized, every PR failed there.
const lf = (text) => (text === null ? null : text.replace(/\r\n/g, '\n'));
const gitOut = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (e) { return fail(`cannot read ${file}: ${e.message}`); }
}

if (cmd === 'lockstep') {
  const docs = Object.fromEntries(VERSION_COPIES.map(c => [c.file, readJson(c.file)]));
  const bad = lockstepMismatches(docs);
  if (bad.length) {
    fail('version copies disagree with package.json:\n' + bad.map(b =>
      `  ${b.where}: found ${JSON.stringify(b.found)}, expected ${JSON.stringify(b.expected)}`).join('\n'));
  }
  console.log(`version lockstep ok: ${docs['package.json'].version} in all ${VERSION_COPIES.length} files`);
} else if (cmd === 'notes') {
  const errors = validateReleaseNotes(readJson(RELEASE_NOTES_FILE));
  if (errors.length) fail(`${RELEASE_NOTES_FILE} is invalid:\n  ${errors.join('\n  ')}`);
  console.log(`release notes ok: ${RELEASE_NOTES_FILE} is valid`);
} else if (cmd === 'guard') {
  if (!ref) fail('usage: check-version.mjs guard <base-ref> [<head-ref>]');
  guard(ref, headRef || null);
} else if (cmd === 'gate') {
  const plan = gatePlan({
    event: process.env.GATE_EVENT, baseBranch: process.env.GATE_BASE,
    refName: process.env.GATE_REF, before: process.env.GATE_BEFORE,
  });
  if (plan.mode === 'skip') { console.log(`version gate not enforced: ${plan.reason}`); process.exit(0); }
  if (plan.mode === 'error') fail(plan.reason);
  if (plan.mode === 'release-pr') {
    const pending = Object.keys(readSide(null).changes);
    if (pending.length) {
      fail(`a PR into ${plan.baseBranch} releases what it carries, and ${pending.length} changeset(s) are still pending `
        + `(${pending.join(', ')}). Their notes would ship nowhere: run "release.mjs prepare --title ..." `
        + `on a branch off ${CONFIG.integrationBranch}, merge that PR, then this one.`);
    }
    console.log(`release PR into ${plan.baseBranch}: no pending changesets`);
    process.exit(0);
  }
  // Shallow CI checkouts have neither ref locally, so fetch exactly the one commit.
  // Fetching by SHA works against GitHub; a failed fetch is a red step, not a pass.
  // --depth=1 ONLY in a checkout that is already shallow. Run by hand in a full one (people
  // imitate this CI step locally), a depth-limited fetch makes the WHOLE repo shallow — the
  // shallow file is shared by every worktree — and hides history from every ancestry check
  // after it.
  const what = plan.mode === 'pr' ? `+refs/heads/${plan.baseBranch}` : plan.before;
  let shallow = true;
  try {
    shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() !== 'false';
  } catch {}
  try {
    execFileSync('git', ['fetch', '--no-tags', ...(shallow ? ['--depth=1'] : []), CONFIG.remote, what], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    fail(`cannot fetch ${what} from ${CONFIG.remote}: ${String(e.stderr || e.message).trim()}`);
  }
  console.log(plan.mode === 'pr'
    ? `enforcing: PR into ${plan.baseBranch}, comparing against its tip`
    : `enforcing: push to ${CONFIG.integrationBranch}, comparing against the replaced commit ${plan.before}`);
  guard('FETCH_HEAD', null);
} else {
  fail('usage: check-version.mjs lockstep | notes | guard <base-ref> [<head-ref>] | gate');
}

// One side of a diff, as lib/changesets.js releaseGuard reads it. `ref` null = the working tree.
function readSide(ref) {
  const read = (file) => {
    if (ref === null) {
      try { return lf(fs.readFileSync(path.join(root, file), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    }
    try { return lf(gitOut(['show', `${ref}:${file}`])); } catch { return null; }
  };
  const json = (file) => {
    const text = read(file);
    if (text === null) return fail(`cannot read ${file} at ${ref ?? 'the working tree'}`);
    try { return JSON.parse(text); } catch (e) { return fail(`${file} at ${ref ?? 'the working tree'} is not JSON: ${e.message}`); }
  };
  let names;
  if (ref === null) {
    let ls = [];
    try { ls = fs.readdirSync(path.join(root, CHANGES_DIR)); } catch {}
    names = ls.map(n => `${CHANGES_DIR}/${n}`);
  } else {
    names = gitOut(['ls-tree', '-r', '--name-only', ref, '--', `${CHANGES_DIR}/`]).split('\n').filter(Boolean);
  }
  const changes = {};
  for (const n of names.filter(isChangeFile).sort()) changes[n] = read(n);
  return {
    docs: Object.fromEntries(VERSION_COPIES.map(c => [c.file, json(c.file)])),
    changelog: read(CHANGELOG_FILE),
    notesText: read(RELEASE_NOTES_FILE),
    changes,
  };
}

function guard(baseRef, head) {
  try { gitOut(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]); }
  catch { fail(`cannot resolve ${baseRef}`); }
  if (head !== null) {
    try { gitOut(['rev-parse', '--verify', '--quiet', `${head}^{commit}`]); }
    catch { fail(`cannot resolve ${head}`); }
  }
  const changed = gitOut(['diff', '--name-only', baseRef, ...(head ? [head] : [])]).split('\n').filter(Boolean);
  const v = releaseGuard({ base: readSide(baseRef), head: readSide(head), changed });
  if (!v.ok) fail(`version/changelog guard (${v.kind}):\n  ${v.errors.join('\n  ')}`);
  for (const n of v.notes) console.log(`guard ok (${v.kind}): ${n}`);
}
