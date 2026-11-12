// subject-mutation, measured on a real throwaway project: a test that checks its subject's
// result dies under the operator, a test that only calls it survives, and the three kinds that
// survive by construction (exported data, an absence guard, a subject in a child) do survive.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classify } from '../scripts/classify.mjs';

const RUN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'run.mjs');

function project() {
  // A space in the path on purpose: the operators are loaded through NODE_OPTIONS.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subject mutation-'));
  const w = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  w('package.json', JSON.stringify({ type: 'module' }));
  w('src/math.js', "export const add = (a, b) => a + b;\nexport const LIMITS = new Set([1, 2]);\nexport const api = { name: 'math', twice: x => x * 2 };\n");
  w('tests/math.test.js', [
    "import test from 'node:test'; import assert from 'node:assert/strict';",
    "import { add, LIMITS, api } from '../src/math.js';",
    "test('strong: checks the result', () => { assert.equal(add(1, 2), 3); });",
    "test('weak: only calls it', () => { add(1, 2); });",
    "test('data: exported set', () => { assert.ok(LIMITS.has(1)); });",
    "test('object: data kept, member stubbed', () => { assert.equal(api.name, 'math'); assert.equal(api.twice(2), 4); });",
  ].join('\n') + '\n');
  w('tests/source.test.js', [
    "import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path';",
    "const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'math.js'), 'utf8');",
    "test('presence: the export is there', () => { assert.match(src, /export const add/); });",
    "test('absence: no eval', () => { assert.doesNotMatch(src, /eval\\(/); });",
    "test('reads its own fixture', () => { assert.match(fs.readFileSync(path.join(import.meta.dirname, 'fixture.txt'), 'utf8'), /kept/); });",
  ].join('\n') + '\n');
  w('tests/fixture.txt', 'kept\n');
  return dir;
}
function run(dir, ...args) {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, [RUN, '--repo', dir, ...args], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
  const survivors = r.stdout.split('\n').filter(l => l.includes('\t')).map(l => l.split('\t')).map(([f, n]) => `${f} › ${n}`).sort();
  return { ...r, survivors, summary: r.stdout.trim().split('\n').pop() };
}

test('M1 stubs the imported functions: a test that checks the result dies, one that does not survives', () => {
  const dir = project();
  try {
    const r = run(dir, '--op', 'm1', '--population', 'lib');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.survivors, ['tests/math.test.js › data: exported set', 'tests/math.test.js › weak: only calls it']);
    assert.match(r.summary, /^# m1 --population lib: 1 files, 4 tests pass unmutated, 2 still pass mutated, in 1 files$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('M2 empties source reads in the test process: a presence check dies, an absence guard and a fixture read survive', () => {
  const dir = project();
  try {
    const r = run(dir, '--op', 'm2', '--population', 'other');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.survivors, ['tests/source.test.js › absence: no eval', 'tests/source.test.js › reads its own fixture']);
    assert.equal(fs.readFileSync(path.join(dir, 'src/math.js'), 'utf8').includes('export const add'), true, 'nothing on disk is changed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('named files, --subjects and --tests-dir: a folder that is not a subject is not stubbed', () => {
  const dir = project();
  try {
    const none = run(dir, '--op', 'm1', '--subjects', 'lib', 'tests/math.test.js');
    assert.equal(none.survivors.length, 4, 'src is not a subject here, so every test survives:\n' + none.stdout);
    fs.renameSync(path.join(dir, 'tests'), path.join(dir, 'spec'));
    const moved = run(dir, '--op', 'm1', '--tests-dir', 'spec', '--population', 'lib');
    assert.deepEqual(moved.survivors, ['spec/math.test.js › data: exported set', 'spec/math.test.js › weak: only calls it']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('usage errors exit 2 and run nothing', () => {
  const dir = project();
  try {
    assert.equal(run(dir, '--op', 'm9', '--population', 'all').status, 2);
    assert.equal(run(dir, '--op', 'm1').status, 2);
    assert.equal(run(dir, '--op', 'm1', '--population', 'child').status, 2, 'no child-pattern, so no child files');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('classify: child pattern first, then a subject import, else other', () => {
  assert.equal(classify("import { a } from '../src/a.js';"), 'lib');
  assert.equal(classify("const m = await import('../../lib/x.mjs');"), 'lib');
  assert.equal(classify("import fs from 'node:fs';"), 'other');
  assert.equal(classify("import { a } from '../app/a.js';"), 'other');
  assert.equal(classify("import { a } from '../app/a.js';", { subjects: ['app'] }), 'lib');
  assert.equal(classify("import { boot } from './harness.mjs'; import { a } from '../src/a.js'; bootServer();", { childPattern: /bootServer/ }), 'child');
});
