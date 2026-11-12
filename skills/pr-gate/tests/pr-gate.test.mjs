// The merge gate (scripts/lib/pr-gate.js + scripts/pr-gate.mjs + scripts/pr-gate-reporter.mjs). The pure
// comparison is pinned on reporter-record fixtures; the CLI is driven end to end against a throwaway git repo, because "it merges the
// PR and runs the suite" is a claim about runtime that only a run can check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecords, normalizeMessage, compareGate, judge, classifyRerun, firstDifference, aloneOutcomes, NOT_RUN_ALONE, suitePatterns } from '../scripts/lib/pr-gate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'pr-gate.mjs');

// Records as pr-gate-reporter.mjs writes them: children before their parent.
const rec = (file, name, msg, nesting = 0) => JSON.stringify({ t: msg == null ? 'test:pass' : 'test:fail', name, nesting, file: `/w/a/${file}`, msg: msg ?? '' });
const run = (...lines) => lines.join('\n') + '\n' + JSON.stringify({ t: 'test:summary', counts: { tests: lines.filter(l => /"t":"test:(pass|fail)"/.test(l)).length } });
const cases = (...lines) => parseRecords(run(...lines), '/w/a').cases;

test('parseRecords names subtests through their parents, and keeps a parent that fails on its own', () => {
  const { cases: cs, total } = parseRecords(run(
    rec('tests/a.test.mjs', 'child ok', null, 1),
    rec('tests/a.test.mjs', 'parent', 'parent > boom'),
    rec('tests/a.test.mjs', 'deep', 'kid', 2),
    rec('tests/a.test.mjs', 'mid', 'subtest failed', 1),
    rec('tests/a.test.mjs', 'top', 'subtest failed'),
  ), '/w/a');
  assert.deepEqual(cs.map(c => [c.file, c.name, c.status, c.message]), [
    ['tests/a.test.mjs', 'parent › child ok', 'pass', ''],
    ['tests/a.test.mjs', 'parent', 'fail', 'parent > boom'],
    ['tests/a.test.mjs', 'top › mid › deep', 'fail', 'kid'],
    ['tests/a.test.mjs', 'top › mid', 'fail', 'subtest failed'],
    ['tests/a.test.mjs', 'top', 'fail', 'subtest failed'],
  ]);
  assert.equal(total, 5);
});

test('parseRecords is incomplete when the runner reported more results than were read, or no total at all', () => {
  const two = [rec('tests/a.test.mjs', 'a'), rec('tests/a.test.mjs', 'b')];
  assert.equal(parseRecords(run(...two), '/w/a').complete, true);
  assert.equal(parseRecords(two.join('\n') + '\n' + JSON.stringify({ t: 'test:summary', counts: { tests: 3 } }), '/w/a').complete, false);
  assert.equal(parseRecords(two.join('\n'), '/w/a').complete, false);
});

// A describe() block, as the reporter writes it: a pass/fail record typed 'suite'. Node counts it
// in `counts.suites`, never in `counts.tests`.
const suiteRec = (file, name, msg, nesting = 0) => JSON.stringify({ ...JSON.parse(rec(file, name, msg, nesting)), type: 'suite' });
const summary = (tests, suites) => JSON.stringify({ t: 'test:summary', counts: { tests, suites } });

