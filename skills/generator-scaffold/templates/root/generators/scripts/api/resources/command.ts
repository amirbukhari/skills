import { projectRoot } from '../../../config';
import { generateResourceContracts } from '../../contract/resources/output';
import { loadManifests } from '../../declarations/manifests/load';
import { loadResources } from '../../declarations/resources/load';
import { generateResources } from './output';

const main = async (): Promise<void> => {
  if (process.argv.length > 2) { throw new Error('generate:resources takes no arguments'); }
  const specs = await loadResources(projectRoot);
  // Loaded only to refuse a manifest that no longer matches the resources.
  await loadManifests(projectRoot, specs);
  await generateResourceContracts(projectRoot, specs);
  await generateResources(projectRoot, specs);
  console.info(`Resource output generated: ${specs.map((spec) => spec.name).join(', ')}.`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Resource generation failed');
  process.exitCode = 1;
});
