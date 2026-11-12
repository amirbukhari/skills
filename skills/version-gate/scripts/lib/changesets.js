// Changesets: how a change is recorded WITHOUT touching a file another branch touches.
//
// THE PROBLEM THIS SOLVES. When every PR raises the version and adds its own entry at the
// top of the changelog and the release notes, any two open PRs edit the same lines, so
// merging one puts a conflict on every other, whatever the merge order. Stacking the PRs
// only moves that conflict into a rebase chain.
//
// THE ARRANGEMENT:
//
//   a feature PR      adds ONE NEW FILE, `<changesDir>/<unique-name>.md`, and touches no
//                     version field, no changelog entry and no release note. Two PRs adding
//                     two different new files cannot conflict.
//   a release prep    `release.mjs prepare --title "..."`, run ONCE per release on its own
//                     PR into the integration branch. It derives the next version (above
//                     package.json AND every release tag), writes it into every copy, folds
//                     every pending changeset into a new changelog section and a new
//                     release-notes entry, and deletes the files it consumed.
//
// THE GUARD (releaseGuard below, run by check-version.mjs `gate` in CI and `guard` locally):
// a diff that moves a version field, the changelog's log or the release notes is legal ONLY
// if it is byte-for-byte what `prepare` produces from the base. Anything else (a hand bump,
// a hand-written changelog entry) fails, and the message says to write a changeset instead.
//
// A CHANGESET FILE:
//
//   ---
//   what: Schedules rows open to show the whole wake prompt.
//   why: You can read exactly what a schedule will do before it runs.
//   ---
//   - **Schedules rows open to the full wake prompt** (`cardSchedules`).
//
// `what`/`why` become one change in the customer-facing release note (written for someone who
// has never seen this codebase, linted exactly like the release notes, release-notes.js).
// A change no user would notice says `noUserFacingChanges: true` instead. The body
// is the engineering changelog text, PR numbers and identifiers welcome.
//
// No git here: check-version.mjs and release.mjs do the reading.

import { VERSION_COPIES, parseSemver, lockstepMismatches, bumpVerdict } from './version.js';
import { RELEASE_NOTES_FILE, validateReleaseNotes } from './release-notes.js';
import { CONFIG } from './config.js';

export const CHANGES_DIR = CONFIG.changesDir;
export const CHANGELOG_FILE = CONFIG.changelog;
// Every file a feature branch must leave alone (the version FIELDS, for the package files:
// a dependency change to a lockfile is fine).
export const GUARDED_FILES = [...VERSION_COPIES.map(c => c.file), CHANGELOG_FILE, RELEASE_NOTES_FILE];

// `<changesDir>/<name>.md`, directly in the directory. README.md there is documentation.
export function isChangeFile(p) {
  if (typeof p !== 'string' || !p.startsWith(`${CHANGES_DIR}/`)) return false;
  const name = p.slice(CHANGES_DIR.length + 1);
  return /^[^/]+\.md$/.test(name) && name !== 'README.md';
}

// { what, why, noUserFacingChanges, body } plus `errors` (empty = valid). `name` only labels
// the messages.
export function parseChange(name, text) {
  const errors = [];
  const out = { name, what: null, why: null, noUserFacingChanges: false, body: '', errors };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(text ?? ''));
  if (!m) {
    errors.push(`${name}: must start with a "---" block holding "what:" and "why:" (or "noUserFacingChanges: true"), closed by "---"`);
    return out;
  }
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) { errors.push(`${name}: cannot read the line ${JSON.stringify(line)} — each line is "key: value"`); continue; }
    const [, k, v] = kv;
    if (k === 'what') out.what = v.trim();
    else if (k === 'why') out.why = v.trim();
    else if (k === 'noUserFacingChanges') {
      if (v.trim() !== 'true') errors.push(`${name}: "noUserFacingChanges" may only be true (omit it otherwise)`);
      else out.noUserFacingChanges = true;
    } else errors.push(`${name}: unknown key "${k}" — only what, why and noUserFacingChanges`);
  }
  out.body = m[2].trim();
  if (!out.body) errors.push(`${name}: needs a body under the "---" block — the engineering changelog text for this change`);
  if (out.noUserFacingChanges) {
    if (out.what !== null || out.why !== null) errors.push(`${name}: a change marked noUserFacingChanges must not also give "what"/"why"`);
    return out;
  }
  if (!out.what || !out.why) {
    errors.push(`${name}: needs "what:" (what changed, as a user would notice it) and "why:" (why they'd care) — or "noUserFacingChanges: true"`);
    return out;
  }
  // The SAME rules release-notes.json is held to, so bad prose fails on the PR that wrote it,
  // not months later on the release that collects it.
  const probe = validateReleaseNotes({ releases: [{ version: '0.0.0', title: 'Probe', changes: [{ what: out.what, why: out.why }] }] });
  for (const e of probe) errors.push(`${name}: ${e.replace(/^releases\[0\] \(0\.0\.0\) changes\[0\]:?\s*/, '')}`);
  return out;
}

