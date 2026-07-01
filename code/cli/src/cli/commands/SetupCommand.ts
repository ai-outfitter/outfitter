/* eslint-disable max-lines */
// Provides the command object for first-run Outfitter setup.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { Command } from 'commander';
import spawn from 'cross-spawn';
import { parse, stringify } from 'yaml';

import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  normalizeGitUri,
  redactProfileSourceUriCredentials,
  resolveRemoteRepositorySubpath,
} from '../../profiles/ProfileCache.js';
import { isValidProfileId, loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import { resolveProfile } from '../../profiles/ProfileMerger.js';
import {
  createSettingsLoadPlan,
  discoverSettingsLoadPlan,
  loadSettings,
  loadSettingsFiles,
  loadSettingsWithCachedRemoteSettings,
} from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';
import {
  persistFirstRunWelcomeProfile,
  updateSettingsDefaultProfile,
  type PersistedFirstRunWelcomeProfile,
} from './FirstRunWelcomeProfile.js';
import type { SyncCommandDependencies, SyncCommandResult } from './SyncCommand.js';
import { executeSyncCommand } from './SyncCommand.js';
import { executeWelcomeCommand, writeWelcomeIntro } from './WelcomeCommand.js';
import type { WelcomeCommandDependencies, WelcomeCommandResult } from './WelcomeCommand.js';

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
  readonly welcomeResult?: WelcomeCommandResult;
  readonly messages: readonly string[];
}

export interface SetupSourceSynchronizer {
  sync(uri: string, cachePath: string): void;
}

export interface SetupSourceLaunchInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly profileId?: string;
}

export interface SetupPiOnboardingLaunchInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly setupSourceUri?: string;
}

export type SetupSourcePostImportAction = 'start' | 'exit';

export type SetupCommandDependencies = SyncCommandDependencies &
  WelcomeCommandDependencies & {
    readonly setupSourceSynchronizer?: SetupSourceSynchronizer;
    readonly selectDefaultProfile?: (
      profiles: readonly SetupProfileChoice[],
      currentDefault: string,
    ) => Promise<string>;
    readonly selectSetupSourceImportTarget?: (
      choices: readonly SetupSourceImportTargetChoice[],
      defaultTarget: SetupSourceImportTarget,
    ) => Promise<SetupSourceImportTarget>;
    readonly selectSetupSourceLaunchAction?: (
      profileId: string,
      launchTarget: SetupSourcePostImportLaunchTarget,
    ) => Promise<SetupSourcePostImportAction>;
    readonly selectSetupSourceImportMode?: (
      choices: readonly SetupSourceImportModeChoice[],
      defaultMode: SetupSourceImportMode,
    ) => Promise<SetupSourceImportMode>;
    readonly launchSetupSourceProfile?: (input: SetupSourceLaunchInput) => Promise<void>;
    readonly launchPiOnboarding?: (input: SetupPiOnboardingLaunchInput) => Promise<{ readonly exitCode: number }>;
    readonly runWelcome?: (
      input: SetupCommandInput,
      dependencies: SetupCommandDependencies,
    ) => Promise<WelcomeCommandResult | undefined>;
  };

export interface SetupProfileChoice {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
}

export type SetupSourceImportTarget = 'home' | 'project';
export type SetupSourceImportMode = 'copy' | 'symlink';

export interface SetupSourceImportTargetChoice {
  readonly target: SetupSourceImportTarget;
  readonly label: string;
  readonly description: string;
}

export interface SetupSourceImportModeChoice {
  readonly mode: SetupSourceImportMode;
  readonly label: string;
  readonly description: string;
}

const setupSourceImportModeChoices: readonly SetupSourceImportModeChoice[] = [
  {
    mode: 'copy',
    label: 'Copy snapshot',
    description: 'copy profiles into the selected .outfitter folder; safest for normal use',
  },
  {
    mode: 'symlink',
    label: 'Symlink for development',
    description: 'link the selected .outfitter folder to the local source so shared profile edits apply immediately',
  },
];

const setupSourceImportTargetChoices: readonly SetupSourceImportTargetChoice[] = [
  {
    target: 'home',
    label: 'User home',
    description: 'install profiles into ~/.outfitter for all repositories on this machine',
  },
  {
    target: 'project',
    label: 'Current project',
    description: 'install profiles into this project .outfitter folder only',
  },
];

interface StarterLayout {
  readonly cachePath: string;
  readonly settingsPath?: string;
  readonly profilesPath?: string;
  readonly sourceKind: 'local-live' | 'remote-cache';
  readonly sourceOutfitterPath?: string;
}

