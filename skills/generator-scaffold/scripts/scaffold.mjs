#!/usr/bin/env node
// Scaffolds a generator-style project from ../templates. No dependencies: Node 20.11 or later.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = fileURLToPath(new URL('../templates', import.meta.url));
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const FOLDER = /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
const RUNNERS = { npm: 'npm run', pnpm: 'pnpm run', yarn: 'yarn run', bun: 'bun run' };

const USAGE = `Usage: node scaffold.mjs --out <dir> --name <project-name> [options]

  --out <dir>          Folder to create the project in. Must be missing or empty.
  --name <name>        Project (package) name, kebab-case.
  --resource <name>    Example resource, kebab-case plural.            Default: tasks
  --singular <label>   The example resource's singular label.          Default: derived from --resource
  --plural <label>     The example resource's plural label.            Default: derived from --resource
  --api-dir <path>     Where the API's source lives, from the root.    Default: apps/api/src
  --shared-dir <path>  Where the shared contract lives, from the root. Default: packages/shared/src
  --pm <manager>       ${Object.keys(RUNNERS).join(' | ')}: used in scripts and generated headers.  Default: npm
`;

const fail = (message) => {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--help' || flag === '-h') { console.info(USAGE); process.exit(0); }
    if (!flag.startsWith('--') || value === undefined || value.startsWith('--')) { fail(`Expected a value after ${flag}`); }
    options[flag.slice(2)] = value;
  }
  return options;
};

const camelCase = (kebab) => kebab.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
const titleCase = (kebab) => kebab.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
const singularOf = (plural) => (plural.endsWith('ies') ? `${plural.slice(0, -3)}y` : plural.replace(/s$/, ''));

const filesUnder = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  }));
  return nested.flat();
};

const main = async () => {
  const known = new Set(['out', 'name', 'resource', 'singular', 'plural', 'api-dir', 'shared-dir', 'pm']);
  const options = parseArgs(process.argv.slice(2));
  const unknown = Object.keys(options).filter((key) => !known.has(key));
  if (unknown.length > 0) { fail(`Unknown option: --${unknown[0]}`); }
  if (options.out === undefined || options.name === undefined) { fail('--out and --name are required'); }

  const resource = options.resource ?? 'tasks';
  const apiDir = (options['api-dir'] ?? 'apps/api/src').replace(/\/+$/, '');
  const sharedDir = (options['shared-dir'] ?? 'packages/shared/src').replace(/\/+$/, '');
  const pm = options.pm ?? 'npm';
  if (!KEBAB.test(options.name)) { fail(`--name must be kebab-case: ${options.name}`); }
  if (!KEBAB.test(resource)) { fail(`--resource must be kebab-case: ${resource}`); }
  for (const [flag, folder] of [['--api-dir', apiDir], ['--shared-dir', sharedDir]]) {
    if (!FOLDER.test(folder) || folder.split('/').includes('..')) { fail(`${flag} must be a relative folder inside the project: ${folder}`); }
    if (folder === 'generators' || folder.startsWith('generators/')) { fail(`${flag} cannot be inside generators/`); }
  }
  if (apiDir === sharedDir || apiDir.startsWith(`${sharedDir}/`) || sharedDir.startsWith(`${apiDir}/`)) {
    fail('--api-dir and --shared-dir must be separate folders');
  }
  if (!Object.hasOwn(RUNNERS, pm)) { fail(`--pm must be one of ${Object.keys(RUNNERS).join(', ')}: ${pm}`); }

  const out = path.resolve(options.out);
  const existing = await readdir(out).catch((error) => {
    if (error.code === 'ENOENT') { return []; }
    throw error;
  });
  if (existing.length > 0) { fail(`${out} is not empty; nothing was written`); }

  const plural = options.plural ?? titleCase(resource);
  const singular = options.singular ?? singularOf(plural);
  // Longest tokens first, so a token that begins another is never replaced inside it.
  const tokens = Object.entries({
    __RESOURCE_PASCAL__: camelCase(`x-${resource}`).slice(1),
    __RESOURCE_CAMEL__: camelCase(resource),
    __SINGULAR_LOWER__: singular.toLowerCase(),
    __SHARED_DIR__: sharedDir,
    __SINGULAR__: singular,
    __RESOURCE__: resource,
    __API_DIR__: apiDir,
    __PROJECT__: options.name,
    __PM_RUN__: RUNNERS[pm],
    __PLURAL__: plural,
  }).sort(([left], [right]) => right.length - left.length);
  const fill = (text) => tokens.reduce((result, [token, value]) => result.replaceAll(token, value), text);

  const written = [];
  for (const [source, target] of [['root', '.'], ['api', apiDir]]) {
    const base = path.join(TEMPLATES, source);
    for (const file of await filesUnder(base)) {
      const relative = fill(path.relative(base, file)).replace(/^gitignore$/, '.gitignore');
      const destination = path.join(out, target, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, fill(await readFile(file, 'utf8')), { flag: 'wx' });
      written.push(path.relative(out, destination));
    }
  }

  const leftover = [];
  for (const file of written) {
    if (/__[A-Z_]+__/.test(file) || /__[A-Z][A-Z_]*__/.test(await readFile(path.join(out, file), 'utf8'))) { leftover.push(file); }
  }
  if (leftover.length > 0) { throw new Error(`Unfilled template tokens in: ${leftover.join(', ')}`); }

  console.info(`Scaffolded ${options.name} in ${out}: ${written.length} files.`);
  console.info(`Next: cd there, ${pm} install, then ${RUNNERS[pm]} generate, ${RUNNERS[pm]} test and ${RUNNERS[pm]} typecheck.`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