test('parseRecords: describe() blocks are counted as suites, so a file using them is a complete record', () => {
  // The shape that refused an unchanged base: 39 tests in 7 describe blocks read 46 results
  // against a reported total of 39. Here: 3 tests, 2 of them inside 1 suite.
  const lines = [
    rec('tests/d.test.mjs', 'one', null, 1),
    rec('tests/d.test.mjs', 'two', null, 1),
    suiteRec('tests/d.test.mjs', 'block', null),
    rec('tests/d.test.mjs', 'loose', null),
  ];
  const r = parseRecords([...lines, summary(3, 1)].join('\n'), '/w/a');
  assert.deepEqual([r.total, r.suites, r.read, r.complete], [3, 1, { tests: 3, suites: 1 }, true]);
  assert.deepEqual(r.cases.map(c => c.name), ['block › one', 'block › two', 'block', 'loose']);
  // A suite that fails on its own (a throwing before() hook) is still a case the gate compares.
  const failing = parseRecords([rec('tests/d.test.mjs', 'one', 'hook failed', 1), suiteRec('tests/d.test.mjs', 'block', 'before hook threw'), summary(1, 1)].join('\n'), '/w/a');
  assert.equal(failing.complete, true);
  assert.deepEqual(failing.cases.map(c => [c.name, c.status]), [['block › one', 'fail'], ['block', 'fail']]);
});

test('parseRecords: each count must match EXACTLY; a suite cannot stand in for a missing test, nor a test for a suite', () => {
  const block = [rec('tests/d.test.mjs', 'one', null, 1), suiteRec('tests/d.test.mjs', 'block', null)];
  const short = parseRecords([...block, summary(2, 1)].join('\n'), '/w/a');           // a test not read
  assert.deepEqual([short.complete, short.read], [false, { tests: 1, suites: 1 }]);
  assert.equal(parseRecords([...block, summary(1, 2)].join('\n'), '/w/a').complete, false); // a suite not read
  // Same number of records as tests + suites, wrong split: still incomplete.
  assert.equal(parseRecords([...block, summary(2, 0)].join('\n'), '/w/a').complete, false);
  // A summary with no `suites` field reads as 0, so a typed suite record is then a mismatch.
  assert.equal(parseRecords([...block, JSON.stringify({ t: 'test:summary', counts: { tests: 1 } })].join('\n'), '/w/a').complete, false);
  // Records with no type (an older reporter) count as tests, as before.
  assert.equal(parseRecords([rec('tests/a.test.mjs', 'a'), JSON.stringify({ t: 'test:summary', counts: { tests: 1 } })].join('\n'), '/w/a').complete, true);
});

test('parseRecords: a file failing outside any test carries its own output; duplicate names stay distinct', () => {
  const { cases: cs } = parseRecords([
    JSON.stringify({ t: 'output', file: '/w/a/tests/hand.test.mjs', text: 'FAIL: 2 checks\n' }),
    rec('tests/hand.test.mjs', 'tests/hand.test.mjs', 'test failed'),
    rec('tests/b.test.mjs', 'same', null), rec('tests/b.test.mjs', 'same', null),
  ].join('\n'), '/w/a');
  assert.equal(cs[0].message, 'test failed\nFAIL: 2 checks\n');
  assert.deepEqual(cs.slice(1).map(c => c.name), ['same', 'same #2']);
});

test('normalizeMessage removes what differs between two runs of the same failure, and nothing else', () => {
  const a = normalizeMessage('at /wt/one/tests/x.js failed in 12.5ms on 127.0.0.1:40123 writing /tmp/test-root-1/f', ['/wt/one']);
  const b = normalizeMessage('at /wt/two/tests/x.js failed in 3ms on 127.0.0.1:51000 writing /tmp/test-root-9/f', ['/wt/two']);
  assert.equal(a, b);
  assert.notEqual(normalizeMessage('offenders: one.spec.js'), normalizeMessage('offenders: one.spec.js, two.spec.js'));
  // Measured on a real run: a browser launch failing the same way on both sides, differing only
  // by Chrome's pid inside Playwright's coloured call log.
  const launch = pid => `browserType.launch: closed\n\x1b[2m  - <launched> pid=${pid}\x1b[22m\n\x1b[2m  - [pid=${pid}] <kill>\x1b[22m`;
  assert.equal(normalizeMessage(launch(3051070)), normalizeMessage(launch(4120)));
  assert.equal(normalizeMessage('run 1b4e28ba-2fa1-41d2-883f-0016d3cca427 at 2026-10-04T17:21:42.123Z'), normalizeMessage('run 6f1c0a52-9d0e-4c7b-a1e3-5b2d9e8f7a61 at 2026-10-04T18:02:07Z'));
});