/* eslint-disable complexity -- setup orchestration coordinates settings, sync, prompts, and welcome persistence. */
export const executeSetupCommand = async (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies = {},
): Promise<SetupCommandResult> => {
  requireInteractiveTerminalIfNeeded(dependencies);
  const settingsPath = join(input.homeDirectory, '.outfitter', 'settings.yml');
  const initialSettingsMissing = !existsSync(settingsPath);
  const starterLayout = input.setupSourceUri
    ? prepareStarterLayout(
        input.homeDirectory,
        input.projectDirectory,
        input.setupSourceUri,
        dependencies.setupSourceSynchronizer,
      )
    : undefined;
  const loadedSettings = loadSettings(discoverSettingsLoadPlan(input));

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot setup with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const defaultProfileId = initialSettingsMissing
    ? readStarterDefaultProfileId(starterLayout?.settingsPath)
    : readUserDefaultProfileId(loadedSettings.files);
  assertValidDefaultProfileId(defaultProfileId);

  if (input.setupSourceUri !== undefined && dependencies.interactive === true && starterLayout !== undefined) {
    return executeInteractiveSetupSourceCommand({
      input: { ...input, setupSourceUri: input.setupSourceUri },
      dependencies,
      homeSettingsPath: settingsPath,
      initialSettingsMissing,
      starterLayout,
      currentDefaultProfileId: defaultProfileId,
    });
  }

  const createdSettings = createInitialSettingsIfMissing(settingsPath, starterLayout?.settingsPath);
  ensureExistingUserSettingsDefaultProfile(settingsPath, loadedSettings.files, defaultProfileId);
  const copiedStarterProfileFiles = copyStarterProfileFilesIfPresent(
    starterLayout?.profilesPath,
    join(input.homeDirectory, '.outfitter', 'profiles'),
  );
  const rollbackCreatedSettings = createdSettings ? () => rmSync(settingsPath, { force: true }) : () => undefined;
  const syncResult = executeSyncCommand(input, dependencies);
  failOnInitialDefaultProfileSyncFailure(initialSettingsMissing, rollbackCreatedSettings, syncResult);
  const selectedDefaultProfileId = shouldSkipInitialDefaultProfilePrompt(initialSettingsMissing, dependencies)
    ? defaultProfileId
    : await selectDefaultProfileIfInteractive(input, settingsPath, defaultProfileId, dependencies, starterLayout);
  const welcomeResult = await runWelcomeAfterInteractiveSetup(input, dependencies);
  const welcomeProfile = persistWelcomeProfileForSetup(input, settingsPath, welcomeResult);
  const finalDefaultProfile = prepareFinalDefaultProfile(input.homeDirectory, selectedDefaultProfileId, welcomeProfile);

  return {
    settingsPath,
    defaultProfilePath: finalDefaultProfile.path,
    createdSettings,
    copiedStarterProfileFiles,
    createdDefaultProfile: finalDefaultProfile.created,
    syncResult,
    welcomeResult,
    messages: buildSetupMessages({
      input,
      starterLayout,
      settingsPath,
      createdSettings,
      copiedStarterProfileFiles,
      defaultProfileId: finalDefaultProfile.id,
      defaultProfilePath: finalDefaultProfile.path,
      createdDefaultProfile: finalDefaultProfile.created,
      syncResult,
      welcomeProfileMessages: welcomeProfile?.messages ?? [],
      runExampleMessages: input.setupSourceUri === undefined ? [] : [formatRunProfileExample(finalDefaultProfile.id)],
    }),
  };
};
/* eslint-enable complexity */

const defaultProfilesSourceUri = 'git+https://github.com/ai-outfitter/default-profiles.git:profiles';

const failOnInitialDefaultProfileSyncFailure = (
  initialSettingsMissing: boolean,
  rollbackCreatedSettings: () => void,
  syncResult: SyncCommandResult,
): void => {
  if (!initialSettingsMissing) {
    return;
  }

  const failedDefaultProfilesSource = syncResult.sources.find(
    (source) => source.uri === defaultProfilesSourceUri && source.status === 'failed',
  );

  if (failedDefaultProfilesSource === undefined) {
    return;
  }

  rollbackCreatedSettings();

  throw new Error(
    `Cannot complete first-run setup because the default profiles source failed to sync: ${failedDefaultProfilesSource.message}. ` +
      'Fix the network/git issue and rerun `outfitter setup` once the source is reachable.',
  );
};

interface InteractiveSetupSourceCommandInput {
  readonly input: SetupCommandInput & { readonly setupSourceUri: string };
  readonly dependencies: SetupCommandDependencies;
  readonly homeSettingsPath: string;
  readonly initialSettingsMissing: boolean;
  readonly starterLayout: StarterLayout;
  readonly currentDefaultProfileId: string;
}

interface SetupSourceOnboardingResult {
  readonly importTarget: SetupSourceImportTarget;
  readonly selectedProfileId: string;
  readonly importMode: SetupSourceImportMode;
}

interface AppliedSetupSourceImport {
  readonly settingsPath: string;
  readonly settingsDescription: string;
  readonly profilesPath: string;
  readonly createdSettings: boolean;
  readonly copiedStarterProfileFiles: number;
  readonly copiedStarterResourceFiles: number;
  readonly selectedProfileAlreadyExists: boolean;
  readonly selectedProfileConflictMessage?: string;
  readonly symlinkedOutfitter: boolean;
}

