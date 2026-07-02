// Provides the command object for first-run Outfitter setup.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Command } from 'commander';

import { builtinStarterProfileId, materializeBuiltinProfiles } from '../../profiles/BuiltinProfiles.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../settings/SettingsLoader.js';
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
  buildSetupMessages,
  formatHiddenHomeImportMessage,
  formatRunProfileExample,
  formatSetupSourceExitMessages,
} from './setup/SetupMessages.js';
import {
  assertValidDefaultProfileId,
  canResolveProfileForLaunch,
  ensureExistingUserSettingsDefaultProfile,
  findWelcomeSourceProfileDirectory,
  readUserDefaultProfileId,
} from './setup/SetupProfileDiscovery.js';
import {
  selectDefaultProfileIfInteractive,
  selectSetupSourceLaunchAction,
  runSetupSourceOnboarding,
} from './setup/SetupPrompts.js';
import {
  applySetupSourceImport,
  copyStarterProfileFilesIfPresent,
  createDefaultProfileIfMissing,
  findSetupProfilePath,
} from './setup/SetupSourceImport.js';
import {
  prepareStarterLayout,
  readStarterDefaultProfileId,
  readStarterSettingsContent,
} from './setup/SetupStarterLayout.js';
import { formatSettingsIssue } from './setup/SetupTypes.js';
import type {
  SetupCommandDependencies,
  SetupCommandInput,
  SetupCommandResult,
  SetupPiOnboardingLaunchInput,
  SetupSourceImportTarget,
  SetupSourcePostImportAction,
  SetupSourcePostImportLaunchTarget,
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

export { updateSettingsDefaultProfile };

export const executeSetupCommand = async (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies = {},
): Promise<SetupCommandResult> => {
  requireInteractiveTerminalIfNeeded(dependencies);
  const settingsPath = join(input.homeDirectory, '.outfitter', 'settings.yml');
  const initialSettingsMissing = !existsSync(settingsPath);
  const starterLayout = prepareStarterLayoutIfRequested(input, dependencies);
  const loadedSettingsFiles = loadValidatedSetupSettingsFiles(input);

  const defaultProfileId = initialSettingsMissing
    ? readStarterDefaultProfileId(starterLayout?.settingsPath)
    : readUserDefaultProfileId(loadedSettingsFiles);
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

  return executeStandardSetupCommand({
    input,
    dependencies,
    settingsPath,
    initialSettingsMissing,
    starterLayout,
    defaultProfileId,
    loadedSettingsFiles,
  });
};

const prepareStarterLayoutIfRequested = (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies,
): StarterLayout | undefined =>
  input.setupSourceUri === undefined
    ? undefined
    : prepareStarterLayout(
        input.homeDirectory,
        input.projectDirectory,
        input.setupSourceUri,
        dependencies.setupSourceSynchronizer,
      );

type LoadedSetupSettingsFiles = ReturnType<typeof loadSettings>['files'];

const loadValidatedSetupSettingsFiles = (input: SetupCommandInput): LoadedSetupSettingsFiles => {
  const loadedSettings = loadSettings(discoverSettingsLoadPlan(input));

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot setup with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  return loadedSettings.files;
};

interface StandardSetupCommandState {
  readonly input: SetupCommandInput;
  readonly dependencies: SetupCommandDependencies;
  readonly settingsPath: string;
  readonly initialSettingsMissing: boolean;
  readonly starterLayout: StarterLayout | undefined;
  readonly defaultProfileId: string;
  readonly loadedSettingsFiles: LoadedSetupSettingsFiles;
}

const executeStandardSetupCommand = async (state: StandardSetupCommandState): Promise<SetupCommandResult> => {
  const { input, dependencies, settingsPath, initialSettingsMissing, starterLayout, defaultProfileId } = state;
  const createdSettings = createInitialSettingsIfMissing(settingsPath, starterLayout?.settingsPath);
  ensureExistingUserSettingsDefaultProfile(settingsPath, state.loadedSettingsFiles, defaultProfileId);
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
  const selectedDefaultProfileId = await chooseStandardDefaultProfileId(state, syncFallback);
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

const chooseStandardDefaultProfileId = async (
  state: StandardSetupCommandState,
  syncFallback: InitialDefaultProfileSyncFallback,
): Promise<string> => {
  if (syncFallback.degraded && state.input.setupSourceUri === undefined) {
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

const defaultProfilesSourceUri = 'git+https://github.com/ai-outfitter/default-profiles.git:profiles';

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
  const appliedImport = applySetupSourceImport(input, starterLayout, onboarding);
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

const persistWelcomeProfileForSetup = (
  input: SetupCommandInput,
  settingsPath: string,
  welcomeResult: WelcomeCommandResult | undefined,
): PersistedFirstRunWelcomeProfile | undefined =>
  persistFirstRunWelcomeProfile(input.homeDirectory, settingsPath, welcomeResult, {
    sourceProfileDirectory: findWelcomeSourceProfileDirectory(input, welcomeResult?.selectedRole?.id),
  });

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
