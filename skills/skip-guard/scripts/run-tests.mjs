#!/usr/bin/env node
// A `node --test` runner for a package.json "test" script: run the suite under ONE temp root,
// remove it afterwards, and FAIL the run if any test was skipped or todo.
//
//   node run-tests.mjs "tests/**/*.test.mjs"          the suite (put this in package.json)
//   node run-tests.mjs tests/foo.test.mjs             just these files (or globs)
//   npm test -- --test-name-pattern=picker            extra node --test arguments, appended
//   RUN_TESTS_KEEP_TMP=1 npm test                     keep the root and print where it is
//   RUN_TESTS_GLOB='test/**/*.test.js'                the glob used when no argument is a path
//   RUN_TESTS_UNSET=APP_STATE_DIR,APP_HOME            variables removed from the tests' environment
// Arguments are passed to `node --test` unchanged; when none is a path, the default glob is
// appended (lib/test-temp-root.js › testArgs). The temp root, and the narrow rules for sweeping
// roots a killed run left behind, are in lib/test-temp-root.js.
//
// A run in which ANY test was skipped or todo FAILS, listing each one (lib/skip-guard.js says
// why and names the one declared exception). The count comes from a reporter added to every
// run (skip-census-reporter.mjs), so it is what the runner did, not what the source says.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRoot, staleRoots, rootEnv, testArgs, removeTree, DEFAULT_GLOB } from './lib/test-temp-root.js';
import { censusArgs, parseCensus, judgeSkips, verdictLines } from './lib/skip-guard.js';

const tmpBase = os.tmpdir();
const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// removeTree, not a bare rmSync: a test can leave a directory without its execute bit, and
// rmSync then gives up at the top of the tree (lib/test-temp-root.js › removeTree says why).
for (const dir of staleRoots({ fs, tmpBase, uid, alive })) {
  const e = removeTree(fs, dir, { uid });
  if (e) console.error(`run-tests: could not remove ${dir} (its run is gone): ${e.code || e.message}`);
  else console.log(`run-tests: removed ${dir} (its run is gone)`);
}

const root = createRoot(fs, tmpBase, process.pid);
const keep = process.env.RUN_TESTS_KEEP_TMP === '1';

// A run started from inside a live instance of the application under test inherits that
// instance's environment, and every test that resolves a state dir from process.env (or passes
// process.env to a child) would then read and write the LIVE instance's files. RUN_TESTS_UNSET
// names the variables the suite must never inherit; tests that need one set it explicitly.
const inherited = { ...process.env };
for (const name of String(process.env.RUN_TESTS_UNSET || '').split(',').map(x => x.trim()).filter(Boolean)) delete inherited[name];
delete inherited.RUN_TESTS_UNSET;
const census = path.join(root, '.skip-census.jsonl');
const censusReporter = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'skip-census-reporter.mjs')).href;
const args = testArgs(process.argv.slice(2), process.env.RUN_TESTS_GLOB || DEFAULT_GLOB);
const child = spawn(process.execPath, ['--test', ...censusArgs(args.slice(1), { reporter: censusReporter, destination: census })], {
  stdio: 'inherit',
  env: { ...inherited, ...rootEnv(root) },
});

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (keep) { console.log(`run-tests: kept ${root}`); return; }
  const e = removeTree(fs, root, { uid });
  if (e) console.error(`run-tests: could not remove ${root}: ${e.message}`);
}

// Forward a stop to the suite and clean up once it has exited, never before: removing the
// root under running tests would turn an interrupt into a pile of unrelated ENOENTs. SIGINT
// is only swallowed, not forwarded: Ctrl-C already reaches the whole process group, and a
// second SIGINT makes `node --test` hard-exit and skip its teardown.
process.on('SIGINT', () => {});
for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => { try { child.kill(sig); } catch {} });

// Read before cleanup() removes the root it lives in. A run that exited 0 without writing the
// census cannot vouch for itself, so that fails too.
function skipVerdict() {
  let text;
  try { text = fs.readFileSync(census, 'utf8'); }
  catch (e) { return { ok: false, lines: [`[skip-guard] FAIL: the run wrote no skip census (${census}: ${e.code || e.message})`] }; }
  const judged = judgeSkips(parseCensus(text), process.platform);
  return { ok: !judged.refused.length, lines: verdictLines(judged) };
}

child.on('exit', (code, signal) => {
  const status = code ?? (signal ? 1 : 0);
  const verdict = status === 0 || fs.existsSync(census) ? skipVerdict() : { ok: true, lines: [] };
  for (const l of verdict.lines) (verdict.ok ? console.log : console.error)(l);
  cleanup();
  process.exitCode = status || (verdict.ok ? 0 : 1);
});
child.on('error', e => { console.error(`run-tests: ${e.message}`); cleanup(); process.exitCode = 1; });
