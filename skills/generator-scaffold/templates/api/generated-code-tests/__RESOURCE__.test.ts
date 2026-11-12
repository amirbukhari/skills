import { beforeEach, expect, it } from 'vitest';
import { recordSchema, type IRecord } from '@shared/generated/resources/__RESOURCE__';
import { createApp } from '@api/http/app';

// Exercises the code generated from generators/resources/__RESOURCE__.ts and generators/manifests/__RESOURCE__.ts
// through the application, against in-memory stores.

let app: ReturnType<typeof createApp>;
const BASE = '/api/__RESOURCE__';

const create = async (body: unknown): Promise<IRecord> => {
  const response = await app.handle('POST', BASE, body);
  expect(response.status).toBe(201);
  return recordSchema.parse((response.body as { data: unknown }).data);
};

beforeEach(() => { app = createApp(); });

it('creates a record with its defaults, an id and a creation time', async () => {
  const record = await create({ name: '  First  ' });
  expect(record).toMatchObject({ name: 'First', status: 'OPEN', notes: null, modified: null });
  expect((await app.handle('GET', `${BASE}/${record.id}`)).body).toEqual({ data: record });
});

it('refuses invalid input with the field and the message its label gives', async () => {
  expect(await app.handle('POST', BASE, { name: '' })).toEqual({ status: 400, body: { error: 'name: Name is required' } });
  expect((await app.handle('POST', BASE, { name: 'A', status: 'LATER' })).status).toBe(400);
  expect((await app.handle('POST', BASE, { name: 'A', colour: 'red' })).status).toBe(400);
});

it('refuses a second record with the same unique value, but lets a record keep its own', async () => {
  const record = await create({ name: 'Same' });
  expect(await app.handle('POST', BASE, { name: 'Same' })).toEqual({
    status: 409, body: { error: 'Name "Same" is already in use' },
  });
  expect((await app.handle('PUT', `${BASE}/${record.id}`, { name: 'Same', status: 'DONE' })).status).toBe(200);
});

it('replaces the record on update and records when', async () => {
  const record = await create({ name: 'Draft', notes: 'keep me' });
  const response = await app.handle('PUT', `${BASE}/${record.id}`, { name: 'Final', status: 'DONE' });
  const updated = recordSchema.parse((response.body as { data: unknown }).data);
  expect(updated).toMatchObject({ id: record.id, name: 'Final', status: 'DONE', notes: null, created: record.created });
  expect(updated.modified).not.toBeNull();
});

it('lists in the declared order, filtered by a declared filter only', async () => {
  await create({ name: 'b', status: 'DONE' });
  await create({ name: 'c' });
  await create({ name: 'a', status: 'DONE' });
  const names = async (query: string): Promise<string[]> => (
    ((await app.handle('GET', `${BASE}${query}`)).body as { data: IRecord[] }).data.map((row) => row.name)
  );
  expect(await names('')).toEqual(['a', 'b', 'c']);
  expect(await names('?status=DONE')).toEqual(['a', 'b']);
  expect((await app.handle('GET', `${BASE}?name=a`)).status).toBe(400);
});

it('answers 404 for a record that does not exist, and opens no endpoint the declaration leaves out', async () => {
  const missing = '00000000-0000-4000-8000-000000000000';
  expect(await app.handle('GET', `${BASE}/${missing}`)).toEqual({
    status: 404, body: { error: `there is no __SINGULAR_LOWER__ with id ${missing}` },
  });
  const record = await create({ name: 'Kept' });
  expect((await app.handle('DELETE', `${BASE}/${record.id}`)).status).toBe(404);
  expect((await app.handle('GET', `${BASE}/${record.id}`)).status).toBe(200);
});

it('runs the feature\'s action through the action endpoint, validating its input', async () => {
  await create({ name: 'one' });
  await create({ name: 'two', status: 'DONE' });
  const run = (input: unknown) => app.handle('POST', '/api/actions/__RESOURCE_CAMEL__Summary', input);
  expect(await run({ status: null })).toEqual({ status: 200, body: { data: { total: 2 } } });
  expect(await run({ status: 'DONE' })).toEqual({ status: 200, body: { data: { total: 1 } } });
  expect((await run({})).status).toBe(400);
  expect((await app.handle('POST', '/api/actions/noSuchAction', {})).status).toBe(404);
});
