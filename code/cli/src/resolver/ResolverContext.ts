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
}

export interface ResolveResult {
  readonly set: EffectiveResourceSet;
  /** The merged settings loaded during resolution, so callers need not reload them. */
  readonly settings: Settings;
  readonly settingsIssues: readonly SettingsLoadIssue[];
}

/** The single shared resolution path used by list, validate, run, and dump. */
export const resolveEffectiveSet = (input: ResolveInput): ResolveResult => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);
  const layers = discoverLayers({ ...input, settings: loadedSettings.settings });

  return { set: resolveResources(layers), settings: loadedSettings.settings, settingsIssues: loadedSettings.issues };
};
