// The capture harness against a stand-in browser (tests/fake-playwright.mjs): what it asks the
// browser for, what it writes, and every way a capture must FAIL rather than look like a clean
// review. No browser is needed. `node --test tests/capture.test.mjs`
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCapture, parseViewport, blurCss, shotFile, SOFTWARE_GL_ARGS, AUTOPLAY_ARGS } from '../scripts/lib/capture.js';
import { chromium, calls } from './fake-playwright.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'scripts', 'capture.mjs');
const FAKE = path.join(HERE, 'fake-playwright.mjs');
const BASE = 'http://app.test/';
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const run = (t, flow, extra = {}) => { calls.length = 0; return runCapture({ chromium, flow, base: BASE, out: path.join(tmp(t), 'shots'), ...extra }); };

test('a flow\'s shots are written, listed in manifest.json with what each shows, and the browser is closed', async (t) => {
  const r = await run(t, async (ctx) => {
    const page = await ctx.open('main');
    await ctx.shot(page, '01-title', 'Title screen');
    await ctx.shot(page, '02-menu.png', 'Main menu');
    ctx.note('build', 'abc123');
  });
  assert.equal(r.ok, true, r.failure);
  const out = path.dirname(r.manifestPath);
  assert.deepEqual(fs.readdirSync(out).sort(), ['01-title.png', '02-menu.png', 'manifest.json']);
  const manifest = JSON.parse(fs.readFileSync(r.manifestPath, 'utf8'));
  assert.deepEqual(manifest, { base: BASE, viewport: '1280x720', renderer: 'chromium', build: 'abc123',
    shots: [{ file: '01-title.png', what: 'Title screen' }, { file: '02-menu.png', what: 'Main menu' }], errors: [] });
  assert.deepEqual(calls.find(c => c.op === 'newContext').options, { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  assert.equal(calls.at(-1).op, 'close');
});

test('console errors and page errors fail the run and are recorded with the page they came from; warnings are not errors', async (t) => {
  const r = await run(t, async (ctx) => {
    const a = await ctx.open('A', `${BASE}?warn`);
    const b = await ctx.open('B', `${BASE}?boom`);
    await ctx.shot(a, 'a'); await ctx.shot(b, 'b');
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['B console Failed to load resource', 'B pageerror ReferenceError: nope is not defined']);
  assert.match(r.failure, /2 console\/page error\(s\)/);
  assert.equal(JSON.parse(fs.readFileSync(r.manifestPath, 'utf8')).errors.length, 2, 'the manifest of a failed run still carries the evidence');
  const allowed = await run(t, async (ctx) => { await ctx.shot(await ctx.open('B', `${BASE}?boom`), 'b'); }, { allowErrors: true });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.errors.length, 2, 'allowed is still recorded');
});

test('a flow that takes no screenshot fails: looking at nothing is not a clean review', async (t) => {
  const r = await run(t, async (ctx) => { await ctx.open('main'); });
  assert.equal(r.ok, false);
  assert.match(r.failure, /took no screenshot/);
});

test('a flow that throws fails the run, keeps the shots taken so far, and still closes the browser', async (t) => {
  const r = await run(t, async (ctx) => { const p = await ctx.open('main'); await ctx.shot(p, 'before'); throw new Error('selector never appeared'); });
  assert.equal(r.ok, false);
  assert.match(r.failure, /the flow threw: Error: selector never appeared/);
  assert.equal(r.shots.length, 1);
  assert.equal(calls.at(-1).op, 'close');
});

test('--blur injects the style before every shot and the manifest says the blur is the harness\'s', async (t) => {
  const r = await run(t, async (ctx) => { const p = await ctx.open('main'); await ctx.shot(p, 'one'); }, { blur: '.story h2, .toast' });
  const shot = calls.find(c => c.op === 'screenshot');
  assert.deepEqual(shot.styles, ['.story h2, .toast { filter: blur(5px) !important; }']);
  assert.match(r.manifest.note, /^Blurred by the capture harness, not by the application: \.story h2, \.toast$/);
  assert.equal(blurCss(''), '');
  const plain = await run(t, async (ctx) => { await ctx.shot(await ctx.open('main'), 'one'); });
  assert.ok(!calls.some(c => c.op === 'style'));
  assert.equal(plain.manifest.note, undefined);
});

test('launch options: software WebGL, autoplay and a system browser channel are opt-in', async (t) => {
  const flow = async (ctx) => { await ctx.shot(await ctx.open('main'), 'one'); };
  await run(t, flow);
  assert.deepEqual(calls[0], { op: 'launch', options: { args: [] } });
  const r = await run(t, flow, { softwareGl: true, autoplay: true, channel: 'chrome', viewport: parseViewport('800x600') });
  assert.deepEqual(calls[0].options, { channel: 'chrome', args: [...SOFTWARE_GL_ARGS, ...AUTOPLAY_ARGS] });
  assert.equal(r.manifest.renderer, 'chrome + SwiftShader (software WebGL)');
  assert.equal(r.manifest.viewport, '800x600');
  assert.throws(() => parseViewport('wide'));
});

test('a shot name cannot leave the output folder, and a repeated name is refused instead of overwriting', async (t) => {
  for (const bad of ['../escape', 'a/b', '.hidden', '']) assert.throws(() => shotFile(bad), /not a usable shot name/, bad);
  assert.equal(shotFile('ok-1'), 'ok-1.png');
  const r = await run(t, async (ctx) => { const p = await ctx.open('main'); await ctx.shot(p, 'same'); await ctx.shot(p, 'same.png'); });
  assert.equal(r.ok, false);
  assert.match(r.failure, /two shots named same\.png/);
});

test('until waits then settles; pressUntil presses until the page says done, and gives up loudly', async (t) => {
  let pressed = null;
  const r = await run(t, async (ctx) => {
    const p = await ctx.open('main');
    await ctx.until(p, (s) => s.url !== null);
    pressed = await ctx.pressUntil(p, 'Space', (s) => s.presses >= 3);
    await ctx.hold(p, 'KeyW', 250);
    await ctx.shot(p, 'done');
    await ctx.pressUntil(p, 'Enter', () => false, { tries: 2 });
  }, { settleMs: 123 });
  assert.equal(pressed, 3);
  const i = calls.findIndex(c => c.op === 'waitForFunction');
  assert.deepEqual(calls[i + 1], { op: 'wait', ms: 123 }, 'settle follows the wait');
  assert.equal(calls.filter(c => c.op === 'press' && c.key === 'Space').length, 3, 'no press after it was done');
  assert.deepEqual(calls.filter(c => ['down', 'up'].includes(c.op)).map(c => c.op), ['down', 'up']);
  assert.match(r.failure, /pressUntil\(Enter\): not done after 2 presses/);
});

test('a browser that never launches becomes an error naming Node and Playwright, not a silent hang', async (t) => {
  const hang = { launch: () => new Promise(() => {}) };
  await assert.rejects(runCapture({ chromium: hang, flow: async () => {}, base: BASE, out: tmp(t), launchTimeoutMs: 50 }),
    /did not launch within 50 ms — check that the installed Playwright supports Node/);
});

// ── the CLI ──────────────────────────────────────────────────────────────────────────────
function cli(t, flowSource, args, env = {}) {
  const dir = tmp(t);
  const flow = path.join(dir, 'flow.mjs');
  fs.writeFileSync(flow, flowSource);
  const log = path.join(dir, 'calls.jsonl');
  const r = spawnSync(process.execPath, [CLI, flow, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CAPTURE_PLAYWRIGHT: FAKE, FAKE_PW_LOG: log, CAPTURE_BASE: '', CAPTURE_OUT: '', ...env } });
  const seen = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  return { ...r, dir, seen };
}
const FLOW = 'export default async (ctx) => { const p = await ctx.open("main"); await ctx.shot(p, `view-${ctx.args.join("-") || "default"}`, "the view"); };\n';

test('CLI: runs the flow, passes it the arguments after --, writes into --out and exits 0', (t) => {
  const r = cli(t, FLOW, ['--base', BASE, '--out', 'pics', '--software-gl', '--', '12', '34']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(r.dir, 'pics')).sort(), ['manifest.json', 'view-12-34.png']);
  assert.deepEqual(r.seen[0].options.args, SOFTWARE_GL_ARGS);
  assert.match(r.stdout, /1 shot\(s\), manifest .*manifest\.json\nconsole errors: none/);
});