// Measured on a real gate run: tests/line-anchors.test.mjs was red on the base, and a PR that added
// lines to server.js above one dead anchor moved `server.js:23280` to `server.js:23328` inside the
// failure message. Nothing else changed, the merged run had FEWER failures, and the gate called it
// a BREAK. A source position moves whenever a file above it is edited; it is not what failed.
// Built with `at`, never written out: a literal file-and-line position here is itself a dead anchor
// to tests/line-anchors.test.mjs and a line-keyed guard to tests/line-anchor-guard.test.mjs.
const at = (file, ...n) => [file, ...n].join(':');
const row = (pos, cited) => `${pos}  "${cited}"`;
const deadAnchors = (...rows) => `These anchors point at a line that cannot exist\n  + [\n${rows.map(r => `  +   '${r}  — no such file in the tree',`).join('\n')}\n  + ]`;
test('a failure differing only by a shifted source line number is the same failure, alone and in the full run', () => {
  const before = deadAnchors(row(at('lib/chat.js', 13), at('src/mcp.js', '28-74')), row(at('server.js', 23280), at('mailbox.js', 83)));
  const after = deadAnchors(row(at('lib/chat.js', 13), at('src/mcp.js', '28-74')), row(at('server.js', 23328), at('mailbox.js', 83)));
  assert.equal(normalizeMessage(before), normalizeMessage(after));
  const v = compareGate(cases(rec('tests/line-anchors.test.mjs', 'no anchor points at a line that cannot exist', before)),
    cases(rec('tests/line-anchors.test.mjs', 'no anchor points at a line that cannot exist', after)));
  assert.deepEqual(v.changedFailures, []);
  assert.equal(v.pass, true);
  const k = 'tests/line-anchors.test.mjs › no anchor points at a line that cannot exist';
  const alone = msg => aloneOutcomes(cases(rec('tests/line-anchors.test.mjs', 'no anchor points at a line that cannot exist', msg)), [k]).get(k);
  assert.equal(alone(before), alone(after));
  // A stack frame moves the same way when the test file itself is edited above the failing line.
  assert.equal(normalizeMessage(`at file:///r/${at('tests/x.test.mjs', 132, 17)}`), normalizeMessage(`at file:///r/${at('tests/x.test.mjs', 140, 5)}`));
});

test('a failure that changed in SUBSTANCE still counts, though its line numbers moved too', () => {
  const k = 'tests/line-anchors.test.mjs › no anchor points at a line that cannot exist';
  const before = deadAnchors(row(at('server.js', 23280), at('mailbox.js', 83)));
  const changed = {
    'a second dead anchor': deadAnchors(row(at('server.js', 23328), at('mailbox.js', 83)), row(at('server.js', 23400), at('mailbox.js', 83))),
    'a different file': deadAnchors(row(at('lib/other.js', 23328), at('mailbox.js', 83))),
    'a different anchor': deadAnchors(row(at('server.js', 23328), at('inbox.js', 83))),
    'a different reason': deadAnchors(row(at('server.js', 23328), at('mailbox.js', 83))).replace('no such file', 'past the end of the file'),
  };
  for (const [what, after] of Object.entries(changed)) {
    assert.notEqual(normalizeMessage(before), normalizeMessage(after), what);
    const v = compareGate(cases(rec('tests/line-anchors.test.mjs', 'no anchor points at a line that cannot exist', before)),
      cases(rec('tests/line-anchors.test.mjs', 'no anchor points at a line that cannot exist', after)));
    assert.deepEqual(v.changedFailures.map(f => f.key), [k], what);
    assert.equal(v.pass, false, what);
  }
  // A number that is not a source position is still compared: counts, sizes, versions, ports' hosts.
  assert.notEqual(normalizeMessage('expected 3 offenders, got 4'), normalizeMessage('expected 3 offenders, got 5'));
  assert.notEqual(normalizeMessage('version 0.2.34'), normalizeMessage('version 0.2.35'));
  assert.notEqual(normalizeMessage('limit is 16MB'), normalizeMessage('limit is 17MB'));
});

