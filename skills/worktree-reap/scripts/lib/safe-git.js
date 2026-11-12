// Every git command these tools run goes through here, so a repository's OWN config cannot make
// them run a program.
//
// Why: repo config travels with the directory, not with the user. Anything that can write a
// checkout can write `.git/config` and `.git/hooks/`; a cloned or handed-over repo arrives with
// them already set. Measured: a planted `core.fsmonitor` runs, as the user, the moment anything
// runs `git status` there. And fsmonitor is one of a family. On git 2.25 (measured,
// one planted repo): `status` runs fsmonitor and the post-index-change hook; `diff` runs
// `diff.external`, the attribute-named clean filter and fsmonitor; `show`/`log -p` run filters
// and textconv; `worktree add` runs the filter, fsmonitor, post-checkout and post-index-change.
//
// Three tiers, because the keys come in three kinds:
//   1. FIXED overrides on every call (`-c` is read after the repo's config, so it wins): no
//      fsmonitor, no hooks of any name, no external diff, no ext:: transport, no submodule
//      recursion, no signature checks on log. Diff-producing commands also get --no-ext-diff
//      --no-textconv. An EMPTY core.fsmonitor is what disables it on old and new git alike;
//      `false` on 2.25 runs /bin/false.
//   2. DISCOVERED keys whose NAME the repo chooses — `filter.<driver>.*`, `diff.<driver>.*`,
//      `merge.<driver>.driver`, credential helpers per URL, per-remote upload-pack — are read
//      from the repo-local scopes (`git config --local`, and the per-worktree file when the repo
//      enables it; includes followed) and overridden one by one. Where the user needs a value to
//      keep working (an ssh command, a credential helper, a gpg program), it is the value from
//      their OWN global/system config, or git's default: the user's config is trusted exactly as
//      their shell rc is, a repo's is not.
//   3. REFUSED: the few keys `-c` cannot override. `core.gitProxy` is first-match-wins, so a repo
//      value read before ours still runs; a driver or URL name containing `=` or a control
//      character cannot be spelled as a `-c` key. The call is not made and the caller says why.
//
// Reading config runs nothing: `git config` does not refresh the index, run hooks or filters.
// The one thing -c does not reach is a SUBMODULE's own config (its driver names are not ours to
// discover); submodule recursion is off for every command that would follow it.
// Not covered: `gh`, which runs git itself, outside these arguments.
import { execFile, spawnSync } from 'node:child_process';

export const FIXED_OVERRIDES = [
  'core.fsmonitor=',
  'core.hooksPath=/dev/null',
  'core.pager=cat',
  'diff.external=',
  'protocol.ext.allow=never',
  'submodule.recurse=false',
  'fetch.recurseSubmodules=false',
  'diff.ignoreSubmodules=all',
  'status.submoduleSummary=false',
  'log.showSignature=false',
];
const DIFF_COMMANDS = new Set(['diff', 'show', 'log']);
export const DIFF_SAFETY_FLAGS = ['--no-ext-diff', '--no-textconv'];

// Keys a repo can set that name a program. Each maps a repo-local key to the overrides that
// neutralize it; `reassert` means "the user's own global/system values, else `fallback`".
const DRIVER_KEYS = [
  { re: /^filter\.(.+)\.(clean|smudge|process|required)$/, set: (d) => [[`filter.${d}.clean`, ''], [`filter.${d}.smudge`, ''], [`filter.${d}.process`, ''], [`filter.${d}.required`, 'false']] },
  { re: /^diff\.(.+)\.(textconv|command)$/, set: (d) => [[`diff.${d}.textconv`, ''], [`diff.${d}.command`, '']] },
  { re: /^merge\.(.+)\.driver$/, set: (d) => [[`merge.${d}.driver`, '']] },
];
const REASSERT_KEYS = [
  { re: /^credential\.helper$/, multi: true },
  { re: /^credential\..+\.helper$/, multi: true },
  { re: /^core\.sshcommand$/, fallback: 'ssh' },
  { re: /^core\.askpass$/, fallback: '' },
  { re: /^core\.editor$/, fallback: ':' },
  { re: /^sequence\.editor$/, fallback: ':' },
  { re: /^gpg\.program$/, fallback: 'gpg' },
  { re: /^gpg\.openpgp\.program$/, fallback: 'gpg' },
  { re: /^gpg\.x509\.program$/, fallback: 'gpgsm' },
  { re: /^gpg\.ssh\.program$/, fallback: 'ssh-keygen' },
  { re: /^remote\..+\.uploadpack$/, fallback: 'git-upload-pack' },
  { re: /^remote\..+\.receivepack$/, fallback: 'git-receive-pack' },
  { re: /^pager\..+$/, fallback: 'cat' },
];
const REFUSE_KEYS = [/^core\.gitproxy$/];

// `git config --list -z` → [[key, value]]. Keys come back with section and variable
// lowercased and the subsection as written (it is case-sensitive).
export function parseConfigList(raw) {
  return String(raw || '').split('\0').filter(Boolean).map((e) => {
    const nl = e.indexOf('\n');
    return nl < 0 ? [e, null] : [e.slice(0, nl), e.slice(nl + 1)];
  });
}

// The subsection of `section.<sub>.var`, as written.
const subsection = (key) => key.slice(key.indexOf('.') + 1, key.lastIndexOf('.'));

