// A stand-in for Playwright's `chromium`, with just the surface the harness uses. It records
// every call so a test can check what the harness asked the browser to do, and "screenshots"
// by writing the page's current state to the file. `window`-side functions are run against a
// small fake state object, so a flow can wait on and change application state.
import fs from 'node:fs';

export const calls = [];
const record = (c) => { calls.push(c); if (process.env.FAKE_PW_LOG) fs.appendFileSync(process.env.FAKE_PW_LOG, JSON.stringify(c) + '\n'); };

function makePage(context) {
  const handlers = { console: [], pageerror: [] };
  const state = { url: null, presses: 0, styles: [], held: [] };
  const page = {
    state,
    on: (ev, fn) => { handlers[ev]?.push(fn); },
    emitConsole: (type, text) => handlers.console.forEach(fn => fn({ type: () => type, text: () => text })),
    emitPageError: (message) => handlers.pageerror.forEach(fn => fn(new Error(message))),
    async goto(url) {
      state.url = url; record({ op: 'goto', url });
      if (String(url).includes('boom')) { page.emitConsole('error', 'Failed to load resource'); page.emitPageError('ReferenceError: nope is not defined'); }
      if (String(url).includes('warn')) page.emitConsole('warning', 'just a warning');
    },
    async addStyleTag({ content }) { state.styles.push(content); record({ op: 'style', content }); },
    async screenshot({ path }) { record({ op: 'screenshot', path, styles: [...state.styles] }); fs.writeFileSync(path, `PNG ${state.url} presses=${state.presses}`); },
    async waitForFunction(fn, arg, o) { record({ op: 'waitForFunction', timeout: o?.timeout }); if (!fn.call(null, arg === undefined ? state : arg, state)) throw new Error('Timeout waiting for function'); },
    async waitForTimeout(ms) { record({ op: 'wait', ms }); },
    async evaluate(fn, arg) { return fn.call(null, arg === undefined ? state : arg, state); },
    keyboard: {
      async press(key) { state.presses++; record({ op: 'press', key }); },
      async down(key) { state.held.push(key); record({ op: 'down', key }); },
      async up(key) { state.held = state.held.filter(k => k !== key); record({ op: 'up', key }); },
    },
    context: () => context,
  };
  return page;
}

export const chromium = {
  async launch(options) {
    record({ op: 'launch', options });
    if (process.env.FAKE_PW_HANG) return new Promise(() => {});
    return {
      async newContext(o) { record({ op: 'newContext', options: o }); const context = { async newPage() { return makePage(context); }, async close() {} }; return context; },
      async close() { record({ op: 'close' }); },
    };
  },
};
