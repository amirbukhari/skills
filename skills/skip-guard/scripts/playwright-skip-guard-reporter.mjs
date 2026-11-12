// Playwright reporter: the browser-suite half of the skip guard (lib/skip-guard.js). A run in
// which any test was skipped or fixme'd FAILS, naming each one with its reason, and so does a run
// in which a whole project was switched off — a project that never ran verified as little as a
// skipped test.
//
// It reads each test's FINAL result as the runner recorded it, so a test.skip(cond) that fires
// only on this machine is counted, and one that does not fire is not. The one exception is
// lib/skip-guard.js › platformOnly(): accepted off its platform, and printed on every run.
//
// A switched-off project: when a playwright config drops a project the run selected (a browser
// that cannot run on this host, say), it says so by setting SKIP_GUARD_PROJECT_OFF to
// JSON `{ "name": "<project>", "notice": "<why>" }` before the run, and the reporter fails the run.
import path from 'node:path';
import { judgeSkips, verdictLines } from './lib/skip-guard.js';

export const PROJECT_OFF_ENV = 'SKIP_GUARD_PROJECT_OFF';

function projectOffFromEnv() {
  try { return process.env[PROJECT_OFF_ENV] ? JSON.parse(process.env[PROJECT_OFF_ENV]) : null; } catch { return null; }
}

export default class PlaywrightSkipGuardReporter {
  constructor(options = {}) {
    // { name, notice } of a project the config switched off whole AND this run selected (the
    // config decides that and passes it in the environment, so this reporter needs no options and works when named on the CLI).
    this.projectOff = options.projectOff !== undefined ? options.projectOff : projectOffFromEnv();
    this.platform = options.platform || process.platform;
    this.log = options.log || (line => console.log(line));
  }

  printsToStdio() { return false; }

  onBegin(config, suite) {
    // Paths print relative to the config's directory (the repo root), as Playwright's own lines do.
    this.baseDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.suite = suite;
  }

  // Exposed for tests: the skipped entries of a finished suite.
  skippedEntries() {
    const out = [];
    for (const t of this.suite ? this.suite.allTests() : []) {
      const last = t.results[t.results.length - 1];
      if (!last || last.status !== 'skipped') continue;
      const ann = [...(last.annotations || []), ...(t.annotations || [])]
        .find(a => a.type === 'skip' || a.type === 'fixme');
      const file = path.relative(this.baseDir, t.location.file);
      const project = t.parent?.project?.()?.name;
      out.push({
        name: `${project ? `[${project}] ` : ''}${t.titlePath().slice(3).join(' › ')}`,
        file: `${file}:${t.location.line}`,
        skip: ann?.description || (ann ? ann.type : true),
      });
    }
    return out;
  }

  onEnd() {
    const judged = judgeSkips(this.skippedEntries(), this.platform);
    const lines = verdictLines(judged, { label: 'e2e skip-guard' });
    if (this.projectOff) lines.push(`[e2e skip-guard] FAIL: project ${this.projectOff.name} was selected and did not run — ${this.projectOff.notice}`);
    const failed = judged.refused.length > 0 || !!this.projectOff;
    if (lines.length) this.log('\n' + lines.join('\n'));
    return failed ? { status: 'failed' } : undefined;
  }
}
