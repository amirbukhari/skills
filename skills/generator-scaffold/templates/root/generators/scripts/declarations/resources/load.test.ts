import {
  mkdtemp, mkdir, rm, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  afterEach, beforeEach, describe, expect, it,
} from 'vitest';
import { projectRoot } from '../../../config';
import { loadResources } from './load';

it('loads every real resource declaration', async () => {
  const resources = await loadResources(projectRoot);
  // Pinned: adding or removing a resource is a decision made here, in the same change.
  expect(resources.map((resource) => resource.name)).toEqual([
    '__RESOURCE__',
  ]);
});

describe('resource validation', () => {
  let root: string;
  const notes = () => ({
    name: 'notes',
    label: { singular: 'Note', plural: 'Notes' },
    description: 'A note.',
    fields: {
      id: { type: 'id', label: 'ID' },
      title: { type: 'string', label: 'Title', max: 80 },
      parentId: { type: 'reference', label: 'Parent', resource: 'notes', nullable: true },
    },
    operations: { list: { filters: ['parentId'], sort: { field: 'title', direction: 'asc' } }, get: true },
  });
  const declare = async (file: string, value: unknown) => {
    await writeFile(path.join(root, 'generators/resources', file), `export const resource = ${JSON.stringify(value)};\n`);
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'resources-'));
    await mkdir(path.join(root, 'generators/resources'), { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('accepts a self-consistent declaration and adds the timestamps', async () => {
    await declare('notes.ts', notes());
    const [loaded] = await loadResources(root);
    expect(Object.keys(loaded?.fields ?? {})).toEqual(['id', 'title', 'parentId', 'created', 'modified']);
  });

  it('refuses a folder with no declarations', async () => {
    await expect(loadResources(root)).rejects.toThrow('No resource files found');
  });

  it('refuses a name that differs from the file name', async () => {
    await declare('memos.ts', notes());
    await expect(loadResources(root)).rejects.toThrow('Resource name must match filename: memos.ts');
  });

  it('refuses a declaration that names a timestamp itself', async () => {
    const spec = notes();
    await declare('notes.ts', { ...spec, fields: { ...spec.fields, modified: { type: 'datetime', label: 'M' } } });
    await expect(loadResources(root)).rejects.toThrow('notes.modified: every resource gets modified automatically');
  });

  it('refuses an unknown property, naming where it is', async () => {
    const spec = notes();
    await declare('notes.ts', { ...spec, fields: { ...spec.fields, title: { ...spec.fields.title, width: 3 } } });
    await expect(loadResources(root)).rejects.toThrow(/Invalid resource notes\.ts: fields\.title/);
  });

  it('refuses a reference to a resource no declaration declares', async () => {
    const spec = notes();
    await declare('notes.ts', { ...spec, fields: { ...spec.fields, parentId: { ...spec.fields.parentId, resource: 'folders' } } });
    await expect(loadResources(root)).rejects.toThrow('notes.parentId: references folders, which no declaration declares');
  });

  it('refuses a list filter or sort that names no usable field', async () => {
    const spec = notes();
    await declare('notes.ts', { ...spec, operations: { list: { filters: ['colour'], sort: { field: 'parentId', direction: 'asc' } } } });
    await expect(loadResources(root)).rejects.toThrow(
      'notes: list filter colour is not a field\nnotes: list sort field parentId must be a non-nullable, orderable field',
    );
  });
});
