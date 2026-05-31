// Provides the command object for first-run Bridl setup.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Command } from 'commander';
import spawn from 'cross-spawn';

import {
  createRemoteRepositoryCachePath,
  normalizeGitUri,
  redactProfileSourceUriCredentials,
} from '../../profiles/ProfileCache.js';
import { isValidProfileId } from '../../profiles/ProfileLoader.js';
import {
  createSettingsLoadPlan,
  discoverSettingsLoadPlan,
  loadSettings,
  loadSettingsFiles,
} from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';
import type { SyncCommandDependencies, SyncCommandResult } from './SyncCommand.js';
import { executeSyncCommand } from './SyncCommand.js';

export interface SetupCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly setupSourceUri?: string;
}

export interface SetupCommandResult {
  readonly settingsPath: string;
  readonly defaultProfilePath: string;
  readonly createdSettings: boolean;
  readonly copiedStarterProfileFiles: number;
  readonly createdDefaultProfile: boolean;
  readonly syncResult: SyncCommandResult;
  readonly messages: readonly string[];
}

export interface SetupSourceSynchronizer {
  sync(uri: string, cachePath: string): void;
}

export type SetupCommandDependencies = SyncCommandDependencies & {
  readonly setupSourceSynchronizer?: SetupSourceSynchronizer;
};

interface StarterLayout {
  readonly cachePath: string;
  readonly settingsPath?: string;
  readonly profilesPath?: string;
}

export const executeSetupCommand = (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies = {},
): SetupCommandResult => {
  const settingsPath = join(input.homeDirectory, '.bridl', 'settings.yml');
  const initialSettingsMissing = !existsSync(settingsPath);
  const starterLayout = input.setupSourceUri
    ? prepareStarterLayout(input.homeDirectory, input.setupSourceUri, dependencies.setupSourceSynchronizer)
    : undefined;
  const loadedSettings = loadSettings(discoverSettingsLoadPlan(input));

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot setup with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const defaultProfileId = initialSettingsMissing
    ? readStarterDefaultProfileId(starterLayout?.settingsPath)
    : readUserDefaultProfileId(loadedSettings.files);
  assertValidDefaultProfileId(defaultProfileId);

  const createdSettings = createInitialSettingsIfMissing(settingsPath, starterLayout?.settingsPath);
  ensureExistingUserSettingsDefaultProfile(settingsPath, loadedSettings.files, defaultProfileId);
  const copiedStarterProfileFiles = copyStarterProfileFilesIfPresent(
    starterLayout?.profilesPath,
    join(input.homeDirectory, '.bridl', 'profiles'),
  );
  const defaultProfilePath = join(input.homeDirectory, '.bridl', 'profiles', defaultProfileId, 'profile.yml');
  const createdDefaultProfile = createDefaultProfileIfMissing(defaultProfilePath, defaultProfileId);
  const syncResult = executeSyncCommand(input, dependencies);

  return {
    settingsPath,
    defaultProfilePath,
    createdSettings,
    copiedStarterProfileFiles,
    createdDefaultProfile,
    syncResult,
    messages: buildSetupMessages({
      input,
      starterLayout,
      settingsPath,
      createdSettings,
      copiedStarterProfileFiles,
      defaultProfileId,
      defaultProfilePath,
      createdDefaultProfile,
      syncResult,
    }),
  };
};

interface SetupMessageInput {
  readonly input: SetupCommandInput;
  readonly starterLayout?: StarterLayout;
  readonly settingsPath: string;
  readonly createdSettings: boolean;
  readonly copiedStarterProfileFiles: number;
  readonly defaultProfileId: string;
  readonly defaultProfilePath: string;
  readonly createdDefaultProfile: boolean;
  readonly syncResult: SyncCommandResult;
}

const buildSetupMessages = (input: SetupMessageInput): readonly string[] => {
  const messages: string[] = [];

  if (input.input.setupSourceUri !== undefined && input.starterLayout !== undefined) {
    messages.push(
      `Prepared setup source ${redactProfileSourceUriCredentials(input.input.setupSourceUri)} at ${input.starterLayout.cachePath}.`,
    );
  }

  messages.push(
    input.createdSettings
      ? `Created user settings at ${input.settingsPath}.`
      : `User settings already exist at ${input.settingsPath}; left unchanged.`,
  );

  if (input.starterLayout?.profilesPath !== undefined) {
    messages.push(
      `Copied ${input.copiedStarterProfileFiles} starter profile file(s) into ${join(
        input.input.homeDirectory,
        '.bridl',
        'profiles',
      )}.`,
    );
  }

  messages.push(
    input.createdDefaultProfile
      ? `Created default user profile '${input.defaultProfileId}' at ${input.defaultProfilePath}.`
      : `Default user profile '${input.defaultProfileId}' already exists at ${input.defaultProfilePath}; left unchanged.`,
    ...input.syncResult.messages,
  );

  return messages;
};

