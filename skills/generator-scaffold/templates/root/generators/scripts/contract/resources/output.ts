import path from 'node:path';
import { config } from '../../../config';
import type { IResourceSpec } from '../../../resource';
import { removeStale, writeOutput } from '../../shared/write-output';
import { renderContractIndex, renderResourceContract } from './schemas';

/** Generates the resource contract: one file per resource and their index, in a folder generated in full. */
export const generateResourceContracts = async (root: string, specs: readonly IResourceSpec[]): Promise<void> => {
  const directory = path.join(root, config.sharedDir, 'generated/resources');
  const outputs = [
    { name: 'index.ts', text: renderContractIndex(specs) },
    ...specs.map((spec) => ({ name: `${spec.name}.ts`, text: renderResourceContract(spec) })),
  ];
  await Promise.all(outputs.map((output) => writeOutput(path.join(directory, output.name), output.text, false, 'generate:resources')));
  await removeStale(directory, new Set(outputs.map((output) => output.name)));
};
