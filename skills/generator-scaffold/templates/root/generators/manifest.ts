import type { IResourceOperations, TActionField } from './resource';

/**
 * An action and its contract: behaviour a plain create or update cannot express. Its code lives in the folder named
 * for it (the kebab-case name) under the owning feature's actions/.
 */
export interface IActionManifest {
  /** camelCase public name the action endpoint dispatches on, unique across every manifest. */
  readonly name: string;
  /** Read actions retrieve or calculate; mutating actions change data or trigger external effects. */
  readonly access: 'read' | 'mutating';
  readonly description: string;
  /** The parameters the action accepts, by field name; validated before the handler runs. */
  readonly input: Readonly<Record<string, TActionField>>;
  /** The value the handler returns, by field name; validated before it is sent. */
  readonly output: Readonly<Record<string, TActionField>>;
}

export type TResourceOperation = keyof IResourceOperations;

/** A feature declaration consumed by the generators. */
export interface IFeatureManifest {
  /** Kebab-case; also the file name and the feature's folder name. */
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** A disabled feature keeps its files and contracts, but its actions leave the registry. */
  readonly enabled: boolean;
  readonly actions: readonly IActionManifest[];
  /** The resources the feature uses, each with the operations it needs. Every operation must be one the resource declares. */
  readonly resources: Readonly<Record<string, readonly TResourceOperation[]>>;
}
