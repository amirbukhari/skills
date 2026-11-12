import { expect, it } from 'vitest';
import type { IFeatureManifest } from '../../../manifest';
import { renderActionContract } from '../../contract/actions/schemas';
import { renderActionIndex } from './barrel';
import { renderAction, renderHandlerStub } from './folders';

const manifest: IFeatureManifest = {
  key: 'work-reports',
  label: 'Reports',
  description: 'Reports.',
  enabled: true,
  actions: [{
    name: 'closeReport',
    access: 'mutating',
    description: 'Closes a report.',
    input: { reportId: { type: 'reference', label: 'Report', resource: 'reports' }, reason: { type: 'string', label: 'Reason', max: 200, nullable: true } },
    output: { closed: { type: 'boolean', label: 'Closed' } },
  }],
  resources: {},
};
const [action] = manifest.actions;

it('registers an enabled feature\'s actions and leaves a disabled feature\'s out, keeping both in the catalog', () => {
  expect(renderActionIndex([manifest])).toContain('import { closeReport } from \'../features/work-reports/actions/close-report/action\';');
  const disabled = renderActionIndex([{ ...manifest, enabled: false }]);
  expect(disabled).toContain('export const actions: Readonly<Record<string, IAction>> = {};');
  expect(disabled).toContain('{ key: \'work-reports\', label: \'Reports\', enabled: false, resources: {} },');
});

it('renders strict input and output schemas, with nulls an action input must state', () => {
  const contract = renderActionContract(manifest);
  expect(contract).toContain('export const closeReportInputSchema = z.object({\n  reportId: z.string().uuid(),');
  expect(contract).toMatch(/reason: .*\.nullable\(\),\n\}\)\.strict\(\);/);
  expect(contract).toContain('export type ICloseReportOutput = z.infer<typeof closeReportOutputSchema>;');
});

it('wraps the handler with its schemas, and types the stub to the same contract', () => {
  if (action === undefined) { throw new Error('fixture has no action'); }
  expect(renderAction(manifest.key, action)).toContain('input: closeReportInputSchema,');
  expect(renderHandlerStub(manifest.key, action)).toContain('export const handler: THandler<ICloseReportInput, ICloseReportOutput> = async () => {');
});