const executeInteractiveSetupSourceCommand = async ({
  input,
  dependencies,
  homeSettingsPath,
  initialSettingsMissing,
  starterLayout,
  currentDefaultProfileId,
}: InteractiveSetupSourceCommandInput): Promise<SetupCommandResult> => {
  const onboarding = await runSetupSourceOnboarding(input, dependencies, starterLayout, currentDefaultProfileId);
  const appliedImport = applySetupSourceImport(input, starterLayout, onboarding);
  /* v8 ignore next -- setup-source rollback only runs when a home import creates settings and default-profile sync fails. */
  const rollbackCreatedSettings = appliedImport.createdSettings
    ? () => rmSync(appliedImport.settingsPath, { force: true })
    : () => undefined;
  const syncResult = executeSyncCommand(input, dependencies);

  failOnInitialDefaultProfileSyncFailure(
    initialSettingsMissing && appliedImport.settingsPath === homeSettingsPath,
    rollbackCreatedSettings,
    syncResult,
  );

  const defaultProfilePath = findSetupProfilePath(appliedImport.profilesPath, onboarding.selectedProfileId);
  const createdDefaultProfile = appliedImport.symlinkedOutfitter
    ? false
    : createDefaultProfileIfMissing(defaultProfilePath, onboarding.selectedProfileId);
  const postImportLaunchTarget = appliedImport.selectedProfileAlreadyExists ? 'default' : 'selected';
  const postImportAction = await runSetupSourcePostImportAction(
    input,
    dependencies,
    onboarding.importTarget,
    onboarding.selectedProfileId,
    postImportLaunchTarget,
  );

  return {
    settingsPath: appliedImport.settingsPath,
    defaultProfilePath,
    createdSettings: appliedImport.createdSettings,
    copiedStarterProfileFiles: appliedImport.copiedStarterProfileFiles,
    createdDefaultProfile,
    syncResult,
    messages: buildSetupMessages({
      input,
      starterLayout,
      settingsPath: appliedImport.settingsPath,
      settingsDescription: appliedImport.settingsDescription,
      profileTargetPath: appliedImport.profilesPath,
      createdSettings: appliedImport.createdSettings,
      copiedStarterProfileFiles: appliedImport.copiedStarterProfileFiles,
      defaultProfileId: onboarding.selectedProfileId,
      defaultProfilePath,
      createdDefaultProfile,
      syncResult,
      welcomeProfileMessages:
        appliedImport.selectedProfileConflictMessage === undefined
          ? []
          : [appliedImport.selectedProfileConflictMessage],
      runExampleMessages:
        postImportAction === 'exit'
          ? formatSetupSourceExitMessages(
              input,
              onboarding.importTarget,
              onboarding.selectedProfileId,
              postImportLaunchTarget,
            )
          : [],
    }),
  };
};

interface FinalDefaultProfile {
  readonly id: string;
  readonly path: string;
  readonly created: boolean;
}

const prepareFinalDefaultProfile = (
  homeDirectory: string,
  selectedDefaultProfileId: string,
  welcomeProfile: PersistedFirstRunWelcomeProfile | undefined,
): FinalDefaultProfile => {
  const finalDefaultProfileId = welcomeProfile?.profileId ?? selectedDefaultProfileId;
  const finalDefaultProfilePath = join(homeDirectory, '.outfitter', 'profiles', finalDefaultProfileId, 'profile.yml');
  const createdDefaultProfile =
    welcomeProfile?.createdProfile ?? createDefaultProfileIfMissing(finalDefaultProfilePath, finalDefaultProfileId);

  return { id: finalDefaultProfileId, path: finalDefaultProfilePath, created: createdDefaultProfile };
};

interface SetupMessageInput {
  readonly input: SetupCommandInput;
  readonly starterLayout?: StarterLayout;
  readonly settingsPath: string;
  readonly settingsDescription?: string;
  readonly profileTargetPath?: string;
  readonly createdSettings: boolean;
  readonly copiedStarterProfileFiles: number;
  readonly defaultProfileId: string;
  readonly defaultProfilePath: string;
  readonly createdDefaultProfile: boolean;
  readonly syncResult: SyncCommandResult;
  readonly welcomeProfileMessages: readonly string[];
  readonly runExampleMessages: readonly string[];
}

const buildSetupMessages = (input: SetupMessageInput): readonly string[] => {
  const messages: string[] = [];

  if (input.input.setupSourceUri !== undefined && input.starterLayout !== undefined) {
    messages.push(
      `Prepared setup source ${redactProfileSourceUriCredentials(input.input.setupSourceUri)} at ${input.starterLayout.cachePath}.`,
    );
  }

  const settingsDescription = input.settingsDescription ?? 'user';
  const profileTargetPath = input.profileTargetPath ?? join(input.input.homeDirectory, '.outfitter', 'profiles');

  messages.push(
    input.createdSettings
      ? `Created ${settingsDescription} settings at ${input.settingsPath}.`
      : `${capitalize(settingsDescription)} settings already exist at ${input.settingsPath}; left unchanged.`,
  );

  if (input.starterLayout?.profilesPath !== undefined) {
    messages.push(`Copied ${input.copiedStarterProfileFiles} starter profile file(s) into ${profileTargetPath}.`);
  }

  if (shouldReportDefaultProfileStatus(input)) {
    messages.push(
      input.createdDefaultProfile
        ? `Created default user profile at ${input.defaultProfilePath}.`
        : `Default user profile at ${input.defaultProfilePath} already exists; left unchanged.`,
    );
  }

  messages.push(
    `Selected default profile '${input.defaultProfileId}'.`,
    ...input.welcomeProfileMessages,
    ...input.runExampleMessages,
    ...input.syncResult.messages,
  );

  return messages;
};

const shouldReportDefaultProfileStatus = (input: SetupMessageInput): boolean => {
  if (input.createdDefaultProfile) {
    return true;
  }

  return input.input.setupSourceUri === undefined || input.starterLayout?.profilesPath === undefined;
};

export type SetupSourcePostImportLaunchTarget = 'selected' | 'default';

const formatRunProfileExample = (profileId: string): string =>
  `Start the selected default profile either way:\n  outfitter\n  outfitter --profile ${profileId}`;

const formatRunDefaultProfileExample = (): string => `Start the current default profile:\n  outfitter`;

/* v8 ignore start -- setup-source launch visibility fallbacks are exercised through integration-style CLI flows; unit tests cover the primary imported-profile outcomes. */
const formatSetupSourceExitMessages = (
  input: SetupCommandInput,
  importTarget: SetupSourceImportTarget,
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
): readonly string[] => {
  if (launchTarget === 'default') {
    return [formatRunDefaultProfileExample()];
  }

  if (importTarget !== 'home' || canResolveProfileForLaunch(input, profileId)) {
    return [formatRunProfileExample(profileId)];
  }

  return [formatHiddenHomeImportMessage(profileId)];
};

