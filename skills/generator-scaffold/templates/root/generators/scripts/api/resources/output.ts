import path from 'node:path';
import { config } from '../../../config';
import type { IResourceSpec } from '../../../resource';
import { removeStale, writeOutput } from '../../shared/write-output';
import { renderBarrel } from './barrel';
import { renderRouter } from './router';
import { renderService } from './service';
import { renderStore } from './store';

/** Each file generated for one resource, and how it is rendered. */
const RESOURCE_FILES: Readonly<Record<string, (spec: IResourceSpec, specs: readonly IResourceSpec[]) => string>> = {
  'router.ts': renderRouter,
  'service.ts': renderService,
  'store.ts': renderStore,
};

/**
 * Generates the API's generated folder: one folder per resource and the barrel beside them. The output is gitignored,
 * so it is regenerated rather than reviewed, and anything no declaration produces any more is deleted.
 */
export const generateResources = async (root: string, specs: readonly IResourceSpec[]): Promise<void> => {
  const generated = path.join(root, config.apiDir, 'generated');
  const resources = path.join(generated, 'resources');
  const outputs = [
    { file: path.join(resources, 'index.ts'), text: renderBarrel(specs) },
    ...specs.flatMap((spec) => Object.entries(RESOURCE_FILES).map(([file, render]) => ({
      file: path.join(resources, spec.name, file), text: render(spec, specs),
    }))),
  ];
  await Promise.all(outputs.map((output) => writeOutput(output.file, output.text, false, 'generate:resources')));
  await removeStale(generated, new Set(['resources']));
  await removeStale(resources, new Set(['index.ts', ...specs.map((spec) => spec.name)]));
  await Promise.all(specs.map((spec) => removeStale(path.join(resources, spec.name), new Set(Object.keys(RESOURCE_FILES)))));
};
