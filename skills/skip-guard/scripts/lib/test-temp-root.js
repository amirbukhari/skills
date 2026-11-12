// ONE TEMP ROOT PER TEST RUN. A suite's files call fs.mkdtempSync(os.tmpdir()) hundreds of times
// per run, and most never remove what they made; a dev machine collects tens of thousands of
// leftover test dirs. Fixing each call site is a whack-a-mole that the next test re-opens, so
// run-tests.mjs instead points TMPDIR/TMP/TEMP at a single fresh root before `node --test`
// starts; every test process, and everything they spawn, inherits it, and the runner removes the
// whole root on exit.
//
// A run killed hard (SIGKILL, power loss) cannot clean up after itself, so the next run sweeps
// roots whose owning runner is gone. The sweep is deliberately narrow: only entries named
// node-test-root-<pid>, only real directories (never a symlink), only ones carrying our marker
// file, only ones we own, and only when that pid is no longer alive. Anything else — including
// every dir some other tool left in the temp dir — is not ours and is never touched.
//
// Pure: fs, uid and the liveness probe are injected so it is unit-testable.
import path from 'node:path';

export const ROOT_PREFIX = 'node-test-root-';
export const MARKER = '.node-test-root';

export function rootPath(tmpBase, pid) {
  return path.join(tmpBase, `${ROOT_PREFIX}${pid}`);
}

// Make the root (0700) and stamp it. Throws if it already exists: a stale root with our own
// pid would be a reused pid, and silently adopting it would mix two runs' files.
export function createRoot(fs, tmpBase, pid, now = Date.now()) {
  const root = rootPath(tmpBase, pid);
  fs.mkdirSync(root, { mode: 0o700 });
  fs.writeFileSync(path.join(root, MARKER), JSON.stringify({ pid, startedAt: new Date(now).toISOString() }) + '\n');
  return root;
}

// Which existing roots in tmpBase are safe to remove. `alive(pid)` → true while that process
// exists. Returns absolute paths; never removes anything itself.
export function staleRoots({ fs, tmpBase, uid, alive }) {
  return staleDirs({ fs, tmpBase, uid, alive, pattern: /^node-test-root-(\d+)$/, marker: MARKER, pidOf: m => Number(m[1]) });
}

// The same rules for pr-gate.mjs's work dirs. Their names are mkdtemp's (random suffix,
// no pid), so the owning pid comes from the marker alone; the cache dir carries no marker and
// is never matched. A work dir from before the marker existed is not ours to judge either.
export const GATE_PREFIX = 'pr-gate-';
export const GATE_MARKER = '.pr-gate';
export function staleGateDirs({ fs, tmpBase, uid, alive }) {
  return staleDirs({ fs, tmpBase, uid, alive, pattern: /^pr-gate-[A-Za-z0-9]{6}$/, marker: GATE_MARKER, pidOf: (m, marker) => marker?.pid });
}

function staleDirs({ fs, tmpBase, uid, alive, pattern, marker: markerName, pidOf }) {
  let names = [];
  try { names = fs.readdirSync(tmpBase); } catch { return []; }
  const out = [];
  for (const name of names) {
    const m = pattern.exec(name);
    if (!m) continue;
    const dir = path.join(tmpBase, name);
    let st;
    try { st = fs.lstatSync(dir); } catch { continue; }
    if (!st.isDirectory() || st.isSymbolicLink()) continue;
    if (typeof uid === 'number' && st.uid !== uid) continue;
    let marker;
    try { marker = JSON.parse(fs.readFileSync(path.join(dir, markerName), 'utf8')); } catch { continue; }
    const pid = pidOf(m, marker);
    if (!Number.isInteger(pid) || pid <= 0 || marker?.pid !== pid) continue;
    if (alive(pid)) continue;
    out.push(dir);
  }
  return out;
}

