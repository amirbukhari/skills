#!/usr/bin/env node
// THE MERGE GATE: does merging <pr> into <base> make any existing test fail?
//
//   node pr-gate.mjs <base> <pr>            base and pr are any commit-ish (sha, branch, origin/x)
//   node pr-gate.mjs <base> <pr> --fresh    re-run the base suite instead of using its cache
//   node pr-gate.mjs <base> <pr> --runs 5   re-run each newly failing file alone 5 times (default 3)
//   node pr-gate.mjs <base> <pr> --tests <pattern>   the suite, as node --test paths (repeatable)
//
// Exit 0: no new failing test, and no already-failing test failing differently.
// Exit 1: the merge breaks something; the report names each test.
// Exit 2: could not gate (unknown commit, merge conflict, the PR is already in the base, or a
//         suite run produced no report). Never read 2 as a pass.
//
// It runs the WHOLE node:test suite (lib/pr-gate.js › suitePatterns says which files) on the base and on the base with the PR
// merged, each in a throwaway worktree under a temp HOME, and compares them per test. Why the
// whole suite and not "the tests for what the PR touches": see lib/pr-gate.js. The base result
// is cached per base commit, so gating a queue of PRs against one tip pays for the base once.
//
// It never touches the checkout it is run from: no checkout, no merge, no stash there. The
// worktrees live in the system temp dir and are removed on exit, including on a failed merge.
// A run killed too hard to clean up (SIGKILL) leaves its work dir; the next run removes it.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRoot, rootEnv, pathArgs, GATE_PREFIX, GATE_MARKER, staleGateDirs, removeTree } from './lib/test-temp-root.js';
import { parseRecords, normalizeMessage, compareGate, judge, firstDifference, aloneOutcomes, suitePatterns } from './lib/pr-gate.js';

const REPORTER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pr-gate-reporter.mjs');
const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (n, d) => { const i = argv.indexOf(n); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const fresh = flag('--fresh');
const cliTests = [];
for (let t; (t = opt('--tests', undefined)) !== undefined;) cliTests.push(t);
const runs = Math.max(1, parseInt(opt('--runs', '3'), 10) || 3);
if (argv.length !== 2) {
  console.error('usage: node pr-gate.mjs <base> <pr> [--fresh] [--runs N] [--tests <pattern>]...');
  process.exit(2);
}

const git = (args, cwd = repo) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
if (top.status !== 0) { console.error('pr-gate: not inside a git checkout'); process.exit(2); }
const repo = top.stdout.trim();

function resolve(ref) {
  const r = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (r.status !== 0) { console.error(`pr-gate: unknown commit "${ref}" (fetch it first)`); process.exit(2); }
  return r.stdout.trim();
}
const base = resolve(argv[0]), pr = resolve(argv[1]);
const short = s => s.slice(0, 8);

// The suite is the one the BASE declares (or the one named on the command line).
function suiteArgs(dir) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir, 'package.json'), 'utf8'); } catch {}
  return suitePatterns(text, cliTests, pathArgs);
}

// A gate whose process is gone left its work dir behind: its worktrees first (so git forgets
// them), then the dir. The rules for "whose process is gone" are lib/test-temp-root.js's.
const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (const dir of staleGateDirs({ fs, tmpBase: os.tmpdir(), uid, alive })) {
  for (const t of ['tree', 'base-tree']) if (fs.existsSync(path.join(dir, t))) git(['worktree', 'remove', '--force', path.join(dir, t)]);
  const e = removeTree(fs, dir, { uid });
  process.stderr.write(e ? `pr-gate: could not remove ${dir} (its run is gone): ${e.code || e.message}\n` : `pr-gate: removed ${dir} (its run is gone)\n`);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), GATE_PREFIX));
