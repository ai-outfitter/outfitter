/* eslint-disable complexity */
// Provides deterministic Settings merge scaffolding.
import { mergeObjectsWithPolicy } from '../merge/SettingsValueMerger.js';
import type { CustomSettings, Settings, StatePersistence } from './Settings.js';
import { emptySettings } from './Settings.js';

export const mergeSettingsStack = (settingsStack: readonly Settings[]): Settings => {
  let defaultAgent: string | undefined;
  let defaultHarness: Settings['defaultHarness'];
  let claude: Settings['claude'];
  let sources: Settings['sources'];
  let remoteSettings: Settings['remoteSettings'];
  let cacheDirectory: string | undefined;
  let statePersistence: StatePersistence | undefined;
  let customSettings: CustomSettings | undefined;
  let startup: Settings['startup'];
  let enterprise: Settings['enterprise'];
  let telemetry: Settings['telemetry'];

  for (const settings of settingsStack) {
    defaultAgent = settings.defaultAgent ?? defaultAgent;
    defaultHarness = settings.defaultHarness ?? defaultHarness;
    claude = settings.claude === undefined ? claude : { ...claude, ...settings.claude };

    sources = settings.sources ?? sources;
    remoteSettings = settings.remoteSettings ?? remoteSettings;
    cacheDirectory = settings.cacheDirectory ?? cacheDirectory;
    statePersistence =
      settings.statePersistence === undefined
        ? statePersistence
        : { ...statePersistence, ...settings.statePersistence };
    customSettings = mergeOptionalCustomSettings(customSettings, settings.customSettings);
    startup = settings.startup === undefined ? startup : { ...startup, ...settings.startup };
    enterprise = settings.enterprise === undefined ? enterprise : { ...enterprise, ...settings.enterprise };
    telemetry = settings.telemetry === undefined ? telemetry : { ...telemetry, ...settings.telemetry };
  }

  return {
    ...emptySettings(),
    defaultAgent,
    defaultHarness,
    claude: claude ?? {},
    sources: sources ?? [],
    remoteSettings: remoteSettings ?? [],
    cacheDirectory,
    statePersistence: statePersistence ?? {},
    customSettings: customSettings ?? {},
    startup: startup ?? {},
    enterprise: enterprise ?? {},
    telemetry: telemetry ?? {},
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
