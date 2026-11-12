// The Playwright half of the skip guard: playwright-skip-guard-reporter.mjs fails a run that
// skipped or fixme'd anything, or that selected a project the config switched off whole.
// Driven with the reporter API's own shapes (a suite whose allTests() yields test cases with
// results), so no browser is needed to prove it says NO.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import Reporter, { PROJECT_OFF_ENV } from '../scripts/playwright-skip-guard-reporter.mjs';
import { platformOnly } from '../scripts/lib/skip-guard.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function tc(title, status, annotations = [], project = 'chromium') {
  return {
    title,
    titlePath: () => ['', project, 'x.spec.js', title],
    location: { file: path.join(ROOT, 'tests/e2e/x.spec.js'), line: 7 },
    parent: { project: () => ({ name: project }) },
    annotations: [],
    results: status ? [{ status, annotations }] : [],
  };
}
function run(tests, opts = {}) {
  const lines = [];
  const r = new Reporter({ log: l => lines.push(l), projectOff: null, ...opts });
  r.onBegin({ configFile: path.join(ROOT, 'playwright.config.js') }, { allTests: () => tests });
  return { verdict: r.onEnd({ status: 'passed' }), out: lines.join('\n') };
}

test('a clean run passes and says nothing', () => {
  const { verdict, out } = run([tc('a', 'passed'), tc('b', 'failed')]);
  assert.equal(verdict, undefined);
  assert.equal(out, '');
});

test('a skipped test, a fixme and a test.skip(cond) inside a body each fail the run, by name and reason', () => {
  const { verdict, out } = run([
    tc('ran', 'passed'),
    tc('skipped', 'skipped', [{ type: 'skip', description: 'needs a running server' }]),
    tc('quarantined', 'skipped', [{ type: 'fixme', description: 'QUARANTINED (x): reason' }]),
    tc('bare', 'skipped'),
  ]);
  assert.deepEqual(verdict, { status: 'failed' });
  assert.match(out, /FAIL: 3 test\(s\) skipped or todo/);
  assert.match(out, /\[chromium\] skipped — needs a running server/);
  assert.match(out, /\[chromium\] quarantined — QUARANTINED \(x\): reason/);
  assert.match(out, /\] tests\/e2e\/x\.spec\.js:7 ›/, 'repo-relative, like playwright\'s own lines');
});

test('a platform-only skip is accepted off its platform and printed; on its platform it fails', () => {
  const t = tc('cmd-v', 'skipped', [{ type: 'skip', description: platformOnly('darwin', 'mac only') }]);
  const off = run([t], { platform: 'linux' });
  assert.equal(off.verdict, undefined);
  assert.match(off.out, /1 platform-only skip\(s\) accepted on this OS/);
  assert.deepEqual(run([t], { platform: 'darwin' }).verdict, { status: 'failed' });
});

test('a selected project the config switched off fails the run, read from the environment the config sets', () => {
  const prev = process.env[PROJECT_OFF_ENV];
  process.env[PROJECT_OFF_ENV] = JSON.stringify({ name: 'webkit-mobile', notice: 'frozen webkit' });
  try {
    const lines = [];
    const r = new Reporter({ log: l => lines.push(l) });
    r.onBegin({ rootDir: ROOT }, { allTests: () => [tc('a', 'passed')] });
    assert.deepEqual(r.onEnd(), { status: 'failed' });
    assert.match(lines.join('\n'), /project webkit-mobile was selected and did not run — frozen webkit/);
  } finally {
    if (prev === undefined) delete process.env[PROJECT_OFF_ENV]; else process.env[PROJECT_OFF_ENV] = prev;
  }
});