const formatHiddenHomeImportMessage = (profileId: string): string =>
  `Imported profile '${profileId}' into user home, but this project overrides profile_sources and does not expose ~/.outfitter/profiles. ` +
  'Import into the current project, add ~/.outfitter/profiles to project profile_sources, or run from a directory without project Outfitter settings.';

const runSetupSourcePostImportAction = async (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies,
  importTarget: SetupSourceImportTarget,
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
): Promise<SetupSourcePostImportAction> => {
  if (
    dependencies.interactive !== true ||
    (dependencies.launchSetupSourceProfile === undefined && dependencies.selectSetupSourceLaunchAction === undefined)
  ) {
    return 'exit';
  }

  const action = await selectSetupSourceLaunchAction(profileId, launchTarget, dependencies);

  if (action === 'start') {
    if (launchTarget === 'selected') {
      assertSetupSourceProfileCanLaunch(input, importTarget, profileId);
    }

    await dependencies.launchSetupSourceProfile?.({
      homeDirectory: input.homeDirectory,
      projectDirectory: input.projectDirectory,
      profileId: launchTarget === 'selected' ? profileId : undefined,
    });
  }

  return action;
};

const assertSetupSourceProfileCanLaunch = (
  input: SetupCommandInput,
  importTarget: SetupSourceImportTarget,
  profileId: string,
): void => {
  if (importTarget !== 'home' || canResolveProfileForLaunch(input, profileId)) {
    return;
  }

  throw new Error(formatHiddenHomeImportMessage(profileId));
};

