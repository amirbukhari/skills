// The capture run: boot a real browser, hand a FLOW the helpers it needs to drive the real
// application to the states worth looking at, and record every screenshot and every error.
//
// The browser driver is passed in (`chromium`, Playwright's), so this file has no dependency
// and the tests can drive it without a browser.
//
// Three rules it keeps, each learned from a capture that lied:
//   - console errors and page errors are collected from the first navigation, labelled with
//     the page they came from, and FAIL the run unless the caller allows them;
//   - a flow that takes no screenshot fails: a capture run that looked at nothing must not
//     read as a review that found nothing;
//   - text the caller marks private or spoiler is blurred by an injected style, and the
//     manifest says the blur is the harness's, not the application's.
import fs from 'node:fs';
import path from 'node:path';

export const SOFTWARE_GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const AUTOPLAY_ARGS = ['--autoplay-policy=no-user-gesture-required'];

export function parseViewport(text) {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(text));
  if (!m) throw new Error(`not a viewport (WIDTHxHEIGHT): ${text}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export function blurCss(selectors) {
  const list = (Array.isArray(selectors) ? selectors : String(selectors || '').split(',')).map(s => s.trim()).filter(Boolean);
  return list.length ? `${list.join(', ')} { filter: blur(5px) !important; }` : '';
}

// A shot's file name stays inside the output folder: no separators, no dot-names.
export function shotFile(name) {
  const file = /\.(png|jpe?g)$/i.test(name) ? name : `${name}.png`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file)) throw new Error(`not a usable shot name: ${JSON.stringify(name)} (letters, digits, dot, dash, underscore)`);
  return file;
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// → { ok, shots, errors, manifest, manifestPath, failure }
export async function runCapture({
  chromium, flow, base = null, out, viewport = { width: 1280, height: 720 }, channel = null,
  softwareGl = false, autoplay = false, blur = '', allowErrors = false, launchTimeoutMs = 30000,
  settleMs = 500, args = [], log = () => {},
}) {
  if (typeof flow !== 'function') throw new Error('the flow module must export a default async function');
  if (!out) throw new Error('an output folder is required');
  fs.mkdirSync(out, { recursive: true });
  const launchArgs = [...(softwareGl ? SOFTWARE_GL_ARGS : []), ...(autoplay ? AUTOPLAY_ARGS : [])];
  // Some Playwright builds hang without a word on a Node version they do not support. A
  // launch that never returns becomes an error that says where to look.
  const browser = await withTimeout(
    chromium.launch({ ...(channel ? { channel } : {}), args: launchArgs }), launchTimeoutMs,
    `the browser did not launch within ${launchTimeoutMs} ms — check that the installed Playwright supports Node ${process.versions.node} and that its browsers are installed`,
  );
  const css = blurCss(blur);
  const errors = [], shots = [], notes = {}, seen = new Set();
  let failure = null;

  const ctx = {
    base, out, args, viewport,
    // A fresh browser context and page, with its errors recorded under `name`.
    async open(name, url = base) {
      if (!url) throw new Error(`open(${JSON.stringify(name)}): no URL — pass --base or give open() one`);
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${name} pageerror ${e?.message ?? String(e)}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console ${m.text()}`); });
      await page.goto(url);
      return page;
    },
    // One screenshot, recorded with what it is meant to show.
    async shot(page, name, what = '') {
      const file = shotFile(name);
      if (seen.has(file)) throw new Error(`two shots named ${file}: the second would overwrite the first`);
      seen.add(file);
      if (css) await page.addStyleTag({ content: css });
      await page.screenshot({ path: path.join(out, file) });
      shots.push({ file, what });
      log(`saved ${path.join(out, file)}${what ? `  <- ${what}` : ''}`);
      return file;
    },
    // Wait for a condition in the page, THEN let it settle: "the screen is active" is true
    // before it has finished building and binding input, so an action sent at once is dropped.
    async until(page, fn, arg = undefined, { timeout = 30000, settle = settleMs } = {}) {
      await page.waitForFunction(fn, arg, { timeout });
      if (settle > 0) await page.waitForTimeout(settle);
    },
    // Press a key until the page reports the step is done, not a fixed number of times: under
    // software rendering a synthetic keypress is occasionally dropped.
    async pressUntil(page, key, done, { arg = undefined, tries = 16, gapMs = 380 } = {}) {
      for (let i = 0; i < tries; i++) {
        if (await page.evaluate(done, arg)) return i;
        await page.keyboard.press(key);
        await page.waitForTimeout(gapMs);
      }
      if (await page.evaluate(done, arg)) return tries;
      throw new Error(`pressUntil(${key}): not done after ${tries} presses`);
    },
    async hold(page, key, ms) {
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
    },
    // A fact for the manifest: the build under review, a dump of what the scene drew, ...
    note(key, value) { notes[key] = value; },
  };

  try {
    await flow(ctx);
  } catch (e) {
    failure = `the flow threw: ${e?.stack || e}`;
  } finally {
    try { await browser.close(); } catch {}
  }
  if (!failure && !shots.length) failure = 'the flow took no screenshot — nothing was looked at';
  if (!failure && errors.length && !allowErrors) failure = `${errors.length} console/page error(s) during capture`;

  const manifest = {
    base, viewport: `${viewport.width}x${viewport.height}`,
    renderer: `${channel || 'chromium'}${softwareGl ? ' + SwiftShader (software WebGL)' : ''}`,
    ...(css ? { note: `Blurred by the capture harness, not by the application: ${blurCss(blur).replace(/ \{.*$/, '')}` } : {}),
    ...notes, shots, errors, ...(failure ? { failure } : {}),
  };
  const manifestPath = path.join(out, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { ok: !failure, shots, errors, manifest, manifestPath, failure };
}
