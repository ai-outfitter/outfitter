// Resolves the profile a run launches: loads settings and profile sources, resolves the
// selected profile stack, and materializes remote source caches into local paths.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  resolveRemoteRepositorySubpath,
} from '../../../profiles/ProfileCache.js';
import { loadLocalProfileSource } from '../../../profiles/ProfileLoader.js';
import type { LoadedProfile } from '../../../profiles/ProfileLoader.js';
import { createEmptyProfile, type Profile } from '../../../profiles/Profile.js';
import type { ProfileSourceReference } from '../../../profiles/ProfileSource.js';
import { resolveProfile } from '../../../profiles/ProfileMerger.js';
import { emptySettings, type Settings } from '../../../settings/Settings.js';
import { loadSettingsWithCachedRemoteSettings } from '../../../settings/SettingsLoader.js';
import type { RunCommandInput } from '../RunCommand.js';

export interface ResolvedRunProfile {
  readonly profile: Profile;
  readonly profilePaths: readonly string[];
  readonly profileFolders: readonly string[];
  readonly homeDirectory: string;
  readonly cacheDirectory: string;
  readonly projectDirectory: string;
  readonly settings: Settings;
  readonly settingsPaths: readonly string[];
  readonly profileLayers: readonly LoadedProfile[];
}

export const createFirstRunBootstrapProfile = (input: RunCommandInput): ResolvedRunProfile => ({
  profile: {
    ...createEmptyProfile('outfitter-bootstrap'),
    label: 'Outfitter Bootstrap',
    description: 'Temporary first-run profile that starts Pi before Outfitter settings exist.',
  },
  profilePaths: [],
  profileFolders: [],
  homeDirectory: input.homeDirectory,
  cacheDirectory: join(input.homeDirectory, '.outfitter', 'cache'),
  projectDirectory: input.projectDirectory,
  settings: emptySettings(),
  settingsPaths: [],
  profileLayers: [],
});

export const loadResolvedProfile = (input: RunCommandInput): ResolvedRunProfile => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  ensureConventionalLocalProfileSourceDirectories(loadedSettings.files);
  const loadedProfiles = loadProfileSources(input.homeDirectory, loadedSettings.settings.profileSources!);

  if (loadedProfiles.issues.length > 0) {
    throw new Error(`Cannot run with invalid profiles: ${loadedProfiles.issues.map(formatProfileIssue).join('; ')}`);
  }

  const profileId = selectRunProfileId(input.profileId, loadedSettings.settings.defaultProfile);
  const resolution = resolveProfile({
    profiles: loadedProfiles.profiles,
    profileId,
  });

  if (resolution.profile === undefined || resolution.issues.length > 0) {
    throw new Error(`Cannot resolve profile '${profileId}': ${resolution.issues.map(formatProfileIssue).join('; ')}`);
  }

  const selectedProfile = resolution.profileStack.find((profile) => profile.id === profileId) as Profile;

  if (selectedProfile.template === true) {
    throw new Error(`Profile '${profileId}' is a template profile and must be inherited by a runnable profile.`);
  }

  return {
    profile: resolution.profile,
    profileLayers: findContributingLoadedProfiles(resolution.profileStack, loadedProfiles.profiles),
    profilePaths: findContributingProfilePaths(resolution.profileStack, loadedProfiles.profiles),
    profileFolders: findContributingProfileFolders(resolution.profileStack, loadedProfiles.profiles),
    homeDirectory: input.homeDirectory,
    cacheDirectory: loadedSettings.settings.cacheDirectory ?? join(input.homeDirectory, '.outfitter', 'cache'),
    projectDirectory: input.projectDirectory,
    settings: loadedSettings.settings,
    settingsPaths: loadedSettings.files.map((file) => file.location.path),
  };
};

const ensureConventionalLocalProfileSourceDirectories = (files: readonly ResolvedRunProfileSettingsFile[]): void => {
  for (const file of files) {
    const settingsProfilesPath = join(dirname(file.location.path), 'profiles');
    const hasConventionalLocalSource = file.settings.profileSources?.some(
      (source) => source.uri === undefined && source.github === undefined && source.path === settingsProfilesPath,
    );

    if (hasConventionalLocalSource === true) {
      mkdirSync(settingsProfilesPath, { recursive: true });
    }
  }
};

