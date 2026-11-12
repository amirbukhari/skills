// Customer-facing release notes: the ONE source every "what changed" surface reads.
//
// The release-notes file at the repo root holds one entry per version, written for a person
// who has never seen the codebase: a title, and per change WHAT changed plus WHY they'd
// care. It is structured data rather than prose, so an in-app "what's new" panel, an update
// prompt and a forge release body can all render the same entry.
//
// Nobody edits it by hand. Each PR's changeset carries its what/why (linted here,
// lintNoteText, on the PR that wrote it); `release.mjs prepare` folds them into one entry
// per release and the gate (changesets.js releaseGuard) refuses any other edit. A release
// with nothing a user would notice says so explicitly: `noUserFacingChanges: true`.
//
// The gate can enforce that a note EXISTS and reject obvious commit-speak (a `fix(...)`:
// prefix, a `#123` reference, a file path, backticks, a snake_case identifier). It cannot
// enforce that a stranger understands it; that part is the reviewer's job.
//
// PURE apart from reading the configured file name: no git, and callers pass the parsed
// document in.

import { CONFIG } from './config.js';
import { parseSemver, compareSemver } from './version.js';

export const RELEASE_NOTES_FILE = CONFIG.releaseNotes;

const LIMITS = { title: 90, what: 280, why: 280, minWhy: 12 };

// Heuristics for text written for the codebase rather than for a user. Each is a
// [pattern, why-it-is-rejected] pair; the message is what the author sees in CI.
const COMMIT_SPEAK = [
  [/^\s*(feat|fix|chore|refactor|docs|test|tests|perf|build|ci|style|revert)(\([^)]*\))?!?:/i, 'starts with a commit-type prefix like "fix(...):" — say it the way a user would'],
  [/(^|[\s(])#\d+\b/, 'cites a PR/issue number — a user cannot follow "#123"'],
  [/`/, 'contains backticks (code formatting) — name the thing as a user sees it'],
  [/\b[\w.-]+\.(m?js|cjs|json|ya?ml|md|css|html|sh|py)\b/i, 'names a source file — describe the effect instead'],
  [/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/, 'contains a snake_case identifier — use the name a user sees on screen'],
];

export function lintNoteText(text) {
  const out = [];
  for (const [re, why] of COMMIT_SPEAK) if (re.test(text)) out.push(why);
  return out;
}

const isText = (s) => typeof s === 'string' && s.trim().length > 0;

// Every problem with the whole document, as human-readable strings (empty = valid).
// Checks shape, semver, uniqueness, newest-first order, lengths and commit-speak.
export function validateReleaseNotes(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.releases)) {
    return [`${RELEASE_NOTES_FILE} must be an object with a "releases" array`];
  }
  const seen = new Set();
  let prev = null;
  doc.releases.forEach((r, i) => {
    const at = `releases[${i}]${r && typeof r.version === 'string' ? ` (${r.version})` : ''}`;
    if (!r || typeof r !== 'object') { errors.push(`${at}: must be an object`); return; }
    if (!parseSemver(r.version)) { errors.push(`${at}: "version" must be a semver string like "1.2.3"`); return; }
    if (seen.has(r.version)) errors.push(`${at}: version ${r.version} appears more than once`);
    seen.add(r.version);
    if (prev && compareSemver(r.version, prev) >= 0) errors.push(`${at}: releases must be newest first (${r.version} is listed after ${prev})`);
    prev = r.version;
    const known = new Set(['version', 'title', 'changes', 'noUserFacingChanges']);
    for (const k of Object.keys(r)) if (!known.has(k)) errors.push(`${at}: unknown field "${k}"`);
    if (r.noUserFacingChanges !== undefined && r.noUserFacingChanges !== true) {
      errors.push(`${at}: "noUserFacingChanges" may only be true (omit it otherwise)`);
    }
    if (r.noUserFacingChanges === true) {
      if (r.changes !== undefined) errors.push(`${at}: a release marked noUserFacingChanges must not list changes`);
      if (r.title !== undefined && !isText(r.title)) errors.push(`${at}: "title", when given, must be non-empty text`);
      return;
    }
    if (!isText(r.title)) errors.push(`${at}: needs a "title" — one line a user would read (or "noUserFacingChanges": true)`);
    else {
      if (r.title.length > LIMITS.title) errors.push(`${at}: title is ${r.title.length} characters; keep it under ${LIMITS.title}`);
      for (const p of lintNoteText(r.title)) errors.push(`${at} title: ${p}`);
    }
    if (!Array.isArray(r.changes) || !r.changes.length) {
      errors.push(`${at}: needs a non-empty "changes" list of { "what", "why" } (or "noUserFacingChanges": true)`);
      return;
    }
    r.changes.forEach((c, j) => {
      const cat = `${at} changes[${j}]`;
      if (!c || typeof c !== 'object') { errors.push(`${cat}: must be an object with "what" and "why"`); return; }
      for (const k of Object.keys(c)) if (k !== 'what' && k !== 'why') errors.push(`${cat}: unknown field "${k}"`);
      if (!isText(c.what)) errors.push(`${cat}: needs "what" — what changed, as a user would notice it`);
      if (!isText(c.why)) errors.push(`${cat}: needs "why" — why a user would care`);
      if (!isText(c.what) || !isText(c.why)) return;
      if (c.what.length > LIMITS.what) errors.push(`${cat}: "what" is ${c.what.length} characters; keep it under ${LIMITS.what}`);
      if (c.why.length > LIMITS.why) errors.push(`${cat}: "why" is ${c.why.length} characters; keep it under ${LIMITS.why}`);
      if (c.why.trim().length < LIMITS.minWhy) errors.push(`${cat}: "why" is too short to tell a user why they'd care`);
      if (c.why.trim().toLowerCase() === c.what.trim().toLowerCase()) errors.push(`${cat}: "why" repeats "what" — say why it matters`);
      for (const p of lintNoteText(c.what)) errors.push(`${cat} what: ${p}`);
      for (const p of lintNoteText(c.why)) errors.push(`${cat} why: ${p}`);
    });
  });
  return errors;
}

