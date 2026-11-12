import type { IResourceSpec } from '../../../resource';
import { camelCase, generatedHeader, literal } from '../../shared/names';

/** Renders the barrel the runtime mounts: every resource's store, and every resource's routes over those stores. */
export const renderBarrel = (specs: readonly IResourceSpec[]): string => {
  const names = specs.map((spec) => ({ name: spec.name, camel: camelCase(spec.name) }));
  return [
    generatedHeader('generate:resources', 'generators/resources'),
    'import type { IRoute } from \'@api/http/route\';',
    ...names.flatMap(({ name, camel }) => [
      `import { createRoutes as ${camel}Routes } from './${name}/router';`,
      `import { createService as ${camel}Service } from './${name}/service';`,
      `import { createMemoryStore as ${camel}Store } from './${name}/store';`,
    ]),
    '',
    '/** One store per resource, by the resource\'s camelCase name. */',
    'export const createStores = () => ({',
    ...names.map(({ camel }) => `  ${camel}: ${camel}Store(),`),
    '});',
    '',
    'export type IStores = ReturnType<typeof createStores>;',
    '',
    'const STORE_KEYS: Readonly<Record<string, keyof IStores | undefined>> = {',
    ...names.map(({ name, camel }) => `  ${literal(name)}: ${literal(camel)},`),
    '};',
    '',
    '/** Every resource\'s routes. A resource belongs to no feature, so its endpoints are always mounted. */',
    'export const createRoutes = (stores: IStores): IRoute[] => {',
    '  const exists = async (resource: string, id: string): Promise<boolean> => {',
    '    const key = STORE_KEYS[resource];',
    '    return key !== undefined && (await stores[key].get(id)) !== undefined;',
    '  };',
    '  return [',
    ...names.map(({ camel }) => `    ...${camel}Routes(${camel}Service(stores.${camel}, exists)),`),
    '  ];',
    '};',
    '',
  ].join('\n');
};