type ResolvedRunProfileSettingsFile = ReturnType<typeof loadSettingsWithCachedRemoteSettings>['files'][number];

const selectRunProfileId = (selectedProfileId: string | undefined, defaultProfileId: string | undefined): string => {
  if (selectedProfileId !== undefined) {
    return selectedProfileId;
  }

  if (defaultProfileId !== undefined) {
    return defaultProfileId;
  }

  throw new Error(
    'Cannot run without a selected profile or default_profile in settings.yml; pass --profile or run `outfitter setup`.',
  );
};

const findContributingProfilePaths = (
  profileStack: readonly Profile[],
  loadedProfiles: readonly LoadedProfile[],
): readonly string[] =>
  findContributingLoadedProfiles(profileStack, loadedProfiles).map((loadedProfile) => loadedProfile.profilePath);

const findContributingProfileFolders = (
  profileStack: readonly Profile[],
  loadedProfiles: readonly LoadedProfile[],
): readonly string[] =>
  findContributingLoadedProfiles(profileStack, loadedProfiles).flatMap((loadedProfile) =>
    loadedProfile.resourceRootPath === undefined ? [] : [loadedProfile.resourceRootPath],
  );

export const createLaunchProfileLayers = (loadedProfiles: readonly LoadedProfile[]) =>
  loadedProfiles.map((loadedProfile) => ({
    profile: loadedProfile.profile,
    profilePath: loadedProfile.profilePath,
    sourceRootPath: loadedProfile.sourceRootPath,
    resourceRootPath: loadedProfile.resourceRootPath,
    layout: loadedProfile.layout,
  }));

const findContributingLoadedProfiles = (
  profileStack: readonly Profile[],
  loadedProfiles: readonly LoadedProfile[],
): readonly LoadedProfile[] =>
  profileStack.flatMap((profile) => loadedProfiles.filter((loadedProfile) => loadedProfile.profile.id === profile.id));

export const loadProfileSources = (
  homeDirectory: string,
  sources: readonly ProfileSourceReference[],
): {
  readonly profiles: readonly LoadedProfile[];
  readonly issues: readonly { readonly path: string; readonly message: string }[];
} => {
  const profiles: LoadedProfile[] = [];
  const issues: { readonly path: string; readonly message: string }[] = [];

  for (const source of sources) {
    const materializedSource = materializeSource(homeDirectory, source);

    // A remote source whose cache has never synced (degraded-offline onboarding, blocked
    // network) contributes no profiles instead of failing the launch; a later successful
    // `outfitter sync` upgrades it to the full catalog.
    if (isUnsyncedRemoteProfileSource(source, materializedSource.path)) {
      continue;
    }

    const result = loadLocalProfileSource(materializedSource);
    profiles.push(...result.profiles.map((profile) => ({ ...profile, source })));
    issues.push(...result.issues);
  }

  return { profiles, issues };
};

const isUnsyncedRemoteProfileSource = (source: ProfileSourceReference, materializedPath: string | undefined): boolean =>
  (source.uri !== undefined || source.github !== undefined) &&
  materializedPath !== undefined &&
  !existsSync(materializedPath);

const materializeSource = (homeDirectory: string, source: ProfileSourceReference): ProfileSourceReference => {
  if (source.uri === undefined && source.github === undefined) {
    return source;
  }

  if (source.uri !== undefined && source.ref === undefined && source.path === undefined) {
    return { path: createProfileSourceCachePath(homeDirectory, source.uri), only: source.only, except: source.except };
  }

  return {
    path: resolveRemoteRepositorySubpath(createRemoteRepositoryCachePath(homeDirectory, source), source.path),
    only: source.only,
    except: source.except,
  };
};

const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;

const formatProfileIssue = (issue: { readonly path: string; readonly message: string }): string =>
  `${issue.path} ${issue.message}`;
