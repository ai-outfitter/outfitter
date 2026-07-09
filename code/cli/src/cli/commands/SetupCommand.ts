// Provides the command object for first-run Outfitter setup.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import { builtinStarterProfileId, materializeBuiltinProfiles } from '../../profiles/BuiltinProfiles.js';
import { redactProfileSourceUriCredentials } from '../../profiles/ProfileCache.js';
import { loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import {
  discoverSettingsLoadPlan,
  loadSettings,
  loadSettingsWithCachedRemoteSettings,
} from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';
import {
  persistFirstRunWelcomeProfile,
  updateSettingsDefaultProfile,
  type PersistedFirstRunWelcomeProfile,
} from './FirstRunWelcomeProfile.js';
import { executeSyncCommand } from './SyncCommand.js';
import type { SyncCommandResult } from './SyncCommand.js';
import { executeWelcomeCommand } from './WelcomeCommand.js';
import type { WelcomeCommandResult } from './WelcomeCommand.js';
import {
  materializeSetupProfileSource,
  runSetupSourceOnboarding,
  selectDefaultProfileIfInteractive,
} from './setup/SetupPrompts.js';
import {
  applySetupSourceImport,
  copyStarterProfileFilesIfPresent,
  createDefaultProfileIfMissing,
  findSetupProfilePath,
} from './setup/SetupSourceImport.js';
import {
  formatRunProfileExample,
  formatSetupSourceExitMessages,
  runSetupSourcePostImportAction,
} from './setup/SetupSourceLaunch.js';
import {
  assertValidDefaultProfileId,
  createInitialSettingsIfMissing,
  ensureExistingUserSettingsDefaultProfile,
  prepareStarterLayout,
  readStarterDefaultProfileId,
  readUserDefaultProfileId,
} from './setup/SetupStarterSource.js';
import { formatSettingsIssue } from './setup/SetupTypes.js';
import type {
  AppliedSetupSourceImport,
  SetupCommandDependencies,
  SetupCommandInput,
  SetupCommandResult,
  SetupPiOnboardingLaunchInput,
  StarterLayout,
} from './setup/SetupTypes.js';

export type {
  SetupCommandDependencies,
  SetupCommandInput,
  SetupCommandResult,
  SetupPiOnboardingLaunchInput,
  SetupProfileChoice,
  SetupSourceImportMode,
  SetupSourceImportModeChoice,
  SetupSourceImportTarget,
  SetupSourceImportTargetChoice,
  SetupSourceLaunchInput,
  SetupSourcePostImportAction,
  SetupSourcePostImportLaunchTarget,
  SetupSourceSynchronizer,
} from './setup/SetupTypes.js';
export { createDefaultSettingsContent } from './setup/SetupStarterSource.js';
export { updateSettingsDefaultProfile };

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
  const syncResult = executeSyncCommand(input, dependencies);
  const syncFallback = fallBackToBuiltinProfilesOnInitialSyncFailure(
    join(input.homeDirectory, '.outfitter', 'profiles'),
    initialSettingsMissing,
    syncResult,
  );
  const selectedDefaultProfileId = await chooseSetupDefaultProfileId({
    input,
    dependencies,
    settingsPath,
    initialSettingsMissing,
    starterLayout,
    defaultProfileId,
    syncFallback,
  });
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
      syncWarningMessages: syncFallback.warnings,
      welcomeProfileMessages: welcomeProfile?.messages ?? [],
      runExampleMessages: input.setupSourceUri === undefined ? [] : [formatRunProfileExample(finalDefaultProfile.id)],
    }),
  };
};
/* eslint-enable complexity */

const defaultProfilesSourceUri = 'git+https://github.com/ai-outfitter/default-profiles.git:profiles';

interface SetupDefaultProfileChoiceInput {
  readonly input: SetupCommandInput;
  readonly dependencies: SetupCommandDependencies;
  readonly settingsPath: string;
  readonly initialSettingsMissing: boolean;
  readonly starterLayout: StarterLayout | undefined;
  readonly defaultProfileId: string;
  readonly syncFallback: InitialDefaultProfileSyncFallback;
}

const chooseSetupDefaultProfileId = async (state: SetupDefaultProfileChoiceInput): Promise<string> => {
  if (state.syncFallback.degraded && state.input.setupSourceUri === undefined) {
    return applyDegradedDefaultProfile(state.settingsPath);
  }

  if (shouldSkipInitialDefaultProfilePrompt(state.initialSettingsMissing, state.dependencies)) {
    return state.defaultProfileId;
  }

  return selectDefaultProfileIfInteractive(
    state.input,
    state.settingsPath,
    state.defaultProfileId,
    state.dependencies,
    state.starterLayout,
  );
};

const applyDegradedDefaultProfile = (settingsPath: string): string => {
  updateSettingsDefaultProfile(settingsPath, builtinStarterProfileId);
  return builtinStarterProfileId;
};

interface InitialDefaultProfileSyncFallback {
  readonly degraded: boolean;
  readonly warnings: readonly string[];
}

// Degraded-mode onboarding (OFTR-010.6): when the first-run default catalog sync fails, install
// the bundled built-in profile and warn instead of failing; `outfitter sync` upgrades later.
const fallBackToBuiltinProfilesOnInitialSyncFailure = (
  profilesPath: string,
  initialSettingsMissing: boolean,
  syncResult: SyncCommandResult,
): InitialDefaultProfileSyncFallback => {
  if (!initialSettingsMissing) {
    return { degraded: false, warnings: [] };
  }

  const failedDefaultProfilesSource = syncResult.sources.find(
    (source) => source.uri === defaultProfilesSourceUri && source.status === 'failed',
  );

  if (failedDefaultProfilesSource === undefined) {
    return { degraded: false, warnings: [] };
  }

  materializeBuiltinProfiles(profilesPath);

  return {
    degraded: true,
    warnings: [
      `Warning: the default profiles source ${failedDefaultProfilesSource.uri} failed to sync: ${failedDefaultProfilesSource.message}. ` +
        `Installed the built-in '${builtinStarterProfileId}' profile instead; run \`outfitter sync\` to fetch the full catalog once the source is reachable.`,
    ],
  };
};

interface InteractiveSetupSourceCommandInput {
  readonly input: SetupCommandInput & { readonly setupSourceUri: string };
  readonly dependencies: SetupCommandDependencies;
  readonly homeSettingsPath: string;
  readonly initialSettingsMissing: boolean;
  readonly starterLayout: StarterLayout;
  readonly currentDefaultProfileId: string;
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
  const appliedImport: AppliedSetupSourceImport = applySetupSourceImport(input, starterLayout, onboarding);
  const syncResult = executeSyncCommand(input, dependencies);
  const syncFallback = fallBackToBuiltinProfilesOnInitialSyncFailure(
    appliedImport.profilesPath,
    initialSettingsMissing && appliedImport.settingsPath === homeSettingsPath,
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
      syncWarningMessages: syncFallback.warnings,
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
  readonly syncWarningMessages: readonly string[];
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
    ...input.syncWarningMessages,
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
