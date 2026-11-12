import type { TActionField, TResourceField } from '../../resource';
import { literal } from './names';

const UUID = 'z.string().uuid()';
const INSTANT = 'z.string().datetime()';

const stringExpression = (field: Extract<TResourceField, { type: 'string' }>): string => {
  const min = field.min ?? 1;
  const parts = ['z.string().trim()'];
  if (min > 0) {
    parts.push(`.min(${min}, ${literal(min === 1 ? `${field.label} is required` : `${field.label} must be at least ${min} characters`)})`);
  }
  parts.push(`.max(${field.max}, ${literal(`${field.label} must be at most ${field.max} characters`)})`);
  if (field.pattern !== undefined) {
    parts.push(`.regex(new RegExp(${literal(field.pattern)}), ${literal(`${field.label} is not in the expected format`)})`);
  }
  return parts.join('');
};

const integerExpression = (field: Extract<TResourceField, { type: 'integer' }>): string => [
  `z.number().int(${literal(`${field.label} must be a whole number`)})`,
  field.min === undefined ? '' : `.min(${field.min}, ${literal(`${field.label} must be at least ${field.min}`)})`,
  field.max === undefined ? '' : `.max(${field.max}, ${literal(`${field.label} must be at most ${field.max}`)})`,
].join('');

/** The enum's own zod expression; a resource's contract declares it once and refers to it by name instead. */
export const enumExpression = (field: Extract<TResourceField, { type: 'enum' }>): string => (
  `z.enum([${field.values.map((entry) => literal(entry.value)).join(', ')}])`
);

/**
 * The zod expression that validates one value of a field, before nullability and defaults. `enumName` is the schema
 * a resource contract already declares for an enum field.
 */
export const valueExpression = (field: TResourceField | TActionField, enumName?: string): string => {
  switch (field.type) {
    case 'id': case 'reference': return UUID;
    case 'string': return stringExpression(field);
    case 'integer': return integerExpression(field);
    case 'boolean': return 'z.boolean()';
    case 'enum': return enumName ?? enumExpression(field);
    case 'date': return `z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/, ${literal(`${field.label} must be a date, YYYY-MM-DD`)})`;
    case 'datetime': case 'timestamp': return INSTANT;
    default: return field satisfies never;
  }
};

/** A stored value: nullable when the field is, or when it is the timestamp of an update that may not have happened. */
export const recordExpression = (field: TResourceField, enumName?: string): string => {
  const nullable = field.type === 'timestamp' ? field.set === 'on-update' : field.type !== 'id' && field.nullable === true;
  return `${valueExpression(field, enumName)}${nullable ? '.nullable()' : ''}`;
};

/**
 * A submitted value. A resource input may leave out a field with a default, and a nullable one, which is then null.
 * An action input (`explicitNull`) must state its nulls.
 */
export const inputExpression = (field: TActionField, enumName?: string, explicitNull = false): string => {
  const value = valueExpression(field, enumName);
  if ((field.type === 'enum' || field.type === 'boolean') && field.default !== undefined) {
    return `${value}.default(${literal(field.default)})`;
  }
  if (field.nullable === true) { return `${value}.nullable()${explicitNull ? '' : '.default(null)'}`; }
  return value;
};
