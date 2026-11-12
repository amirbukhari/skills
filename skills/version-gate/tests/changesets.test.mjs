// changesets.js: the changeset format, the release prep, and the guard that keeps feature
// branches off the version and the logs. The CLI end to end is version-gate.test.mjs.
// `node --test tests/changesets.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The libraries read the repository's settings from the directory they run in, so the
// fixture repository exists (and is the cwd) before they are imported.
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'changesets-test-'));
test.after(() => { process.chdir(os.tmpdir()); fs.rmSync(REPO, { recursive: true, force: true }); });
const SUB = 'apps/desktop';
fs.mkdirSync(path.join(REPO, SUB), { recursive: true });
fs.writeFileSync(path.join(REPO, '.version-gate.json'), JSON.stringify({ versionCopies: ['package-lock.json', `${SUB}/package.json`] }));
fs.writeFileSync(path.join(REPO, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.3', dependencies: { y: '1.2.3' } }, null, 2) + '\n');
fs.writeFileSync(path.join(REPO, 'package-lock.json'), JSON.stringify({ name: 'x', version: '1.2.3', lockfileVersion: 3, packages: { '': { name: 'x', version: '1.2.3' }, 'node_modules/y': { version: '1.2.3' } } }, null, 2) + '\n');
// Hand-formatted on purpose: this file does not round-trip through JSON.stringify.
fs.writeFileSync(path.join(REPO, SUB, 'package.json'), '{ "name": "desktop",\n\t"version":   "1.2.3",\n\t"files": ["a",   "b"] }\n');
process.chdir(REPO);
const { VERSION_COPIES } = await import('../scripts/lib/version.js');
const {
  isChangeFile, parseChange, prepareRelease, rewriteVersionText, releaseGuard, changelogLog, GUARDED_FILES,
} = await import('../scripts/lib/changesets.js');

const USER = '---\nwhat: The app opens noticeably faster.\nwhy: Less waiting every time you start your day.\n---\n- **Faster boot**.\n';
const QUIET = '---\nnoUserFacingChanges: true\n---\n- Tests only.\n';

test('the guard covers every version copy and both logs', () => {
  assert.deepEqual(VERSION_COPIES.map(c => c.file), ['package.json', 'package-lock.json', `${SUB}/package.json`]);
  for (const { file } of VERSION_COPIES) assert.ok(GUARDED_FILES.includes(file), file);
  assert.ok(GUARDED_FILES.includes('CHANGELOG.md'));
  assert.ok(GUARDED_FILES.includes('release-notes.json'));
});

test('isChangeFile: .changes/<name>.md only — not the README, not a subdirectory', () => {
  assert.equal(isChangeFile('.changes/my-branch.md'), true);
  assert.equal(isChangeFile('.changes/README.md'), false);
  assert.equal(isChangeFile('.changes/sub/x.md'), false);
  assert.equal(isChangeFile('.changes/x.txt'), false);
  assert.equal(isChangeFile('CHANGELOG.md'), false);
});

test('parseChange: what/why, or an explicit no-user-facing marker; anything else is an error', () => {
  const ok = parseChange('a', USER);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.what, 'The app opens noticeably faster.');
  assert.equal(ok.body, '- **Faster boot**.');
  assert.deepEqual(parseChange('q', QUIET).errors, []);
  assert.match(parseChange('n', 'no front matter').errors.join(), /must start with a "---" block/);
  assert.match(parseChange('w', '---\nwhat: Something nicer.\n---\nbody').errors.join(), /needs "what:".*and "why:"/);
  assert.match(parseChange('b', '---\nnoUserFacingChanges: true\n---\n').errors.join(), /needs a body/);
  assert.match(parseChange('k', '---\nnoUserFacingChanges: true\nfoo: bar\n---\nx').errors.join(), /unknown key "foo"/);
  assert.match(parseChange('m', '---\nnoUserFacingChanges: true\nwhat: x\n---\nx').errors.join(), /must not also give/);
});

test('prepareRelease: filename order, quiet changesets add only changelog text, the entry is validated', () => {
  const p = prepareRelease({
    version: '1.1.0', title: 'Faster', notes: { releases: [{ version: '1.0.0', noUserFacingChanges: true }] },
    changelog: '# Changelog\n\nprose\n\n## 1.0.0\n\n- old\n', changes: { '.changes/b.md': QUIET, '.changes/a.md': USER },
  });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.consumed, ['.changes/a.md', '.changes/b.md']);
  assert.deepEqual(p.entry.changes, [{ what: 'The app opens noticeably faster.', why: 'Less waiting every time you start your day.' }]);
  assert.equal(p.changelog, '# Changelog\n\nprose\n\n## 1.1.0\n\n- **Faster boot**.\n- Tests only.\n\n## 1.0.0\n\n- old\n');
  assert.equal(p.notesText, JSON.stringify(p.notes, null, 2) + '\n');
  const quiet = prepareRelease({ version: '1.1.0', notes: { releases: [] }, changelog: '', changes: { '.changes/q.md': QUIET } });
  assert.deepEqual(quiet.entry, { version: '1.1.0', noUserFacingChanges: true });
  assert.match(prepareRelease({ version: '1.1.0', notes: { releases: [] }, changelog: '', changes: { '.changes/a.md': USER } }).errors.join(), /needs a "title"/);
  assert.match(prepareRelease({ version: '1.0.0', notes: { releases: [{ version: '1.0.0', noUserFacingChanges: true }] }, changelog: '', changes: {} }).errors.join(), /already has an entry for 1\.0\.0/);
});

