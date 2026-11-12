import type { IFeatureManifest } from '../manifest';

export const manifest: IFeatureManifest = {
  key: '__RESOURCE__',
  label: '__PLURAL__',
  description: 'The example feature: manages __RESOURCE__ and counts them.',
  enabled: true,
  actions: [
    {
      name: '__RESOURCE_CAMEL__Summary',
      access: 'read',
      description: 'Counts __RESOURCE__, optionally only those in one status.',
      input: {
        status: {
          type: 'enum',
          label: 'Status',
          values: [{ value: 'OPEN', label: 'Open' }, { value: 'DONE', label: 'Done' }],
          nullable: true,
        },
      },
      output: {
        total: { type: 'integer', label: 'Total', min: 0 },
      },
    },
  ],
  resources: {
    '__RESOURCE__': ['list', 'get', 'create', 'update'],
  },
};
