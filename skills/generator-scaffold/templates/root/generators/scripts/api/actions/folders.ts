import path from 'node:path';
import { config } from '../../../config';
import type { IActionManifest, IFeatureManifest } from '../../../manifest';
import { generatedHeader, kebabCase, literal, pascalCase } from '../../shared/names';
import { seedOnce, writeOutput } from '../../shared/write-output';

/** An action's folder, relative to the API folder. */
export const actionFolder = (key: string, action: IActionManifest): string => (
  `features/${key}/actions/${kebabCase(action.name)}`
);

/** Renders action.ts: the handler wrapped with its generated schemas. Rewritten on every run. */
export const renderAction = (key: string, action: IActionManifest): string => [
  `${generatedHeader('generate:actions', `generators/manifests/${key}.ts`)} Edit handler.ts beside it.`,
  `import { ${action.name}InputSchema, ${action.name}OutputSchema } from '@shared/generated/actions/${key}';`,
  'import { defineAction } from \'@api/actions/define\';',
  'import { handler } from \'./handler\';',
  '',
  `/** ${action.description} */`,
  `export const ${action.name} = defineAction({`,
  `  name: ${literal(action.name)},`,
  `  access: ${literal(action.access)},`,
  `  input: ${action.name}InputSchema,`,
  `  output: ${action.name}OutputSchema,`,
  '  handler,',
  '});',
  '',
].join('\n');

/** Renders the handler stub: typed to the action's contract, written once and the developer's from then on. */
export const renderHandlerStub = (key: string, action: IActionManifest): string => {
  const name = pascalCase(action.name);
  return [
    `import type { I${name}Input, I${name}Output } from '@shared/generated/actions/${key}';`,
    'import type { THandler } from \'@api/actions/define\';',
    '',
    `/** ${action.description} */`,
    `export const handler: THandler<I${name}Input, I${name}Output> = async () => {`,
    `  throw new Error(${literal(`${action.name} is not implemented`)});`,
    '};',
    '',
  ].join('\n');
};

/** Writes every declared action's folder. In check mode a missing handler is drift, and nothing is written. */
export const generateActionFolders = async (root: string, manifests: readonly IFeatureManifest[], check: boolean): Promise<void> => {
  await Promise.all(manifests.flatMap((manifest) => manifest.actions.map(async (action) => {
    const folder = path.join(root, config.apiDir, actionFolder(manifest.key, action));
    await writeOutput(path.join(folder, 'action.ts'), renderAction(manifest.key, action), check, 'generate:actions');
    if (check) { return; }
    if (await seedOnce(path.join(folder, 'handler.ts'), renderHandlerStub(manifest.key, action))) {
      console.info(`Seeded ${path.join(config.apiDir, actionFolder(manifest.key, action), 'handler.ts')}: implement it.`);
    }
  })));
};