test('a test that newly fails is a gate failure (the shape of a PR breaking a repo-wide guard)', () => {
  const base = cases(rec('tests/guard.test.mjs', 'every file is listed'));
  const merged = cases(rec('tests/guard.test.mjs', 'every file is listed', 'missing: org-new.test.mjs'));
  const v = compareGate(base, merged);
  assert.equal(v.pass, false);
  assert.deepEqual(v.newFailures.map(f => f.key), ['tests/guard.test.mjs › every file is listed']);
  assert.deepEqual(v.newFailingFiles, ['tests/guard.test.mjs']);
});

test('a SECOND failure inside a test already failing on base is caught, though the failing set is unchanged', () => {
  const base = cases(rec('tests/fixture.test.mjs', 'specs use the fixture', 'offenders: one.spec.js'));
  const merged = cases(rec('tests/fixture.test.mjs', 'specs use the fixture', 'offenders: one.spec.js, two.spec.js'));
  const v = compareGate(base, merged);
  assert.deepEqual(v.newFailures, [], 'no new failing test: a name-only comparison would pass this');
  assert.equal(v.pass, false);
  assert.equal(v.changedFailures.length, 1);
});

test('the same failure on both sides, differing only by paths, ports and durations, passes', () => {
  const base = cases(rec('tests/x.test.mjs', 't', 'boom at /tmp/a/x in 4ms'));
  const merged = cases(rec('tests/x.test.mjs', 't', 'boom at /tmp/b/x in 9ms'), rec('tests/new.test.mjs', 'n'));
  const v = compareGate(base, merged);
  assert.equal(v.pass, true);
  assert.deepEqual(v.alreadyFailing, ['tests/x.test.mjs › t']);
});

test('a failure the PR fixes is reported as fixed and does not fail the gate', () => {
  const v = compareGate(cases(rec('tests/x.test.mjs', 't', 'boom')), cases(rec('tests/x.test.mjs', 't')));
  assert.equal(v.pass, true);
  assert.deepEqual(v.fixed, ['tests/x.test.mjs › t']);
});

// A test that STOPS RUNNING is not a passing test. Comparing failures alone, every one of these
// printed GATE PASS: the merged run simply had no failure for a test it never ran.
const skipRec = (file, name) => JSON.stringify({ t: 'test:pass', name, nesting: 0, file: `/w/a/${file}`, skip: true, msg: '' });
test('a test file that still exists but is no longer collected BLOCKS the gate', () => {
  const base = cases(rec('tests/guard.test.mjs', 'g'), rec('tests/x.test.mjs', 't'));
  const merged = cases(rec('tests/x.test.mjs', 't'));     // e.g. the PR narrowed the "test" glob
  const v = compareGate(base, merged, { stillExists: () => true });
  assert.deepEqual(v.uncollected, ['tests/guard.test.mjs']);
  assert.equal(v.pass, false);
  const j = judge(v, new Map(), 3);
  assert.equal(j.pass, false, 'the final verdict, not just the candidate list, must refuse');
  assert.deepEqual(j.blocking.map(b => b.kind), ['stopped running']);
});
test('a FAILING base test whose file stops being collected is never reported as fixed', () => {
  const v = compareGate(cases(rec('tests/x.test.mjs', 't', 'boom'), rec('tests/y.test.mjs', 'u')), cases(rec('tests/y.test.mjs', 'u')));
  assert.deepEqual(v.fixed, []);
  assert.equal(judge(v, new Map(), 3).pass, false);
});
test('a deleted test file is a visible deletion, not a stopped test', () => {
  const v = compareGate(cases(rec('tests/old.test.mjs', 'o'), rec('tests/x.test.mjs', 't')), cases(rec('tests/x.test.mjs', 't')),
    { stillExists: f => f !== 'tests/old.test.mjs' });
  assert.deepEqual(v.uncollected, []);
  assert.equal(judge(v, new Map(), 3).pass, true);
});
test('a test the PR newly skips BLOCKS the gate', () => {
  const v = compareGate(cases(rec('tests/x.test.mjs', 't', 'boom')), cases(skipRec('tests/x.test.mjs', 't')));
  assert.deepEqual(v.newlySkipped, ['tests/x.test.mjs › t']);
  assert.deepEqual(v.fixed, [], 'skipping a failing test does not fix it');
  const j = judge(v, new Map(), 3);
  assert.equal(j.pass, false);
  assert.deepEqual(j.blocking.map(b => b.kind), ['newly skipped']);
});
test('a renamed test inside a file that still runs is reported, not blocking', () => {
  const v = compareGate(cases(rec('tests/x.test.mjs', 'old name')), cases(rec('tests/x.test.mjs', 'new name')));
  assert.deepEqual(v.vanished, ['tests/x.test.mjs › old name']);
  assert.equal(judge(v, new Map(), 3).pass, true);
});
test('the gate runs the BASE suite on both sides, never the PR\'s own "test" script', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const runSuite = src.slice(src.indexOf('function runSuite('), src.indexOf('\n}\n', src.indexOf('function runSuite(')));
  assert.doesNotMatch(runSuite, /suiteArgs\(/, 'runSuite must not re-read package.json from the (merged) tree');
});

