// THE MERGE GATE'S VERDICT: does merging a PR make any existing test fail that did not fail
// before? Pure: it reads two run records (the base's, and the base with the PR merged) and
// compares them. ../pr-gate.mjs does the git and the runs.
//
// Why this exists. A reviewer who runs the PR's own tests and "the related suites" never runs
// the repo-wide guards, the tests that scan EVERY file, because those are named after the rule
// they keep, not the feature a PR touches. Approved PRs break them, and each guard would have
// failed loudly if anything had run it. So the gate runs the WHOLE suite twice and compares, and
// it never chooses tests by topic.
//
// Compared PER TEST, keyed `file › test name`, from the runner's own events (recorded by
// pr-gate-reporter.mjs), never from scraped console text. A file-level comparison is not
// enough: when the base is already red, a PR can add a SECOND failure inside a test that is already failing, and the set of failing
// files does not change. So a test failing on BOTH sides is compared by its
// failure MESSAGE as well, after normalising what legitimately differs between two runs
// (worktree paths, temp paths, ports, durations).

// One line per runner event, written by pr-gate-reporter.mjs (a node --test reporter):
//   {t:'test:pass'|'test:fail', type, name, nesting, file, skip, todo, msg}   per test or suite, CHILDREN FIRST
//   {t:'output', file, text}                                                  a file's stdout/stderr
//   {t:'test:summary', counts:{tests,suites,...}}                             the runner's own totals
// Why a reporter and not JUnit: node's JUnit output turns a test with subtests into a
// <testsuite> that carries no failure of its own, so a parent that fails while its subtests pass
// is not in the report at all. The reporter sees every event the runner emits.
//
// Returns { cases: [{ file, name, status, message }], total, suites, read, complete } where `name`
// is the full path through the parents ("parent › child"), `file` is relative to `root`, `total`
// and `suites` are the runner's own counts (null if the summary is missing) and `read` is what
// was read of each: { tests, suites }.
//
// SUITES ARE COUNTED APART, and each count must match exactly. Node emits a pass/fail event for
// a describe() block as well as for each test, but its summary counts the block in
// `counts.suites`, not `counts.tests`. Compared against `counts.tests` alone, one file with 7
// describe blocks read 7 more results than the runner "reported", and the gate refused an
// unchanged base. A suite stays a case: a describe whose
// before() hook throws is a failing suite, and that failure must be compared like any other. A
// record with no `type` counts as a test, and a summary with no `suites` as 0, so a gap in
// either count still reads as incomplete. A file that failed outside any test (a
// hand-rolled harness exiting non-zero, a file that does not load) has its output appended to
// its message, since its message alone is just "test failed".
export function parseRecords(text, root = '') {
  const rootFwd = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
  const rel = f => { f = String(f || '').replace(/\\/g, '/'); return rootFwd && f.startsWith(rootFwd + '/') ? f.slice(rootFwd.length + 1) : f; };
  const pending = new Map(), output = new Map(), all = [];
  let total = null, suites = null;
  const read = { tests: 0, suites: 0 };
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.t === 'test:summary') { if (!r.file && r.counts) { total = r.counts.tests; suites = r.counts.suites ?? 0; } continue; }
    if (r.t === 'output') { const f = rel(r.file); output.set(f, (output.get(f) || '') + r.text); continue; }
    if (r.t !== 'test:pass' && r.t !== 'test:fail') continue;
    if (r.type === 'suite') read.suites++; else read.tests++;
    const file = rel(r.file);
    const rec = { file, path: [String(r.name)], status: r.t === 'test:fail' ? 'fail' : (r.skip || r.todo ? 'skip' : 'pass'), message: r.msg || '', desc: [] };
    // Post-order: a test's subtests were reported just before it, one level deeper.
    const lv = pending.get(file) || new Map(); pending.set(file, lv);
    const n = Number(r.nesting) || 0, kids = lv.get(n + 1) || [];
    lv.delete(n + 1);
    for (const k of kids) for (const d of [k, ...k.desc]) d.path.unshift(rec.path[0]);
    rec.desc = kids.flatMap(k => [k, ...k.desc]);
    if (!lv.has(n)) lv.set(n, []);
    lv.get(n).push(rec);
    all.push(rec);
  }
  const seen = new Map();
  const cases = all.map(rec => {
    let name = rec.path.join(' › ');
    const k = `${rec.file} › ${name}`, c = (seen.get(k) || 0) + 1;
    seen.set(k, c);
    if (c > 1) name += ` #${c}`;
    let message = rec.message;
    if (rec.status === 'fail' && rec.path.length === 1 && rec.file && (rec.file === rec.path[0] || rec.file.endsWith('/' + rec.path[0])) && output.has(rec.file)) {
      message += '\n' + output.get(rec.file);
    }
    return { file: rec.file, name, status: rec.status, message };
  });
  // `complete` is false when the runner reported a different number of tests, or of suites, than
  // were read: a result that was not read is a failure the gate cannot see. No tolerance either way.
  return { cases, total, suites, read, complete: total === read.tests && suites === read.suites };
}

