import { actions } from '@api/actions/index';
import { runAction } from '@api/actions/run';
import { createRoutes, createStores, type IStores } from '@api/generated/resources/index';
import { Problem } from './problem';
import type { IResponse, IRoute } from './route';

/** The params a path gives a route pattern, or undefined when it does not match. */
const match = (pattern: string, pathname: string): Record<string, string> | undefined => {
  const wanted = pattern.split('/');
  const given = pathname.split('/');
  if (wanted.length !== given.length) { return undefined; }
  const params: Record<string, string> = {};
  for (const [index, part] of wanted.entries()) {
    const value = given[index] ?? '';
    if (part.startsWith(':')) { params[part.slice(1)] = decodeURIComponent(value); } else if (part !== value) { return undefined; }
  }
  return params;
};

/**
 * The application: every generated resource route, and one endpoint that runs any enabled action. It is hand-written
 * and never changes when a resource or an action is added; it mounts whatever the generated barrels hold.
 */
export const createApp = (stores: IStores = createStores()) => {
  const routes: IRoute[] = [
    ...createRoutes(stores),
    {
      method: 'POST',
      path: '/api/actions/:name',
      handle: async (request) => ({
        status: 200, body: { data: await runAction(actions, request.params.name ?? '', request.body, { stores }) },
      }),
    },
  ];

  const handle = async (method: string, url: string, body?: unknown): Promise<IResponse> => {
    const target = new URL(url, 'resource://app');
    try {
      for (const route of routes) {
        const params = route.method === method ? match(route.path, target.pathname) : undefined;
        if (params !== undefined) {
          return await route.handle({ params, query: Object.fromEntries(target.searchParams), body });
        }
      }
      throw new Problem(404, `no route for ${method} ${target.pathname}`);
    } catch (error) {
      if (error instanceof Problem) { return { status: error.status, body: { error: error.message } }; }
      throw error;
    }
  };

  return { stores, handle };
};
