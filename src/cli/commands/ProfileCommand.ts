// Provides profile subcommands for listing and creating ApplePi profile folders.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  resolveRemoteRepositorySubpath,
} from '../../profiles/ProfileCache.js';
import { isValidProfileId, loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import type { LoadedProfile } from '../../profiles/ProfileLoader.js';
import type { ProfileSourceReference } from '../../profiles/ProfileSource.js';
import { loadSettingsWithCachedRemoteSettings } from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';

export type CreateProfileScope = 'user' | 'project' | 'project-local';

export interface CreateProfileInput {
  readonly name: string;
  readonly scope?: CreateProfileScope;
  readonly path?: string;
  readonly homeDirectory: string;
  readonly projectDirectory: string;
}

export interface CreateProfileResult {
  readonly profileDirectory: string;
  readonly profilePath: string;
  readonly createdDirectories: readonly string[];
  readonly createdProfile: boolean;
  readonly messages: readonly string[];
}

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

interface CreateProfileOptions {
  readonly scope?: string;
  readonly path?: string;
}

export interface ProfileCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
}

export const executeCreateProfileCommand = (input: CreateProfileInput): CreateProfileResult => {
  assertValidCreateProfileInput(input);

  const profileRoot = resolveProfileRoot(input);
  const profileDirectory = join(profileRoot, input.name);
  const profilePath = join(profileDirectory, 'profile.yml');
  const resourceDirectories = [
    'prompts',
    'skills',
    'extensions',
    join('cli_specific', 'pi'),
    join('cli_specific', 'claude'),
  ].map((resourcePath) => join(profileDirectory, resourcePath));
  const createdDirectories: string[] = [];

  if (!existsSync(profileDirectory)) {
    mkdirSync(profileDirectory, { recursive: true });
    createdDirectories.push(profileDirectory);
  }

  for (const resourceDirectory of resourceDirectories) {
    if (!existsSync(resourceDirectory)) {
      mkdirSync(resourceDirectory, { recursive: true });
      createdDirectories.push(resourceDirectory);
    }
  }

  const createdProfile = !existsSync(profilePath);

  if (createdProfile) {
    writeFileSync(profilePath, createPlaceholderProfileYaml(input.name));
  }

  return {
    profileDirectory,
    profilePath,
    createdDirectories,
    createdProfile,
    messages: [
      createdProfile
        ? `Created profile '${input.name}' at ${profileDirectory}.`
        : `Profile '${input.name}' already exists at ${profileDirectory}; left profile.yml unchanged.`,
    ],
  };
};

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

export const createProfileCommand = (dependencies: ProfileCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'profile',
    description: 'List and manage ApplePi profiles.',
    register(program: Command): void {
      const profileCommand = program.command(command.name).description(command.description);

      profileCommand
        .command('list')
        .description('List available ApplePi profiles.')
        .action(() => {
          const result = executeListProfilesCommand({
            /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
          });

          emitMessages(result.messages, dependencies.writeLine);
        });

      profileCommand
        .command('create')
        .description('Create a new ApplePi profile skeleton.')
        .argument('<name>', 'filesystem-safe profile name')
        .option('--scope <scope>', 'destination scope: user, project, or project-local')
        .option('--path <path>', 'destination profile source directory')
        .action((name: string, options: CreateProfileOptions) => {
          const result = executeCreateProfileCommand({
            name,
            scope: readCreateProfileScope(options.scope),
            path: options.path,
            /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
          });

          emitMessages(result.messages, dependencies.writeLine);
        });
    },
  };

  return command;
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

const assertValidCreateProfileInput = (input: CreateProfileInput): void => {
  if (!isValidProfileId(input.name)) {
    throw new Error(`Profile name '${input.name}' is not a filesystem-safe ApplePi profile id.`);
  }

  if (
    (input.scope === undefined && input.path === undefined) ||
    (input.scope !== undefined && input.path !== undefined)
  ) {
    throw new Error('Create profile requires exactly one destination: --scope or --path.');
  }
};

const resolveProfileRoot = (input: CreateProfileInput): string => {
  if (input.path !== undefined) {
    return input.path;
  }

  switch (input.scope) {
    case 'user':
      return join(input.homeDirectory, '.applepi', 'profiles');
    case 'project':
      return join(input.projectDirectory, '.applepi', 'profiles');
    case 'project-local':
      return join(input.projectDirectory, '.applepi', 'local', 'profiles');
    /* v8 ignore next 2 -- assertValidCreateProfileInput rejects missing scopes before this exhaustive guard. */
    default:
      throw new Error('Create profile requires exactly one destination: --scope or --path.');
  }
};

const createPlaceholderProfileYaml = (profileId: string): string =>
  `id: ${profileId}\nlabel: ${profileId}\ncontrols: {}\n`;

const readCreateProfileScope = (scope: string | undefined): CreateProfileScope | undefined => {
  if (scope === undefined) {
    return undefined;
  }

  if (scope === 'user' || scope === 'project' || scope === 'project-local') {
    return scope;
  }

  throw new Error(`Unknown profile scope '${scope}'. Expected user, project, or project-local.`);
};

const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;

const formatProfileIssue = (issue: { readonly path: string; readonly message: string }): string =>
  `${issue.path} ${issue.message}`;
