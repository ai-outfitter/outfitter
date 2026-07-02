// Builds the user-facing summary messages emitted by the setup command.
import { join } from 'node:path';

import { redactProfileSourceUriCredentials } from '../../../profiles/ProfileCache.js';
import type { SyncCommandResult } from '../SyncCommand.js';
import { canResolveProfileForLaunch } from './SetupProfileDiscovery.js';
import type {
  SetupCommandInput,
  SetupSourceImportTarget,
  SetupSourcePostImportLaunchTarget,
  StarterLayout,
} from './SetupTypes.js';

export interface SetupMessageInput {
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

export const buildSetupMessages = (input: SetupMessageInput): readonly string[] => {
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

export const formatRunProfileExample = (profileId: string): string =>
  `Start the selected default profile either way:\n  outfitter\n  outfitter --profile ${profileId}`;

const formatRunDefaultProfileExample = (): string => `Start the current default profile:\n  outfitter`;

export const formatSetupSourceExitMessages = (
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

export const formatHiddenHomeImportMessage = (profileId: string): string =>
  `Imported profile '${profileId}' into user home, but this project overrides profile_sources and does not expose ~/.outfitter/profiles. ` +
  'Import into the current project, add ~/.outfitter/profiles to project profile_sources, or run from a directory without project Outfitter settings.';
