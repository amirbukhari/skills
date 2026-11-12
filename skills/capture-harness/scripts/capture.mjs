#!/usr/bin/env node
// Look at the running application before calling anything done: run a FLOW that drives the
// real thing in a real browser, and write screenshots plus manifest.json.
//
//   capture.mjs <flow.mjs> --base <url> [--out <dir>] [options] [-- <args for the flow>]
//
//   --base <url>          where the application is served (or CAPTURE_BASE)
//   --out <dir>           output folder (or CAPTURE_OUT; default: screenshots)
//   --viewport <WxH>      default 1280x720
//   --channel <name>      a system browser instead of Playwright's bundled one, e.g. chrome
//   --software-gl         software WebGL (SwiftShader), for machines and CI with no GPU
//   --autoplay            let audio and video start without a user gesture
//   --blur <selectors>    comma-separated CSS selectors blurred in every shot
//   --allow-errors        record console/page errors without failing the run
//   --launch-timeout <ms> default 30000
//
// The flow is a module whose default export is `async (ctx) => { ... }`; lib/capture.js
// lists what ctx offers. Playwright is the TARGET project's own: it is resolved from the
// directory this is run in (`@playwright/test`, `playwright` or `playwright-core`).
//
// Exit 0: every shot taken and no console/page error. Exit 1: an error, a flow that threw, or
// a flow that took no shot. Exit 2: bad usage.
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runCapture, parseViewport } from './lib/capture.js';

const usage = (msg) => { console.error(`capture: ${msg}\nusage: capture.mjs <flow.mjs> --base <url> [--out <dir>] [--viewport WxH] [--channel <name>] [--software-gl] [--autoplay] [--blur <selectors>] [--allow-errors] [-- <flow args>]`); process.exit(2); };
const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split < 0 ? argv : argv.slice(0, split);
const flowArgs = split < 0 ? [] : argv.slice(split + 1);
const opts = { base: process.env.CAPTURE_BASE || null, out: process.env.CAPTURE_OUT || 'screenshots' };
const VALUE = { '--base': 'base', '--out': 'out', '--viewport': 'viewport', '--channel': 'channel', '--blur': 'blur', '--launch-timeout': 'launchTimeoutMs' };
const BOOL = { '--software-gl': 'softwareGl', '--autoplay': 'autoplay', '--allow-errors': 'allowErrors' };
let flowPath = null;
for (let i = 0; i < own.length; i++) {
  const a = own[i];
  if (Object.hasOwn(VALUE, a)) { if (own[i + 1] === undefined) usage(`${a} needs a value`); opts[VALUE[a]] = own[++i]; }
  else if (Object.hasOwn(BOOL, a)) opts[BOOL[a]] = true;
  else if (a.startsWith('-')) usage(`unknown flag ${a}`);
  else if (flowPath) usage(`unexpected argument ${a} (flow arguments go after --)`);
  else flowPath = a;
}
if (!flowPath) usage('no flow module given');
try { if (opts.viewport) opts.viewport = parseViewport(opts.viewport); else delete opts.viewport; } catch (e) { usage(e.message); }
if (opts.launchTimeoutMs !== undefined) {
  opts.launchTimeoutMs = Number(opts.launchTimeoutMs);
  if (!Number.isFinite(opts.launchTimeoutMs) || opts.launchTimeoutMs <= 0) usage('--launch-timeout needs a number of milliseconds');
}

// CAPTURE_PLAYWRIGHT names a module to use in place of Playwright (the test seam).
async function loadChromium() {
  if (process.env.CAPTURE_PLAYWRIGHT) return (await import(pathToFileURL(path.resolve(process.env.CAPTURE_PLAYWRIGHT)).href)).chromium;
  const require = createRequire(path.join(process.cwd(), 'capture-resolve.js'));
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    let resolved;
    try { resolved = require.resolve(name); } catch { continue; }
    const mod = await import(pathToFileURL(resolved).href);
    const chromium = mod.chromium || mod.default?.chromium;
    if (chromium) return chromium;
  }
  console.error(`capture: Playwright is not installed in ${process.cwd()}. Run it from the project, after: npm i -D @playwright/test && npx playwright install chromium`);
  process.exit(2);
}

let flow;
try { flow = (await import(pathToFileURL(path.resolve(flowPath)).href)).default; }
catch (e) { console.error(`capture: cannot load the flow ${flowPath}: ${e.message}`); process.exit(2); }
if (typeof flow !== 'function') { console.error(`capture: ${flowPath} must export a default async function (ctx) => { ... }`); process.exit(2); }

const chromium = await loadChromium();
let result;
try {
  result = await runCapture({ ...opts, out: path.resolve(opts.out), chromium, flow, args: flowArgs, log: (l) => console.log(l) });
} catch (e) {
  console.error(`capture: ${e.message}`);
  process.exit(1);
}
console.log(`${result.shots.length} shot(s), manifest ${result.manifestPath}`);
console.log('console errors:', result.errors.length ? result.errors.slice(0, 8) : 'none');
if (!result.ok) console.error(`capture: FAILED — ${result.failure}`);
process.exit(result.ok ? 0 : 1);