const canResolveProfileForLaunch = (input: SetupCommandInput, profileId: string): boolean => {
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

const selectSetupSourceLaunchAction = async (
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
  dependencies: SetupCommandDependencies,
): Promise<SetupSourcePostImportAction> => {
  if (dependencies.selectSetupSourceLaunchAction !== undefined) {
    return dependencies.selectSetupSourceLaunchAction(profileId, launchTarget);
  }

  return promptForSetupSourceLaunchAction(profileId, launchTarget, dependencies);
};

/* v8 ignore stop */
const capitalize = (value: string): string => `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;

export const createSetupCommand = (dependencies: SetupCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'setup',
    description: 'Create initial Outfitter settings and a default profile.',
    register(program: Command): void {
      program
        .command(`${command.name} [source]`)
        .description(command.description)
        .action(async (source?: string) => {
          const input = {
            /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            setupSourceUri: source,
          };
          const result =
            dependencies.launchPiOnboarding === undefined
              ? await launchPiOnboardingWithRunCommand(input, dependencies)
              : await dependencies.launchPiOnboarding(input);

          if (result.exitCode !== 0) {
            process.exitCode = result.exitCode;
          }
        });
    },
  };

  return command;
};

const launchPiOnboardingWithRunCommand = async (
  input: SetupPiOnboardingLaunchInput,
  dependencies: SetupCommandDependencies,
): Promise<{ readonly exitCode: number }> => {
  const { executeRunCommand } = await import('./RunCommand.js');
  return executeRunCommand(
    {
      ...input,
      agentId: 'pi',
      forceRuntimeOnboarding: true,
    },
    { ...dependencies, interactive: true },
  );
};

const prepareStarterLayout = (
  homeDirectory: string,
  projectDirectory: string,
  setupSourceUri: string,
  synchronizer: SetupSourceSynchronizer = createGitSetupSourceSynchronizer(),
): StarterLayout => {
  const localOutfitterPath = resolveLocalSetupSourceOutfitterPathFromUri(setupSourceUri, projectDirectory);

  if (localOutfitterPath !== undefined) {
    const settingsPath = join(localOutfitterPath, 'settings.yml');
    validateStarterSettingsIfPresent(existsSync(settingsPath) ? settingsPath : undefined);

    return {
      cachePath: localOutfitterPath,
      settingsPath: existsSync(settingsPath) ? settingsPath : undefined,
      profilesPath: firstExistingPath(join(localOutfitterPath, 'profiles')),
      sourceKind: 'local-live',
      sourceOutfitterPath: localOutfitterPath,
    };
  }

  const cachePath = createSetupSourceCachePath(homeDirectory, setupSourceUri);
  synchronizer.sync(setupSourceUri, cachePath);

  const settingsPath = firstExistingPath(
    join(cachePath, 'settings.yml'),
    join(cachePath, '.outfitter', 'settings.yml'),
  );
  validateStarterSettingsIfPresent(settingsPath);

  const preferredProfilesPath = settingsPath?.endsWith(join('.outfitter', 'settings.yml'))
    ? join(cachePath, '.outfitter', 'profiles')
    : join(cachePath, 'profiles');
  const profilesPath = firstExistingPath(
    preferredProfilesPath,
    join(cachePath, 'profiles'),
    join(cachePath, '.outfitter', 'profiles'),
  );

  return { cachePath, settingsPath, profilesPath, sourceKind: 'remote-cache' };
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

const readStarterExplicitDefaultProfileId = (settingsPath?: string): string | undefined => {
  if (settingsPath === undefined) {
    return undefined;
  }

  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));
  return loaded.files[0]?.settings.defaultProfile;
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
    throw new Error(`Default profile '${profileId}' is not a filesystem-safe Outfitter profile id.`);
  }
};

export const createDefaultSettingsContent = (defaultProfileId = 'engineer'): string =>
  [
    `default_profile: ${defaultProfileId}`,
    'profile_sources:',
    '  - github: ai-outfitter/default-profiles',
    '    path: profiles',
    '  - path: ./profiles',
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

/* v8 ignore start -- setup-source filesystem import variants are covered by integration-style fixtures; core settings outcomes are unit covered. */
const applySetupSourceImport = (
  input: SetupCommandInput,
  starterLayout: StarterLayout,
  onboarding: SetupSourceOnboardingResult,
): AppliedSetupSourceImport => {
  const target = createSetupSourceImportTargetLayout(input, onboarding.importTarget);

  if (onboarding.importMode === 'symlink') {
    return applySetupSourceSymlinkImport(input, target, onboarding);
  }

  return applySetupSourceCopyImport(starterLayout, target, onboarding);
};

const applySetupSourceSymlinkImport = (
  input: SetupCommandInput,
  target: Pick<AppliedSetupSourceImport, 'settingsPath' | 'settingsDescription' | 'profilesPath'>,
  onboarding: SetupSourceOnboardingResult,
): AppliedSetupSourceImport => {
  const sourceOutfitterPath = resolveLocalSetupSourceOutfitterPath(input);

  if (sourceOutfitterPath === undefined) {
    throw new Error('Local setup-source symlink mode requires a source .outfitter directory.');
  }

  const sourceSettingsPath = join(sourceOutfitterPath, 'settings.yml');

  if (!existsSync(sourceSettingsPath)) {
    throw new Error('Local setup-source symlink mode requires source .outfitter/settings.yml.');
  }

  validateStarterSettingsIfPresent(sourceSettingsPath);

  const sourceProfilesPath = join(sourceOutfitterPath, 'profiles');
  const sourceSelectedProfilePath = findSetupProfilePath(sourceProfilesPath, onboarding.selectedProfileId);

  if (!existsSync(sourceSelectedProfilePath)) {
    throw new Error(`Local setup-source symlink mode requires selected profile '${onboarding.selectedProfileId}'.`);
  }

  symlinkLocalOutfitterSource(sourceOutfitterPath, dirname(target.settingsPath));

  return {
    ...target,
    createdSettings: false,
    copiedStarterProfileFiles: 0,
    copiedStarterResourceFiles: 0,
    selectedProfileAlreadyExists: false,
    symlinkedOutfitter: true,
  };
};

const applySetupSourceCopyImport = (
  starterLayout: StarterLayout,
  target: Pick<AppliedSetupSourceImport, 'settingsPath' | 'settingsDescription' | 'profilesPath'>,
  onboarding: SetupSourceOnboardingResult,
): AppliedSetupSourceImport => {
  const createdSettings = createImportSettingsIfMissing(
    target.settingsPath,
    starterLayout.settingsPath,
    onboarding.selectedProfileId,
  );
  const selectedProfilePath = findSetupProfilePath(target.profilesPath, onboarding.selectedProfileId);
  const selectedProfileAlreadyExists = existsSync(selectedProfilePath);

  ensureLocalProfileSource(target.settingsPath, target.profilesPath);
  updateSettingsDefaultProfile(target.settingsPath, onboarding.selectedProfileId);

  return {
    ...target,
    createdSettings,
    copiedStarterProfileFiles: copyStarterProfileFilesIfPresent(starterLayout.profilesPath, target.profilesPath),
    copiedStarterResourceFiles: copyStarterResourceFilesIfPresent(
      starterLayout.profilesPath,
      dirname(target.settingsPath),
    ),
    selectedProfileAlreadyExists,
    selectedProfileConflictMessage: selectedProfileAlreadyExists
      ? `Existing selected setup-source profile '${onboarding.selectedProfileId}' at ${selectedProfilePath} was not overwritten.`
      : undefined,
    symlinkedOutfitter: false,
  };
};

/* v8 ignore stop */
/* v8 ignore start -- local setup-source path probing and symlink safety are covered by filesystem integration tests. */
const resolveLocalSetupSourceOutfitterPath = (input: SetupCommandInput): string | undefined =>
  input.setupSourceUri === undefined
    ? undefined
    : resolveLocalSetupSourceOutfitterPathFromUri(input.setupSourceUri, input.projectDirectory);

const resolveLocalSetupSourceOutfitterPathFromUri = (
  setupSourceUri: string,
  projectDirectory: string,
): string | undefined => {
  if (isRemoteSetupSourceUri(setupSourceUri)) {
    return undefined;
  }

  const sourcePath = isAbsolute(setupSourceUri) ? setupSourceUri : resolve(projectDirectory, setupSourceUri);
  const outfitterPath = sourcePath.endsWith('.outfitter') ? sourcePath : join(sourcePath, '.outfitter');

  return existsSync(outfitterPath) ? outfitterPath : undefined;
};

const isRemoteSetupSourceUri = (source: string): boolean => /^[a-z][a-z0-9+.-]*:/iu.test(source) && !isAbsolute(source);

const symlinkLocalOutfitterSource = (sourceOutfitterPath: string, targetOutfitterPath: string): void => {
  if (existsSync(targetOutfitterPath)) {
    const entries = readdirSync(targetOutfitterPath);

    if (entries.length > 0) {
      throw new Error(
        `Cannot symlink local setup source into non-empty .outfitter directory '${targetOutfitterPath}'. ` +
          'Move it aside or use copy snapshot setup.',
      );
    }

    rmSync(targetOutfitterPath, { recursive: true, force: true });
  }

  mkdirSync(dirname(targetOutfitterPath), { recursive: true });
  symlinkSync(sourceOutfitterPath, targetOutfitterPath, 'dir');
};

/* v8 ignore stop */
const createSetupSourceImportTargetLayout = (
  input: SetupCommandInput,
  target: SetupSourceImportTarget,
): Pick<AppliedSetupSourceImport, 'settingsPath' | 'settingsDescription' | 'profilesPath'> => {
  if (target === 'project') {
    return {
      settingsPath: join(input.projectDirectory, '.outfitter', 'settings.yml'),
      settingsDescription: 'project',
      profilesPath: join(input.projectDirectory, '.outfitter', 'profiles'),
    };
  }

  return {
    settingsPath: join(input.homeDirectory, '.outfitter', 'settings.yml'),
    settingsDescription: 'user',
    profilesPath: join(input.homeDirectory, '.outfitter', 'profiles'),
  };
};

const createImportSettingsIfMissing = (
  settingsPath: string,
  starterSettingsPath: string | undefined,
  selectedProfileId: string,
): boolean => {
  if (existsSync(settingsPath)) {
    return false;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    /* v8 ignore next -- setup-source tests exercise starter settings; missing starter settings is defensive fallback. */
    starterSettingsPath === undefined
      ? createLocalProfileSettingsContent(selectedProfileId)
      : readStarterSettingsContent(starterSettingsPath),
  );
  return true;
};

const createLocalProfileSettingsContent = (defaultProfileId: string): string =>
  ['default_profile: ' + defaultProfileId, 'profile_sources:', '  - path: ./profiles', ''].join('\n');

const ensureLocalProfileSource = (settingsPath: string, profilesPath: string): void => {
  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));
  const sources = loaded.files[0]?.settings.profileSources ?? [];

  if (sources.some((source) => source.path === profilesPath)) {
    return;
  }

  const document = readYamlRecord(settingsPath);
  /* v8 ignore next -- appending to existing non-local source lists is equivalent to the covered empty-source case. */
  const existingSources: readonly unknown[] = Array.isArray(document.profile_sources) ? document.profile_sources : [];
  writeFileSync(
    settingsPath,
    stringify({ ...document, profile_sources: [...existingSources, { path: './profiles' }] }),
  );
};

const readYamlRecord = (path: string): Record<string, unknown> => {
  const parsed = parse(readFileSync(path, 'utf8')) as unknown;
  /* v8 ignore next -- settings schema validation guarantees object documents before this helper mutates them. */
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : {};
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

const copyStarterResourceFilesIfPresent = (
  sourceProfilesPath: string | undefined,
  targetOutfitterPath: string,
): number => {
  if (sourceProfilesPath === undefined) {
    return 0;
  }

  const sourceOutfitterPath = dirname(sourceProfilesPath);
  return ['prompts', 'deepwork', 'skills'].reduce(
    (copiedFiles, resourceName) =>
      copiedFiles + copyNamedStarterResourceDirectoryIfPresent(sourceOutfitterPath, targetOutfitterPath, resourceName),
    0,
  );
};

const copyNamedStarterResourceDirectoryIfPresent = (
  sourceOutfitterPath: string,
  targetOutfitterPath: string,
  resourceName: string,
): number => {
  const sourceResourcePath = join(sourceOutfitterPath, resourceName);

  if (!existsSync(sourceResourcePath)) {
    return 0;
  }

  return copyDirectoryContentsWithoutOverwriting(sourceResourcePath, join(targetOutfitterPath, resourceName));
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

const findSetupProfilePath = (profilesPath: string, profileId: string): string => {
  for (const profilePath of [
    join(profilesPath, `${profileId}.yml`),
    join(profilesPath, `${profileId}.yaml`),
    join(profilesPath, profileId, 'profile.yml'),
  ]) {
    if (existsSync(profilePath)) {
      return profilePath;
    }
  }

  return join(profilesPath, profileId, 'profile.yml');
};

const createDefaultProfileIfMissing = (profilePath: string, profileId: string): boolean => {
  if (existsSync(profilePath)) {
    return false;
  }

  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, `id: ${profileId}\nlabel: Default\ncontrols: {}\n`);
  return true;
};

const persistWelcomeProfileForSetup = (
  input: SetupCommandInput,
  settingsPath: string,
  welcomeResult: WelcomeCommandResult | undefined,
): PersistedFirstRunWelcomeProfile | undefined =>
  persistFirstRunWelcomeProfile(input.homeDirectory, settingsPath, welcomeResult, {
    sourceProfileDirectory: findWelcomeSourceProfileDirectory(input, welcomeResult?.selectedRole?.id),
  });

const findWelcomeSourceProfileDirectory = (
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

const runWelcomeAfterInteractiveSetup = async (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies,
): Promise<WelcomeCommandResult | undefined> => {
  if (dependencies.interactive !== true) {
    return undefined;
  }

  if (dependencies.runWelcome !== undefined) {
    return dependencies.runWelcome(input, dependencies);
  }

  return executeWelcomeCommand(input, dependencies);
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
    throw new Error('`outfitter setup` requires an interactive TTY on both stdin and stdout.');
  }
};

const shouldSkipInitialDefaultProfilePrompt = (
  initialSettingsMissing: boolean,
  dependencies: SetupCommandDependencies,
): boolean => initialSettingsMissing && dependencies.interactive === true;

/* v8 ignore next -- default process stdout is direct terminal behavior; tests inject writable streams. */
const resolveReadlineOutput = (dependencies: SetupCommandDependencies): NodeJS.WritableStream =>
  typeof dependencies.output?.write === 'function' ? dependencies.output : process.stdout;

const resolvePromptOutput = (dependencies: SetupCommandDependencies): Pick<NodeJS.WritableStream, 'write'> => {
  if (typeof dependencies.output?.write === 'function') {
    return dependencies.output;
  }

  if (dependencies.writeLine !== undefined) {
    return {
      write(message: string) {
        dependencies.writeLine?.(message.replace(/\n$/u, ''));
        return true;
      },
    };
  }

  /* v8 ignore next 7 -- defensive non-writable injected output fallback; normal tests inject writeLine or writable output. */
  if (dependencies.output !== undefined) {
    return {
      write() {
        return true;
      },
    };
  }

  return process.stdout;
};

const runSetupSourceOnboarding = async (
  input: SetupCommandInput & { readonly setupSourceUri: string },
  dependencies: SetupCommandDependencies,
  starterLayout: StarterLayout,
  currentDefault: string,
): Promise<SetupSourceOnboardingResult> => {
  const discoveredProfiles = discoverSetupProfileChoices(input, starterLayout);
  const sourceDefault = discoverSetupSourcePromptDefault(input, starterLayout, discoveredProfiles);
  const promptDefault = chooseSetupPromptDefault(discoveredProfiles, sourceDefault, currentDefault);
  const profiles = selectSetupPromptProfiles(discoveredProfiles, currentDefault, promptDefault);
  const localSymlinkAvailable = resolveLocalSetupSourceOutfitterPath(input) !== undefined;

  if (
    dependencies.selectSetupSourceImportTarget === undefined &&
    dependencies.selectDefaultProfile === undefined &&
    dependencies.selectSetupSourceImportMode === undefined
  ) {
    return promptForSetupSourceOnboarding(input, profiles, promptDefault, localSymlinkAvailable, dependencies);
  }

  writeSetupSourceWelcome(input, profiles, resolvePromptOutput(dependencies));
  const importTarget = await selectSetupSourceImportTarget(dependencies);
  const importMode = await selectSetupSourceImportMode(dependencies, localSymlinkAvailable);
  const selectedProfileId = await selectSetupProfile(profiles, promptDefault, dependencies);
  assertValidSelectedDefaultProfile(selectedProfileId, profiles);

  return { importTarget, selectedProfileId, importMode };
};

/* v8 ignore start -- readline fallback is smoke-tested through terminal streams; injected selector paths carry deterministic setup-source coverage. */
const promptForSetupSourceOnboarding = async (
  input: SetupCommandInput & { readonly setupSourceUri: string },
  profiles: readonly SetupProfileChoice[],
  currentDefault: string,
  localSymlinkAvailable: boolean,
  dependencies: SetupCommandDependencies,
): Promise<SetupSourceOnboardingResult> => {
  const output = resolvePromptOutput(dependencies);
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({
    input: dependencies.input ?? process.stdin,
    output: resolveReadlineOutput(dependencies),
  });

  try {
    writeSetupSourceWelcome(input, profiles, output);
    const importTarget = await promptForSetupSourceImportTargetWithReadline(
      readline,
      output,
      setupSourceImportTargetChoices,
      'home',
    );
    const importMode = await promptForSetupSourceImportModeWithReadline(readline, output, localSymlinkAvailable);
    const selectedProfileId = await promptForSetupProfileWithReadline(
      readline,
      output,
      profiles,
      currentDefault,
      'Choose the default profile from this setup source:',
    );
    assertValidSelectedDefaultProfile(selectedProfileId, profiles);

    return { importTarget, selectedProfileId, importMode };
  } finally {
    readline.close();
  }
};

const writeSetupSourceWelcome = (
  input: SetupCommandInput & { readonly setupSourceUri: string },
  profiles: readonly SetupProfileChoice[],
  output: Pick<NodeJS.WritableStream, 'write'>,
): void => {
  writeWelcomeIntro(output);
  output.write(
    `\nYou're importing Outfitter profiles from ${redactProfileSourceUriCredentials(input.setupSourceUri)}.\n`,
  );
  output.write(`Found ${profiles.length} profile(s)${formatSetupSourceProfileList(profiles)}.\n`);

  if (resolveLocalSetupSourceOutfitterPath(input) !== undefined) {
    output.write(
      'Local setup source detected. Copy snapshot setup is safest; symlink setup links your target .outfitter to the local source .outfitter so shared-profile edits apply immediately during development.\n',
    );
  }
};

