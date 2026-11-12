import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { IResourceSpec, ITimestampField } from '../../../resource';
import { resourceProblems } from './checks';
import { resourceSpecSchema } from './schema';

/** The fields every resource gets without declaring them. */
const TIMESTAMPS: Readonly<Record<string, ITimestampField>> = {
  created: { type: 'timestamp', label: 'Created', set: 'on-create' },
  modified: { type: 'timestamp', label: 'Modified', set: 'on-update' },
};

/** The declaration files in a folder, in name order. Subfolders hold shared values, not declarations, and are skipped. */
export const declarationFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
};

/** Imports one declaration file and validates the export named `key` against `schema`. */
export const loadDeclaration = async <TSchema extends z.ZodType>(
  kind: string, directory: string, file: string, key: string, schema: TSchema,
): Promise<z.output<TSchema>> => {
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(path.join(directory, file)).href);
  } catch (error) {
    throw new Error(`Unable to load ${kind} ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = schema.safeParse((loaded as Record<string, unknown>)[key]);
  if (!parsed.success) {
    throw new Error(`Invalid ${kind} ${file}: ${parsed.error.issues.map((issue) => (
      `${issue.path.join('.')}: ${issue.message}`
    )).join('; ')}`);
  }
  return parsed.data;
};

const loadFile = async (directory: string, file: string): Promise<IResourceSpec> => {
  const spec: IResourceSpec = await loadDeclaration('resource', directory, file, 'resource', resourceSpecSchema);
  if (file !== `${spec.name}.ts`) { throw new Error(`Resource name must match filename: ${file}`); }
  const clashes = Object.keys(TIMESTAMPS).filter((name) => name in spec.fields);
  if (clashes.length > 0) {
    throw new Error(`Invalid resource ${file}: ${clashes.map((name) => (
      `${spec.name}.${name}: every resource gets ${name} automatically; remove it from the declaration`
    )).join('; ')}`);
  }
  return { ...spec, fields: { ...spec.fields, ...TIMESTAMPS } };
};

/**
 * Loads the declarations in generators/resources, validates each one's shape, adds the timestamps every resource
 * gets, then checks the declarations against each other.
 */
export const loadResources = async (root: string): Promise<IResourceSpec[]> => {
  const directory = path.join(root, 'generators/resources');
  const files = await declarationFiles(directory);
  if (files.length === 0) { throw new Error('No resource files found'); }
  const specs = await Promise.all(files.map((file) => loadFile(directory, file)));
  const problems = resourceProblems(specs);
  if (problems.length > 0) { throw new Error(`Invalid resource declarations:\n${problems.join('\n')}`); }
  return specs;
};