// Pure: from the repo-local entries decide the -c overrides, or a refusal. A key re-asserted
// from the user's own config needs `userEntries` (their global + system entries); passed null,
// the answer is { needsUser: true } and the caller reads them and asks again — so the extra
// reads happen only for the rare repo that sets such a key.
export function overridesForRepoConfig(localEntries, userEntries = null) {
  const out = new Map();   // key -> [values]  (a multi-valued key may carry several)
  for (const [key] of localEntries) {
    if (REFUSE_KEYS.some((re) => re.test(key))) return { overrides: [], refusal: `the repo's own git config sets ${key}, which names a program this tool cannot override` };
    const driver = DRIVER_KEYS.find((d) => d.re.test(key));
    const again = !driver && REASSERT_KEYS.find((r) => r.re.test(key));
    if (!driver && !again) continue;
    if (/[=\0-\x1f\x7f]/.test(key)) return { overrides: [], refusal: `the repo's own git config names a program under a key this tool cannot override (${JSON.stringify(key)})` };
    if (driver) {
      for (const [k, v] of driver.set(subsection(key))) out.set(k, [v]);
    } else if (!out.has(key)) {
      if (!userEntries) return { needsUser: true };
      const mine = userEntries.filter(([k]) => k === key).map(([, v]) => v ?? '');
      out.set(key, again.multi ? ['', ...mine] : [mine.length ? mine.at(-1) : again.fallback]);
    }
  }
  const overrides = [];
  for (const [k, vs] of out) for (const v of vs) overrides.push(`${k}=${v}`);
  return { overrides, refusal: null };
}

// Splice the fixed and discovered overrides in front of `args`, and the diff flags after a
// diff-producing subcommand. `args` must start at the subcommand (no `-C`; pass the directory
// as `cwd` instead, which is also where the repo's config is read).
export function hardenArgs(args, overrides = []) {
  const [sub, ...rest] = args;
  const tail = DIFF_COMMANDS.has(sub) ? [sub, ...DIFF_SAFETY_FLAGS, ...rest] : args;
  return [...[...FIXED_OVERRIDES, ...overrides].flatMap((o) => ['-c', o]), ...tail];
}

const READ = ['config', '--list', '--includes', '-z'];
const readArgs = (scope) => [...FIXED_OVERRIDES.flatMap((o) => ['-c', o]), ...READ, scope];
const NOT_A_REPO = /not in a git directory|can only be used inside a git repository|not a git repository/i;
const enabled = (v) => /^(true|yes|on|1)$/i.test(v ?? 'true');

// One planner, written once over a runner that is either sync or async (`step` threads both).
function* planSteps(args) {
  const local = yield readArgs('--local');
  if (local.status !== 0) {
    if (NOT_A_REPO.test(local.stderr)) return { args: hardenArgs(args), refusal: null };
    return { args: null, refusal: `cannot read this repo's git config: ${String(local.stderr || 'git did not run').trim().split('\n')[0]}` };
  }
  const entries = parseConfigList(local.stdout);
  if (entries.some(([k, v]) => k === 'extensions.worktreeconfig' && enabled(v))) {
    const wt = yield readArgs('--worktree');
    if (wt.status === 0) entries.push(...parseConfigList(wt.stdout));
  }
  let r = overridesForRepoConfig(entries);
  if (r.needsUser) {
    const user = [];
    for (const scope of ['--system', '--global']) {
      const u = yield readArgs(scope);
      if (u.status === 0) user.push(...parseConfigList(u.stdout));
    }
    r = overridesForRepoConfig(entries, user);
  }
  return r.refusal ? { args: null, refusal: r.refusal } : { args: hardenArgs(args, r.overrides), refusal: null };
}

const READ_OPTS = { encoding: 'utf8', timeout: 5000, maxBuffer: 8_000_000 };

// Plan a git call in `cwd`: { args } to run, or { refusal } saying why it must not run. `args`
// start at the subcommand — pass the directory as cwd, never as `-C`, because cwd is also where
// the repo's config is read.
export function safeGitArgsSync(cwd, args, { env = process.env } = {}) {
  const it = planSteps(args);
  let step = it.next();
  while (!step.done) {
    const r = spawnSync('git', step.value, { cwd, env, ...READ_OPTS });
    step = it.next({ status: r.error ? -1 : r.status, stdout: r.stdout || '', stderr: r.error ? r.error.message : (r.stderr || '') });
  }
  return step.value;
}

export async function safeGitArgs(cwd, args, { env = process.env, exec = execFile } = {}) {
  const it = planSteps(args);
  let step = it.next();
  while (!step.done) {
    const a = step.value;
    const r = await new Promise((resolve) => exec('git', a, { cwd, env, ...READ_OPTS }, (err, stdout, stderr) =>
      resolve({ status: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: stdout || '', stderr: String(stderr || (err ? err.message : '')) })));
    step = it.next(r);
  }
  return step.value;
}

// The common shape: run git in `cwd`; resolves { ok, stdout, stderr, refused }, never rejects.
export async function runSafeGit(cwd, args, { timeout = 15_000, maxBuffer = 4_000_000, env = process.env, exec = execFile } = {}) {
  const p = await safeGitArgs(cwd, args, { env, exec });
  if (p.refusal) return { ok: false, stdout: '', stderr: p.refusal, refused: p.refusal };
  return new Promise((resolve) => exec('git', p.args, { cwd, timeout, maxBuffer, env }, (err, stdout, stderr) =>
    resolve({ ok: !err, stdout: stdout || '', stderr: err ? String(stderr || err.message) : String(stderr || ''), refused: null })));
}
