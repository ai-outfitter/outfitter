// Defines the internal Settings shape produced from Outfitter settings files.
import type { RemoteSourceReference } from '../profiles/ProfileSource.js';

export type RemoteSettingsReference = RemoteSourceReference & { readonly path: string };
export type SettingsValue =
  | string
  | number
  | boolean
  | null
  | readonly SettingsValue[]
  | { readonly [key: string]: SettingsValue };
export type CustomSettings = Readonly<Record<string, SettingsValue>>;

/** Harnesses Outfitter can launch a composed agent in. */
export type Harness = 'pi' | 'claude';

/** Functional persistence strategies for adapter-declared state paths. */
export type StatePersistenceStrategy = 'symlink' | 'discard' | 'warn' | 'error' | 'prompt';
export type StatePersistence = Readonly<Record<string, StatePersistenceStrategy>>;

/**
 * An ordered `.agents` payload source: a local path, a remote URI, or a `github` shorthand.
 * Modeled as a discriminated union so exactly one of `path`/`uri`/`github` is present and `ref`
 * is available only for remote sources.
 */
export type SourceReference =
  | { readonly path: string; readonly uri?: never; readonly github?: never; readonly ref?: never }
  | { readonly uri: string; readonly github?: never; readonly ref?: string; readonly path?: string }
  | { readonly github: string; readonly uri?: never; readonly ref?: string; readonly path?: string };

export interface StartupSettings {
  readonly asciiArt?: boolean;
}

export interface EnterpriseSettings {
  readonly privateCatalogs?: boolean;
}

export interface Settings {
  /** Agent slug that plain `outfitter` runs when no agent is selected. */
  readonly defaultAgent?: string;
  /** Harness that plain `outfitter` launches when `--harness` is omitted. */
  readonly defaultHarness?: Harness;
  readonly sources?: readonly SourceReference[];
  readonly remoteSettings?: readonly RemoteSettingsReference[];
  readonly cacheDirectory?: string;
  readonly statePersistence?: StatePersistence;
  readonly customSettings?: CustomSettings;
  readonly startup?: StartupSettings;
  readonly enterprise?: EnterpriseSettings;
}

export const emptySettings = (): Settings => ({
  sources: [],
  remoteSettings: [],
});
