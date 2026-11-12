---
name: capture-harness
description: Drive a running web application or browser game through a scripted flow in a real browser and save named screenshots with a manifest, failing on console errors. Use before calling any visual work done, when a preview or unit test cannot show what the composited screen really looks like, when a reviewer needs screenshots of specific states (after login, mid-game, a camera on a given spot), or when the user asks to capture, screenshot or visually check the app.
---

# capture-harness

Nothing visual ships unlooked-at. Offline previews miss what the running
application composites: blend modes, tints, scaling, overlays, a second player.
This harness boots the real thing in a browser, runs a flow you write, and
saves the frames plus a `manifest.json` that lists each shot and every console
or page error.

## Run it

Needs Node 18+ and Playwright installed **in the project being captured**
(`npm i -D @playwright/test && npx playwright install chromium`). Start the
application first, then run from the project folder:

```bash
node <skill>/scripts/capture.mjs tools/flow.mjs --base <url of the running app>
node <skill>/scripts/capture.mjs tools/flow.mjs --base <url> --out shots -- 33,161 12,178
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `--base <url>` | Where the application is served. | `CAPTURE_BASE` |
| `--out <dir>` | Output folder. | `CAPTURE_OUT`, else `screenshots` |
| `--viewport <WxH>` | Page size. | `1280x720` |
| `--channel <name>` | A system browser, for example `chrome`. | Playwright's Chromium |
| `--software-gl` | Software WebGL (SwiftShader), for machines and CI with no GPU. | off |
| `--autoplay` | Audio and video may start without a user gesture. | off |
| `--blur <selectors>` | CSS selectors blurred in every shot: story text, personal data. | none |
| `--allow-errors` | Record console and page errors without failing. | off |
| `-- <args>` | Passed to the flow as `ctx.args`. | |

| Exit | Meaning |
| --- | --- |
| 0 | Every shot taken, no console or page error. |
| 1 | An error was logged, the flow threw, or the flow took no shot. |
| 2 | Bad usage, or Playwright is not installed in the project. |

## Write a flow

A flow is a module with a default async function. It receives `ctx`:

| Helper | Does |
| --- | --- |
| `ctx.open(name, url?)` | A fresh browser context and page at `url` (default: the base). Errors are recorded under `name`. Call it twice for two users. |
| `ctx.shot(page, name, what)` | One screenshot, listed in the manifest with what it shows. A repeated name is refused. |
| `ctx.until(page, fn, arg?, { timeout, settle })` | Wait for a condition in the page, then a settle delay. |
| `ctx.pressUntil(page, key, doneFn, { tries, gapMs })` | Press a key until the page reports the step done. |
| `ctx.hold(page, key, ms)` | Hold a key down. |
| `ctx.note(key, value)` | Add a fact to the manifest: the build id, a dump of what the scene drew. |
| `ctx.base`, `ctx.out`, `ctx.args`, `ctx.viewport` | The run's settings. |

`page` is a normal Playwright page, so `fill`, `click`, `evaluate` and the rest
are available.

```js
// tools/flow.mjs
export default async (ctx) => {
  const page = await ctx.open('player');
  await ctx.shot(page, '01-title', 'Title screen');

  await page.keyboard.press('Enter');
  await ctx.until(page, () => window.__debug?.scene === 'world');

  // Move the camera, not the player: walking is slow, hits collision, and
  // cannot frame everything.
  for (const [i, target] of ctx.args.entries()) {
    const [col, row] = target.split(',').map(Number);
    await page.evaluate(([c, r]) => window.__debug.centerCameraOn(c, r), [col, row]);
    await page.waitForTimeout(700);
    await ctx.shot(page, `view-${i}-${col}-${row}`, `tile (${col},${row})`);
  }
  ctx.note('build', await page.evaluate(() => window.__debug.build));
};
```

## Practices the helpers encode

- **Expose a debug handle.** A small `window.__debug` object in development
  builds (current screen, player state, a camera setter) lets a flow wait on
  real state. Waiting on timers alone produces frames of loading screens.
- **Wait, then settle.** A screen reports itself active before it has finished
  building and binding input. An action sent at that instant is dropped.
  `ctx.until` adds the delay.
- **Press until done.** Under software rendering a synthetic keypress is
  sometimes dropped. `ctx.pressUntil` checks state between presses.
- **Blur what reviewers should not read.** The manifest states that the blur
  comes from the harness and is not in the application.
- **Test accounts.** A flow that signs up users should give them a recognisable
  prefix and a random suffix, and the accounts should be removed afterwards.
- **If the browser never starts,** the run stops after 30 seconds with a message.
  Some Playwright versions hang silently on Node versions they do not support.

## Tests

```bash
node --test tests/*.test.mjs
```

The tests drive the harness and its CLI with a stand-in for Playwright
(`tests/fake-playwright.mjs`), so they need no browser.
