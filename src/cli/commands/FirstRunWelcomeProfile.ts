// Persists first-run welcome choices as a local profile used before launching Pi.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';

import type { WelcomeCommandResult, WelcomeProfileChoice } from './WelcomeCommand.js';

export interface PersistedFirstRunWelcomeProfile {
  readonly profileId: string;
  readonly createdProfile: boolean;
  readonly messages?: readonly string[];
}

export interface FirstRunWelcomeProfileOptions {
  readonly sourceProfileDirectory?: string;
}

export const persistFirstRunWelcomeProfile = (
  homeDirectory: string,
  settingsPath: string,
  welcomeResult: WelcomeCommandResult | undefined,
  options: FirstRunWelcomeProfileOptions = {},
): PersistedFirstRunWelcomeProfile | undefined => {
  const selectedProfile = welcomeResult?.selectedProfile ?? welcomeResult?.selectedRole;

  if (welcomeResult === undefined || !welcomeResult.answered || selectedProfile === undefined) {
    return undefined;
  }

  const welcomeProfile = createFirstRunWelcomeProfile(welcomeResult, selectedProfile);
  const persistedProfile = persistWelcomeProfileFiles(homeDirectory, settingsPath, welcomeProfile, options);

  updateSettingsDefaultProfile(settingsPath, welcomeProfile.id);
  return {
    profileId: welcomeProfile.id,
    createdProfile: persistedProfile.createdProfile,
    ...(persistedProfile.messages.length === 0 ? {} : { messages: persistedProfile.messages }),
  };
};

interface FirstRunWelcomeProfile {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly content: string;
  readonly extensions: readonly string[];
}

const persistWelcomeProfileFiles = (
  homeDirectory: string,
  settingsPath: string,
  welcomeProfile: FirstRunWelcomeProfile,
  options: FirstRunWelcomeProfileOptions,
): { readonly createdProfile: boolean; readonly messages: readonly string[] } => {
  const profileDirectory = join(homeDirectory, '.outfitter', 'profiles', welcomeProfile.id);
  const profilePath = join(profileDirectory, 'profile.yml');

  if (existsSync(profilePath)) {
    return { createdProfile: false, messages: [] };
  }

  if (options.sourceProfileDirectory !== undefined && existsSync(options.sourceProfileDirectory)) {
    cpSync(options.sourceProfileDirectory, profileDirectory, { recursive: true, force: false });
    updateSettingsProfileSources(settingsPath, welcomeProfile.id, true);
    return {
      createdProfile: true,
      messages: [`Copied the ${welcomeProfile.label} profile locally so it can be edited at ${profilePath}.`],
    };
  }

  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(profilePath, welcomeProfile.content);
  updateSettingsProfileSources(settingsPath, welcomeProfile.id, false);
  return { createdProfile: true, messages: [] };
};

const createFirstRunWelcomeProfile = (
  welcomeResult: WelcomeCommandResult,
  selectedProfile: WelcomeProfileChoice,
): FirstRunWelcomeProfile => {
  const profileId = selectedProfile.id;
  const extensions = welcomeResult.selectedLoadout?.selectedItems.map((item) => item.source) ?? [];
  const label = selectedProfile.label ?? selectedProfile.id;

  return {
    id: profileId,
    label,
    description: selectedProfile.description,
    content: createFirstRunWelcomeProfileContent(profileId, label, selectedProfile.description, extensions),
    extensions,
  };
};

const createFirstRunWelcomeProfileContent = (
  profileId: string,
  profileLabel: string,
  profileDescription: string | undefined,
  extensions: readonly string[],
): string => {
  const profile = {
    id: profileId,
    label: profileLabel,
    ...(profileDescription === undefined ? {} : { description: profileDescription }),
    controls: extensions.length === 0 ? {} : { pi: { extensions } },
  };

  return stringify(profile);
};

const readRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};

const defaultProfilesSourceGithub = 'ai-outfitter/default-profiles';
const defaultProfilesSourcePath = 'profiles';
const defaultProfilesSourceRef = 'main';
const defaultProfilesSourceUri = 'https://github.com/ai-outfitter/default-profiles';

const updateSettingsProfileSources = (
  settingsPath: string,
  profileId: string,
  excludeCopiedRemoteProfile: boolean,
): void => {
  const document = readRecord(parse(readFileSync(settingsPath, 'utf8')) as unknown);
  const rawProfileSources = document.profile_sources;
  const profileSources: readonly unknown[] = Array.isArray(rawProfileSources) ? rawProfileSources : [];
  const nextProfileSources = profileSources.map((source): unknown => {
    const record = readRecord(source);

    if (!isDefaultProfilesSource(record)) {
      return source;
    }

    return excludeCopiedRemoteProfile ? withExceptProfile(record, profileId) : record;
  });

  const ensuredProfileSources = ensureLocalProfileSource(
    ensureDefaultProfilesSource(nextProfileSources, profileId, excludeCopiedRemoteProfile),
  );

  writeFileSync(settingsPath, stringify({ ...document, profile_sources: ensuredProfileSources }));
};

const ensureDefaultProfilesSource = (
  profileSources: readonly unknown[],
  profileId: string,
  excludeCopiedRemoteProfile: boolean,
): readonly unknown[] => {
  if (profileSources.some((source) => isDefaultProfilesSource(readRecord(source)))) {
    return profileSources;
  }

  const defaultSource = {
    github: defaultProfilesSourceGithub,
    ref: defaultProfilesSourceRef,
    path: defaultProfilesSourcePath,
    ...(excludeCopiedRemoteProfile ? { except: [profileId] } : {}),
  };

  return [defaultSource, ...profileSources];
};

const ensureLocalProfileSource = (profileSources: readonly unknown[]): readonly unknown[] => {
  if (profileSources.some((source) => readRecord(source).path === './profiles')) {
    return profileSources;
  }

  return [...profileSources, { path: './profiles' }];
};

const withExceptProfile = (source: Record<string, unknown>, profileId: string): Record<string, unknown> => {
  const except = Array.isArray(source.except)
    ? source.except.filter((item): item is string => typeof item === 'string')
    : [];

  return { ...source, except: [...new Set([...except, profileId])] };
};

const isDefaultProfilesSource = (source: Record<string, unknown>): boolean => {
  if (source.path !== defaultProfilesSourcePath) {
    return false;
  }

  if (source.github === defaultProfilesSourceGithub) {
    return true;
  }

  return typeof source.uri === 'string' && normalizeDefaultProfilesSourceUri(source.uri) === defaultProfilesSourceUri;
};

const normalizeDefaultProfilesSourceUri = (uri: string): string =>
  uri
    .replace(/^git\+/u, '')
    .replace(/\/$/u, '')
    .replace(/\.git$/u, '');

export const updateSettingsDefaultProfile = (settingsPath: string, profileId: string): void => {
  const content = readFileSync(settingsPath, 'utf8');
  const nextContent = /^default_profile:.*$/mu.test(content)
    ? content.replace(/^default_profile:.*$/gmu, `default_profile: ${profileId}`)
    : `${content.replace(/\s*$/u, '\n')}default_profile: ${profileId}\n`;

  writeFileSync(settingsPath, nextContent);
};
