// Provides deterministic Settings merge scaffolding.
import { mergeObjectsWithPolicy } from '../merge/SettingsValueMerger.js';
import type { CustomSettings, Settings } from './Settings.js';
import { emptySettings } from './Settings.js';

export const mergeSettingsStack = (settingsStack: readonly Settings[]): Settings => {
  let defaultProfile: string | undefined;
  let defaultAgent: string | undefined;
  let profileSources: Settings['profileSources'];
  let remoteSettings: Settings['remoteSettings'];
  let cacheDirectory: string | undefined;
  let customSettings: CustomSettings | undefined;

  for (const settings of settingsStack) {
    defaultProfile = settings.defaultProfile ?? defaultProfile;
    defaultAgent = settings.defaultAgent ?? defaultAgent;

    profileSources = settings.profileSources ?? profileSources;
    remoteSettings = settings.remoteSettings ?? remoteSettings;
    cacheDirectory = settings.cacheDirectory ?? cacheDirectory;
    customSettings = mergeOptionalCustomSettings(customSettings, settings.customSettings);
  }

  return {
    ...emptySettings(),
    defaultProfile,
    defaultAgent,
    profileSources: profileSources ?? [],
    remoteSettings: remoteSettings ?? [],
    cacheDirectory,
    customSettings: customSettings ?? {},
  };
};

const mergeOptionalCustomSettings = (
  lowerPrecedence: CustomSettings | undefined,
  higherPrecedence: CustomSettings | undefined,
): CustomSettings | undefined =>
  higherPrecedence === undefined ? lowerPrecedence : mergeCustomSettings(lowerPrecedence, higherPrecedence);

const mergeCustomSettings = (
  lowerPrecedence: CustomSettings | undefined,
  higherPrecedence: CustomSettings,
): CustomSettings => mergeObjectsWithPolicy(lowerPrecedence, higherPrecedence);
