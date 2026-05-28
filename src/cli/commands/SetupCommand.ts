// Provides the command object for first-run Bridl setup.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Command } from 'commander';

import { isValidProfileId } from '../../profiles/ProfileLoader.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';
import type { SyncCommandDependencies, SyncCommandResult } from './SyncCommand.js';
import { executeSyncCommand } from './SyncCommand.js';

export interface SetupCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
}

export interface SetupCommandResult {
  readonly settingsPath: string;
  readonly defaultProfilePath: string;
  readonly createdSettings: boolean;
  readonly createdDefaultProfile: boolean;
  readonly syncResult: SyncCommandResult;
  readonly messages: readonly string[];
}

export type SetupCommandDependencies = SyncCommandDependencies;

export const executeSetupCommand = (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies = {},
): SetupCommandResult => {
  const settingsPath = join(input.homeDirectory, '.bridl', 'settings.yml');
  const initialSettingsMissing = !existsSync(settingsPath);
  const loadedSettings = loadSettings(discoverSettingsLoadPlan(input));

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot setup with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const defaultProfileId = initialSettingsMissing ? 'default' : readUserDefaultProfileId(loadedSettings.files);
  assertValidDefaultProfileId(defaultProfileId);

  const createdSettings = createInitialSettingsIfMissing(settingsPath);
  const defaultProfilePath = join(input.homeDirectory, '.bridl', 'profiles', defaultProfileId, 'profile.yml');
  const createdDefaultProfile = createDefaultProfileIfMissing(defaultProfilePath, defaultProfileId);
  const syncResult = executeSyncCommand(input, dependencies);

  return {
    settingsPath,
    defaultProfilePath,
    createdSettings,
    createdDefaultProfile,
    syncResult,
    messages: [
      createdSettings ? `Created user settings at ${settingsPath}.` : `User settings already exists at ${settingsPath}; left unchanged.`,
      createdDefaultProfile
        ? `Created default user profile '${defaultProfileId}' at ${defaultProfilePath}.`
        : `Default user profile '${defaultProfileId}' already exists at ${defaultProfilePath}; left unchanged.`,
      ...syncResult.messages,
    ],
  };
};

export const createSetupCommand = (dependencies: SetupCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'setup',
    description: 'Create initial Bridl settings and a default profile.',
    register(program: Command): void {
      program.command(command.name).description(command.description).action(() => {
        const result = executeSetupCommand(
          {
            /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
          },
          dependencies,
        );

        for (const message of result.messages) {
          /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
          (dependencies.writeLine ?? console.log)(message);
        }
      });
    },
  };

  return command;
};

const readUserDefaultProfileId = (
  files: readonly { readonly location: { readonly scope: string }; readonly settings: { readonly defaultProfile?: string } }[],
): string => files.find((file) => file.location.scope === 'user')?.settings.defaultProfile ?? 'default';

const assertValidDefaultProfileId = (profileId: string): void => {
  if (!isValidProfileId(profileId)) {
    throw new Error(`Default profile '${profileId}' is not a filesystem-safe Bridl profile id.`);
  }
};

const createInitialSettingsIfMissing = (settingsPath: string): boolean => {
  if (existsSync(settingsPath)) {
    return false;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
  return true;
};

const createDefaultProfileIfMissing = (profilePath: string, profileId: string): boolean => {
  if (existsSync(profilePath)) {
    return false;
  }

  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, `id: ${profileId}\nlabel: Default\ncontrols: {}\n`);
  return true;
};

const formatSettingsIssue = (issue: { readonly filePath: string; readonly path: string; readonly message: string }): string =>
  `${issue.filePath}#${issue.path} ${issue.message}`;