fs.writeFileSync(path.join(work, GATE_MARKER), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
const wt = path.join(work, 'tree');
// A second checkout of the bare base, made only when there are alone runs to do, so the merged
// and base runs can alternate instead of all merged runs going first: see `rerunAlone`.
const baseWt = path.join(work, 'base-tree');
let baseAdded = false;
const cacheDir = process.env.PR_GATE_CACHE || path.join(os.tmpdir(), 'pr-gate-cache');
let added = false;
function cleanup() {
  if (added) {
    git(['merge', '--abort'], wt);
    git(['worktree', 'remove', '--force', wt]);
  }
  if (baseAdded) git(['worktree', 'remove', '--force', baseWt]);
  // Not fs.rmSync in a bare try: a test can leave a directory without its execute bit, rmSync
  // then stops at the top of the tree, and the empty catch hid the whole work dir staying put.
  const e = removeTree(fs, work, { uid });
  if (e) console.error(`pr-gate: could not remove ${work}: ${e.code || e.message}`);
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(2));
const fail2 = msg => { console.error(`pr-gate: ${msg}`); process.exit(2); };

// Each run gets its own HOME (code under test may write to whatever HOME it sees) and its own
// test temp root, both inside `work`, so nothing lands in the real home or the shared tmp.
let n = 0;
function runNode(args, cwd = wt) {
  const home = path.join(work, `home-${++n}`);
  fs.mkdirSync(home);
  const root = createRoot(fs, work, process.pid * 1000 + n);
  // Run from inside a test, the child would inherit NODE_TEST_CONTEXT and report to the outer
  // runner instead of to its own reporter, leaving the JUnit file empty.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  return spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...env, HOME: home, USERPROFILE: home, ...rootEnv(root) },
  });
}

// The suite is the BASE's: read once, from the base tree, and used for both runs. Read per run,
// the merged side took the PR's own package.json, so a PR that narrowed its "test" glob was
// gated on the tests it chose to keep.
let patterns = null;
function runSuite(label) {
  const out = path.join(work, `${label.replace(/[^\w.-]+/g, '_')}.jsonl`);
  process.stderr.write(`pr-gate: running the full suite on ${label}...\n`);
  // Reporter flags go BEFORE the patterns: node passes anything after the first pattern to the
  // test files as their own argv, so a trailing --test-reporter is silently ignored.
  if (!patterns) fail2('internal: the base suite patterns were not read before a run');
  runNode(['--test', ...[`--test-reporter=${pathToFileURL(REPORTER).href}`, `--test-reporter-destination=${out}`, ...patterns]]);
  const { cases, total, suites, read, complete } = parseRecords(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '', wt);
  if (!cases.length) fail2(`the ${label} run produced no test results; nothing to compare`);
  // A result the gate did not read is a failure it cannot see: refuse rather than compare.
  if (!complete) fail2(`the ${label} run reported ${total ?? 'no'} tests and ${suites ?? 'no'} suites but ${read.tests} test and ${read.suites} suite results were read; refusing to compare an incomplete record`);
  return cases.map(c => ({ ...c, message: normalizeMessage(c.message, [wt]) }));
}

if (git(['worktree', 'add', '--detach', '--quiet', wt, base]).status !== 0) fail2(`could not create a worktree at ${short(base)}`);
added = true;
const nm = path.join(repo, 'node_modules');
const linkModules = dir => { if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir'); };
linkModules(wt);
patterns = suiteArgs(wt);

// Is the PR already in the base? Then the merge is a no-op and "passes" by testing nothing.
if (git(['merge-base', '--is-ancestor', pr, base]).status === 0) fail2(`${short(pr)} is already in ${short(base)}; there is nothing to gate`);

// Merge by SHA and CHECK it took. A merge that fails quietly leaves the bare base checked out,
// and the gate would then pass a PR it never tested.
function merge() {
  const m = git(['-c', 'user.name=pr-gate', '-c', 'user.email=pr-gate@localhost', 'merge', '--no-ff', '--no-commit', pr], wt);
  if (m.status !== 0) {
    const u = git(['diff', '--name-only', '--diff-filter=U'], wt).stdout.trim();
    fail2(`${short(pr)} does not merge cleanly into ${short(base)}${u ? `; conflicted:\n  ${u.split('\n').join('\n  ')}` : `:\n${m.stdout}${m.stderr}`}`);
  }
  const mh = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], wt);
  if (mh.status !== 0 || mh.stdout.trim() !== pr) fail2(`the merge of ${short(pr)} did not take (no MERGE_HEAD); refusing to test the bare base`);
}
// A conflict is known before the base run is paid for: try the merge, then back it out.
merge();
if (git(['merge', '--abort'], wt).status !== 0 || git(['status', '--porcelain', '--untracked-files=no'], wt).stdout.trim()) fail2('could not back out the trial merge');

// The cache is per base commit AND per suite: the same base gated with another --tests is another run.
const suiteId = createHash('sha256').update(JSON.stringify(patterns)).digest('hex').slice(0, 12);
const cacheFile = path.join(cacheDir, `base-v2-${base}-${suiteId}.json`);
let baseCases = null;
if (!fresh) { try { baseCases = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {} }
if (!baseCases) {
  baseCases = runSuite(`base ${short(base)}`);
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(baseCases)); } catch {}
} else process.stderr.write(`pr-gate: base ${short(base)} from cache (--fresh to re-run)\n`);

merge();

