// A node --test reporter for pr-gate.mjs: one JSON line per test result, per chunk of a
// file's output, and the run's summary. lib/pr-gate.js › parseRecords reads it back; the record
// shape and why this is not JUnit are described there.
// `type` is the runner's own `details.type`: 'suite' for a describe()/suite() block, 'test' for
// a test. Node emits a pass/fail event for both but counts suites apart (`counts.suites`), so
// parseRecords needs the type to reconcile each count exactly.
const msgOf = err => {
  if (!err) return '';
  const e = err.cause && typeof err.cause === 'object' ? err.cause : err;
  return String(e.message ?? e);
};

export default async function* prGateReporter(source) {
  for await (const { type, data } of source) {
    if (type === 'test:pass' || type === 'test:fail') {
      yield JSON.stringify({ t: type, type: data.details?.type, name: data.name, nesting: data.nesting, file: data.file, skip: !!data.skip, todo: !!data.todo, msg: type === 'test:fail' ? msgOf(data.details?.error) : '' }) + '\n';
    } else if (type === 'test:stdout' || type === 'test:stderr') {
      yield JSON.stringify({ t: 'output', file: data.file, text: data.message }) + '\n';
    } else if (type === 'test:summary') {
      yield JSON.stringify({ t: type, file: data.file, counts: data.counts }) + '\n';
    }
  }
}