// Remove a tree that a test may have left with a directory it cannot enter. Code under test
// that chmods a path to 0600 will do so even when a test planted a DIRECTORY there, and a 0600
// directory has no execute bit: its entries cannot be unlinked, so fs.rmSync gives up with EACCES at the
// top of the tree — leaving everything — and so does a plain `rm -rf`. On that failure, give
// every directory in the tree we own back its owner rwx, then remove again. Symlinks are never
// followed (a chmod through one would change a file outside the tree), and a directory someone
// else owns is left as it is. Returns null once the tree is gone, else the error that stopped it.
export function removeTree(fs, dir, { uid } = {}) {
  const rm = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  try { rm(); return null; } catch (e) { if (e?.code !== 'EACCES' && e?.code !== 'EPERM') return e; }
  unlockTree(fs, dir, uid);
  try { rm(); return null; } catch (e) { return e; }
}

function unlockTree(fs, dir, uid) {
  let st;
  try { st = fs.lstatSync(dir); } catch { return; }
  if (!st.isDirectory() || st.isSymbolicLink()) return;
  if (typeof uid === 'number' && st.uid !== uid) return;
  // Before the readdir: a directory without r cannot be listed and without x cannot be entered.
  if ((st.mode & 0o700) !== 0o700) { try { fs.chmodSync(dir, (st.mode & 0o7777) | 0o700); } catch { return; } }
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) unlockTree(fs, path.join(dir, name), uid);
}

// The env every test process runs under.
export function rootEnv(root) {
  return { TMPDIR: root, TMP: root, TEMP: root, TEST_TMP_ROOT: root };
}

// The runner's arguments go to `node --test` unchanged and in order (the glob lives in
// package.json's test script, and `npm test -- <more>` appends to it). The one addition: when no
// argument is a PATH, the default glob is appended. Any flag (`--test-concurrency 4`) must not
// count as a path, or no glob is added and `node --test` falls back to its own discovery, which
// matches test files anywhere under the cwd, other worktrees included. Telling a path from
// a flag's value needs the flags that take a separate value (`--test-concurrency 1`, not just
// `--test-concurrency=1`), listed below from `node --help`. Unknown flags are assumed to take
// no value, and everything after `--` is a path.
export const DEFAULT_GLOB = 'tests/**/*.test.mjs';
const VALUE_FLAGS = new Set([
  '-C', '-e', '-r', '--conditions', '--eval', '--require', '--import', '--loader', '--experimental-loader',
  '--allow-fs-read', '--allow-fs-write', '--cpu-prof-dir', '--cpu-prof-interval', '--cpu-prof-name',
  '--diagnostic-dir', '--disable-proto', '--disable-warning', '--dns-result-order', '--env-file',
  '--env-file-if-exists', '--experimental-config-file', '--heap-prof-dir', '--heap-prof-interval',
  '--heap-prof-name', '--heapsnapshot-near-heap-limit', '--heapsnapshot-signal', '--icu-data-dir',
  '--input-type', '--localstorage-file', '--max-http-header-size', '--openssl-config',
  '--redirect-warnings', '--report-filename', '--report-signal', '--secure-heap', '--secure-heap-min',
  '--snapshot-blob', '--stack-trace-limit', '--title', '--unhandled-rejections',
  '--test-concurrency', '--test-coverage-branches', '--test-coverage-exclude', '--test-coverage-functions',
  '--test-coverage-include', '--test-coverage-lines', '--test-global-setup', '--test-isolation',
  '--test-name-pattern', '--test-reporter', '--test-reporter-destination', '--test-rerun-failures',
  '--test-shard', '--test-skip-pattern', '--test-timeout', '--watch-path', '--watch-kill-signal',
]);
export function hasPathArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') return i + 1 < argv.length;
    if (!a.startsWith('-') || a === '-') return true;
    if (!a.includes('=') && VALUE_FLAGS.has(a)) i++;
  }
  return false;
}
export function testArgs(argv, defaultGlob = DEFAULT_GLOB) {
  return ['--test', ...argv, ...(hasPathArg(argv) || !defaultGlob ? [] : [defaultGlob])];
}
// The PATH arguments alone: flags and their separate values dropped.
export function pathArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('-') || a === '-') out.push(a);
    else if (!a.includes('=') && VALUE_FLAGS.has(a)) i++;
  }
  return out;
}
