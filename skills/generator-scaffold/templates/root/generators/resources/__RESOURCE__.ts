import type { IResourceSpec } from '../resource';

export const resource: IResourceSpec = {
  name: '__RESOURCE__',
  label: { singular: '__SINGULAR__', plural: '__PLURAL__' },
  description: 'The example resource. Replace its fields with your own.',
  fields: {
    id: { type: 'id', label: 'ID' },
    name: { type: 'string', label: 'Name', max: 120, unique: true },
    status: {
      type: 'enum',
      label: 'Status',
      values: [{ value: 'OPEN', label: 'Open' }, { value: 'DONE', label: 'Done' }],
      default: 'OPEN',
    },
    notes: { type: 'string', label: 'Notes', max: 2000, nullable: true },
  },
  // No `delete`: a record is retired through its status, so the router opens no DELETE endpoint.
  operations: {
    list: { filters: ['status'], sort: { field: 'name', direction: 'asc' } },
    get: true,
    create: true,
    update: true,
  },
};
