#!/usr/bin/env node
// Prepare a release: the ONE writer of the version and of the two logs (lib/changesets.js).
//
//   release.mjs prepare --title "<one line a user would read>" [--version <x.y.z>]
//   release.mjs prepare --title "..." --branch [<name>] [--open]
//
// --branch does it all with no hand steps: fetches the integration branch, cuts <name>
// (default: config `prepBranch`) off it in its own worktree, prepares there and commits
// exactly the prep; --open also pushes it and opens the PR (needs the `gh` CLI). The
// checkout it is run from is never touched.
//
// Run it on a fresh branch off the integration branch, ONCE per release. It:
//   1. derives the next version: one patch above the highest of package.json and every
//      release tag (<tagPrefix><x.y.z>, local and on the remote), unless --version names
//      one (it must be higher);
//   2. writes it into every copy (lib/config.js versionCopies), touching no other byte;
//   3. folds every pending changeset into a new changelog section and a new release-notes
//      entry (the --title is that entry's title; it may be omitted only when no changeset
//      is user-facing);
//   4. deletes the changesets it consumed.
// Commit the result as it stands and open a PR into the integration branch: the gate
// (check-version.mjs guard) accepts it only if it is exactly what this writes.
//
// FAILS CLOSED and writes nothing when anything is wrong (a malformed changeset, a version
// not above every tag, an unreachable remote without --version).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VERSION_COPIES, parseSemver, compareSemver, lockstepMismatches } from './lib/version.js';
import { RELEASE_NOTES_FILE } from './lib/release-notes.js';
import { CHANGES_DIR, CHANGELOG_FILE, isChangeFile, prepareRelease, rewriteVersionText } from './lib/changesets.js';
import { CONFIG } from './lib/config.js';

const REMOTE = CONFIG.remote;
const BASE = CONFIG.integrationBranch;
const TAG = CONFIG.tagPrefix;

const root = process.cwd();
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1); };
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const USAGE = 'usage: release.mjs prepare --title "<title>" [--version <x.y.z>] [--branch [<name>] [--open]]';
if (args[0] !== 'prepare') fail(USAGE);

// STRICT: every token after `prepare` must be one of these flags (or the value it takes), each
// at most once. An unknown flag used to be ignored, so a typo (`--titel`, `--version=1.2.3`)
// silently produced a release that was not the one asked for. Checked before anything runs.
// The value rules mirror the reads below: --title/--version take the next token whatever it
// is (opt()); --branch takes the next token only when it does not start with `--`.
const FLAGS = { '--title': 'value', '--version': 'value', '--branch': 'optional', '--open': 'none' };
{
  const seen = new Set();
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const kind = Object.hasOwn(FLAGS, a) ? FLAGS[a] : null;
    if (!kind) fail(`${a.startsWith('-') ? 'unknown flag' : 'unexpected argument'}: ${a}\n${USAGE}`);
    if (seen.has(a)) fail(`${a} given more than once\n${USAGE}`);
    seen.add(a);
    if (kind === 'value') {
      if (i + 1 >= args.length) fail(`${a} needs a value\n${USAGE}`);
      i++;
    } else if (kind === 'optional' && args[i + 1] && !args[i + 1].startsWith('--')) i++;
  }
}