export const createSetupCommand = (dependencies: SetupCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'setup',
    description: 'Create initial Bridl settings and a default profile.',
    register(program: Command): void {
      program
        .command(`${command.name} [source]`)
        .description(command.description)
        .action((source?: string) => {
          const result = executeSetupCommand(
            {
              /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
              homeDirectory: dependencies.homeDirectory ?? homedir(),
              /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
              projectDirectory: dependencies.projectDirectory ?? process.cwd(),
              setupSourceUri: source,
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

const prepareStarterLayout = (
  homeDirectory: string,
  setupSourceUri: string,
  synchronizer: SetupSourceSynchronizer = createGitSetupSourceSynchronizer(),
): StarterLayout => {
  const cachePath = createSetupSourceCachePath(homeDirectory, setupSourceUri);
  synchronizer.sync(setupSourceUri, cachePath);

  const settingsPath = firstExistingPath(join(cachePath, 'settings.yml'), join(cachePath, '.bridl', 'settings.yml'));
  validateStarterSettingsIfPresent(settingsPath);

  const preferredProfilesPath = settingsPath?.endsWith(join('.bridl', 'settings.yml'))
    ? join(cachePath, '.bridl', 'profiles')
    : join(cachePath, 'profiles');
  const profilesPath = firstExistingPath(
    preferredProfilesPath,
    join(cachePath, 'profiles'),
    join(cachePath, '.bridl', 'profiles'),
  );

  return { cachePath, settingsPath, profilesPath };
};

const createSetupSourceCachePath = (homeDirectory: string, setupSourceUri: string): string =>
  createRemoteRepositoryCachePath(homeDirectory, { uri: setupSourceUri });

const createGitSetupSourceSynchronizer = (): SetupSourceSynchronizer => ({
  sync(uri, cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });

    if (existsSync(cachePath)) {
      runGit(['-C', cachePath, 'pull', '--ff-only'], uri);
      return;
    }

    runGit(['clone', '--', normalizeGitUri(uri), cachePath], uri);
  },
});

const runGit = (args: readonly string[], sensitiveUri: string): void => {
  const result = spawn.sync('git', args, { stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0) {
    /* v8 ignore next -- the final fallback only applies if git emits no stdout or stderr. */
    throw new Error(
      redactSensitiveText((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim(), sensitiveUri),
    );
  }
};

const redactSensitiveText = (message: string, uri: string): string =>
  message
    .split(uri)
    .join(redactProfileSourceUriCredentials(uri))
    .split(normalizeGitUri(uri))
    .join(redactProfileSourceUriCredentials(normalizeGitUri(uri)));

const firstExistingPath = (...paths: readonly string[]): string | undefined => paths.find((path) => existsSync(path));

const validateStarterSettingsIfPresent = (settingsPath?: string): void => {
  if (settingsPath === undefined) {
    return;
  }

  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

  if (loaded.issues.length > 0) {
    throw new Error(`Cannot setup from invalid starter settings: ${loaded.issues.map(formatSettingsIssue).join('; ')}`);
  }
};

const readStarterDefaultProfileId = (settingsPath?: string): string => {
  if (settingsPath === undefined) {
    return 'default';
  }

  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));
  return loaded.files[0]?.settings.defaultProfile ?? 'default';
};

type LoadedSetupSettingsFile = {
  readonly location: { readonly scope: string };
  readonly settings: { readonly defaultProfile?: string };
};

const readUserDefaultProfileId = (files: readonly LoadedSetupSettingsFile[]): string =>
  files.find((file) => file.location.scope === 'user')?.settings.defaultProfile ?? 'default';

const ensureExistingUserSettingsDefaultProfile = (
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

const assertValidDefaultProfileId = (profileId: string): void => {
  if (!isValidProfileId(profileId)) {
    throw new Error(`Default profile '${profileId}' is not a filesystem-safe Bridl profile id.`);
  }
};

const createInitialSettingsIfMissing = (settingsPath: string, starterSettingsPath?: string): boolean => {
  if (existsSync(settingsPath)) {
    return false;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    starterSettingsPath === undefined
      ? 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n'
      : readStarterSettingsContent(starterSettingsPath),
  );
  return true;
};

const readStarterSettingsContent = (starterSettingsPath: string): string => {
  const content = readFileSync(starterSettingsPath, 'utf8');
  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: starterSettingsPath }]));

  if (loaded.files[0]?.settings.defaultProfile !== undefined) {
    return content;
  }

  return `default_profile: default\n${content}`;
};

const copyStarterProfileFilesIfPresent = (
  sourceProfilesPath: string | undefined,
  targetProfilesPath: string,
): number => {
  if (sourceProfilesPath === undefined) {
    return 0;
  }

  return copyDirectoryContentsWithoutOverwriting(sourceProfilesPath, targetProfilesPath);
};

const copyDirectoryContentsWithoutOverwriting = (sourceDirectory: string, targetDirectory: string): number => {
  mkdirSync(targetDirectory, { recursive: true });
  let copiedFiles = 0;

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = join(sourceDirectory, entry.name);
    const targetPath = join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      copiedFiles += copyDirectoryContentsWithoutOverwriting(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile() && !existsSync(targetPath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      cpSync(sourcePath, targetPath, { force: false });
      copiedFiles += 1;
    }
  }

  return copiedFiles;
};

const createDefaultProfileIfMissing = (profilePath: string, profileId: string): boolean => {
  if (existsSync(profilePath)) {
    return false;
  }

  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, `id: ${profileId}\nlabel: Default\ncontrols: {}\n`);
  return true;
};

const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;
