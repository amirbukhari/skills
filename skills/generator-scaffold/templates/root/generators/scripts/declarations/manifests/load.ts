import path from 'node:path';
import type { IFeatureManifest } from '../../../manifest';
import type { IResourceSpec } from '../../../resource';
import { declarationFiles, loadDeclaration } from '../resources/load';
import { manifestSchema } from './schema';

/** What is wrong with the manifests taken together and against the resources; empty when they are consistent. */
export const manifestProblems = (manifests: readonly IFeatureManifest[], specs: readonly IResourceSpec[]): string[] => {
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  const actionNames = manifests.flatMap((manifest) => manifest.actions.map((action) => action.name));
  const repeated = [...new Set(actionNames.filter((name, index) => actionNames.indexOf(name) !== index))];
  return [
    ...repeated.map((name) => `action ${name} is declared more than once; action names are unique across all manifests`),
    ...manifests.flatMap((manifest) => [
      ...Object.entries(manifest.resources).flatMap(([name, operations]) => {
        const spec = byName.get(name);
        if (spec === undefined) { return [`${manifest.key}: uses ${name}, which no declaration declares`]; }
        return operations.filter((operation) => spec.operations[operation] === undefined)
          .map((operation) => `${manifest.key}: selects ${operation} on ${name}, which does not declare it`);
      }),
      ...manifest.actions.flatMap((action) => (
        [...Object.entries(action.input), ...Object.entries(action.output)].flatMap(([name, field]) => (
          field.type === 'reference' && !byName.has(field.resource)
            ? [`${manifest.key}: ${action.name}.${name} references ${field.resource}, which no declaration declares`]
            : []
        ))
      )),
    ]),
  ];
};

/** Loads the feature manifests in generators/manifests and checks them against the resource declarations. */
export const loadManifests = async (root: string, specs: readonly IResourceSpec[]): Promise<IFeatureManifest[]> => {
  const directory = path.join(root, 'generators/manifests');
  const files = await declarationFiles(directory);
  const manifests = await Promise.all(files.map(async (file) => {
    const manifest: IFeatureManifest = await loadDeclaration('manifest', directory, file, 'manifest', manifestSchema);
    if (file !== `${manifest.key}.ts`) { throw new Error(`Manifest key must match filename: ${file}`); }
    return manifest;
  }));
  const problems = manifestProblems(manifests, specs);
  if (problems.length > 0) { throw new Error(`Invalid manifests:\n${problems.join('\n')}`); }
  return manifests;
};
