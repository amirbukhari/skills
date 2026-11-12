#!/usr/bin/env node
// Which tests still pass with their subject taken away?
//
// Runs each test file twice — once as is, once under a mutation operator — and prints every
// test that PASSES BOTH times. A test that cannot tell its subject from nothing is not
// evidence about the subject.
//
//   node run.mjs --op m1 --population lib
//   node run.mjs --op m2 --population other
//   node run.mjs --op m12 tests/foo.test.mjs tests/bar.test.mjs
//
//   --op m1    stub the test file's direct imports from the subject folders   (hooks.mjs)
//        m2    empty every repository-source read in the test process        (m2.mjs)
//        m12   both
//   --population lib    files that import a subject folder
//                other  files that import no repository module
//                child  files matching --child-pattern (UNMEASURED by both operators: the
//                       subject runs in another process, which neither touches)
//                all    every test file
//   --repo <dir>        the repository under test (default: the git checkout the cwd is in)
//   --tests-dir <dir>   where test files (*.test.js|mjs|cjs) live, relative to it (default: tests, else test)
//   --subjects a,b      the folders whose modules are subjects (default: lib,bin,tools,src)
//   --child-pattern <regex>   source text that marks a test whose subject runs in a child
//                       process, e.g. 'bootServer|spawnApp' (default: none)
//   --unset-env <regex> environment variable NAMES removed for the runs, e.g. '^(APP_|MYTOOL_)'
//   --jobs N            files in parallel (default 4). A full suite at once can exhaust a small machine.
//   --timeout-ms N      per test (default 20000)
//
// A survivor is a lead, not a verdict. Three kinds survive by construction and are not
// weak tests: a subject that runs in a CHILD process (neither operator reaches it), a test
// of exported DATA (M1 stubs functions only), and an absence guard or fixture self-check
// that is true of an empty file by its nature. Read each one before changing it.
//
// Every run gets a fresh temp HOME/TMPDIR, and an env without NODE_OPTIONS and --unset-env's names.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classify } from './classify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPS = {
  m1: [path.join(HERE, 'm1.mjs')],
  m2: [path.join(HERE, 'm2.mjs')],
  m12: [path.join(HERE, 'm1.mjs'), path.join(HERE, 'm2.mjs')],
};

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const die = msg => { console.error(`subject-mutation: ${msg}`); process.exit(2); };
const op = opt('--op', 'm1');
const population = opt('--population', null);
const jobs = Number(opt('--jobs', '4'));
const testTimeout = Number(opt('--timeout-ms', '20000'));
if (!OPS[op]) die(`--op must be one of ${Object.keys(OPS).join(', ')}`);
if (population && !['lib', 'other', 'child', 'all'].includes(population)) die('--population must be lib, other, child or all');

const repoArg = opt('--repo', null);
const top = repoArg ? null : spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
const REPO = fs.realpathSync(path.resolve(repoArg || (top.status === 0 ? top.stdout.trim() : process.cwd())));
const testsDir = (opt('--tests-dir', null) || (fs.existsSync(path.join(REPO, 'tests')) || !fs.existsSync(path.join(REPO, 'test')) ? 'tests' : 'test')).replace(/^\.?\/+|\/+$/g, '');
const subjects = opt('--subjects', 'lib,bin,tools,src').split(',').map(s => s.trim().replace(/^\.?\/+|\/+$/g, '')).filter(Boolean);
const regexOpt = name => { const v = opt(name, null); if (!v) return null; try { return new RegExp(v); } catch (e) { die(`${name}: ${e.message}`); } };
const childPattern = regexOpt('--child-pattern');
const unsetEnv = regexOpt('--unset-env');

function testFiles(dir) {
  const out = [];
  const walk = d => {
    let es = [];
    try { es = fs.readdirSync(path.join(REPO, d), { withFileTypes: true }); } catch { return; }
    for (const e of es.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(`${d}/${e.name}`); }
      else if (/\.test\.[cm]?js$/.test(e.name)) out.push(`${d}/${e.name}`);
    }
  };
  walk(dir);
  return out;
}

let files = args.filter(a => !a.startsWith('--'));
if (population) {
  files = testFiles(testsDir).filter(f => population === 'all' || classify(fs.readFileSync(path.join(REPO, f), 'utf8'), { subjects, childPattern }) === population);
}
if (!files.length) die(population ? `no ${population} test files under ${testsDir}/` : 'no test files: name some, or pass --population');

function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'NODE_OPTIONS' || k === 'NODE_TEST_CONTEXT' || (unsetEnv && unsetEnv.test(k))) continue;
    env[k] = v;
  }
  return env;
}

function runOnce(file, imports, timeoutMs) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'subject-mutation-'));
  const env = { ...cleanEnv(), HOME: home, USERPROFILE: home, TMPDIR: home, TMP: home, TEMP: home,
    SUBJECT_MUTATION_REPO: REPO, SUBJECT_MUTATION_TESTS_DIR: testsDir, SUBJECT_MUTATION_SUBJECTS: subjects.join(',') };
  // file: URLs, not paths: NODE_OPTIONS splits on spaces, and a path may hold one.
  if (imports.length) env.NODE_OPTIONS = imports.map(p => `--import=${pathToFileURL(p).href}`).join(' ');
  return new Promise(resolve => {
    const child = spawn(process.execPath, [
      '--test', '--test-concurrency=1', `--test-timeout=${testTimeout}`,
      `--test-reporter=${pathToFileURL(path.join(HERE, 'reporter.mjs')).href}`, '--test-reporter-destination=stdout', file,
    ], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    // Kill the whole process GROUP: killing the runner alone orphans the test processes it
    // started, which keep the stdout pipe open, so 'close' would never fire.
    const timer = setTimeout(() => {
      try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {}
      child.stdout.destroy();
    }, timeoutMs);
    child.on('close', () => {
      clearTimeout(timer);
      fs.rmSync(home, { recursive: true, force: true });
      const rows = out.split('\n').filter(Boolean).map(l => l.split('\t'));
      resolve(new Map(rows.map(([st, , name]) => [name, st])));
    });
  });
}

const results = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    const ctl = await runOnce(file, [], 120_000);
    const mut = await runOnce(file, OPS[op], 60_000);
    const passed = [...ctl].filter(([, st]) => st === 'PASS').map(([n]) => n);
    const survivors = passed.filter(n => mut.get(n) === 'PASS');
    results.push({ file, passed: passed.length, survivors });
    process.stderr.write(`${results.length}/${files.length} ${file}: ${survivors.length}/${passed.length} survive\n`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));

results.sort((a, b) => b.survivors.length - a.survivors.length || a.file.localeCompare(b.file));
for (const r of results) for (const n of r.survivors) console.log(`${r.file}\t${n}`);
const total = results.reduce((s, r) => s + r.passed, 0);
const surv = results.reduce((s, r) => s + r.survivors.length, 0);
console.log(`\n# ${op}${population ? ` --population ${population}` : ''}: ${files.length} files, ${total} tests pass unmutated, `
  + `${surv} still pass mutated, in ${results.filter(r => r.survivors.length).length} files`);