// What legitimately differs between two runs of the same failing test, removed so that only a
// real change in what failed is left: the checkout's own path, temp paths, loopback ports,
// process ids, uuids, timestamps, durations, terminal colour codes and source line numbers.
// Measured: a browser test failing identically on both sides differed only by Chrome's pid in
// Playwright's call log. And a guard red on the base listed `app.js:120`; a PR that added
// lines above it moved that to `app.js:168`, and the gate called an unchanged failure a
// BREAK. A position moves whenever anything above it is edited, so only the number goes: the
// file name, and every other line of the message, is still compared. Only a known source or
// doc extension counts as a file, so a version (`1.2.34`) or a count is never mistaken for one.
export function normalizeMessage(msg, roots = []) {
  let s = String(msg).replace(/\\/g, '/');
  for (const r of roots.filter(Boolean).map(r => String(r).replace(/\\/g, '/').replace(/\/+$/, '')).sort((a, b) => b.length - a.length)) {
    s = s.split(r).join('<repo>');
  }
  return s
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\bpid[=: ]\s*\d+/gi, 'pid=<pid>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/(?:\/(?:private\/)?(?:var\/folders|tmp)\/|[A-Z]:\/Users\/[^/\s]+\/AppData\/Local\/Temp\/)[^\s'"`)\]]*/g, '<tmp>')
    .replace(/\b(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\b/g, '$1:<port>')
    .replace(/\b\d+(?:\.\d+)?\s?ms\b/g, '<ms>')
    // Known limit: a change confined to line numbers inside a file the PR edits (one dead anchor
    // swapped for another with the same target and reason) cannot be told from a shift by text
    // comparison. Scoping this to changed files would not close it; that file IS changed.
    .replace(/(\.(?:[cm]?js|jsx|tsx?|json|md|html?|css|py|sh|ya?ml|txt)):\d+(?:[-:]\d+)?\b/g, '$1:<line>')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// The first line at which two normalised messages differ, for the report.
export function firstDifference(before, after) {
  const b = String(before).split('\n'), a = String(after).split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { line: i + 1, before: b[i] ?? '(none)', after: a[i] ?? '(none)' };
  }
  return null;
}

export const testKey = c => `${c.file} › ${c.name}`;

// Map of failing test key -> normalised message.
export function failures(cases, roots = []) {
  const m = new Map();
  for (const c of cases) if (c.status === 'fail') m.set(testKey(c), normalizeMessage(c.message, roots));
  return m;
}

// The CANDIDATES from one full run of each side (see `judge` for the verdict). `pass` here means
// there was nothing to re-run at all. Tests that fail on base and pass merged are reported as fixed.
//
// A test that STOPS RUNNING is not a test that passes. Comparing failures alone, a PR that narrowed
// the suite's glob, broke a file's collection, or skipped the test it breaks produced no merged
// failure for it, so the gate printed GATE PASS over a test it never ran (and a base failure that
// vanished even printed as "fixed"). So:
//   - `uncollected`: a base test FILE that still exists in the merged tree (`stillExists`) but
//     produced no merged result at all. BLOCKS. A deleted file is a visible deletion, not this.
//   - `newlySkipped`: ran (pass or fail) on base, reported as skipped merged. BLOCKS.
//   - `vanished`: a single base test missing merged while its file still ran (a rename or a
//     deleted case). Reported, not blocking: renames are routine and the diff shows them.
// None of the three is ever reported as `fixed`.
export function compareGate(baseCases, mergedCases, { roots = [], stillExists = () => true } = {}) {
  const base = failures(baseCases, roots), merged = failures(mergedCases, roots);
  const newFailures = [], changedFailures = [], fixed = [];
  for (const [k, msg] of merged) {
    if (!base.has(k)) newFailures.push({ key: k, message: msg });
    else if (base.get(k) !== msg) changedFailures.push({ key: k, before: base.get(k), after: msg });
  }
  const mergedStatus = new Map(mergedCases.map(c => [testKey(c), c.status]));
  const mergedFiles = new Set(mergedCases.map(c => c.file));
  const uncollectedFiles = new Set(), newlySkipped = [], vanished = [];
  for (const c of baseCases) {
    const k = testKey(c);
    const now = mergedStatus.get(k);
    if (now === undefined) {
      if (!mergedFiles.has(c.file)) { if (stillExists(c.file)) uncollectedFiles.add(c.file); }
      else vanished.push(k);
    } else if (now === 'skip' && c.status !== 'skip') newlySkipped.push(k);
  }
  for (const k of base.keys()) if (mergedStatus.get(k) !== undefined && mergedStatus.get(k) !== 'skip' && !merged.has(k)) fixed.push(k);
  const fileOf = k => k.slice(0, k.indexOf(' › '));
  const newFailingFiles = [...new Set(newFailures.map(f => fileOf(f.key)))].sort();
  const uncollected = [...uncollectedFiles].sort();
  const count = cs => ({ tests: cs.length, fail: cs.filter(c => c.status === 'fail').length, skip: cs.filter(c => c.status === 'skip').length });
  return {
    pass: newFailures.length === 0 && changedFailures.length === 0 && uncollected.length === 0 && newlySkipped.length === 0,
    base: count(baseCases), merged: count(mergedCases),
    newFailures, changedFailures, fixed, newFailingFiles, uncollected, newlySkipped, vanished,
    alreadyFailing: [...base.keys()].filter(k => merged.has(k)),
  };
}

// A failure seen once in a full run is a CANDIDATE, not a verdict. Measured on the real suite: an
// EMPTY commit on a red tip "failed" the gate, through two kinds of noise. Some tests fail only
// under full-suite load (temp-dir ENOTEMPTY, a backpressure test) and pass alone 3 of 3. Some
// already-red tests fail with a message that changes with conditions (Playwright's kill-log
// order, a megabyte count). So every candidate's file is re-run alone, on BOTH sides, and alone
// is compared with alone. Comparing the merged side alone against the base side inside the full
// suite was measured to be wrong too: a browser test red on both sides gave one stable message
// alone and another under load, and blocked a PR that touched nothing near it.
//   - a new failure BLOCKS if the test fails in any merged-alone run and in no base-alone run
//     (every run = deterministic, some = flaky); failing in none = 'full-run-only', and failing
//     alone on the base too = 'fails alone on base', both warnings;
//   - a changed failure BLOCKS only if every merged-alone run fails with the same message and
//     no base-alone run produced it; anything else = 'unstable message' or 'same as base alone',
//     a warning.
// `reruns` / `baseReruns` map a test key to its outcome in each alone run on that side: the
// normalised failure message, or null when it passed (or did not run).
export function judge(v, reruns, runs, baseReruns = new Map()) {
  const blocking = [], warnings = [];
  const baseOf = k => baseReruns.get(k) || [];
  for (const f of v.newFailures) {
    const out = reruns.get(f.key) || [];
    const failed = out.filter(m => m !== null).length, baseFailed = baseOf(f.key).filter(m => m !== null).length;
    const kind = classifyRerun(failed, runs);
    const detail = `${failed}/${runs} failed alone merged, ${baseFailed}/${baseOf(f.key).length} alone on base`;
    if (kind === 'full-run-only') warnings.push({ key: f.key, kind, detail, message: f.message });
    else if (baseFailed > 0) warnings.push({ key: f.key, kind: 'fails alone on base', detail, message: f.message });
    else blocking.push({ key: f.key, kind, detail, message: f.message });
  }
  for (const f of v.changedFailures) {
    const out = reruns.get(f.key) || [], seenOnBase = new Set(baseOf(f.key).filter(m => m !== null));
    const stable = out.length === runs && out.every(m => m !== null && m === out[0]);
    const detail = `${out.filter(m => m !== null).length}/${runs} failed alone merged with ${new Set(out.filter(m => m !== null)).size} distinct message(s); ${seenOnBase.size} distinct on base alone`;
    if (stable && !seenOnBase.has(out[0])) blocking.push({ key: f.key, kind: 'changed', detail, before: [...seenOnBase][0] ?? f.before, after: out[0] });
    else warnings.push({ key: f.key, kind: stable ? 'same as base alone' : 'unstable message', detail, before: f.before, after: f.after });
  }
  // Not re-run alone: there is nothing to reproduce. A file the merged suite never collected, or
  // a test it reported as skipped, is a fact of that run, not a noisy failure.
  for (const file of v.uncollected || []) blocking.push({ key: `${file} › (every test)`, kind: 'stopped running', detail: 'the file still exists but the merged suite produced no result for it', message: '' });
  for (const k of v.newlySkipped || []) blocking.push({ key: k, kind: 'newly skipped', detail: 'ran on base, reported as skipped merged', message: '' });
  return { pass: blocking.length === 0, blocking, warnings };
}

// One alone run's outcome for each candidate key: its normalised failure message, null when it
// PASSED, and NOT_RUN_ALONE when the run recorded no result for it at all. That last case used to
// read as null, i.e. as a pass: an alone run that died before writing its records (OOM, a killed
// runner, a reporter crash) turned a real new failure into "full-run-only" — NOT COUNTED, and the
// gate passed. On the MERGED side a missing measurement now counts as a failed run, so the gate
// fails closed. The BASE side passes `missing: null`: there a missing result is usually the plain
// fact that the test does not exist before the PR, and counting it as a base failure would excuse
// the PR's new failure as "fails alone on base" — failing open again, from the other direction.
export const NOT_RUN_ALONE = 'did not run alone: the run recorded no result for this test';
export function aloneOutcomes(cases, keys, roots = [], { missing = NOT_RUN_ALONE } = {}) {
  const status = new Map(cases.map(c => [testKey(c), c]));
  return new Map(keys.map(k => {
    const c = status.get(k);
    if (!c || c.status === 'skip') return [k, missing];
    return [k, c.status === 'fail' ? normalizeMessage(c.message, roots) : null];
  }));
}

// Every run fails = deterministic; some = flaky; none = it only fails inside the full run.
export function classifyRerun(failedRuns, runs) {
  if (failedRuns >= runs) return 'deterministic';
  if (failedRuns > 0) return 'flaky';
  return 'full-run-only';
}
// WHICH TESTS THE GATE RUNS, as `node --test` path arguments. First of: the patterns given on
// the command line; `"prGate": { "tests": [...] }` in the base's package.json; the path arguments
// of its "test" script when that script is `node --test …` or a runner script given paths
// (`node tools/run-tests.mjs "tests/**/*.test.mjs"`). [] means node's own discovery. `pathArgs`
// drops flags and their values.
export function suitePatterns(pkgText, cli = [], pathArgs = a => a.filter(x => !x.startsWith('-'))) {
  if (cli.length) return [...cli];
  let pkg;
  try { pkg = JSON.parse(pkgText); } catch { return []; }
  const declared = pkg?.prGate?.tests;
  if (Array.isArray(declared) && declared.length && declared.every(x => typeof x === 'string' && x)) return [...declared];
  const script = String(pkg?.scripts?.test || '');
  if (/[;&|]/.test(script)) return [];
  const m = script.match(/^\s*node\s+(?:--test\b|\S+\.[cm]?js\b)\s*(.*)$/);
  if (!m) return [];
  const words = m[1].match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return pathArgs(words.map(w => w.replace(/^(["'])(.*)\1$/, '$2')));
}
