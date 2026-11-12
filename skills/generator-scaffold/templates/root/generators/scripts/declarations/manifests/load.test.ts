import { expect, it } from 'vitest';
import type { IFeatureManifest } from '../../../manifest';
import { projectRoot } from '../../../config';
import { loadResources } from '../resources/load';
import { loadManifests, manifestProblems } from './load';

const feature = (overrides: Partial<IFeatureManifest>): IFeatureManifest => ({
  key: 'reports', label: 'Reports', description: 'Reports.', enabled: true, actions: [], resources: {}, ...overrides,
});

it('loads every real manifest against the real resources', async () => {
  const specs = await loadResources(projectRoot);
  const manifests = await loadManifests(projectRoot, specs);
  expect(manifests.map((manifest) => manifest.key)).toEqual(['__RESOURCE__']);
  expect(manifestProblems(manifests, specs)).toEqual([]);
});

it('refuses a resource no declaration declares, and an operation the resource does not declare', async () => {
  const specs = await loadResources(projectRoot);
  expect(manifestProblems([feature({ resources: { ghosts: ['list'], '__RESOURCE__': ['delete'] } })], specs)).toEqual([
    'reports: uses ghosts, which no declaration declares',
    'reports: selects delete on __RESOURCE__, which does not declare it',
  ]);
});

it('refuses an action name two manifests share', () => {
  const action = { name: 'refresh', access: 'read', description: 'Refreshes.', input: {}, output: {} } as const;
  expect(manifestProblems([feature({ actions: [action] }), feature({ key: 'other', actions: [action] })], [])).toEqual([
    'action refresh is declared more than once; action names are unique across all manifests',
  ]);
});
