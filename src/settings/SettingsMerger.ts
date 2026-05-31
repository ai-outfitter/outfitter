// Provides deterministic Settings merge scaffolding.
import type { Settings } from './Settings.js';
import { emptySettings } from './Settings.js';

export const mergeSettingsStack = (settingsStack: readonly Settings[]): Settings => {
  let defaultProfile: string | undefined;
  let profileSources: Settings['profileSources'];
  let remoteSettings: Settings['remoteSettings'];

  for (const settings of settingsStack) {
    defaultProfile = settings.defaultProfile ?? defaultProfile;

    if (settings.profileSources !== undefined) {
      profileSources = settings.profileSources;
    }

    if (settings.remoteSettings !== undefined) {
      remoteSettings = settings.remoteSettings;
    }
  }

  return {
    ...emptySettings(),
    defaultProfile,
    profileSources: profileSources ?? [],
    remoteSettings: remoteSettings ?? [],
  };
};