test('CLI: the base and output folder may come from the environment; the default folder is screenshots/', (t) => {
  const r = cli(t, FLOW, [], { CAPTURE_BASE: BASE });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(r.dir, 'screenshots', 'view-default.png')));
  assert.equal(r.seen.find(c => c.op === 'goto').url, BASE);
});

test('CLI: page errors exit 1; with no base there is nothing to open and it exits 1; a typo exits 2 before launching', (t) => {
  const red = cli(t, FLOW, ['--base', `${BASE}?boom`]);
  assert.equal(red.status, 1);
  assert.match(red.stderr, /FAILED — 2 console\/page error/);
  const noBase = cli(t, FLOW, []);
  assert.equal(noBase.status, 1);
  assert.match(noBase.stderr, /no URL — pass --base/);
  const typo = cli(t, FLOW, ['--base', BASE, '--sofware-gl']);
  assert.equal(typo.status, 2);
  assert.equal(typo.seen.length, 0);
  const notFn = cli(t, 'export const x = 1;\n', ['--base', BASE]);
  assert.equal(notFn.status, 2);
  assert.match(notFn.stderr, /must export a default async function/);
});

test('CLI: without Playwright in the project it says how to install it', (t) => {
  const r = cli(t, FLOW, ['--base', BASE], { CAPTURE_PLAYWRIGHT: '', NODE_PATH: '' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Playwright is not installed in .*npx playwright install chromium/);
});
