import type { IResourceSpec } from '../../../resource';
import { generatedHeader } from '../../shared/names';

/** Renders the router: one route per declared operation, each calling the service. An undeclared operation has no route. */
export const renderRouter = (spec: IResourceSpec): string => {
  const base = `/api/${spec.name}`;
  const { operations } = spec;
  const route = (method: string, path: string, handle: string): string => (
    `  { method: '${method}', path: '${path}', handle: ${handle} },`
  );
  return [
    generatedHeader('generate:resources', `generators/resources/${spec.name}.ts`),
    'import type { IRoute } from \'@api/http/route\';',
    'import type { IService } from \'./service\';',
    '',
    Object.keys(operations).length === 0
      ? 'export const createRoutes = (_service: IService): IRoute[] => ['
      : 'export const createRoutes = (service: IService): IRoute[] => [',
    ...(operations.list ? [route('GET', base, 'async (request) => ({ status: 200, body: { data: await service.list(request.query) } })')] : []),
    ...(operations.create ? [route('POST', base, 'async (request) => ({ status: 201, body: { data: await service.create(request.body) } })')] : []),
    ...(operations.get ? [route('GET', `${base}/:id`, 'async (request) => ({ status: 200, body: { data: await service.get(request.params.id ?? \'\') } })')] : []),
    ...(operations.update ? [route('PUT', `${base}/:id`, 'async (request) => ({ status: 200, body: { data: await service.update(request.params.id ?? \'\', request.body) } })')] : []),
    ...(operations.delete ? [route('DELETE', `${base}/:id`, 'async (request) => { await service.remove(request.params.id ?? \'\'); return { status: 204, body: undefined }; }')] : []),
    '];',
    '',
  ].join('\n');
};