const formatSetupSourceProfileList = (profiles: readonly SetupProfileChoice[]): string => {
  /* v8 ignore next -- setup-source profile prompts normally require discovered source profiles. */
  if (profiles.length === 0) {
    return '';
  }

  return `: ${profiles.map((profile) => profile.id).join(', ')}`;
};

const selectSetupSourceImportTarget = async (
  dependencies: SetupCommandDependencies,
): Promise<SetupSourceImportTarget> => {
  /* v8 ignore else -- mixed dependency injection path; the full readline path prompts with one shared readline. */
  if (dependencies.selectSetupSourceImportTarget !== undefined) {
    const selectedTarget = await dependencies.selectSetupSourceImportTarget(setupSourceImportTargetChoices, 'home');
    assertValidSetupSourceImportTarget(selectedTarget);
    return selectedTarget;
  }

  return 'home';
};

const selectSetupSourceImportMode = async (
  dependencies: SetupCommandDependencies,
  localSymlinkAvailable: boolean,
): Promise<SetupSourceImportMode> => {
  if (!localSymlinkAvailable) {
    return 'copy';
  }

  if (dependencies.selectSetupSourceImportMode !== undefined) {
    const selectedMode = await dependencies.selectSetupSourceImportMode(setupSourceImportModeChoices, 'copy');
    assertValidSetupSourceImportMode(selectedMode);
    return selectedMode;
  }

  return 'copy';
};

