// Provides the profile list subcommand and profile discovery behavior.
import { homedir } from 'node:os';

import { Command } from 'commander';

import { loadMaterializedProfileSources } from '../../../profiles/ProfileLoader.js';
import type { LoadedProfile } from '../../../profiles/ProfileLoader.js';
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

  const profileLoadResult = loadMaterializedProfileSources(
    input.homeDirectory,
    loadedSettings.settings.profileSources!,
  );

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
