// Provides the command object for first-run ApplePi setup.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Command } from 'commander';
import spawn from 'cross-spawn';

import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  normalizeGitUri,
  redactProfileSourceUriCredentials,
  resolveRemoteRepositorySubpath,
} from '../../profiles/ProfileCache.js';
import { isValidProfileId, loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import {
  createSettingsLoadPlan,
  discoverSettingsLoadPlan,
  loadSettings,
  loadSettingsFiles,
  loadSettingsWithCachedRemoteSettings,
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
  readonly input?: { readonly isTTY?: boolean } & NodeJS.ReadableStream;
  readonly output?: { readonly isTTY?: boolean } & NodeJS.WritableStream;
  readonly interactive?: boolean;
  readonly selectDefaultProfile?: (profiles: readonly SetupProfileChoice[], currentDefault: string) => Promise<string>;
};

export interface SetupProfileChoice {
  readonly id: string;
  readonly label?: string;
}

const defaultProfileSourceRepository = 'applepi-ai/default-profiles';

interface StarterLayout {
  readonly cachePath: string;
  readonly settingsPath?: string;
  readonly profilesPath?: string;
}

export const executeSetupCommand = async (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies = {},
): Promise<SetupCommandResult> => {
  requireInteractiveTerminalIfNeeded(dependencies);
  const settingsPath = join(input.homeDirectory, '.applepi', 'settings.yml');
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
    join(input.homeDirectory, '.applepi', 'profiles'),
  );
  const syncResult = executeSyncCommand(input, dependencies);
  const selectedDefaultProfileId = await selectDefaultProfileIfInteractive(
    input,
    settingsPath,
    defaultProfileId,
    dependencies,
  );
  const defaultProfilePath = join(input.homeDirectory, '.applepi', 'profiles', selectedDefaultProfileId, 'profile.yml');
  const createdDefaultProfile = createDefaultProfileIfMissing(defaultProfilePath, selectedDefaultProfileId);

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
      defaultProfileId: selectedDefaultProfileId,
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
        '.applepi',
        'profiles',
      )}.`,
    );
  }

  messages.push(
    input.createdDefaultProfile
      ? `Created default user profile at ${input.defaultProfilePath}.`
      : `Default user profile at ${input.defaultProfilePath} already exists; left unchanged.`,
    `Selected default profile '${input.defaultProfileId}'.`,
    ...input.syncResult.messages,
  );

  return messages;
};

export const createSetupCommand = (dependencies: SetupCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'setup',
    description: 'Create initial ApplePi settings and a default profile.',
    register(program: Command): void {
      program
        .command(`${command.name} [source]`)
        .description(command.description)
        .action(async (source?: string) => {
          const result = await executeSetupCommand(
            {
              /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
              homeDirectory: dependencies.homeDirectory ?? homedir(),
              /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
              projectDirectory: dependencies.projectDirectory ?? process.cwd(),
              setupSourceUri: source,
            },
            { ...dependencies, interactive: true },
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

  const settingsPath = firstExistingPath(join(cachePath, 'settings.yml'), join(cachePath, '.applepi', 'settings.yml'));
  validateStarterSettingsIfPresent(settingsPath);

  const preferredProfilesPath = settingsPath?.endsWith(join('.applepi', 'settings.yml'))
    ? join(cachePath, '.applepi', 'profiles')
    : join(cachePath, 'profiles');
  const profilesPath = firstExistingPath(
    preferredProfilesPath,
    join(cachePath, 'profiles'),
    join(cachePath, '.applepi', 'profiles'),
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
    return 'engineer';
  }

  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));
  return loaded.files[0]?.settings.defaultProfile ?? 'engineer';
};

type LoadedSetupSettingsFile = {
  readonly location: { readonly scope: string };
  readonly settings: { readonly defaultProfile?: string };
};

const readUserDefaultProfileId = (files: readonly LoadedSetupSettingsFile[]): string =>
  files.find((file) => file.location.scope === 'user')?.settings.defaultProfile ?? 'engineer';

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
    throw new Error(`Default profile '${profileId}' is not a filesystem-safe ApplePi profile id.`);
  }
};

const createDefaultSettingsContent = (): string =>
  [
    'default_profile: engineer',
    'profile_sources:',
    '  - path: ./profiles',
    `  - github: ${defaultProfileSourceRepository}`,
    '    ref: main',
    '    path: profiles',
    '',
  ].join('\n');

const createInitialSettingsIfMissing = (settingsPath: string, starterSettingsPath?: string): boolean => {
  if (existsSync(settingsPath)) {
    return false;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    starterSettingsPath === undefined
      ? createDefaultSettingsContent()
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

  return `default_profile: engineer\n${content}`;
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

const requireInteractiveTerminalIfNeeded = (dependencies: SetupCommandDependencies): void => {
  if (dependencies.interactive !== true) {
    return;
  }

  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const inputIsTty = (dependencies.input ?? process.stdin).isTTY === true;
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const outputIsTty = (dependencies.output ?? process.stdout).isTTY === true;

  if (!inputIsTty || !outputIsTty) {
    throw new Error('`applepi setup` requires an interactive TTY on both stdin and stdout.');
  }
};

const selectDefaultProfileIfInteractive = async (
  input: SetupCommandInput,
  settingsPath: string,
  currentDefault: string,
  dependencies: SetupCommandDependencies,
): Promise<string> => {
  if (dependencies.interactive !== true) {
    return currentDefault;
  }

  const profiles = discoverSetupProfileChoices(input);
  const writer = dependencies.writeLine ?? console.log;
  writer('Welcome to ApplePi. ApplePi is the easiest way to run Pi.');
  writer('ApplePi manages full pi configurations for you, so you can use different profiles in different situations.');
  const selectedProfile = await selectSetupProfile(profiles, currentDefault, dependencies);
  assertValidSelectedDefaultProfile(selectedProfile, profiles);
  updateSettingsDefaultProfile(settingsPath, selectedProfile);
  return selectedProfile;
};

const assertValidSelectedDefaultProfile = (selectedProfile: string, profiles: readonly SetupProfileChoice[]): void => {
  assertValidDefaultProfileId(selectedProfile);

  if (profiles.length > 0 && profiles.every((profile) => profile.id !== selectedProfile)) {
    throw new Error(`Selected default profile '${selectedProfile}' was not one of the available setup profiles.`);
  }
};

const discoverSetupProfileChoices = (input: SetupCommandInput): readonly SetupProfileChoice[] => {
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
      });
    }
  }

  return [...choices.values()].sort((left, right) => left.id.localeCompare(right.id));
};

const materializeSetupProfileSource = (
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

const selectSetupProfile = async (
  profiles: readonly SetupProfileChoice[],
  currentDefault: string,
  dependencies: SetupCommandDependencies,
): Promise<string> => {
  if (dependencies.selectDefaultProfile !== undefined) {
    return dependencies.selectDefaultProfile(profiles, currentDefault);
  }

  return promptForSetupProfile(profiles, currentDefault, dependencies);
};

const promptForSetupProfile = async (
  profiles: readonly SetupProfileChoice[],
  currentDefault: string,
  dependencies: SetupCommandDependencies,
): Promise<string> => {
  const candidates = profiles.length > 0 ? profiles : [{ id: currentDefault }];
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const output = dependencies.output ?? process.stdout;
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({ input: dependencies.input ?? process.stdin, output });

  try {
    output.write('\nChoose the default profile for your sessions:\n');
    candidates.forEach((profile, index) => {
      const label = profile.label === undefined ? '' : ` - ${profile.label}`;
      output.write(`${index + 1}. ${profile.id}${label}\n`);
    });

    const currentIndex = Math.max(
      candidates.findIndex((profile) => profile.id === currentDefault),
      0,
    );
    const answer = await readline.question(`Default profile [${currentIndex + 1}]: `);
    const selectedIndex = Number.parseInt(answer.trim() || String(currentIndex + 1), 10) - 1;

    const selectedProfile = candidates[selectedIndex];

    if (selectedProfile === undefined) {
      throw new Error('Selected default profile number is out of range.');
    }

    return selectedProfile.id;
  } finally {
    readline.close();
  }
};

export const updateSettingsDefaultProfile = (settingsPath: string, profileId: string): void => {
  const content = readFileSync(settingsPath, 'utf8');
  const nextContent = /^default_profile:.*$/mu.test(content)
    ? content.replace(/^default_profile:.*$/gmu, `default_profile: ${profileId}`)
    : `${content.replace(/\s*$/u, '\n')}default_profile: ${profileId}\n`;

  writeFileSync(settingsPath, nextContent);
};

const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;
