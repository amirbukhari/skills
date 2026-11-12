// Where a repository tells the version gate about itself: `.version-gate.json` at the
// repository root (the directory the tools are run from). Every key is optional.
//
//   {
//     "integrationBranch": "<branch feature PRs merge into>",
//     "releaseBranch":     "<branch a release is cut from>",   // omit for a one-branch flow
//     "remote":            "origin",
//     "tagPrefix":         "v",                                // release tags are <prefix><x.y.z>
//     "versionCopies":     ["package-lock.json", "apps/desktop/package.json"],
//     "changesDir":        ".changes",
//     "changelog":         "CHANGELOG.md",
//     "releaseNotes":      "release-notes.json",
//     "prepBranch":        "release-prep",
//     "worktreesDir":      ".worktrees"
//   }
//
// With no `integrationBranch` (and no VERSION_GATE_BRANCH in the environment) it is the
// remote's default branch as recorded in refs/remotes/<remote>/HEAD. With none of the three
// there is NO integration branch and the gate fails closed: it never guesses a name.
//
// `versionCopies` lists every file besides package.json that carries the version. An entry is
// a path (a lockfile gets `version` and `packages[""].version`, anything else `version`) or
// `{ "file", "fields": [["path","to","field"], ...] }`. Left out, it is package-lock.json
// when that file exists.
//
// FAILS CLOSED: a config file that is not JSON, or that carries an unknown key, throws.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const CONFIG_FILE = '.version-gate.json';
export const SOURCE_FILE = 'package.json';
const KEYS = ['integrationBranch', 'releaseBranch', 'remote', 'tagPrefix', 'versionCopies', 'changesDir', 'changelog', 'releaseNotes', 'prepBranch', 'worktreesDir'];
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json']);

function copySpec(entry) {
  if (typeof entry === 'string') {
    return { file: entry, fields: LOCKFILES.has(path.posix.basename(entry)) ? [['version'], ['packages', '', 'version']] : [['version']] };
  }
  if (entry && typeof entry.file === 'string' && Array.isArray(entry.fields) && entry.fields.length
    && entry.fields.every(f => Array.isArray(f) && f.length && f.every(k => typeof k === 'string'))) {
    return { file: entry.file, fields: entry.fields };
  }
  throw new Error(`${CONFIG_FILE}: a versionCopies entry is a path or { "file", "fields": [[...]] }, got ${JSON.stringify(entry)}`);
}

function remoteDefaultBranch(root, remote) {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const prefix = `refs/remotes/${remote}/`;
    return ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
  } catch { return null; }
}

export function loadConfig(root = process.cwd(), env = process.env) {
  let raw = {};
  let text = null;
  try { text = fs.readFileSync(path.join(root, CONFIG_FILE), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (text !== null) {
    try { raw = JSON.parse(text); } catch (e) { throw new Error(`${CONFIG_FILE} is not JSON: ${e.message}`); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} must be a JSON object`);
    for (const k of Object.keys(raw)) if (!KEYS.includes(k)) throw new Error(`${CONFIG_FILE}: unknown key "${k}" (known: ${KEYS.join(', ')})`);
  }
  const str = (k, dflt) => {
    if (raw[k] === undefined || raw[k] === null) return dflt;
    if (typeof raw[k] !== 'string' || !raw[k].trim()) throw new Error(`${CONFIG_FILE}: "${k}" must be a non-empty string`);
    return raw[k].trim();
  };
  const remote = str('remote', 'origin');
  let copies;
  if (raw.versionCopies === undefined) {
    copies = fs.existsSync(path.join(root, 'package-lock.json')) ? ['package-lock.json'] : [];
  } else {
    if (!Array.isArray(raw.versionCopies)) throw new Error(`${CONFIG_FILE}: "versionCopies" must be a list`);
    copies = raw.versionCopies;
  }
  const versionCopies = [copySpec(SOURCE_FILE), ...copies.map(copySpec).filter(c => c.file !== SOURCE_FILE)];
  const integrationBranch = String(env.VERSION_GATE_BRANCH || '').trim() || str('integrationBranch', null) || remoteDefaultBranch(root, remote);
  return {
    integrationBranch,
    releaseBranch: str('releaseBranch', null),
    remote,
    tagPrefix: str('tagPrefix', 'v'),
    versionCopies,
    changesDir: str('changesDir', '.changes').replace(/\/+$/, ''),
    changelog: str('changelog', 'CHANGELOG.md'),
    releaseNotes: str('releaseNotes', 'release-notes.json'),
    prepBranch: str('prepBranch', 'release-prep'),
    worktreesDir: str('worktreesDir', '.worktrees'),
  };
}

export const CONFIG = loadConfig();
