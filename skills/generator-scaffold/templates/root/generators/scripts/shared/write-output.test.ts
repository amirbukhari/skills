import {
  mkdtemp, mkdir, readFile, readdir, rm, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  afterEach, beforeEach, expect, it,
} from 'vitest';
import { removeStale, seedOnce, writeOutput } from './write-output';

let directory: string;

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'write-output-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('writes a missing file, creating its folders', async () => {
  const file = path.join(directory, 'nested/out.ts');
  await writeOutput(file, 'one\n', false, 'generate');
  expect(await readFile(file, 'utf8')).toBe('one\n');
});

it('reports drift in check mode without writing', async () => {
  const file = path.join(directory, 'out.ts');
  await writeFile(file, 'old\n');
  await expect(writeOutput(file, 'new\n', true, 'generate:actions')).rejects.toThrow(/out\.ts is out of date\. Run .*generate:actions/);
  expect(await readFile(file, 'utf8')).toBe('old\n');
});

it('accepts an up-to-date file in check mode, whatever its line endings', async () => {
  const file = path.join(directory, 'out.ts');
  await writeFile(file, 'same\r\n');
  await expect(writeOutput(file, 'same\n', true, 'generate')).resolves.toBeUndefined();
});

it('seeds a hand-owned file once and never overwrites it', async () => {
  const file = path.join(directory, 'feature/handler.ts');
  expect(await seedOnce(file, 'stub\n')).toBe(true);
  await writeFile(file, 'mine\n');
  expect(await seedOnce(file, 'stub\n')).toBe(false);
  expect(await readFile(file, 'utf8')).toBe('mine\n');
});

it('removes what a generated folder no longer produces', async () => {
  await mkdir(path.join(directory, 'gone'));
  await writeFile(path.join(directory, 'kept.ts'), '');
  await writeFile(path.join(directory, 'stale.ts'), '');
  await removeStale(directory, new Set(['kept.ts']));
  expect(await readdir(directory)).toEqual(['kept.ts']);
  await expect(removeStale(path.join(directory, 'absent'), new Set())).resolves.toBeUndefined();
});