const mergedCases = runSuite(`${short(base)} + ${short(pr)}`);
const v = compareGate(baseCases, mergedCases, { stillExists: f => fs.existsSync(path.join(wt, f)) });

const c = r => `${r.tests} tests, ${r.fail} fail, ${r.skip} skipped`;
console.log(`base   ${short(base)}: ${c(v.base)}`);
console.log(`merged ${short(base)} + ${short(pr)}: ${c(v.merged)}`);
if (v.fixed.length) console.log(`\nfailing on base, passing merged (${v.fixed.length}):\n${v.fixed.map(k => `  ${k}`).join('\n')}`);
if (v.vanished.length) console.log(`\nran on base, absent merged while their file still ran (${v.vanished.length}) - renamed or deleted; read the diff:\n${v.vanished.map(k => `  ${k}`).join('\n')}`);
if (v.alreadyFailing.length) console.log(`\nalready failing on base, failure unchanged (${v.alreadyFailing.length - v.changedFailures.length}); compared by message, not just by name`);

// Re-run each candidate's file alone, `runs` times on each side, and record what each candidate
// test did. Alone is compared with alone: see `judge`. The two sides ALTERNATE run by run
// (merged, base, merged, base...) in two checkouts. Running every merged run first and then every
// base run was measured to be wrong: a load-sensitive test failed 3/5 merged and 0/5 base, and
// interleaving showed both trees failing in the same stretch and passing in the next, so the
// verdict was measuring when the machine was busy, not the PR. Alternating spreads a busy
// stretch over both sides.
const fileOf = k => k.slice(0, k.indexOf(' › '));
const keys = [...v.newFailures, ...v.changedFailures].map(f => f.key);
const files = [...new Set(keys.map(fileOf))].sort();
function aloneRun(file, tree, got, { missing } = {}) {
  const out = path.join(work, `alone-${n + 1}.jsonl`);
  runNode(['--test', `--test-reporter=${pathToFileURL(REPORTER).href}`, `--test-reporter-destination=${out}`, file], tree);
  const mine = keys.filter(k => fileOf(k) === file);
  const outcome = aloneOutcomes(parseRecords(fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '', tree).cases, mine, [tree], { missing });
  for (const k of mine) got.get(k).push(outcome.get(k));
}
const reruns = new Map(keys.map(k => [k, []])), baseReruns = new Map(keys.map(k => [k, []]));
if (files.length) {
  process.stderr.write(`pr-gate: re-running ${files.length} file(s) alone ${runs}x on each side, merged and base alternating...\n`);
  if (git(['worktree', 'add', '--detach', '--quiet', baseWt, base]).status !== 0) fail2(`could not create a base worktree at ${short(base)} for the alone runs`);
  baseAdded = true;
  if (git(['rev-parse', 'HEAD'], baseWt).stdout.trim() !== base
    || git(['status', '--porcelain', '--untracked-files=no'], baseWt).stdout.trim()) fail2('the base worktree for the alone runs is not the bare base');
  linkModules(baseWt);
  for (const file of files) {
    for (let i = 0; i < runs; i++) {
      aloneRun(file, wt, reruns);
      aloneRun(file, baseWt, baseReruns, { missing: null });
    }
  }
}
const j = judge(v, reruns, runs, baseReruns);

const clip = t => (t.length > 300 ? t.slice(0, 300) + '…' : t);
const firstLines = (s, k = 4) => s.split('\n').slice(0, k).map(l => `      ${clip(l)}`).join('\n');
const show = f => {
  if (f.before === undefined) return `  ${f.key}\n    ${f.kind}: ${f.detail}\n${firstLines(f.message)}`;
  const d = firstDifference(f.before, f.after);
  return `  ${f.key}\n    ${f.kind}: ${f.detail}` + (d ? `\n    first difference, line ${d.line} of the message:\n      before: ${clip(d.before)}\n      after:  ${clip(d.after)}` : '');
};
if (j.warnings.length) {
  console.log(`\nNOT COUNTED, did not reproduce when re-run alone ${runs}x (${j.warnings.length}) - read them, but they are not this PR's on the evidence:`);
  for (const f of j.warnings) console.log(show(f));
}
if (j.blocking.length) {
  console.log(`\nBREAKS (${j.blocking.length}) - reproduced when re-run alone:`);
  for (const f of j.blocking) console.log(show(f));
}
console.log(j.pass
  ? '\nGATE PASS: no test newly fails, no already-failing test fails differently (alone), and no test stopped running'
  : '\nGATE FAIL: merging this PR breaks the tests under BREAKS');
process.exitCode = j.pass ? 0 : 1;
