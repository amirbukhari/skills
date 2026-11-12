import type { IResourceSpec } from '../../../resource';
import { generatedHeader, literal } from '../../shared/names';
import { uniqueFields } from './store';

const singular = (spec: IResourceSpec): string => spec.label.singular.toLowerCase();

/** The checks a write makes beyond its schema: each reference names a record, and no unique value is taken. */
const checks = (spec: IResourceSpec, specs: readonly IResourceSpec[]): string[] => [
  ...Object.entries(spec.fields).flatMap(([name, field]) => {
    if (field.type !== 'reference') { return []; }
    const target = specs.find((other) => other.name === field.resource) ?? spec;
    const guard = field.nullable === true ? `input.${name} !== null && ` : '';
    return [
      `    if (${guard}!(await exists(${literal(field.resource)}, input.${name}))) {`,
      `      throw new Problem(400, \`there is no ${singular(target)} with id \${input.${name}}\`);`,
      '    }',
    ];
  }),
  ...uniqueFields(spec).flatMap((name) => [
    `    const ${name}Holder = await store.findBy(${literal(name)}, input.${name});`,
    `    if (${name}Holder !== undefined && ${name}Holder.id !== id) {`,
    `      throw new Problem(409, \`${spec.fields[name]?.label ?? name} "\${input.${name}}" is already in use\`);`,
    '    }',
  ]),
];

/**
 * Renders the service: every operation over the store, with validation against the contract. It holds all five
 * whatever the declaration opens, so server code can make a write no caller can post.
 */
export const renderService = (spec: IResourceSpec, specs: readonly IResourceSpec[]): string => {
  const body = checks(spec, specs);
  return [
    generatedHeader('generate:resources', `generators/resources/${spec.name}.ts`),
    'import { randomUUID } from \'node:crypto\';',
    `import { filterSchema, inputSchema, type IInput, type IRecord } from '@shared/generated/resources/${spec.name}';`,
    'import { parseOrProblem, Problem } from \'@api/http/problem\';',
    'import type { IStore } from \'./store\';',
    '',
    '/** Whether a record of the named resource exists; how a service checks its references. */',
    'export type TExists = (resource: string, id: string) => Promise<boolean>;',
    '',
    body.length === 0
      ? 'export const createService = (store: IStore, _exists: TExists) => {'
      : 'export const createService = (store: IStore, exists: TExists) => {',
    ...(body.length === 0 ? [] : ['  const check = async (input: IInput, id?: string): Promise<void> => {', ...body, '  };', '']),
    '  const get = async (id: string): Promise<IRecord> => {',
    '    const record = await store.get(id);',
    `    if (record === undefined) { throw new Problem(404, \`there is no ${singular(spec)} with id \${id}\`); }`,
    '    return record;',
    '  };',
    '',
    '  return {',
    '    list: async (query: unknown): Promise<IRecord[]> => store.list(parseOrProblem(filterSchema, query)),',
    '    get,',
    '    create: async (body: unknown): Promise<IRecord> => {',
    '      const input: IInput = parseOrProblem(inputSchema, body);',
    ...(body.length === 0 ? [] : ['      await check(input);']),
    '      const record: IRecord = { id: randomUUID(), ...input, created: new Date().toISOString(), modified: null };',
    '      await store.insert(record);',
    '      return record;',
    '    },',
    '    update: async (id: string, body: unknown): Promise<IRecord> => {',
    '      const current = await get(id);',
    '      const input: IInput = parseOrProblem(inputSchema, body);',
    ...(body.length === 0 ? [] : ['      await check(input, id);']),
    '      const record: IRecord = { ...current, ...input, modified: new Date().toISOString() };',
    '      await store.replace(record);',
    '      return record;',
    '    },',
    '    remove: async (id: string): Promise<void> => {',
    '      await get(id);',
    '      await store.remove(id);',
    '    },',
    '  };',
    '};',
    '',
    'export type IService = ReturnType<typeof createService>;',
    '',
  ].join('\n');
};
