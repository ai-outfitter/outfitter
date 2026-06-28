// Provides deterministic Settings merge scaffolding.
import { mergeObjectsWithPolicy } from '../merge/SettingsValueMerger.js';
import type { CustomSettings, Settings } from './Settings.js';
import { emptySettings } from './Settings.js';

// Settings precedence is easier to audit as a direct field-by-field merge.
// eslint-disable-next-line complexity
export const mergeSettingsStack = (settingsStack: readonly Settings[]): Settings => {
  let defaultProfile: string | undefined;
  let defaultAgent: string | undefined;
  let defaultLaunchBackend: Settings['defaultLaunchBackend'];
  let profileSources: Settings['profileSources'];
  let remoteSettings: Settings['remoteSettings'];
  let cacheDirectory: string | undefined;
  let containerPolicy: Settings['containerPolicy'];
  let customSettings: CustomSettings | undefined;

  for (const settings of settingsStack) {
    defaultProfile = settings.defaultProfile ?? defaultProfile;
    defaultAgent = settings.defaultAgent ?? defaultAgent;
    defaultLaunchBackend = settings.defaultLaunchBackend ?? defaultLaunchBackend;

    profileSources = settings.profileSources ?? profileSources;
    remoteSettings = settings.remoteSettings ?? remoteSettings;
    cacheDirectory = settings.cacheDirectory ?? cacheDirectory;
    containerPolicy = settings.containerPolicy ?? containerPolicy;
    customSettings = mergeOptionalCustomSettings(customSettings, settings.customSettings);
  }

  return {
    ...emptySettings(),
    defaultProfile,
    defaultAgent,
    defaultLaunchBackend,
    profileSources: profileSources ?? [],
    remoteSettings: remoteSettings ?? [],
    cacheDirectory,
    containerPolicy: containerPolicy ?? { envPassthrough: [] },
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
