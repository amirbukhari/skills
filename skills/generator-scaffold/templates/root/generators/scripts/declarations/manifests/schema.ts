import { z } from 'zod';
import { actionFieldSchema, CAMEL, KEBAB } from '../resources/schema';

const fields = z.record(z.string().regex(CAMEL, 'field names are camelCase'), actionFieldSchema);

export const manifestSchema = z.strictObject({
  key: z.string().regex(KEBAB, 'feature keys are kebab-case'),
  label: z.string().min(1),
  description: z.string().min(1),
  enabled: z.boolean(),
  actions: z.array(z.strictObject({
    name: z.string().regex(CAMEL, 'action names are camelCase'),
    access: z.enum(['read', 'mutating']),
    description: z.string().min(1),
    input: fields,
    output: fields,
  })),
  resources: z.record(z.string().regex(KEBAB), z.array(z.enum(['list', 'get', 'create', 'update', 'delete']))),
});