// An alone run that recorded NOTHING for a candidate (the runner died, OOM, the reporter broke)
// is a missing measurement. It used to be recorded as null — a pass — so the new failure was
// classed 'full-run-only' and NOT COUNTED. It must count as a failed run instead.
test('an alone run with no result for a new failure counts as failing, and the gate refuses', () => {
  const key = 'tests/x.test.mjs › t';
  const v = compareGate(cases(rec('tests/x.test.mjs', 't')), cases(rec('tests/x.test.mjs', 't', 'boom')));
  const empty = aloneOutcomes([], [key]);
  assert.equal(empty.get(key), NOT_RUN_ALONE);
  assert.equal(aloneOutcomes(cases(rec('tests/x.test.mjs', 't')), [key]).get(key), null, 'control: a recorded pass is a pass');
  assert.equal(aloneOutcomes(cases(rec('tests/x.test.mjs', 't', 'boom')), [key]).get(key), 'boom');
  assert.equal(aloneOutcomes([], [key], [], { missing: null }).get(key), null, 'the base side: a test that does not exist yet is not a base failure');
  const reruns = new Map([[key, [empty.get(key), empty.get(key), empty.get(key)]]]);
  const baseReruns = new Map([[key, [null, null, null]]]);
  const j = judge(v, reruns, 3, baseReruns);
  assert.equal(j.pass, false, 'a failure whose alone runs measured nothing must not be waved through');
});

test('firstDifference names the first line that changed', () => {
  assert.deepEqual(firstDifference('a\nb\nc', 'a\nB\nc'), { line: 2, before: 'b', after: 'B' });
  assert.deepEqual(firstDifference('a', 'a\nmore'), { line: 2, before: '(none)', after: 'more' });
  assert.equal(firstDifference('same', 'same'), null);
});