// --branch [<name>]: do the whole prep with no hand steps. Fetch the integration branch, cut a new
// branch off it in its own worktree (<main checkout>/<worktreesDir>/<name>, so the checkout this is
// run from is never touched), prepare there, and commit exactly the prep. --open then pushes the
// branch and opens its PR into the integration branch. The prep itself is the same code path as a plain
// `prepare` (this script re-runs itself in the new worktree), so the gate sees the same output.
if (args.includes('--branch')) {
  const at = args.indexOf('--branch');
  const named = args[at + 1] && !args[at + 1].startsWith('--');
  const branch = named ? args[at + 1] : CONFIG.prepBranch;
  if (!BASE) fail('no integration branch is known: set "integrationBranch" in .version-gate.json (or VERSION_GATE_BRANCH)');
  const open = args.includes('--open');
  const rest = args.filter((a, i) => i !== at && !(named && i === at + 1) && a !== '--open');
  const sh = (cmd, a, cwd = root) => execFileSync(cmd, a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const why = (e) => String(e.stderr || e.message).trim();
  try { sh('git', ['check-ref-format', '--branch', branch]); } catch { fail(`not a valid branch name: ${branch}`); }
  // A full fetch, never --depth: a depth-limited fetch makes the whole shared repo shallow.
  try { sh('git', ['fetch', '--no-tags', REMOTE, `+refs/heads/${BASE}:refs/remotes/${REMOTE}/${BASE}`]); }
  catch (e) { fail(`cannot fetch ${BASE} from ${REMOTE}: ${why(e)}`); }
  let exists = false;
  try { sh('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); exists = true; } catch {}
  if (exists) fail(`branch ${branch} already exists locally; name another with --branch <name>`);
  let onOrigin = '';
  try { onOrigin = sh('git', ['ls-remote', '--heads', REMOTE, branch]).trim(); }
  catch (e) { fail(`cannot list ${REMOTE}'s branches: ${why(e)}`); }
  if (onOrigin) fail(`branch ${branch} already exists on ${REMOTE}; name another with --branch <name>`);
  const common = path.resolve(root, sh('git', ['rev-parse', '--git-common-dir']).trim());
  const dir = path.join(path.dirname(common), CONFIG.worktreesDir, branch);
  if (fs.existsSync(dir)) fail(`${dir} already exists`);
  // --no-track: a branch cut from the remote's integration branch would otherwise take it as its upstream,
  // and a bare `git push` from the new worktree would aim at the protected base.
  try { sh('git', ['worktree', 'add', '--no-track', '-b', branch, dir, `${REMOTE}/${BASE}`]); }
  catch (e) { fail(`cannot create the worktree: ${why(e)}`); }
  const undo = () => {
    try { sh('git', ['worktree', 'remove', '--force', dir]); } catch {}
    try { sh('git', ['branch', '-D', branch]); } catch {}
  };
  let out;
  try { out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...rest], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { undo(); fail(`prepare failed in ${dir}; removed it again.\n${String(e.stderr || e.stdout || e.message).trim()}`); }
  process.stdout.write(out);
  const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  // Stage by path: the version copies, the two logs and the changesets dir (deletions included).
  const paths = [...VERSION_COPIES.map(c => c.file), RELEASE_NOTES_FILE, CHANGELOG_FILE, CHANGES_DIR];
  try {
    sh('git', ['add', '-A', '--', ...paths], dir);
    sh('git', ['commit', '-q', '-m', `Prepare release ${version}`], dir);
  } catch (e) { undo(); fail(`cannot commit the prep; removed the worktree again: ${why(e)}`); }
  const leftover = sh('git', ['status', '--porcelain'], dir).trim();
  if (leftover) fail(`prep committed on ${branch}, but ${dir} still has changes the prep did not make:\n${leftover}`);
  console.log(`committed "Prepare release ${version}" on ${branch} in ${dir}`);
  if (!open) {
    console.log(`next: release.mjs ... --open does this for you, or by hand:\n  git -C ${dir} push ${REMOTE} ${branch}\n  gh pr create --base ${BASE} --head ${branch} --title "Prepare release ${version}"`);
    process.exit(0);
  }
  try { sh('git', ['push', REMOTE, `refs/heads/${branch}:refs/heads/${branch}`], dir); }
  catch (e) { fail(`committed on ${branch}, but the push failed: ${why(e)}`); }
  const body = `Release prep for ${version}, written by \`release.mjs prepare --branch\`: the version `
    + `copies, ${CHANGELOG_FILE} and ${RELEASE_NOTES_FILE}, and the changesets it folded in. No code changes.`
    + (CONFIG.releaseBranch ? ` Merge it, then the ${BASE} -> ${CONFIG.releaseBranch} release PR.` : '');
  try { process.stdout.write(sh('gh', ['pr', 'create', '--base', BASE, '--head', branch, '--title', `Prepare release ${version}`, '--body', body], dir)); }
  catch (e) { fail(`pushed ${branch}, but opening the PR failed: ${why(e)}`); }
  process.exit(0);
}

// LF, as the guard reads it (check-version.mjs readSide); git restores a Windows checkout's CRLF.
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const texts = Object.fromEntries(VERSION_COPIES.map(c => [c.file, read(c.file)]));
const docs = Object.fromEntries(Object.entries(texts).map(([f, t]) => [f, JSON.parse(t)]));
const bad = lockstepMismatches(docs);
if (bad.length) fail(`version copies disagree before preparing: ${bad.map(b => b.where).join(', ')}`);
const current = docs['package.json'].version;

// Every release tag the release could collide with. The remote is authoritative; a local tag
// list alone can be stale, so an unreachable remote fails unless --version is given.
const tagVersions = (out) => out.split('\n').map(l => l.trim().split('refs/tags/').pop()).filter(Boolean)
  .map(t => t.replace(/\^\{\}$/, '')).filter(t => t.startsWith(TAG)).map(t => t.slice(TAG.length)).filter(parseSemver);
let tags = [];
try { tags.push(...tagVersions(execFileSync('git', ['tag', '-l', `${TAG}*`], { cwd: root, encoding: 'utf8' }))); } catch {}
let remoteOk = true;
try { tags.push(...tagVersions(execFileSync('git', ['ls-remote', '--tags', REMOTE, `${TAG}*`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))); }
catch { remoteOk = false; }
const highest = [current, ...tags].sort(compareSemver).pop();

let version = opt('--version');
if (version === undefined) {
  if (!remoteOk) fail(`cannot list ${TAG}* tags on ${REMOTE}; pass --version <x.y.z> above every tag`);
  const p = parseSemver(highest);
  version = `${p.major}.${p.minor}.${p.patch + 1}`;
}
if (!parseSemver(version)) fail(`not a semver version: ${version}`);
if (compareSemver(version, highest) <= 0) fail(`${version} is not above ${highest} (package.json ${current}, highest ${TAG}* tag ${tags.sort(compareSemver).pop() || 'none'})`);

let names = [];
try { names = fs.readdirSync(path.join(root, CHANGES_DIR)).map(n => `${CHANGES_DIR}/${n}`).filter(isChangeFile).sort(); } catch {}
const changes = Object.fromEntries(names.map(n => [n, read(n)]));
const plan = prepareRelease({
  version, title: opt('--title'),
  notes: JSON.parse(read(RELEASE_NOTES_FILE)), changelog: read(CHANGELOG_FILE), changes,
});
if (plan.errors.length) fail(`nothing written:\n  ${plan.errors.join('\n  ')}`);

const next = Object.fromEntries(Object.entries(texts).map(([f, t]) => [f, rewriteVersionText(f, t, current, version)]));
for (const [f, t] of Object.entries(next)) fs.writeFileSync(path.join(root, f), t);
fs.writeFileSync(path.join(root, RELEASE_NOTES_FILE), plan.notesText);
fs.writeFileSync(path.join(root, CHANGELOG_FILE), plan.changelog);
for (const n of plan.consumed) fs.rmSync(path.join(root, n));

console.log(`prepared ${current} -> ${version}: ${plan.consumed.length} changeset(s) folded into ${CHANGELOG_FILE} and ${RELEASE_NOTES_FILE}`);
console.log(plan.entry.noUserFacingChanges ? '  release note: no user-facing changes' : `  release note: "${plan.entry.title}" (${plan.entry.changes.length} change(s))`);
console.log(`next: commit exactly this and open a PR into ${BASE || 'the integration branch'}.`);
