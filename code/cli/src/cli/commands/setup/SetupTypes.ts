// Shared types and prompt-choice constants for the Outfitter setup command modules.
import type { SyncCommandDependencies, SyncCommandResult } from '../SyncCommand.js';
import type { WelcomeCommandDependencies, WelcomeCommandResult } from '../WelcomeCommand.js';

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

export type SetupSourcePostImportLaunchTarget = 'selected' | 'default';

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

export const setupSourceImportModeChoices: readonly SetupSourceImportModeChoice[] = [
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

export const setupSourceImportTargetChoices: readonly SetupSourceImportTargetChoice[] = [
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

export interface StarterLayout {
  readonly cachePath: string;
  readonly settingsPath?: string;
  readonly profilesPath?: string;
  readonly sourceKind: 'local-live' | 'remote-cache';
  readonly sourceOutfitterPath?: string;
}

export interface SetupSourceOnboardingResult {
  readonly importTarget: SetupSourceImportTarget;
  readonly selectedProfileId: string;
  readonly importMode: SetupSourceImportMode;
}

export const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;
