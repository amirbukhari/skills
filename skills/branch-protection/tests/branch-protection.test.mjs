// Branch protection as code: the plan rules (lib/branch-protection.js) and the real CLI
// against a stub `gh` that records every call. `node --test tests/branch-protection.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planBranch, applyDecision, sameChecks } from '../scripts/lib/branch-protection.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'branch-protection.mjs');
// The desired state a repository would check in. Nothing here is a default of the tool.
const CHECKS = [{ context: 'test (ubuntu-latest)', app_id: 15368 }, { context: 'test (windows-latest)', app_id: 15368 }];
const CONFIG = { repo: 'acme/widgets', branches: { trunk: { required_status_checks: { strict: false, checks: CHECKS } } } };
const DEV = CONFIG.branches.trunk;

test('plan: unknown strict (non-admin read) still proposes the strict-only patch', () => {
  const { rows, patch } = planBranch(DEV, { checks: CHECKS, strict: null });
  assert.equal(rows[0].status, 'unknown');
  assert.equal(rows[1].status, 'ok');
  assert.deepEqual(patch, { strict: false });
});

test('plan: idempotent — no patch once strict already matches', () => {
  assert.equal(planBranch(DEV, { checks: CHECKS, strict: false }).patch, null);
  assert.deepEqual(planBranch(DEV, { checks: CHECKS, strict: true }).patch, { strict: false });
});

test('plan: the patch never carries checks, even when they drifted', () => {
  const { rows, patch } = planBranch(DEV, { checks: [CHECKS[0]], strict: true });
  assert.equal(rows[1].status, 'drift');
  assert.deepEqual(Object.keys(patch), ['strict']);
});

test('check identity includes app_id and ignores order', () => {
  assert.ok(sameChecks(CHECKS, [...CHECKS].reverse()));
  assert.ok(!sameChecks(CHECKS, CHECKS.map(c => ({ context: c.context }))));
});

test('apply refuses without admin, and on unknown permission', () => {
  for (const admin of [false, null, undefined]) {
    const d = applyDecision({ patch: { strict: false }, admin });
    assert.equal(d.write, false);
    assert.equal(d.refuse, true);
  }
  assert.equal(applyDecision({ patch: { strict: false }, admin: true }).write, true);
  assert.equal(applyDecision({ patch: null, admin: true }).write, false);
});

// ── the real CLI against a stub gh ───────────────────────────────────────────────────────
function runCli({ admin, strict, args = [], config = CONFIG, inRepoDir = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-protection-'));
  const log = path.join(dir, 'calls.jsonl');
  const state = path.join(dir, 'strict.json');
  fs.writeFileSync(state, JSON.stringify(strict));
  const configFile = path.join(dir, inRepoDir ? '.github/branch-protection.json' : 'protection.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config));
  const stub = path.join(dir, 'gh.mjs');
  fs.writeFileSync(stub, `
    import fs from 'node:fs';
    const args = process.argv.slice(2);
    const input = args.includes('--input') ? fs.readFileSync(0, 'utf8') : null;
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, input }) + '\\n');
    if (args[0] === 'repo') { process.stdout.write('found/by-gh\\n'); process.exit(0); }
    const url = args.find(a => a.startsWith('repos/'));
    const admin = ${JSON.stringify(admin)};
    const deny = () => { process.stderr.write('gh: Not Found (HTTP 404)'); process.exit(1); };
    if (args.includes('PATCH')) {
      if (!admin) deny();
      fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(JSON.parse(input).strict));
      process.stdout.write('{}');
    } else if (url.endsWith('/protection/required_status_checks')) {
      if (!admin) deny();
      process.stdout.write(JSON.stringify({ strict: JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8')), checks: ${JSON.stringify(CHECKS)} }));
    } else if (url.includes('/branches/')) {
      process.stdout.write(JSON.stringify({ protection: { required_status_checks: { checks: ${JSON.stringify(CHECKS)} } } }));
    } else {
      process.stdout.write(JSON.stringify({ permissions: { admin } }));
    }
  `);
  const r = spawnSync(process.execPath, [CLI, ...(inRepoDir ? [] : ['--config', configFile]), ...args], {
    encoding: 'utf8', cwd: dir, env: { ...process.env, BRANCH_PROTECTION_GH: stub, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  const after = JSON.parse(fs.readFileSync(state, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...r, calls, after };
}
const patches = calls => calls.filter(c => c.args.includes('PATCH'));

test('CLI default is read-only: no PATCH, even as admin', () => {
  const r = runCli({ admin: true, strict: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(patches(r.calls).length, 0);
  assert.match(r.stdout, /--apply would PATCH required_status_checks \{"strict":false\}/);
});

test('CLI --apply without admin refuses, sends no PATCH, exits non-zero', () => {
  const r = runCli({ admin: false, strict: true, args: ['--apply'] });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(patches(r.calls).length, 0);
  assert.match(r.stdout, /REFUSED/);
  assert.match(r.stdout, /unknown \(needs admin\)/);
});

test('CLI --apply as admin sends exactly one PATCH whose body is {"strict":false}, then is a no-op', () => {
  const r = runCli({ admin: true, strict: true, args: ['--apply'] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const p = patches(r.calls);
  assert.equal(p.length, 1);
  assert.ok(p[0].args.some(a => a.endsWith('repos/acme/widgets/branches/trunk/protection/required_status_checks')));
  assert.ok(!p[0].args.some(a => /\/protection$/.test(a)), 'never the whole-protection endpoint');
  assert.deepEqual(JSON.parse(p[0].input), { strict: false });
  assert.equal(r.after, false);

  const again = runCli({ admin: true, strict: false, args: ['--apply'] });
  assert.equal(again.status, 0);
  assert.equal(patches(again.calls).length, 0);
});

// ── which repository, which file ─────────────────────────────────────────────────────────
test('the repository comes from --repo, then the file, then gh; it is never guessed', () => {
  const { repo, ...noRepo } = CONFIG;
  const flag = runCli({ admin: true, strict: false, args: ['--repo', 'other/place'] });
  assert.match(flag.stdout, /^other\/place: /);
  assert.ok(flag.calls.every(c => !c.args.some(a => a.includes('acme/widgets'))));
  const file = runCli({ admin: true, strict: false });
  assert.match(file.stdout, /^acme\/widgets: /);
  const discovered = runCli({ admin: true, strict: false, config: noRepo });
  assert.match(discovered.stdout, /^found\/by-gh: /);
  assert.ok(discovered.calls.some(c => c.args.some(a => a === 'repos/found/by-gh/branches/trunk')));
});

test('with no --config the file is .github/branch-protection.json of the directory it runs in', () => {
  const r = runCli({ admin: true, strict: false, inRepoDir: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\ntrunk\n\s+ok\s+required_status_checks\.strict/);
});

test('a missing file, a file with no branches and an unknown flag stop before any request', () => {
  const none = spawnSync(process.execPath, [CLI, '--config', path.join(os.tmpdir(), 'no-such-protection.json')], { encoding: 'utf8' });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /cannot read/);
  const empty = runCli({ admin: true, strict: true, config: { repo: 'acme/widgets', branches: {} } });
  assert.equal(empty.status, 2);
  assert.equal(empty.calls.length, 0);
  const typo = runCli({ admin: true, strict: true, args: ['--aply'] });
  assert.equal(typo.status, 2);
  assert.equal(typo.calls.length, 0, 'a mistyped --apply must not fall back to a silent read-only run that looks applied');
});
