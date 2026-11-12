import type { IActionManifest, IFeatureManifest } from '../../../manifest';
import type { TActionField } from '../../../resource';
import { generatedHeader, pascalCase } from '../../shared/names';
import { inputExpression, recordExpression } from '../../shared/zod';

const object = (fields: Readonly<Record<string, TActionField>>, expression: (field: TActionField) => string): string => {
  const lines = Object.entries(fields).map(([name, field]) => `  ${name}: ${expression(field)},`);
  return lines.length === 0 ? 'z.object({}).strict()' : ['z.object({', ...lines, '}).strict()'].join('\n');
};

const renderAction = (action: IActionManifest): string[] => [
  `/** ${action.description} */`,
  `export const ${action.name}InputSchema = ${object(action.input, (field) => inputExpression(field, undefined, true))};`,
  `export const ${action.name}OutputSchema = ${object(action.output, (field) => recordExpression(field))};`,
  `export type I${pascalCase(action.name)}Input = z.infer<typeof ${action.name}InputSchema>;`,
  `export type I${pascalCase(action.name)}Output = z.infer<typeof ${action.name}OutputSchema>;`,
  '',
];

/** Renders one manifest's action contract: strict input and output schemas for each action, with their types. */
export const renderActionContract = (manifest: IFeatureManifest): string => [
  generatedHeader('generate:actions', `generators/manifests/${manifest.key}.ts`),
  'import { z } from \'zod\';',
  '',
  ...manifest.actions.flatMap(renderAction),
].join('\n');