test('judge: only what reproduces alone on the merged side, and not alone on the base, blocks', () => {
  const v = {
    newFailures: [
      { key: 'f › always', message: 'x' }, { key: 'f › sometimes', message: 'x' },
      { key: 'f › load-only', message: 'ENOTEMPTY' }, { key: 'f › red alone on base too', message: 'y' },
    ],
    changedFailures: [
      { key: 'g › guard', before: 'offenders: one', after: 'offenders: one, two' },
      { key: 'g › megabytes', before: 'got 14 MB', after: 'got 21 MB' },
      // Measured: red on both sides, one message under load and another, stable, alone.
      { key: 'g › browser', before: 'log order under load', after: 'log order alone' },
    ],
  };
  const reruns = new Map([
    ['f › always', ['x', 'x', 'x']], ['f › sometimes', [null, 'x', null]], ['f › load-only', [null, null, null]],
    ['f › red alone on base too', ['y', 'y', 'y']],
    ['g › guard', ['offenders: one, two', 'offenders: one, two', 'offenders: one, two']],
    ['g › megabytes', ['got 15 MB', null, 'got 9 MB']],
    ['g › browser', ['log order alone', 'log order alone', 'log order alone']],
  ]);
  const baseReruns = new Map([
    ['f › always', [null, null, null]], ['f › sometimes', [null, null, null]], ['f › load-only', [null, null, null]],
    ['f › red alone on base too', ['y', null, 'y']],
    ['g › guard', ['offenders: one', 'offenders: one', 'offenders: one']],
    ['g › megabytes', [null, null, null]],
    ['g › browser', ['log order alone', 'log order alone', 'log order alone']],
  ]);
  const j = judge(v, reruns, 3, baseReruns);
  assert.equal(j.pass, false);
  assert.deepEqual(j.blocking.map(b => [b.key, b.kind]), [['f › always', 'deterministic'], ['f › sometimes', 'flaky'], ['g › guard', 'changed']]);
  assert.deepEqual(j.warnings.map(w => [w.key, w.kind]), [
    ['f › load-only', 'full-run-only'], ['f › red alone on base too', 'fails alone on base'],
    ['g › megabytes', 'unstable message'], ['g › browser', 'same as base alone'],
  ]);
  assert.equal(j.blocking[2].before, 'offenders: one', 'a blocking change is shown against the base ALONE message');
  const quiet = judge({ newFailures: [v.newFailures[2], v.newFailures[3]], changedFailures: [v.changedFailures[1], v.changedFailures[2]] }, reruns, 3, baseReruns);
  assert.equal(quiet.pass, true, 'noise alone never fails the gate');
});

test('classifyRerun', () => {
  assert.equal(classifyRerun(3, 3), 'deterministic');
  assert.equal(classifyRerun(1, 3), 'flaky');
  assert.equal(classifyRerun(0, 3), 'full-run-only');
});

// ---- end to end: the CLI against a throwaway repo -------------------------------------------

function sandboxRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-gate-repo-'));
  const g = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  const commit = (msg, files) => { for (const [f, s] of Object.entries(files)) write(f, s); g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  g('init', '-q');
  // A guard in the shape of the e2e fixture guards: it scans a directory and lists offenders.
  const base = commit('base', {
    'package.json': JSON.stringify({ type: 'module', scripts: { test: 'node tools/run-tests.mjs "tests/**/*.test.mjs"' } }),
    'tests/ok.test.mjs': "import { test } from 'node:test'; test('ok', () => {});\n",
    'tests/guard.test.mjs': "import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';\n" +
      "test('no spec is bad', () => { assert.deepEqual(fs.readdirSync('specs').filter(f => f.startsWith('bad')), []); });\n",
    'specs/bad-one.js': '',
  });
  return { dir, g, commit, base };
}
const gate = (dir, ...args) => spawnSync(process.execPath, [CLI, ...args, '--fresh', '--runs', '2'], {
  cwd: dir, encoding: 'utf8', env: { ...process.env, PR_GATE_CACHE: path.join(dir, '.git', 'pr-gate-cache') },
});

