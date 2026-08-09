// Shared entry point that turns a home/project location into one effective resource set.
import { loadSettingsWithCachedRemoteSettings } from '../settings/SettingsLoader.js';
import type { SettingsLoadIssue } from '../settings/SettingsLoader.js';
import type { Settings } from '../settings/Settings.js';
import { discoverLayers } from './Layer.js';
import type { EffectiveResourceSet } from './Resource.js';
import { resolveResources } from './Resolver.js';

export interface ResolveInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  /** Invocation-only protocol resource roots, highest precedence first. */
  readonly runtimeLayers?: readonly string[];
}

export interface ResolveResult {
  readonly set: EffectiveResourceSet;
  /** The merged settings loaded during resolution, so callers need not reload them. */
  readonly settings: Settings;
  readonly settingsIssues: readonly SettingsLoadIssue[];
  /** Non-fatal `outfitter sync` guidance for configured remote sources with no cache. */
  readonly warnings: readonly string[];
}

/** The single shared resolution path used by list, validate, run, and dump. */
export const resolveEffectiveSet = (input: ResolveInput): ResolveResult => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);
  const discovered = discoverLayers({ ...input, settings: loadedSettings.settings });

  return {
    set: resolveResources(discovered.layers),
    settings: loadedSettings.settings,
    settingsIssues: loadedSettings.issues,
    warnings: discovered.unsynchronized,
  };
};
