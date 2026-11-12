// release-notes.js: the customer-facing release-notes format and its rules.
// `node --test tests/release-notes.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateReleaseNotes, lintNoteText, noteFor, noteGateVerdict, notesBetween,
  hasUserFacing, renderReleaseBody, parseReleaseBody, releaseBodyProse,
} from '../scripts/lib/release-notes.js';

const entry = (v, title = `Release ${v}`) => ({ version: v, title, changes: [{ what: `Something new in ${v}.`, why: 'It saves you a step every day.' }] });
const doc = (...releases) => ({ releases });

test('validate: shape, semver, uniqueness and newest-first order', () => {
  assert.deepEqual(validateReleaseNotes(doc(entry('0.3.0'), entry('0.2.0'))), []);
  assert.match(validateReleaseNotes(null)[0], /"releases" array/);
  assert.ok(validateReleaseNotes(doc(entry('0.2.0'), entry('0.3.0'))).some((e) => /newest first/.test(e)));
  assert.ok(validateReleaseNotes(doc(entry('0.2.0'), entry('0.2.0'))).some((e) => /more than once/.test(e)));
  assert.ok(validateReleaseNotes(doc({ ...entry('1.0'), version: '1.0' })).some((e) => /semver/.test(e)));
  assert.ok(validateReleaseNotes(doc({ ...entry('0.2.0'), extra: 1 })).some((e) => /unknown field "extra"/.test(e)));
});

test('validate: a real entry needs a title and at least one what+why pair', () => {
  const errs = (r) => validateReleaseNotes(doc(r));
  assert.ok(errs({ version: '0.2.0' }).some((e) => /needs a "title"/.test(e)));
  assert.ok(errs({ version: '0.2.0', title: 'X', changes: [] }).some((e) => /non-empty "changes"/.test(e)));
  assert.ok(errs({ version: '0.2.0', title: 'X', changes: [{ what: 'A thing changed.' }] }).some((e) => /needs "why"/.test(e)));
  assert.ok(errs({ version: '0.2.0', title: 'X', changes: [{ what: 'Same words here.', why: 'same words here.' }] }).some((e) => /repeats "what"/.test(e)));
  assert.ok(errs({ version: '0.2.0', title: 'X', changes: [{ what: 'A thing changed.', why: 'Nice.' }] }).some((e) => /too short/.test(e)));
  assert.ok(errs({ version: '0.2.0', title: 'x'.repeat(91), changes: entry('0.2.0').changes }).some((e) => /under 90/.test(e)));
});

test('validate: "no user-facing changes" is an explicit marker, and only true counts', () => {
  assert.deepEqual(validateReleaseNotes(doc({ version: '0.2.0', noUserFacingChanges: true })), []);
  assert.ok(validateReleaseNotes(doc({ version: '0.2.0', noUserFacingChanges: false })).some((e) => /may only be true/.test(e)));
  assert.ok(validateReleaseNotes(doc({ version: '0.2.0', noUserFacingChanges: true, changes: [] })).some((e) => /must not list changes/.test(e)));
});

test('lint: commit-speak is rejected, plain language passes', () => {
  assert.deepEqual(lintNoteText('Pepper can show you an image right in the chat.'), []);
  assert.deepEqual(lintNoteText('Works on macOS and in the GitHub panel, e.g. v2 and 3.5x faster.'), [], 'ordinary product words are not flagged');
  for (const bad of ['fix(sessions): keep tabs', 'feat: new thing', 'Fixed in #812', 'Run `npm test`', 'see lib/version.js', 'show_image now works']) {
    assert.ok(lintNoteText(bad).length, `flagged: ${bad}`);
  }
});

test('gate verdict: valid doc + entry for the version passes; missing entry names the fix', () => {
  assert.equal(noteGateVerdict(doc(entry('0.3.0')), '0.3.0').ok, true);
  const miss = noteGateVerdict(doc(entry('0.2.0')), '0.3.0');
  assert.equal(miss.ok, false);
  assert.match(miss.reason, /no entry for 0\.3\.0/);
  assert.match(miss.reason, /"noUserFacingChanges": true/);
  const bad = noteGateVerdict(doc(entry('0.3.0'), entry('0.3.0')), '0.3.0');
  assert.equal(bad.ok, false, 'an invalid document fails even when the entry exists');
});

test('notesBetween: (from, to], newest first; from=null is just to\'s own entry', () => {
  const d = doc(entry('0.4.0'), entry('0.3.0'), entry('0.2.0'), entry('0.1.0'));
  assert.deepEqual(notesBetween(d, '0.1.0', '0.3.0').map((r) => r.version), ['0.3.0', '0.2.0']);
  assert.deepEqual(notesBetween(d, null, '0.3.0').map((r) => r.version), ['0.3.0']);
  assert.deepEqual(notesBetween(d, null, '9.9.9'), [], 'no entry for the current version → nothing');
  assert.deepEqual(notesBetween(null, '0.1.0', '0.3.0'), []);
});
test('hasUserFacing: a range that is all "no user-facing changes" has nothing to show', () => {
  assert.equal(hasUserFacing([{ version: '0.3.0', noUserFacingChanges: true }]), false);
  assert.equal(hasUserFacing([{ version: '0.3.0', noUserFacingChanges: true }, entry('0.2.0')]), true);
});

test('release body: readable markdown first, a machine block last that parses back exactly', () => {
  const e = entry('0.3.0', 'Faster start-up');
  const body = renderReleaseBody(e, { footer: 'Builds are unsigned.' });
  assert.match(body, /^## Faster start-up\n\n- \*\*Something new in 0\.3\.0\.\*\* It saves you a step/);
  assert.ok(body.indexOf('Builds are unsigned.') < body.indexOf('<!-- release-notes '), 'prose (and footer) before the block');
  assert.deepEqual(parseReleaseBody(body), e);
  assert.equal(releaseBodyProse(body).includes('<!-- release-notes'), false);
  assert.match(releaseBodyProse(body), /Builds are unsigned\.$/);
});

test('release body: text containing "-->" cannot end the comment early', () => {
  const e = { version: '0.3.0', title: 'Arrows --> everywhere', changes: [{ what: 'A --> B now works.', why: 'Diagrams read the way you drew them.' }] };
  assert.deepEqual(parseReleaseBody(renderReleaseBody(e)), e);
});

test('release body: an older release with no block, or a corrupt one, parses to null', () => {
  assert.equal(parseReleaseBody('A plain body from an older release'), null);
  assert.equal(parseReleaseBody('x\n<!-- release-notes {not json} -->'), null);
  assert.equal(parseReleaseBody('x\n<!-- release-notes {"version":"0.3.0"} -->'), null, 'an invalid entry is not trusted');
  assert.equal(releaseBodyProse('plain body'), 'plain body');
});

test('marker entries render as a maintenance release', () => {
  const body = renderReleaseBody({ version: '0.2.2', noUserFacingChanges: true });
  assert.match(body, /## Version 0\.2\.2\n\nA maintenance release/);
  assert.deepEqual(parseReleaseBody(body), { version: '0.2.2', noUserFacingChanges: true });
});
