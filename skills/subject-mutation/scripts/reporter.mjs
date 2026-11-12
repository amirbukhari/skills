// One line per test: STATUS \t file \t name
import { relOf } from './config.mjs';

export default async function* (source) {
  for await (const e of source) {
    if (e.type !== 'test:pass' && e.type !== 'test:fail') continue;
    if (e.data.details?.type === 'suite') continue;
    const st = e.type === 'test:fail' ? 'FAIL' : e.data.skip !== undefined ? 'SKIP' : e.data.todo !== undefined ? 'TODO' : 'PASS';
    yield `${st}\t${relOf(e.data.file || '') ?? (e.data.file || '')}\t${e.data.name}\n`;
  }
}
