// Shared entry point that turns a home/project location into one effective resource set.
import { join } from 'node:path';

import { loadSettingsWithCachedRemoteSettings } from '../settings/SettingsLoader.js';
import type { SettingsLoadIssue } from '../settings/SettingsLoader.js';
import type { Settings } from '../settings/Settings.js';
import type { ResolutionWarningDetail } from '../validation/ResolutionWarning.js';
import { slugAmbiguityWarningDetails, sourceRefAmbiguityWarningDetails } from './AmbiguityWarnings.js';
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
  /** Structured provenance for each entry in `warnings`, in the same order. */
  readonly warningDetails: readonly ResolutionWarningDetail[];
  /** Configured remote sources whose cache is absent. */
  readonly unsynchronizedWarnings: readonly string[];
  /** Ambiguity-only subset, exposed so sync can report shared resolution diagnostics after fetching. */
  readonly ambiguityWarnings: readonly string[];
}

/** The single shared resolution path used by list, validate, run, and dump. */
export const resolveEffectiveSet = (input: ResolveInput): ResolveResult => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);
  const settingsSourcePath =
    [...loadedSettings.files].reverse().find((file) => file.settings.sources !== undefined)?.location.path ??
    loadedSettings.files.at(-1)?.location.path ??
    join(input.projectDirectory, '.agents', 'settings.yml');
  const discovered = discoverLayers({
    ...input,
    settings: loadedSettings.settings,
    settingsSourcePath,
  });
  const set = resolveResources(discovered.layers);
  const ambiguityWarningDetails = [
    ...sourceRefAmbiguityWarningDetails(
      loadedSettings.files,
      // Settings merging always materializes the default empty source list.
      loadedSettings.settings.sources!,
      discovered.transitiveDeclarations,
    ),
    ...slugAmbiguityWarningDetails(set),
  ];
  const discoveryWarningDetails = [...discovered.unsynchronizedDetails, ...discovered.warningDetails];
  const warningDetails = [...discoveryWarningDetails, ...ambiguityWarningDetails];
  const ambiguityWarnings = ambiguityWarningDetails.map(({ message }) => message);

  return {
    set,
    settings: loadedSettings.settings,
    settingsIssues: loadedSettings.issues,
    warnings: warningDetails.map(({ message }) => message),
    warningDetails,
    unsynchronizedWarnings: discovered.unsynchronized,
    ambiguityWarnings,
  };
};
