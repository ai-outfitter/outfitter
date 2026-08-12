// Shared entry point that turns a home/project location into one effective resource set.
import { loadSettingsWithCachedRemoteSettings } from '../settings/SettingsLoader.js';
import type { SettingsLoadIssue } from '../settings/SettingsLoader.js';
import type { Settings } from '../settings/Settings.js';
import { slugAmbiguityWarnings, sourceRefAmbiguityWarnings } from './AmbiguityWarnings.js';
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
  /** Non-fatal guidance: uncached remote sources plus transitive-source skip warnings. */
  readonly warnings: readonly string[];
  /** Ambiguity-only subset, exposed so sync can report shared resolution diagnostics after fetching. */
  readonly ambiguityWarnings: readonly string[];
}

/** The single shared resolution path used by list, validate, run, and dump. */
export const resolveEffectiveSet = (input: ResolveInput): ResolveResult => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);
  const discovered = discoverLayers({ ...input, settings: loadedSettings.settings });
  const set = resolveResources(discovered.layers);
  const ambiguityWarnings = [
    ...sourceRefAmbiguityWarnings(
      loadedSettings.files,
      // Settings merging always materializes the default empty source list.
      loadedSettings.settings.sources!,
      discovered.transitiveDeclarations,
    ),
    ...slugAmbiguityWarnings(set),
  ];

  return {
    set,
    settings: loadedSettings.settings,
    settingsIssues: loadedSettings.issues,
    warnings: [...discovered.unsynchronized, ...discovered.warnings, ...ambiguityWarnings],
    ambiguityWarnings,
  };
};
