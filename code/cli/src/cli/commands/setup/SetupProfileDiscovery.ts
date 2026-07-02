// Discovers setup profile choices from starter layouts and effective settings sources.
import { readFileSync, writeFileSync } from 'node:fs';

import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  resolveRemoteRepositorySubpath,
} from '../../../profiles/ProfileCache.js';
import { isValidProfileId, loadLocalProfileSource } from '../../../profiles/ProfileLoader.js';
import { resolveProfile } from '../../../profiles/ProfileMerger.js';
import { loadSettingsWithCachedRemoteSettings } from '../../../settings/SettingsLoader.js';
import { readStarterExplicitDefaultProfileId } from './SetupStarterLayout.js';
import type { SetupCommandInput, SetupProfileChoice, StarterLayout } from './SetupTypes.js';

export const assertValidDefaultProfileId = (profileId: string): void => {
  if (!isValidProfileId(profileId)) {
    throw new Error(`Default profile '${profileId}' is not a filesystem-safe Outfitter profile id.`);
  }
};

type LoadedSetupSettingsFile = {
  readonly location: { readonly scope: string };
  readonly settings: { readonly defaultProfile?: string };
};

export const readUserDefaultProfileId = (files: readonly LoadedSetupSettingsFile[]): string =>
  files.find((file) => file.location.scope === 'user')?.settings.defaultProfile ?? 'engineer';

export const ensureExistingUserSettingsDefaultProfile = (
  settingsPath: string,
  files: readonly LoadedSetupSettingsFile[],
  defaultProfileId: string,
): void => {
  const userSettings = files.find((file) => file.location.scope === 'user');

  if (userSettings === undefined || userSettings.settings.defaultProfile !== undefined) {
    return;
  }

  const content = readFileSync(settingsPath, 'utf8');
  writeFileSync(settingsPath, `${content}\ndefault_profile: ${defaultProfileId}\n`);
};

export const canResolveProfileForLaunch = (input: SetupCommandInput, profileId: string): boolean => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);

  if (loadedSettings.issues.length > 0) {
    return true;
  }

  const profiles = loadedSettings.settings.profileSources!.flatMap(
    (source) =>
      loadLocalProfileSource({
        path: materializeSetupProfileSource(input.homeDirectory, source),
        only: source.only,
        except: source.except,
      }).profiles,
  );
  const resolution = resolveProfile({ profiles, profileId });
  const selectedProfile = resolution.profileStack.find((profile) => profile.id === profileId);

  return resolution.profile !== undefined && resolution.issues.length === 0 && selectedProfile?.template !== true;
};

export const findWelcomeSourceProfileDirectory = (
  input: SetupCommandInput,
  profileId: string | undefined,
): string | undefined => {
  if (profileId === undefined) {
    return undefined;
  }

  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);

  /* v8 ignore next -- setup already rejected invalid settings; this fallback handles cache mutation during welcome. */
  if (loadedSettings.issues.length > 0) {
    return undefined;
  }

  for (const source of loadedSettings.settings.profileSources!) {
    const materializedPath = materializeSetupProfileSource(input.homeDirectory, source);
    const loadedProfiles = loadLocalProfileSource({ path: materializedPath, only: source.only, except: source.except });
    const loadedProfile = loadedProfiles.profiles.find((profile) => profile.profile.id === profileId);

    if (loadedProfile !== undefined) {
      return loadedProfile.folderPath;
    }
  }

  return undefined;
};

export const discoverSetupSourcePromptDefault = (
  input: SetupCommandInput,
  starterLayout: StarterLayout | undefined,
  profiles: readonly SetupProfileChoice[],
): string | undefined => {
  if (input.setupSourceUri === undefined) {
    return undefined;
  }

  const sourceDefault = readStarterExplicitDefaultProfileId(starterLayout?.settingsPath);
  return profiles.some((profile) => profile.id === sourceDefault) ? sourceDefault : undefined;
};

export const selectSetupPromptProfiles = (
  discoveredProfiles: readonly SetupProfileChoice[],
  currentDefault: string,
  promptDefault: string,
): readonly SetupProfileChoice[] => {
  const profiles = discoveredProfiles.length > 0 ? discoveredProfiles : [{ id: currentDefault }];
  return prioritizeSetupProfileChoice(profiles, promptDefault);
};

export const chooseSetupPromptDefault = (
  profiles: readonly SetupProfileChoice[],
  sourceDefault: string | undefined,
  fallbackDefault: string,
): string => {
  if (sourceDefault !== undefined && profiles.some((profile) => profile.id === sourceDefault)) {
    return sourceDefault;
  }

  if (profiles.some((profile) => profile.id === fallbackDefault)) {
    return fallbackDefault;
  }

  return profiles[0]?.id ?? fallbackDefault;
};

const prioritizeSetupProfileChoice = (
  profiles: readonly SetupProfileChoice[],
  profileId: string,
): readonly SetupProfileChoice[] => [
  ...profiles.filter((profile) => profile.id === profileId),
  ...profiles.filter((profile) => profile.id !== profileId),
];

export const discoverSetupProfileChoices = (
  input: SetupCommandInput,
  starterLayout?: StarterLayout,
): readonly SetupProfileChoice[] => {
  if (input.setupSourceUri !== undefined && starterLayout?.profilesPath !== undefined) {
    return discoverSetupProfileChoicesFromLocalSource(starterLayout.profilesPath);
  }

  return discoverSetupProfileChoicesFromEffectiveSettings(input);
};

const discoverSetupProfileChoicesFromLocalSource = (path: string): readonly SetupProfileChoice[] => {
  const loadedProfiles = loadLocalProfileSource({ path });

  return loadedProfiles.profiles
    .map((profile) => ({
      id: profile.profile.id,
      label: profile.profile.label,
      description: profile.profile.description,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const discoverSetupProfileChoicesFromEffectiveSettings = (input: SetupCommandInput): readonly SetupProfileChoice[] => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);
  const choices = new Map<string, SetupProfileChoice>();

  for (const source of loadedSettings.settings.profileSources!) {
    const materializedPath = materializeSetupProfileSource(input.homeDirectory, source);
    const loadedProfiles = loadLocalProfileSource({ path: materializedPath, only: source.only, except: source.except });

    for (const profile of loadedProfiles.profiles) {
      const existingChoice = choices.get(profile.profile.id);
      choices.set(profile.profile.id, {
        id: profile.profile.id,
        label: profile.profile.label ?? existingChoice?.label,
        description: profile.profile.description ?? existingChoice?.description,
      });
    }
  }

  return [...choices.values()].sort((left, right) => left.id.localeCompare(right.id));
};

export const materializeSetupProfileSource = (
  homeDirectory: string,
  source: { readonly path?: string; readonly uri?: string; readonly github?: string; readonly ref?: string },
): string => {
  if (source.path !== undefined && source.uri === undefined && source.github === undefined) {
    return source.path;
  }

  if (source.uri !== undefined && source.ref === undefined && source.path === undefined) {
    return createProfileSourceCachePath(homeDirectory, source.uri);
  }

  if (source.uri !== undefined) {
    return resolveRemoteRepositorySubpath(
      createRemoteRepositoryCachePath(homeDirectory, { uri: source.uri, ref: source.ref }),
      source.path,
    );
  }

  return resolveRemoteRepositorySubpath(
    createRemoteRepositoryCachePath(homeDirectory, { github: source.github!, ref: source.ref }),
    source.path,
  );
};