export function noteFor(doc, version) {
  if (!doc || !Array.isArray(doc.releases) || !parseSemver(version)) return null;
  return doc.releases.find((r) => r && r.version === version) || null;
}

// The gate's verdict for one version: the document is valid AND carries an entry for it.
export function noteGateVerdict(doc, version) {
  const errors = validateReleaseNotes(doc);
  if (errors.length) return { ok: false, reason: `${RELEASE_NOTES_FILE} is invalid:\n  ${errors.join('\n  ')}` };
  const entry = noteFor(doc, version);
  if (!entry) {
    return {
      ok: false,
      reason: `${RELEASE_NOTES_FILE} has no entry for ${version}. Every version bump ships a customer-facing note: add `
        + `{ "version": "${version}", "title": "...", "changes": [{ "what": "...", "why": "..." }] } at the top — `
        + `or { "version": "${version}", "noUserFacingChanges": true } if nothing a user would notice changed.`,
    };
  }
  return { ok: true, reason: entry.noUserFacingChanges ? `${version}: marked "no user-facing changes"` : `${version}: "${entry.title}"` };
}

// Entries with from < version <= to, newest first. `from` null → just `to`'s own entry.
// Unparsable bounds or document → []. Never throws: this feeds live UI.
export function notesBetween(doc, from, to) {
  if (!doc || !Array.isArray(doc.releases) || !parseSemver(to)) return [];
  const lo = parseSemver(from) ? from : null;
  return doc.releases
    .filter((r) => r && parseSemver(r.version))
    .filter((r) => compareSemver(r.version, to) <= 0 && (lo ? compareSemver(r.version, lo) > 0 : r.version === to))
    .sort((a, b) => compareSemver(b.version, a.version));
}

// Does a set of entries have anything worth interrupting a user for?
export const hasUserFacing = (entries) => (entries || []).some((r) => r && r.noUserFacingChanges !== true);

// ---------------------------------------------------------------------------
// The GitHub Release body: readable markdown on the release page, plus a machine block
// a client can parse back into the same structure. The block goes
// LAST so a reader that shows the body as plain text shows the prose first. GitHub renders an HTML comment as nothing, so the page stays clean.
// ---------------------------------------------------------------------------
const BLOCK_OPEN = '<!-- release-notes ';
const BLOCK_CLOSE = ' -->';

export function renderReleaseBody(entry, { footer = '' } = {}) {
  if (!entry) return footer;
  const lines = [];
  if (entry.noUserFacingChanges) {
    lines.push(`## ${entry.title || `Version ${entry.version}`}`, '', 'A maintenance release: nothing about how it looks or works has changed.');
  } else {
    lines.push(`## ${entry.title}`, '');
    for (const c of entry.changes) lines.push(`- **${c.what}** ${c.why}`);
  }
  if (footer) lines.push('', '---', '', footer);
  // `-->` inside the JSON would end the comment early; JSON never needs a literal `--`.
  const json = JSON.stringify(entry).replace(/--/g, '-\\u002d');
  lines.push('', BLOCK_OPEN + json + BLOCK_CLOSE);
  return lines.join('\n');
}

// The structured entry embedded in a release body, or null (an older release, or none).
export function parseReleaseBody(body) {
  if (typeof body !== 'string') return null;
  const i = body.lastIndexOf(BLOCK_OPEN);
  if (i < 0) return null;
  const j = body.indexOf(BLOCK_CLOSE, i + BLOCK_OPEN.length);
  if (j < 0) return null;
  try {
    const entry = JSON.parse(body.slice(i + BLOCK_OPEN.length, j));
    return validateReleaseNotes({ releases: [entry] }).length ? null : entry;
  } catch { return null; }
}

// The prose part of a release body — what an older client (or a missing block) falls back to.
export function releaseBodyProse(body) {
  if (typeof body !== 'string') return '';
  const i = body.lastIndexOf(BLOCK_OPEN);
  return (i < 0 ? body : body.slice(0, i)).trim();
}