test('CLI: a PR adding a failing test fails the gate, named and re-run alone', () => {
  const r = sandboxRepo();
  try {
    const pr = r.commit('pr', { 'tests/broken.test.mjs': "import { test } from 'node:test'; test('broken', () => { throw new Error('nope'); });\n" });
    const out = gate(r.dir, r.base, pr);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /BREAKS \(1\)[^\n]*\n  tests\/broken\.test\.mjs › broken\n    deterministic: 2\/2 failed alone merged, 0\/2 alone on base/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('CLI: a PR adding a second offender to an already-red guard fails the gate', () => {
  const r = sandboxRepo();
  try {
    const pr = r.commit('pr', { 'specs/bad-two.js': '' });
    const out = gate(r.dir, r.base, pr);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /BREAKS \(1\)[^\n]*\n  tests\/guard\.test\.mjs › no spec is bad\n    changed: 2\/2 failed alone merged with 1 distinct message\(s\); 1 distinct on base alone\n    first difference, line \d+ of the message:\n      before: .*bad-one\.js'\n      after: {2}.*bad-one\.js',\n/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('CLI: a parent test that starts failing on its own, with every subtest passing, fails the gate', () => {
  const r = sandboxRepo();
  try {
    const parent = body => "import { test } from 'node:test';\ntest('parent', async t => { await t.test('child', () => {}); " + body + " });\n";
    const base = r.commit('parent passes', { 'tests/parent.test.mjs': parent('') });
    const pr = r.commit('parent throws', { 'tests/parent.test.mjs': parent("throw new Error('after the subtests');") });
    const out = gate(r.dir, base, pr);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /BREAKS \(1\)[^\n]*\n  tests\/parent\.test\.mjs › parent\n    deterministic/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('CLI: a harmless PR on a red base passes', () => {
  const r = sandboxRepo();
  try {
    const pr = r.commit('pr', { 'tests/more.test.mjs': "import { test } from 'node:test'; test('more', () => {});\n" });
    const out = gate(r.dir, r.base, pr);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /GATE PASS/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('CLI: an already-red test whose message changes every run does not fail a harmless PR (the noise floor)', () => {
  const r = sandboxRepo();
  try {
    const base = r.commit('noisy red test', { 'tests/noisy.test.mjs': "import { test } from 'node:test';\ntest('noisy', () => { throw new Error('got ' + Math.random() + ' MB'); });\n" });
    const pr = r.commit('harmless', { 'README': 'x\n' });
    const out = gate(r.dir, base, pr);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /NOT COUNTED[^\n]*\n  tests\/noisy\.test\.mjs › noisy\n    unstable message: 2\/2 failed alone merged with 2 distinct message\(s\); 2 distinct on base alone/);
    assert.match(out.stdout, /GATE PASS/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('CLI: a base whose suite uses describe() blocks gates cleanly (the over-count that refused an unchanged base)', () => {
  const r = sandboxRepo();
  try {
    const base = r.commit('describe blocks', { 'tests/blocks.test.mjs': "import { test, describe } from 'node:test';\n" +
      "describe('first', () => { test('a', () => {}); test('b', () => {}); });\n" +
      "describe('second', () => { describe('inner', () => { test('c', () => {}); }); });\n" });
    const pr = r.commit('harmless', { 'README': 'x\n' });
    const out = gate(r.dir, base, pr);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.doesNotMatch(out.stderr, /incomplete record/);
    // 3 tests from blocks.test.mjs + ok + guard + the 3 suites, each read and compared.
    assert.match(out.stdout, /^base {3}\w+: 8 tests, 1 fail, 0 skipped$/m);
    assert.match(out.stdout, /GATE PASS/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

// A genuinely SHORT record: a test file finds the reporter's destination in its runner's argv and
// truncates it mid-run, so results the runner counted are gone from the file. The refusal must
// fire. Linux only: the destination is read from /proc.
test('CLI: a record missing results the runner reported is still refused with exit 2', { skip: process.platform !== 'linux' && 'reads /proc' }, () => {
  const r = sandboxRepo();
  try {
    const base = r.commit('truncator', { 'tests/truncate.test.mjs': "import { test } from 'node:test'; import fs from 'node:fs';\n" +
      "test('truncate the record', async () => {\n" +
      "  const argv = fs.readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8').split('\\0');\n" +
      "  const out = argv.find(a => a.startsWith('--test-reporter-destination=')).slice('--test-reporter-destination='.length);\n" +
      // Wait until both other files' results are on disk, then cut the record back to its first
      // result: results the runner counted are gone, and some are still read, so this is the
      // incomplete-record refusal and not the "no results at all" one.
      "  const has = t => fs.existsSync(out) && t.every(n => fs.readFileSync(out, 'utf8').includes(JSON.stringify(n)));\n" +
      "  for (let i = 0; i < 400 && !has(['ok', 'no spec is bad']); i++) await new Promise(res => setTimeout(res, 25));\n" +
      "  if (!has(['ok', 'no spec is bad'])) throw new Error('the other results were never recorded');\n" +
      "  const rec = fs.readFileSync(out, 'utf8');\n" +
      "  fs.truncateSync(out, rec.indexOf('\\n', rec.indexOf('\"t\":\"test:pass\"')) + 1);\n" +
      "});\n" });
    const pr = r.commit('harmless', { 'README': 'x\n' });
    const out = gate(r.dir, base, pr);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    const m = out.stderr.match(/reported (\d+) tests and (\d+) suites but (\d+) test and (\d+) suite results were read; refusing to compare an incomplete record/);
    assert.ok(m, out.stderr);
    assert.ok(Number(m[3]) < Number(m[1]), `fewer tests read than reported: ${m[0]}`);
    assert.doesNotMatch(out.stdout, /GATE PASS/);
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('CLI: a conflict, a PR already in the base, and an unknown commit are exit 2, never a pass', () => {
  const r = sandboxRepo();
  try {
    r.g('checkout', '-q', '-b', 'side');
    const side = r.commit('side', { 'tests/ok.test.mjs': '// side\n' });
    r.g('checkout', '-q', '-');
    const main = r.commit('main', { 'tests/ok.test.mjs': '// main\n' });
    const conflict = gate(r.dir, main, side);
    assert.equal(conflict.status, 2, conflict.stdout + conflict.stderr);
    assert.match(conflict.stderr, /does not merge cleanly[\s\S]*tests\/ok\.test\.mjs/);
    const already = gate(r.dir, main, r.base);
    assert.equal(already.status, 2);
    assert.match(already.stderr, /already in/);
    assert.equal(gate(r.dir, main, 'no-such-ref').status, 2);
    assert.deepEqual(fs.readdirSync(r.dir).sort(), ['.git', 'package.json', 'specs', 'tests'], 'the checkout it runs from is untouched');
    assert.equal(r.g('status', '--porcelain'), '');
    assert.equal(r.g('worktree', 'list').split('\n').length, 1, 'its worktree was removed');
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

// Which files the gate runs, read from the BASE: the command line wins, then an explicit
// declaration, then the path arguments of the "test" script. Nothing readable = node's discovery.
test('suitePatterns: command line, then prGate.tests, then the test script paths', () => {
  const pkg = o => JSON.stringify(o);
  const drop = a => a.filter(x => !x.startsWith('-'));
  assert.deepEqual(suitePatterns(pkg({ prGate: { tests: ['a/*.mjs'] } }), ['x.test.mjs']), ['x.test.mjs']);
  assert.deepEqual(suitePatterns(pkg({ prGate: { tests: ['a/*.mjs'] }, scripts: { test: 'node --test b/' } })), ['a/*.mjs']);
  assert.deepEqual(suitePatterns(pkg({ scripts: { test: 'node tools/run-tests.mjs "tests/**/*.test.mjs"' } }), [], drop), ['tests/**/*.test.mjs']);
  assert.deepEqual(suitePatterns(pkg({ scripts: { test: "node --test --test-concurrency=1 'test/*.js' more/" } }), [], drop), ['test/*.js', 'more/']);
  assert.deepEqual(suitePatterns(pkg({ scripts: { test: 'vitest run' } })), [], 'another runner is not guessed at');
  assert.deepEqual(suitePatterns(pkg({ scripts: { test: 'node --test a && node --test b' } })), [], 'a compound script is not half-read');
  assert.deepEqual(suitePatterns('{ not json'), []);
});