const assertValidSetupSourceImportMode = (mode: SetupSourceImportMode): void => {
  if (setupSourceImportModeChoices.every((choice) => choice.mode !== mode)) {
    throw new Error(`Selected setup-source import mode '${mode}' is not available.`);
  }
};

const assertValidSetupSourceImportTarget = (target: SetupSourceImportTarget): void => {
  /* v8 ignore next -- defensive validation for custom dependency injection. */
  if (setupSourceImportTargetChoices.every((choice) => choice.target !== target)) {
    throw new Error(`Selected setup-source import target '${target}' is not available.`);
  }
};

const promptForSetupSourceImportTargetWithReadline = async (
  readline: { question(query: string): Promise<string> },
  output: Pick<NodeJS.WritableStream, 'write'>,
  choices: readonly SetupSourceImportTargetChoice[],
  defaultTarget: SetupSourceImportTarget,
): Promise<SetupSourceImportTarget> => {
  output.write('\nChoose where to install these profiles:\n');
  choices.forEach((choice, index) => {
    output.write(`${index + 1}. ${choice.label}\n`);
    output.write(`   ${choice.description}.\n`);
  });

  const defaultIndex = Math.max(
    choices.findIndex((choice) => choice.target === defaultTarget),
    0,
  );
  const answer = await readline.question(`Import target [${defaultIndex + 1}]: `);
  const selectedIndex = Number.parseInt(answer.trim() || String(defaultIndex + 1), 10) - 1;
  const selectedChoice = choices[selectedIndex];

  if (selectedChoice === undefined) {
    throw new Error('Selected setup-source import target number is out of range.');
  }

  return selectedChoice.target;
};

