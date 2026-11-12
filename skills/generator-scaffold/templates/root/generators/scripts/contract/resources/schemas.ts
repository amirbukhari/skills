import type { IResourceSpec, TActionField } from '../../../resource';
import { camelCase, generatedHeader } from '../../shared/names';
import { enumExpression, inputExpression, recordExpression, valueExpression } from '../../shared/zod';

const enumName = (spec: IResourceSpec, name: string): string | undefined => (
  spec.fields[name]?.type === 'enum' ? `${name}Schema` : undefined
);

/** The fields a request writes: every field but the id and the timestamps. */
export const inputFields = (spec: IResourceSpec): [string, TActionField][] => (
  Object.entries(spec.fields).flatMap(([name, field]): [string, TActionField][] => (
    field.type === 'id' || field.type === 'timestamp' ? [] : [[name, field]]
  ))
);

const object = (lines: readonly string[]): string => (
  lines.length === 0 ? 'z.object({}).strict()' : ['z.object({', ...lines.map((line) => `  ${line},`), '}).strict()'].join('\n')
);

/** Renders one resource's contract: enum, record, input and filter schemas, each with its type. */
export const renderResourceContract = (spec: IResourceSpec): string => {
  const enums = Object.entries(spec.fields).flatMap(([name, field]) => (
    field.type === 'enum' ? [`export const ${name}Schema = ${enumExpression(field)};`] : []
  ));
  const record = Object.entries(spec.fields).map(([name, field]) => `${name}: ${recordExpression(field, enumName(spec, name))}`);
  const input = inputFields(spec).map(([name, field]) => `${name}: ${inputExpression(field, enumName(spec, name))}`);
  const filter = (spec.operations.list?.filters ?? []).flatMap((name) => {
    const field = spec.fields[name];
    if (field === undefined) { return []; }
    return [`${name}: ${field.type === 'string' ? 'z.string()' : valueExpression(field, enumName(spec, name))}.optional()`];
  });
  return [
    generatedHeader('generate:resources', `generators/resources/${spec.name}.ts`),
    'import { z } from \'zod\';',
    '',
    ...(enums.length === 0 ? [] : [...enums, '']),
    `/** ${spec.label.singular}: every stored field. */`,
    `export const recordSchema = ${object(record)};`,
    '',
    '/** What a create or an update submits. */',
    `export const inputSchema = ${object(input)};`,
    '',
    '/** What a list may be filtered by. */',
    `export const filterSchema = ${object(filter)};`,
    '',
    'export type IRecord = z.infer<typeof recordSchema>;',
    'export type IInput = z.infer<typeof inputSchema>;',
    'export type IFilter = z.infer<typeof filterSchema>;',
    '',
  ].join('\n');
};

/** Renders the contract's index: each resource's contract under its camelCase name. */
export const renderContractIndex = (specs: readonly IResourceSpec[]): string => [
  generatedHeader('generate:resources', 'generators/resources'),
  ...specs.map((spec) => `export * as ${camelCase(spec.name)} from './${spec.name}';`),
  '',
].join('\n');
