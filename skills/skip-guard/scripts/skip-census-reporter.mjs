// node:test reporter: one JSON line per test (or suite) the run reported as skipped or todo.
// run-tests.mjs adds it to every run and fails the run on what it writes
// (lib/skip-guard.js says why). It writes nothing for a test that ran.
export default async function* skipCensus(source) {
  for await (const ev of source) {
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
    const d = ev.data || {};
    if (d.skip === undefined && d.todo === undefined) continue;
    yield JSON.stringify({
      name: d.name, file: d.file, line: d.line, kind: d.details?.type,
      ...(d.skip !== undefined ? { skip: d.skip } : {}),
      ...(d.todo !== undefined ? { todo: d.todo } : {}),
    }) + '\n';
  }
}
