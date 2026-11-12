/**
 * The resource declaration format. One declaration describes one resource completely enough to generate its contract,
 * store, service and router. Declarations are plain data, so every generator reads them without running application code.
 */

/** Properties every declared field shares. */
interface IFieldBase {
  /** Human label: used in validation messages. */
  readonly label: string;
  readonly description?: string;
  /** Whether null is a valid stored and submitted value. Defaults to false. */
  readonly nullable?: boolean;
}

/** The primary key: a UUID the service makes before inserting. Never part of an input schema. */
export interface IIdField {
  readonly type: 'id';
  readonly label: string;
}

export interface IStringField extends IFieldBase {
  readonly type: 'string';
  readonly max: number;
  /** Defaults to 1: an empty string is refused. */
  readonly min?: number;
  /** Regular expression source, anchored by the author. */
  readonly pattern?: string;
  /** Whether no two records may hold the same value. Generates the lookup and the conflict check. */
  readonly unique?: boolean;
}

export interface IIntegerField extends IFieldBase {
  readonly type: 'integer';
  readonly min?: number;
  readonly max?: number;
}

export interface IBooleanField extends IFieldBase {
  readonly type: 'boolean';
  readonly default?: boolean;
}

/** One allowed value of an enum, with the label a UI shows for it. */
export interface IEnumValue {
  readonly value: string;
  readonly label: string;
}

export interface IEnumField extends IFieldBase {
  readonly type: 'enum';
  readonly values: readonly IEnumValue[];
  readonly default?: string;
}

/** A calendar date (`YYYY-MM-DD`) or an ISO 8601 instant, carried as a string. */
export interface IDateField extends IFieldBase {
  readonly type: 'date' | 'datetime';
}

/** The id of a record of another resource. A write is refused when no such record exists. */
export interface IReferenceField extends IFieldBase {
  readonly type: 'reference';
  /** Name of the referenced resource. */
  readonly resource: string;
}

/** When the record was created or last updated. The loader adds these to every resource; a declaration never names one. */
export interface ITimestampField {
  readonly type: 'timestamp';
  readonly label: string;
  /** `on-update` is null until the record's first update. */
  readonly set: 'on-create' | 'on-update';
}

/** The fields a declaration may name besides `id`. */
export type TDeclaredField = IStringField | IIntegerField | IBooleanField | IEnumField | IDateField | IReferenceField;

export type TResourceField = IIdField | TDeclaredField | ITimestampField;

/** One field of an action's input or output: a declared field without its storage properties. */
export type TActionField = TDeclaredField extends infer TField
  ? (TField extends TDeclaredField ? Omit<TField, 'unique'> : never)
  : never;

export interface IListOperation {
  /** Fields a list may be filtered by, as query parameters: strings, enums and references. */
  readonly filters?: readonly string[];
  readonly sort: { readonly field: string; readonly direction: 'asc' | 'desc' };
}

/** The endpoints a resource opens. Leave one out and no caller can reach it; server code still can, through the service. */
export interface IResourceOperations {
  readonly list?: IListOperation;
  readonly get?: true;
  readonly create?: true;
  /** Replaces the whole record. */
  readonly update?: true;
  readonly delete?: true;
}

export interface IResourceSpec {
  /** Kebab-case plural; also the file name and the URL segment under /api. */
  readonly name: string;
  readonly label: { readonly singular: string; readonly plural: string };
  readonly description: string;
  /** By field name, camelCase. Must include `id`. */
  readonly fields: Readonly<Record<string, TResourceField>>;
  readonly operations: IResourceOperations;
}
