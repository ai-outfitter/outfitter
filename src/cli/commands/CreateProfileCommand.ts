// Provides the command object for creating a Bridl profile folder.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { isValidProfileId } from '../../profiles/ProfileLoader.js';
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

interface CreateProfileOptions {
  readonly scope?: string;
  readonly path?: string;
}

export interface CreateProfileCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
}

export const executeCreateProfileCommand = (input: CreateProfileInput): CreateProfileResult => {
  assertValidCreateProfileInput(input);

  const profileRoot = resolveProfileRoot(input);
  const profileDirectory = join(profileRoot, input.name);
  const profilePath = join(profileDirectory, 'profile.yml');
  const resourceDirectories = ['prompts', 'skills', 'extensions', join('cli_specific', 'pi')].map((resourcePath) =>
    join(profileDirectory, resourcePath),
  );
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

export const createCreateProfileCommand = (dependencies: CreateProfileCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'create_profile',
    description: 'Create a new Bridl profile skeleton.',
    register(program: Command): void {
      program
        .command(command.name)
        .alias('create-profile')
        .description(command.description)
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

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }
        });
    },
  };

  return command;
};

const assertValidCreateProfileInput = (input: CreateProfileInput): void => {
  if (!isValidProfileId(input.name)) {
    throw new Error(`Profile name '${input.name}' is not a filesystem-safe Bridl profile id.`);
  }

  if ((input.scope === undefined && input.path === undefined) || (input.scope !== undefined && input.path !== undefined)) {
    throw new Error('Create profile requires exactly one destination: --scope or --path.');
  }
};

const resolveProfileRoot = (input: CreateProfileInput): string => {
  if (input.path !== undefined) {
    return input.path;
  }

  switch (input.scope) {
    case 'user':
      return join(input.homeDirectory, '.bridl', 'profiles');
    case 'project':
      return join(input.projectDirectory, '.bridl', 'profiles');
    case 'project-local':
      return join(input.projectDirectory, '.bridl', 'local', 'profiles');
    /* v8 ignore next 2 -- assertValidCreateProfileInput rejects missing scopes before this exhaustive guard. */
    default:
      throw new Error('Create profile requires exactly one destination: --scope or --path.');
  }
};

const createPlaceholderProfileYaml = (profileId: string): string => `id: ${profileId}\nlabel: ${profileId}\ncontrols: {}\n`;

const readCreateProfileScope = (scope: string | undefined): CreateProfileScope | undefined => {
  if (scope === undefined) {
    return undefined;
  }

  if (scope === 'user' || scope === 'project' || scope === 'project-local') {
    return scope;
  }

  throw new Error(`Unknown profile scope '${scope}'. Expected user, project, or project-local.`);
};