// The prep must not reformat the files it writes: a hand-formatted package.json does not
// round-trip through JSON.stringify, and a reformatted lockfile is a diff nobody can review.
test('rewriteVersionText changes ONLY the version field(s) of every real copy', () => {
  for (const { file, fields } of VERSION_COPIES) {
    const text = fs.readFileSync(path.join(REPO, file), 'utf8');
    const from = JSON.parse(text).version;
    assert.equal(from, '1.2.3');
    const next = rewriteVersionText(file, text, from, '99.0.0');
    const changed = text.split('\n').filter((l, i) => l !== next.split('\n')[i]);
    assert.equal(changed.length, fields.length, `${file}: ${changed.length} lines changed`);
    assert.equal(text.split('\n').length, next.split('\n').length, file);
    for (const f of fields) assert.equal(f.reduce((o, k) => o[k], JSON.parse(next)), '99.0.0', `${file} ${f.join('.')}`);
  }
});

test('changelogLog: the header prose is not the log', () => {
  assert.equal(changelogLog('# C\n\nprose\n\n## 1.0.0\n\n- x\n'), '## 1.0.0\n\n- x\n');
  assert.equal(changelogLog('# C\n\nother prose\n\n## 1.0.0\n\n- x\n'), '## 1.0.0\n\n- x\n');
  assert.equal(changelogLog('# no entries'), '');
  assert.equal(changelogLog(null), null);
});

// --- releaseGuard, pure -------------------------------------------------------------
const docs = v => Object.fromEntries(VERSION_COPIES.map(({ file }) => [file, file.endsWith('lock.json')
  ? { name: 'x', version: v, packages: { '': { version: v } } } : { name: 'x', version: v }]));
const side = (v, extra = {}) => ({ docs: docs(v), changelog: `# C\n\n## ${v}\n\n- x\n`, notesText: JSON.stringify({ releases: [{ version: v, noUserFacingChanges: true }] }, null, 2) + '\n', changes: {}, ...extra });

test('releaseGuard: a dependency change to a lockfile is fine; only the version FIELDS are guarded', () => {
  const head = side('1.0.0', { changes: { '.changes/deps.md': QUIET } });
  head.docs['package-lock.json'] = { ...head.docs['package-lock.json'], packages: { '': { version: '1.0.0' }, 'node_modules/y': { version: '2.0.0' } } };
  const v = releaseGuard({ base: side('1.0.0'), head, changed: ['package-lock.json'] });
  assert.equal(v.ok, true, v.errors.join('\n'));
});

test('releaseGuard: a release prep must consume EVERY pending changeset and add none', () => {
  const base = side('1.0.0', { changes: { '.changes/a.md': QUIET, '.changes/b.md': QUIET } });
  const prep = prepareRelease({ version: '1.0.1', notes: JSON.parse(base.notesText), changelog: base.changelog, changes: base.changes });
  const head = { docs: docs('1.0.1'), changelog: prep.changelog, notesText: prep.notesText, changes: {} };
  const all = ['package.json', 'package-lock.json', `${SUB}/package.json`, 'CHANGELOG.md', 'release-notes.json', '.changes/a.md', '.changes/b.md'];
  assert.equal(releaseGuard({ base, head, changed: all }).ok, true);
  const leftover = releaseGuard({ base, head: { ...head, changes: { '.changes/b.md': QUIET } }, changed: all });
  assert.match(leftover.errors.join(), /consumes EVERY pending changeset; still present: \.changes\/b\.md/);
  const added = releaseGuard({ base, head: { ...head, changes: { '.changes/new.md': QUIET } }, changed: all });
  assert.match(added.errors.join(), /never adds or edits one: \.changes\/new\.md/);
  const backwards = releaseGuard({ base, head: { ...head, docs: docs('0.9.0') }, changed: all });
  assert.match(backwards.errors.join(), /without raising the version/);
});
