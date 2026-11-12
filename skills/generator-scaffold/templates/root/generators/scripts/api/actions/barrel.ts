import path from 'node:path';
import { config } from '../../../config';
import type { IFeatureManifest } from '../../../manifest';
import { loadManifests } from '../../declarations/manifests/load';
import { loadResources } from '../../declarations/resources/load';
import { renderActionContract } from '../../contract/actions/schemas';
import { generatedHeader, literal } from '../../shared/names';
import { removeStale, writeOutput } from '../../shared/write-output';
import { actionFolder, generateActionFolders } from './folders';

/** Renders actions/index.ts: every enabled feature's actions by public name, and the catalog of every feature. */
export const renderActionIndex = (manifests: readonly IFeatureManifest[]): string => {
  const enabled = manifests.filter((manifest) => manifest.enabled)
    .flatMap((manifest) => manifest.actions.map((action) => ({ name: action.name, source: `../${actionFolder(manifest.key, action)}/action` })))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const head = 'export const actions: Readonly<Record<string, IAction>> =';
  return [
    generatedHeader('generate:actions', 'generators/manifests'),
    ...enabled.map((action) => `import { ${action.name} } from ${literal(action.source)};`),
    'import type { IAction } from \'./define\';',
    '',
    '/** Every enabled action by public name; each validates its input and output against its declared schemas. */',
    ...(enabled.length === 0 ? [`${head} {};`] : [`${head} {`, ...enabled.map((action) => `  ${action.name},`), '};']),
    '',
    '/** Every declared feature, enabled or not, with the resource operations it uses. */',
    'export const features = [',
    ...manifests.map((manifest) => (
      `  { key: ${literal(manifest.key)}, label: ${literal(manifest.label)}, enabled: ${manifest.enabled}, resources: ${JSON.stringify(manifest.resources)} },`
    )),
    '] as const;',
    '',
  ].join('\n');
};

/**
 * Generates the action contracts, every declared action's folder and the registry of enabled actions, or checks them
 * for drift without writing when `check` is true.
 */
export const generateActions = async (root: string, check = false): Promise<void> => {
  const manifests = await loadManifests(root, await loadResources(root));
  const contracts = path.join(root, config.sharedDir, 'generated/actions');
  const withActions = manifests.filter((manifest) => manifest.actions.length > 0);
  await Promise.all(withActions.map((manifest) => (
    writeOutput(path.join(contracts, `${manifest.key}.ts`), renderActionContract(manifest), check, 'generate:actions')
  )));
  if (!check) { await removeStale(contracts, new Set(withActions.map((manifest) => `${manifest.key}.ts`))); }
  await generateActionFolders(root, manifests, check);
  await writeOutput(path.join(root, config.apiDir, 'actions/index.ts'), renderActionIndex(manifests), check, 'generate:actions');
};
