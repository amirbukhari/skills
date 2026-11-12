import type { IResourceSpec } from '../../../resource';

/** A declaration for the renderer tests, as the loader returns it: timestamps added. */
export const projects: IResourceSpec = {
  name: 'work-projects',
  label: { singular: 'Project', plural: 'Projects' },
  description: 'A project.',
  fields: {
    id: { type: 'id', label: 'ID' },
    code: { type: 'string', label: 'Code', max: 16, unique: true },
    stage: {
      type: 'enum', label: 'Stage', values: [{ value: 'DRAFT', label: 'Draft' }, { value: 'LIVE', label: 'Live' }], default: 'DRAFT',
    },
    parentId: { type: 'reference', label: 'Parent', resource: 'work-projects', nullable: true },
    created: { type: 'timestamp', label: 'Created', set: 'on-create' },
    modified: { type: 'timestamp', label: 'Modified', set: 'on-update' },
  },
  operations: { list: { filters: ['stage', 'parentId'], sort: { field: 'code', direction: 'desc' } }, get: true, delete: true },
};
