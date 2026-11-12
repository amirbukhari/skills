import type { IResourceSpec } from '../../../resource';
import { generatedHeader, literal } from '../../shared/names';

/** The fields the store can look a record up by: the unique ones. */
export const uniqueFields = (spec: IResourceSpec): string[] => (
  Object.entries(spec.fields).flatMap(([name, field]) => (field.type === 'string' && field.unique === true ? [name] : []))
);

/**
 * Renders the storage interface the service needs and an in-memory implementation of it. This renderer is the seam
 * for a real datastore: render a second implementation of IStore here and the service does not change.
 */
export const renderStore = (spec: IResourceSpec): string => {
  const uniques = uniqueFields(spec);
  const filters = spec.operations.list?.filters ?? [];
  const sort = spec.operations.list?.sort ?? { field: 'id', direction: 'asc' as const };
  const [before, after] = sort.direction === 'asc' ? [-1, 1] : [1, -1];
  const condition = filters.map((name) => `(filter.${name} === undefined || row.${name} === filter.${name})`).join(' && ');
  const lookup = uniques.map(literal).join(' | ');
  return [
    generatedHeader('generate:resources', `generators/resources/${spec.name}.ts`),
    `import type { IFilter, IRecord } from '@shared/generated/resources/${spec.name}';`,
    '',
    '/** What the service needs from storage. */',
    'export interface IStore {',
    '  list(filter: IFilter): Promise<IRecord[]>;',
    '  get(id: string): Promise<IRecord | undefined>;',
    ...(uniques.length === 0 ? [] : [`  findBy(field: ${lookup}, value: string): Promise<IRecord | undefined>;`]),
    '  insert(record: IRecord): Promise<void>;',
    '  replace(record: IRecord): Promise<void>;',
    '  remove(id: string): Promise<void>;',
    '}',
    '',
    '/** An in-memory store: enough for tests and local development. */',
    'export const createMemoryStore = (): IStore => {',
    '  const rows = new Map<string, IRecord>();',
    '  return {',
    `    list: async (${filters.length === 0 ? '' : 'filter'}) => [...rows.values()]`,
    ...(filters.length === 0 ? [] : [`      .filter((row) => ${condition})`]),
    `      .sort((left, right) => (left.${sort.field} < right.${sort.field} ? ${before} : left.${sort.field} > right.${sort.field} ? ${after} : 0)),`,
    '    get: async (id) => rows.get(id),',
    ...(uniques.length === 0 ? [] : ['    findBy: async (field, value) => [...rows.values()].find((row) => row[field] === value),']),
    '    insert: async (record) => { rows.set(record.id, record); },',
    '    replace: async (record) => { rows.set(record.id, record); },',
    '    remove: async (id) => { rows.delete(id); },',
    '  };',
    '};',
    '',
  ].join('\n');
};
