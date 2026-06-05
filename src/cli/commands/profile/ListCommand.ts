// Provides the profile list subcommand and profile discovery behavior.
import { homedir } from 'node:os';

import { Command } from 'commander';

import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  resolveRemoteRepositorySubpath,
} from '../../../profiles/ProfileCache.js';
import { loadLocalProfileSource } from '../../../profiles/ProfileLoader.js';
import type { LoadedProfile } from '../../../profiles/ProfileLoader.js';
import type { ProfileSourceReference } from '../../../profiles/ProfileSource.js';
import { loadSettingsWithCachedRemoteSettings } from '../../../settings/SettingsLoader.js';
import type { CommandObject } from '../CommandObject.js';
import type { ProfileCommandDependencies } from './Shared.js';
import { getOrCreateProfileCommander } from './Shared.js';

export interface ListedProfile {
  readonly id: string;
  readonly label?: string;
  readonly profilePath: string;
}

export interface ListProfilesInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
}

export interface ListProfilesResult {
  readonly profiles: readonly ListedProfile[];
  readonly messages: readonly string[];
}

export const createProfileListCommand = (dependencies: ProfileCommandDependencies): CommandObject => {
  const command: CommandObject = {
    name: 'profile list',
    description: 'List available ApplePi profiles.',
    register(program: Command): void {
      getOrCreateProfileCommander(program).addCommand(createProfileListCommander(dependencies));
    },
  };

  return command;
};

const createProfileListCommander = (dependencies: ProfileCommandDependencies): Command =>
  new Command('list').description('List available ApplePi profiles.').action(() => {
    const result = executeListProfilesCommand({
      /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
      homeDirectory: dependencies.homeDirectory ?? homedir(),
      /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
      projectDirectory: dependencies.projectDirectory ?? process.cwd(),
    });

    emitMessages(result.messages, dependencies.writeLine);
  });

export const executeListProfilesCommand = (input: ListProfilesInput): ListProfilesResult => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);

  if (loadedSettings.issues.length > 0) {
    throw new Error(
      `Cannot list profiles with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`,
    );
  }

  const profileLoadResult = loadProfileSources(input.homeDirectory, loadedSettings.settings.profileSources!);

  if (profileLoadResult.issues.length > 0) {
    throw new Error(
      `Cannot list profiles with invalid profiles: ${profileLoadResult.issues.map(formatProfileIssue).join('; ')}`,
    );
  }

  const profiles = listHighestPrecedenceProfiles(profileLoadResult.profiles);

  return {
    profiles,
    messages: profiles.length === 0 ? ['No profiles found.'] : profiles.map((profile) => profile.id),
  };
};

const emitMessages = (messages: readonly string[], writeLine: ((message: string) => void) | undefined): void => {
  for (const message of messages) {
    /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
    (writeLine ?? console.log)(message);
  }
};

const loadProfileSources = (
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
    const result = loadLocalProfileSource(materializedSource);
    profiles.push(...result.profiles.map((profile) => ({ ...profile, source })));
    issues.push(...result.issues);
  }

  return { profiles, issues };
};

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

const listHighestPrecedenceProfiles = (loadedProfiles: readonly LoadedProfile[]): readonly ListedProfile[] => {
  const profilesById = new Map<string, ListedProfile>();

  for (const loadedProfile of loadedProfiles) {
    profilesById.set(loadedProfile.profile.id, {
      id: loadedProfile.profile.id,
      label: loadedProfile.profile.label,
      profilePath: loadedProfile.profilePath,
    });
  }

  return [...profilesById.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;

const formatProfileIssue = (issue: { readonly path: string; readonly message: string }): string =>
  `${issue.path} ${issue.message}`;
