// M1 module hooks: a test file's DIRECT imports of the subject folders are replaced by stubs.
// Every exported function returns undefined; a plain-object export keeps its data but its
// function members are stubbed. Data exports (Sets, arrays, constants) are left as they are, so
// a test of exported DATA survives M1 by construction, not by weakness.
import { relOf, isTestRel, isSubjectModuleRel } from './config.mjs';

const bare = u => u.split('?')[0];
const isTestFile = u => !!u && u.startsWith('file:') && isTestRel(relOf(bare(u)));
const isSubject = u => u.startsWith('file:') && isSubjectModuleRel(relOf(bare(u)));

export async function resolve(spec, ctx, next) {
  const r = await next(spec, ctx);
  if (isTestFile(ctx.parentURL) && isSubject(r.url) && !r.url.includes('?')) {
    return { ...r, url: r.url + '?subject-mutation', format: 'module' };
  }
  return r;
}

export async function load(url, ctx, next) {
  if (!url.endsWith('?subject-mutation')) return next(url, ctx);
  const real = url.replace('?subject-mutation', '?subject-real');
  const ns = await import(real);
  const names = Object.keys(ns).filter(k => k !== 'default');
  const src = [
    `import * as real from ${JSON.stringify(real)};`,
    `const noop = function () { return undefined; };`,
    `const plain = v => v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);`,
    `const neuter = v => typeof v === 'function' ? noop : plain(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'function' ? noop : x])) : v;`,
    ...names.map(n => `export const ${n} = neuter(real[${JSON.stringify(n)}]);`),
    'default' in ns ? 'export default neuter(real.default);' : '',
  ].join('\n');
  return { format: 'module', source: src, shortCircuit: true };
}
