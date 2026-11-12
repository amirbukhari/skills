import { z } from 'zod';

export const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const CAMEL = /^[a-z][A-Za-z0-9]*$/;

const base = {
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  nullable: z.boolean().optional(),
};

const idField = z.strictObject({ type: z.literal('id'), label: z.string().min(1) });

/** The fields a declaration may name besides `id`. A timestamp is not among them: only the loader adds one. */
const declaredFields = [
  z.strictObject({
    type: z.literal('string'),
    ...base,
    max: z.number().int().positive(),
    min: z.number().int().min(0).optional(),
    pattern: z.string().min(1).optional(),
    unique: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('integer'), ...base, min: z.number().int().optional(), max: z.number().int().optional(),
  }),
  z.strictObject({ type: z.literal('boolean'), ...base, default: z.boolean().optional() }),
  z.strictObject({
    type: z.literal('enum'),
    ...base,
    values: z.array(z.strictObject({ value: z.string().min(1), label: z.string().min(1) })).min(1),
    default: z.string().optional(),
  }),
  z.strictObject({ type: z.literal('date'), ...base }),
  z.strictObject({ type: z.literal('datetime'), ...base }),
  z.strictObject({ type: z.literal('reference'), ...base, resource: z.string().regex(KEBAB) }),
] as const;

const resourceFieldSchema = z.discriminatedUnion('type', [idField, ...declaredFields]);

/** One field of an action's input or output: a declared field, which storage properties do not apply to. */
export const actionFieldSchema = z.discriminatedUnion('type', [...declaredFields])
  .refine((field) => !('unique' in field), 'an action field cannot be unique');

const fieldName = z.string().regex(CAMEL, 'field names are camelCase');

export const resourceSpecSchema = z.strictObject({
  name: z.string().regex(KEBAB, 'resource names are kebab-case'),
  label: z.strictObject({ singular: z.string().min(1), plural: z.string().min(1) }),
  description: z.string().min(1),
  fields: z.record(fieldName, resourceFieldSchema),
  operations: z.strictObject({
    list: z.strictObject({
      filters: z.array(fieldName).optional(),
      sort: z.strictObject({ field: fieldName, direction: z.enum(['asc', 'desc']) }),
    }).optional(),
    get: z.literal(true).optional(),
    create: z.literal(true).optional(),
    update: z.literal(true).optional(),
    delete: z.literal(true).optional(),
  }),
});
