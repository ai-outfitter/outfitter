// Defines the internal Settings shape produced from Outfitter settings files.
import type { RemoteSourceReference } from '../sources/SourceCache.js';

export type RemoteSettingsReference = RemoteSourceReference & { readonly path: string };
export type SettingsValue =
  string | number | boolean | null | readonly SettingsValue[] | { readonly [key: string]: SettingsValue };
export type CustomSettings = Readonly<Record<string, SettingsValue>>;

/** Harnesses Outfitter can launch a composed agent in. */
export const HARNESSES = ['pi', 'claude', 'codex'] as const;
export type Harness = (typeof HARNESSES)[number];

/**
 * How much of the user's own harness configuration a run stands on. `inherit` layers the
 * composition over the machine's native configuration — trust, permissions, credentials, and the
 * MCP servers and plugins already installed there. `isolated` launches from the projection alone,
 * which is what a reproducible CI or container run wants.
 */
export const ISOLATIONS = ['inherit', 'isolated'] as const;
export type Isolation = (typeof ISOLATIONS)[number];

/** Functional persistence strategies for adapter-declared state paths. */
export type StatePersistenceStrategy = 'symlink' | 'discard' | 'warn' | 'error' | 'prompt';
export type StatePersistence = Readonly<Record<string, StatePersistenceStrategy>>;
export const SOURCE_CACHE_POLICIES = ['repair', 'locked', 'offline'] as const;
export type SourceCachePolicy = (typeof SOURCE_CACHE_POLICIES)[number];

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

export interface TelemetrySettings {
  readonly enabled?: boolean;
}

export interface SourceCacheSettings {
  readonly policy?: SourceCachePolicy;
}

export interface Settings {
  /** Agent slug that plain `outfitter` runs when no agent is selected. */
  readonly defaultAgent?: string;
  /** Harness that plain `outfitter` launches when `--harness` is omitted. */
  readonly defaultHarness?: Harness;
  /**
   * Whether runs stand on the machine's native harness configuration. Honored only from the home
   * scope: a checked-in project or a remote catalog must not decide how much of the user's machine
   * a profile it ships sees.
   */
  readonly isolation?: Isolation;
  readonly sources?: readonly SourceReference[];
  readonly remoteSettings?: readonly RemoteSettingsReference[];
  readonly cacheDirectory?: string;
  readonly sourceCache?: SourceCacheSettings;
  readonly statePersistence?: StatePersistence;
  readonly customSettings?: CustomSettings;
  readonly startup?: StartupSettings;
  readonly enterprise?: EnterpriseSettings;
  readonly telemetry?: TelemetrySettings;
}

export const emptySettings = (): Settings => ({
  sources: [],
  remoteSettings: [],
});
