/* eslint-disable complexity */
// Provides deterministic Settings merge scaffolding.
import { mergeObjectsWithPolicy } from '../merge/SettingsValueMerger.js';
import { promptSourceKey } from '../composer/PromptSource.js';
import type { AgentDefaults, CustomSettings, HarnessDefaults, Settings, StatePersistence } from './Settings.js';
import { emptySettings } from './Settings.js';

/** Folds one additive defaults list across the stack, collapsing duplicates to their first occurrence. */
const mergeDefaultsList = <T>(
  lower: readonly T[] | undefined,
  higher: readonly T[] | undefined,
  key: (entry: T) => string,
) => {
  if (lower === undefined && higher === undefined) return undefined;
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const entry of [...(lower ?? []), ...(higher ?? [])]) {
    const entryKey = key(entry);
    if (!seen.has(entryKey)) {
      seen.add(entryKey);
      merged.push(entry);
    }
  }
  return merged;
};

const mergeAgentDefaults = (lower: AgentDefaults | undefined, higher: AgentDefaults | undefined) => {
  if (lower === undefined && higher === undefined) return undefined;
  return {
    extensions: mergeDefaultsList(lower?.extensions, higher?.extensions, (entry) => entry),
    skills: mergeDefaultsList(lower?.skills, higher?.skills, (entry) => entry),
    mcp: mergeDefaultsList(lower?.mcp, higher?.mcp, (entry) => entry),
    plugins: mergeDefaultsList(lower?.plugins, higher?.plugins, (entry) => entry),
    subagents: mergeDefaultsList(lower?.subagents, higher?.subagents, (entry) => entry),
    appendSystemPrompt: mergeDefaultsList(lower?.appendSystemPrompt, higher?.appendSystemPrompt, promptSourceKey),
  };
};

export const mergeSettingsStack = (settingsStack: readonly Settings[]): Settings => {
  let defaultAgent: string | undefined;
  let defaultHarness: Settings['defaultHarness'];
  let isolation: Settings['isolation'];
  let sources: Settings['sources'];
  const workflows: string[] = [];
  let remoteSettings: Settings['remoteSettings'];
  let cacheDirectory: string | undefined;
  let sourceCache: Settings['sourceCache'];
  let statePersistence: StatePersistence | undefined;
  let customSettings: CustomSettings | undefined;
  let startup: Settings['startup'];
  let enterprise: Settings['enterprise'];
  let telemetry: Settings['telemetry'];
  let agentDefaults: AgentDefaults | undefined;
  let harnessDefaults: HarnessDefaults | undefined;

  for (const settings of settingsStack) {
    defaultAgent = settings.defaultAgent ?? defaultAgent;
    defaultHarness = settings.defaultHarness ?? defaultHarness;
    isolation = settings.isolation ?? isolation;

    sources = settings.sources ?? sources;
    for (const workflow of settings.workflows ?? []) {
      if (!workflows.includes(workflow)) workflows.push(workflow);
    }
    remoteSettings = settings.remoteSettings ?? remoteSettings;
    cacheDirectory = settings.cacheDirectory ?? cacheDirectory;
    sourceCache = settings.sourceCache === undefined ? sourceCache : { ...sourceCache, ...settings.sourceCache };
    statePersistence =
      settings.statePersistence === undefined
        ? statePersistence
        : { ...statePersistence, ...settings.statePersistence };
    customSettings = mergeOptionalCustomSettings(customSettings, settings.customSettings);
    startup = settings.startup === undefined ? startup : { ...startup, ...settings.startup };
    enterprise = settings.enterprise === undefined ? enterprise : { ...enterprise, ...settings.enterprise };
    telemetry = settings.telemetry === undefined ? telemetry : { ...telemetry, ...settings.telemetry };
    agentDefaults = mergeAgentDefaults(agentDefaults, settings.agentDefaults);
    harnessDefaults =
      settings.harnessDefaults === undefined
        ? harnessDefaults
        : mergeObjectsWithPolicy(harnessDefaults, settings.harnessDefaults);
  }

  return {
    ...emptySettings(),
    defaultAgent,
    defaultHarness,
    isolation,
    sources: sources ?? [],
    workflows,
    remoteSettings: remoteSettings ?? [],
    cacheDirectory,
    sourceCache: sourceCache ?? {},
    statePersistence: statePersistence ?? {},
    customSettings: customSettings ?? {},
    startup: startup ?? {},
    enterprise: enterprise ?? {},
    telemetry: telemetry ?? {},
    agentDefaults,
    harnessDefaults,
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
