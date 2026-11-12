// A skipped test verified nothing, and a run that skipped tests says "0 fail" all the same.
// This is the rule both runners enforce (run-tests.mjs for node:test, and
// playwright-skip-guard-reporter.mjs for Playwright): a run in which ANY test was skipped,
// fixme'd or todo'd FAILS, and names every one of them with its reason.
//
// It counts what the runner reports at RUN time, not what the source says. A grep for
// `.skip(` would miss `t.skip()` inside a test body, a conditional `{ skip: cond && '…' }`
// that only fires on one machine, and a whole describe skipped above its tests.
//
// The one exception is a test bound to an operating system it cannot run on anywhere else
// (⌘V is only a paste gesture on macOS). Such a test declares it in its skip reason with
// platformOnly(), and the guard accepts that skip ONLY on a platform the declaration
// excludes. The accepted skips are printed on every run, so the exception is never silent,
// and a declared test that skips on its own platform still fails the run.

export const PLATFORM_ONLY_PREFIX = 'PLATFORM-ONLY';
const PLATFORM_ONLY_RE = /^PLATFORM-ONLY \(([a-z0-9]+(?:,[a-z0-9]+)*)\): /;

// The skip reason for a test that can only run on `platforms` (process.platform values).
export function platformOnly(platforms, reason) {
  const list = [].concat(platforms);
  if (!list.length || list.some(p => !/^[a-z0-9]+$/.test(p))) throw new Error(`platformOnly: bad platform list ${JSON.stringify(platforms)}`);
  if (!reason || typeof reason !== 'string') throw new Error('platformOnly: a reason is required');
  return `${PLATFORM_ONLY_PREFIX} (${list.join(',')}): ${reason}`;
}

// The platforms a skip reason declares, or null when it declares none.
export function declaredPlatforms(reason) {
  const m = typeof reason === 'string' ? PLATFORM_ONLY_RE.exec(reason) : null;
  return m ? m[1].split(',') : null;
}

// entries: [{ name, file, skip?, todo? }] — `skip`/`todo` as the runner reported them
// (a string reason, or true). Returns { accepted, refused }, each entry gaining `why`.
export function judgeSkips(entries, platform) {
  const accepted = [];
  const refused = [];
  for (const e of entries) {
    if (e.todo !== undefined && e.todo !== false) { refused.push({ ...e, why: 'todo' }); continue; }
    const declared = declaredPlatforms(e.skip);
    if (declared && !declared.includes(platform)) accepted.push({ ...e, why: `platform-only (${declared.join(',')}), this is ${platform}` });
    else if (declared) refused.push({ ...e, why: `declared platform-only for ${platform}, and skipped ON it` });
    else refused.push({ ...e, why: 'skipped' });
  }
  return { accepted, refused };
}

const reasonText = (e) => {
  const r = e.todo !== undefined && e.todo !== false ? e.todo : e.skip;
  return typeof r === 'string' && r ? r : '(no reason given)';
};

// The lines a runner prints. Empty when there is nothing to say.
export function verdictLines({ accepted, refused }, { label = 'skip-guard' } = {}) {
  const lines = [];
  if (accepted.length) {
    lines.push(`[${label}] ${accepted.length} platform-only skip(s) accepted on this OS:`);
    for (const e of accepted) lines.push(`  - ${e.file ? e.file + ' › ' : ''}${e.name} — ${reasonText(e)}`);
  }
  if (refused.length) {
    lines.push(`[${label}] FAIL: ${refused.length} test(s) skipped or todo — a skipped test verified nothing:`);
    for (const e of refused) lines.push(`  - [${e.why}] ${e.file ? e.file + ' › ' : ''}${e.name} — ${reasonText(e)}`);
  }
  return lines;
}

// ---- node:test wiring -------------------------------------------------------------------
//
// `node --test` pairs --test-reporter with --test-reporter-destination BY POSITION and throws
// when the counts differ, and naming any reporter drops the default one. So the census
// reporter goes FIRST with its own destination; with no reporter of the caller's, the default
// (spec → stdout) is put back; and a lone `--test-reporter=tap` with no destination, which
// Node reads as stdout, gets stdout said explicitly (any other count mismatch is the caller's,
// and Node rejects it as it would have without us). Everything added goes before the caller's
// arguments: Node ignores a flag that follows the file list.
const countFlag = (argv, flag) => {
  let n = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') break;
    if (a === flag) { n++; i++; } else if (a.startsWith(flag + '=')) n++;
  }
  return n;
};

export function censusArgs(argv, { reporter, destination }) {
  const reporters = countFlag(argv, '--test-reporter');
  const dests = countFlag(argv, '--test-reporter-destination');
  const head = [`--test-reporter=${reporter}`, `--test-reporter-destination=${destination}`];
  if (!reporters) head.push('--test-reporter=spec', '--test-reporter-destination=stdout');
  else if (reporters === 1 && dests === 0) head.push('--test-reporter-destination=stdout');
  return [...head, ...argv];
}

// Parse the census reporter's JSON lines.
export function parseCensus(text) {
  return String(text || '').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
