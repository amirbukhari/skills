import { projectRoot } from '../../../config';
import { generateActions } from './barrel';

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('generate:actions takes only --check');
  }
  const check = args[0] === '--check';
  await generateActions(projectRoot, check);
  console.info(check ? 'Action output is up to date.' : 'Action output generated.');
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Action generation failed');
  process.exitCode = 1;
});