// The release-notes.json entry a set of changesets makes. Filename order, so it is
// deterministic — the guard re-derives it and compares.
export function releaseEntry(version, title, parsed) {
  const changes = parsed.filter(c => !c.noUserFacingChanges).map(c => ({ what: c.what, why: c.why }));
  if (!changes.length) return title ? { version, title, noUserFacingChanges: true } : { version, noUserFacingChanges: true };
  return { version, title, changes };
}

const byName = changes => Object.keys(changes).sort().map(name => ({ name, text: changes[name] }));

export function changelogSection(version, parsed) {
  const bodies = parsed.map(c => c.body).filter(Boolean);
  return `## ${version}\n\n${bodies.length ? bodies.join('\n') : '- No changes recorded.'}\n\n`;
}

// Insert the new section above the newest existing one (the header prose stays on top).
export function prependChangelog(changelog, section) {
  const text = String(changelog ?? '');
  const i = text.search(/^## /m);
  return i < 0 ? `${text.replace(/\n*$/, '\n\n')}${section}` : text.slice(0, i) + section + text.slice(i);
}

// The one serialization of release-notes.json (it round-trips today; keep it that way).
export const serializeNotes = doc => JSON.stringify(doc, null, 2) + '\n';

// Pure release prep. `changes` is { [path]: text } of every pending changeset; `notes` the
// parsed release-notes.json; `changelog` CHANGELOG.md's text. → { notes, notesText, changelog,
// entry, consumed, errors }. Errors mean nothing may be written.
export function prepareRelease({ version, title, notes, changelog, changes }) {
  const errors = [];
  if (!parseSemver(version)) errors.push(`not a semver version: ${JSON.stringify(version)}`);
  const list = byName(changes || {});
  const parsed = list.map(({ name, text }) => parseChange(name, text));
  for (const p of parsed) errors.push(...p.errors);
  const titleText = typeof title === 'string' && title.trim() ? title.trim() : undefined;
  const entry = releaseEntry(version, titleText, parsed);
  const releases = Array.isArray(notes?.releases) ? notes.releases : [];
  if (releases.some(r => r?.version === version)) errors.push(`${RELEASE_NOTES_FILE} already has an entry for ${version}`);
  const nextNotes = { ...(notes || {}), releases: [entry, ...releases] };
  errors.push(...validateReleaseNotes(nextNotes).map(e => `the new ${RELEASE_NOTES_FILE} would be invalid: ${e}`));
  return {
    notes: nextNotes,
    notesText: serializeNotes(nextNotes),
    changelog: prependChangelog(changelog, changelogSection(version, parsed)),
    entry,
    consumed: list.map(c => c.name),
    errors,
  };
}

// Set a doc's version fields (VERSION_COPIES) — on a copy.
function withVersion(file, doc, version) {
  const spec = VERSION_COPIES.find(c => c.file === file);
  const out = structuredClone(doc);
  for (const f of spec.fields) {
    let o = out;
    for (const k of f.slice(0, -1)) o = o?.[k];
    if (o && typeof o === 'object') o[f[f.length - 1]] = version;
  }
  return out;
}

// Rewrite the version fields of one copy's TEXT, keeping every other byte (not every copy
// round-trips through JSON.stringify). The first N `"version": "<old>"` occurrences are the
// fields VERSION_COPIES names (top-level, then the lockfile's packages[""]); the result is
// checked by parsing, so a file laid out otherwise fails loudly instead of being half-edited.
export function rewriteVersionText(file, text, from, to) {
  const spec = VERSION_COPIES.find(c => c.file === file);
  if (!spec) throw new Error(`${file} is not a version copy`);
  let left = spec.fields.length;
  const needle = new RegExp(`("version"\\s*:\\s*")${from.replace(/[.+]/g, '\\$&')}(")`, 'g');
  const next = text.replace(needle, (all, a, b) => (left-- > 0 ? a + to + b : all));
  const want = withVersion(file, JSON.parse(text), to);
  if (JSON.stringify(JSON.parse(next)) !== JSON.stringify(want)) {
    throw new Error(`${file}: could not rewrite exactly its version field(s) ${from} -> ${to}`);
  }
  return next;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// CHANGELOG.md's LOG: everything from the first version heading down. The prose header above
// it describes the process and stays editable; the entries are where branches collided.
export function changelogLog(text) {
  if (typeof text !== 'string') return null;
  const i = text.search(/^## /m);
  return i < 0 ? '' : text.slice(i);
}
const versionOf = docs => docs?.['package.json']?.version;
const fieldValues = docs => VERSION_COPIES.flatMap(({ file, fields }) =>
  fields.map(f => f.reduce((o, k) => (o == null ? undefined : o[k]), docs?.[file])));

const HOW = `Feature branches never edit a version field, ${CHANGELOG_FILE} or ${RELEASE_NOTES_FILE} — every open PR edits the same lines there, so each merge conflicts the next. `
  + `Revert those edits and add a NEW file ${CHANGES_DIR}/<branch-name>.md instead (a "---" block with "what:" and "why:", then the changelog text). `
  + `The version and both logs are written once per release by "release.mjs prepare".`;

// THE GUARD. `base` and `head` are one side each of a diff:
//   { docs: { [VERSION_COPIES file]: parsed JSON }, changelog: text|null, notesText: text|null,
//     changes: { [.changes path]: text } }
// `changed` lists the paths that differ (git's view; added changesets are folded in here too).
// → { ok, kind: 'none'|'feature'|'release', errors, notes[] }
export function releaseGuard({ base, head, changed = [] }) {
  const errors = [], notes = [];
  const added = Object.keys(head.changes).filter(n => !(n in base.changes)).sort();
  const edited = Object.keys(head.changes).filter(n => n in base.changes && base.changes[n] !== head.changes[n]).sort();
  const touched = [...new Set([...changed, ...added])];
  const versionMoved = !sameJson(fieldValues(base.docs), fieldValues(head.docs));
  const changelogMoved = changelogLog(base.changelog) !== changelogLog(head.changelog);
  const notesMoved = base.notesText !== head.notesText;

  if (!versionMoved && !changelogMoved && !notesMoved) {
    if (!touched.length) return { ok: true, kind: 'none', errors, notes: ['nothing changed against the base'] };
    for (const n of [...added, ...edited]) errors.push(...parseChange(n, head.changes[n]).errors);
    if (!added.length && !edited.length) {
      errors.push(`this branch changes ${touched.length} file(s) but adds no changeset. Add ${CHANGES_DIR}/<branch-name>.md — `
        + `"what:"/"why:" for the release note (or "noUserFacingChanges: true"), then the changelog text.`);
    }
    if (!errors.length) notes.push(`changeset(s): ${[...added, ...edited].join(', ')}`);
    return { ok: !errors.length, kind: 'feature', errors, notes };
  }

  // Something guarded moved. That is legal only as a release prep, reproduced exactly.
  const moved = [versionMoved && 'a version field', changelogMoved && CHANGELOG_FILE, notesMoved && RELEASE_NOTES_FILE].filter(Boolean);
  const from = versionOf(base.docs), to = versionOf(head.docs);
  const fail = msg => errors.push(msg);
  const extra = touched.filter(p => !GUARDED_FILES.includes(p) && !isChangeFile(p));
  if (extra.length) {
    // Not a release prep: a feature branch that also edited the shared lines.
    fail(`this branch edits ${moved.join(', ')} directly, alongside ${extra.length} other file(s). ${HOW}`);
    return { ok: false, kind: 'feature', errors, notes };
  }
  const raised = bumpVerdict(to, from);
  if (!raised.ok) {
    fail(`this branch changes ${moved.join(', ')} without raising the version (${from} -> ${to}). ${HOW}`);
    return { ok: false, kind: 'release', errors, notes };
  }
  for (const m of lockstepMismatches(head.docs)) fail(`version copies disagree: ${m.where} is ${JSON.stringify(m.found)}, expected ${JSON.stringify(m.expected)}`);
  for (const { file } of VERSION_COPIES) {
    if (!sameJson(withVersion(file, base.docs[file], to), head.docs[file])) {
      fail(`${file} changes more than its version field(s) — a release prep changes nothing else`);
    }
  }
  if (added.length || edited.length) fail(`a release prep consumes changesets, it never adds or edits one: ${[...added, ...edited].join(', ')}`);
  const left = Object.keys(head.changes).filter(n => n in base.changes);
  if (left.length) fail(`a release prep consumes EVERY pending changeset; still present: ${left.join(', ')}`);
  let headNotes = null;
  try { headNotes = JSON.parse(head.notesText); } catch { fail(`${RELEASE_NOTES_FILE} is not JSON`); }
  let baseNotes = { releases: [] };
  try { if (base.notesText) baseNotes = JSON.parse(base.notesText); } catch { fail(`the base's ${RELEASE_NOTES_FILE} is not JSON`); }
  const title = headNotes?.releases?.[0]?.version === to ? headNotes.releases[0].title : undefined;
  const want = prepareRelease({ version: to, title, notes: baseNotes, changelog: base.changelog, changes: base.changes });
  for (const e of want.errors) fail(e);
  if (headNotes && head.notesText !== want.notesText) fail(`${RELEASE_NOTES_FILE} is not what "release.mjs prepare" writes from the base's changesets`);
  if (changelogLog(head.changelog) !== changelogLog(want.changelog)) fail(`${CHANGELOG_FILE} is not what "release.mjs prepare" writes from the base's changesets`);
  if (errors.length) errors.push(HOW);
  else notes.push(`release prep ${from} -> ${to}, consuming ${want.consumed.length} changeset(s)`);
  return { ok: !errors.length, kind: 'release', errors, notes };
}
