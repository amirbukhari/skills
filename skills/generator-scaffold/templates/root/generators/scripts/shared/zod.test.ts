import { expect, it } from 'vitest';
import { inputExpression, recordExpression, valueExpression } from './zod';

it('derives a string field\'s messages from its label', () => {
  expect(valueExpression({ type: 'string', label: 'Name', max: 10 })).toBe(
    'z.string().trim().min(1, \'Name is required\').max(10, \'Name must be at most 10 characters\')',
  );
});

it('refers to a declared enum schema by name, or spells the values out', () => {
  const field = { type: 'enum', label: 'Status', values: [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }] } as const;
  expect(valueExpression(field, 'statusSchema')).toBe('statusSchema');
  expect(valueExpression(field)).toBe('z.enum([\'A\', \'B\'])');
});

it('lets a resource input leave out a default or a nullable field, and an action input state its nulls', () => {
  expect(inputExpression({ type: 'boolean', label: 'Urgent', default: false })).toBe('z.boolean().default(false)');
  expect(inputExpression({ type: 'integer', label: 'Rank', nullable: true })).toMatch(/\.nullable\(\)\.default\(null\)$/);
  expect(inputExpression({ type: 'integer', label: 'Rank', nullable: true }, undefined, true)).toMatch(/\.nullable\(\)$/);
});

it('stores the update timestamp as null until the first update', () => {
  expect(recordExpression({ type: 'timestamp', label: 'Modified', set: 'on-update' })).toBe('z.string().datetime().nullable()');
  expect(recordExpression({ type: 'timestamp', label: 'Created', set: 'on-create' })).toBe('z.string().datetime()');
});