const promptForSetupSourceImportModeWithReadline = async (
  readline: { question(query: string): Promise<string> },
  output: Pick<NodeJS.WritableStream, 'write'>,
  localSymlinkAvailable: boolean,
): Promise<SetupSourceImportMode> => {
  if (!localSymlinkAvailable) {
    return 'copy';
  }

  output.write('\nChoose how to install this local setup source:\n');
  setupSourceImportModeChoices.forEach((choice, index) => {
    output.write(`${index + 1}. ${choice.label}\n`);
    output.write(`   ${choice.description}.\n`);
  });

  const answer = await readline.question('Import mode [1]: ');
  const selectedIndex = Number.parseInt(answer.trim() || '1', 10) - 1;
  const selectedChoice = setupSourceImportModeChoices[selectedIndex];

  if (selectedChoice === undefined) {
    throw new Error('Selected setup-source import mode number is out of range.');
  }

  return selectedChoice.mode;
};

/* v8 ignore next -- covered by interactive CLI smoke tests; unit tests inject the launch choice. */
const promptForSetupSourceLaunchAction = async (
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
  dependencies: SetupCommandDependencies,
): Promise<SetupSourcePostImportAction> => {
  const readline = createInterface({
    input: dependencies.input ?? process.stdin,
    output: resolveReadlineOutput(dependencies),
  });

  try {
    const prompt =
      launchTarget === 'selected'
        ? `Start Outfitter with profile '${profileId}' now? [Y/n]: `
        : 'Start Outfitter with the current default profile now? [Y/n]: ';
    const answer = await readline.question(prompt);
    return answer.trim().toLowerCase().startsWith('n') ? 'exit' : 'start';
  } finally {
    readline.close();
  }
};

/* v8 ignore stop */
const selectDefaultProfileIfInteractive = async (
  input: SetupCommandInput,
  settingsPath: string,
  currentDefault: string,
  dependencies: SetupCommandDependencies,
  starterLayout?: StarterLayout,
): Promise<string> => {
  if (dependencies.interactive !== true) {
    return currentDefault;
  }

  const discoveredProfiles = discoverSetupProfileChoices(input, starterLayout);
  const sourceDefault = discoverSetupSourcePromptDefault(input, starterLayout, discoveredProfiles);
  const promptDefault = chooseSetupPromptDefault(discoveredProfiles, sourceDefault, currentDefault);
  const profiles = selectSetupPromptProfiles(discoveredProfiles, currentDefault, promptDefault);
  writeWelcomeIntro(resolvePromptOutput(dependencies));
  const selectedProfile = await selectSetupProfile(profiles, promptDefault, dependencies);
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

const discoverSetupSourcePromptDefault = (
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

const selectSetupPromptProfiles = (
  discoveredProfiles: readonly SetupProfileChoice[],
  currentDefault: string,
  promptDefault: string,
): readonly SetupProfileChoice[] => {
  const profiles = discoveredProfiles.length > 0 ? discoveredProfiles : [{ id: currentDefault }];
  return prioritizeSetupProfileChoice(profiles, promptDefault);
};

const chooseSetupPromptDefault = (
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

const discoverSetupProfileChoices = (
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
  const output = resolvePromptOutput(dependencies);
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({
    input: dependencies.input ?? process.stdin,
    output: resolveReadlineOutput(dependencies),
  });

  try {
    return await promptForSetupProfileWithReadline(
      readline,
      output,
      profiles,
      currentDefault,
      'Choose the default profile for your sessions:',
    );
  } finally {
    readline.close();
  }
};

const promptForSetupProfileWithReadline = async (
  readline: { question(query: string): Promise<string> },
  output: Pick<NodeJS.WritableStream, 'write'>,
  profiles: readonly SetupProfileChoice[],
  currentDefault: string,
  heading: string,
): Promise<string> => {
  const candidates = profiles.length > 0 ? profiles : [{ id: currentDefault }];
  output.write(`\n${heading}\n`);
  candidates.forEach((profile, index) => {
    const label = profile.label === undefined ? '' : ` - ${profile.label}`;
    output.write(`${index + 1}. ${profile.id}${label}\n`);
    if (profile.description !== undefined) {
      output.write(`   ${profile.description}\n`);
    }
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
};

export { updateSettingsDefaultProfile };

const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;
