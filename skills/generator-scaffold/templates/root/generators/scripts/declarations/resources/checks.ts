import type { IResourceSpec, TResourceField } from '../../../resource';

const FILTERABLE: ReadonlySet<TResourceField['type']> = new Set(['string', 'enum', 'reference']);
const UNSORTABLE: ReadonlySet<TResourceField['type']> = new Set(['boolean']);

const fieldProblems = (spec: IResourceSpec, names: ReadonlySet<string>): string[] => (
  Object.entries(spec.fields).flatMap(([name, field]) => {
    const at = `${spec.name}.${name}`;
    const problems: string[] = [];
    if (field.type === 'id' && name !== 'id') { problems.push(`${at}: only the field named id may have type id`); }
    if (field.type === 'reference' && !names.has(field.resource)) {
      problems.push(`${at}: references ${field.resource}, which no declaration declares`);
    }
    if (field.type === 'string' && (field.min ?? 1) > field.max) { problems.push(`${at}: min is greater than max`); }
    if (field.type === 'string' && field.unique === true && field.nullable === true) {
      problems.push(`${at}: a unique field cannot be nullable`);
    }
    if (field.type === 'integer' && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      problems.push(`${at}: min is greater than max`);
    }
    if (field.type === 'enum') {
      const values = field.values.map((entry) => entry.value);
      if (new Set(values).size !== values.length) { problems.push(`${at}: enum values must be unique`); }
      if (field.default !== undefined && !values.includes(field.default)) {
        problems.push(`${at}: default ${field.default} is not one of its values`);
      }
    }
    return problems;
  })
);

const listProblems = (spec: IResourceSpec): string[] => {
  const list = spec.operations.list;
  if (list === undefined) { return []; }
  const problems = (list.filters ?? []).flatMap((name) => {
    const field = spec.fields[name];
    if (field === undefined) { return [`${spec.name}: list filter ${name} is not a field`]; }
    return FILTERABLE.has(field.type) ? [] : [`${spec.name}: list filter ${name} must be a string, an enum or a reference`];
  });
  const sort = spec.fields[list.sort.field];
  if (sort === undefined) { return [...problems, `${spec.name}: list sort field ${list.sort.field} is not a field`]; }
  const nullable = sort.type === 'timestamp' ? sort.set === 'on-update' : sort.type !== 'id' && sort.nullable === true;
  if (nullable || UNSORTABLE.has(sort.type)) {
    problems.push(`${spec.name}: list sort field ${list.sort.field} must be a non-nullable, orderable field`);
  }
  return problems;
};

/** What is wrong with the declarations taken together; empty when they are consistent. */
export const resourceProblems = (specs: readonly IResourceSpec[]): string[] => {
  const names = new Set(specs.map((spec) => spec.name));
  return specs.flatMap((spec) => [
    ...(spec.fields.id?.type === 'id' ? [] : [`${spec.name}: needs a field named id of type id`]),
    ...fieldProblems(spec, names),
    ...listProblems(spec),
  ]);
};
