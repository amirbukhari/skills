import {
  mkdir, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config';

const missing = (error: NodeJS.ErrnoException): boolean => error.code === 'ENOENT';

/** Writes generated output only when it changed, or reports drift without writing when `check` is true. */
export const writeOutput = async (file: string, text: string, check: boolean, command: string): Promise<void> => {
  const previous = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (missing(error)) { return undefined; }
    throw error;
  });
  // A checkout may convert line endings; that alone is not drift.
  if (previous?.replace(/\r\n/g, '\n') === text) { return; }
  if (check) { throw new Error(`${path.basename(file)} is out of date. Run ${config.run} ${command}`); }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};

/** Writes a hand-owned file only when it does not exist yet. Returns whether it wrote. */
export const seedOnce = async (file: string, text: string): Promise<boolean> => {
  await mkdir(path.dirname(file), { recursive: true });
  return writeFile(file, text, { flag: 'wx' }).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') { return false; }
    throw error;
  });
};

/** Removes whatever a wholly generated folder holds that no declaration produces any more. */
export const removeStale = async (directory: string, expected: ReadonlySet<string>): Promise<void> => {
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (missing(error)) { return [] as string[]; }
    throw error;
  });
  await Promise.all(names.filter((name) => !expected.has(name))
    .map((name) => rm(path.join(directory, name), { recursive: true, force: true })));
};
