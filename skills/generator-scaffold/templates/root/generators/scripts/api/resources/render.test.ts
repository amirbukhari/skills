import { expect, it } from 'vitest';
import { projects } from '../../declarations/resources/fixtures';
import { renderBarrel } from './barrel';
import { renderRouter } from './router';
import { renderService } from './service';
import { renderStore } from './store';

it('opens a route only for a declared operation', () => {
  const router = renderRouter(projects);
  expect(router).toContain('{ method: \'GET\', path: \'/api/work-projects\',');
  expect(router).toContain('{ method: \'DELETE\', path: \'/api/work-projects/:id\',');
  expect(router).not.toContain('method: \'POST\'');
  expect(router).not.toContain('method: \'PUT\'');
});

it('gives the store a lookup for each unique field, and the declared filters and sort', () => {
  const store = renderStore(projects);
  expect(store).toContain('findBy(field: \'code\', value: string)');
  expect(store).toContain('(filter.stage === undefined || row.stage === filter.stage) && (filter.parentId === undefined || row.parentId === filter.parentId)');
  expect(store).toContain('left.code < right.code ? 1 : left.code > right.code ? -1 : 0');
});

it('checks references and unique values in the service, with no hand-written code', () => {
  const service = renderService(projects, [projects]);
  expect(service).toContain('if (input.parentId !== null && !(await exists(\'work-projects\', input.parentId))) {');
  expect(service).toContain('throw new Problem(409, `Code "${input.code}" is already in use`);');
});

it('wires every resource into the barrel under its camelCase name', () => {
  const barrel = renderBarrel([projects]);
  expect(barrel).toContain('  workProjects: workProjectsStore(),');
  expect(barrel).toContain('    ...workProjectsRoutes(workProjectsService(stores.workProjects, exists)),');
});
