// Decides whether a run should enter Pi-native first-run onboarding and prepares its inputs.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  builtinStarterProfileId,
  createBuiltinProfilesCachePath,
  materializeBuiltinProfiles,
} from '../../../profiles/BuiltinProfiles.js';
import type { RunCommandDependencies, RunCommandInput } from '../RunCommand.js';
import { isNonInteractivePiLaunch } from '../PiLoginLaunch.js';
import { createGitSynchronizer, syncProfileSource, type RemoteProfileSource } from '../SyncCommand.js';
import { selectRunAgentId } from './RunProfileResolution.js';

export interface FirstRunRuntimeOnboarding {
  readonly defaultProfilesPath: string;
}

export const defaultProfilesSource = {
  github: 'ai-outfitter/default-profiles',
  path: 'profiles',
} as const satisfies RemoteProfileSource;

export const prepareFirstRunRuntimeOnboarding = (
  input: RunCommandInput,
  dependencies: RunCommandDependencies,
): FirstRunRuntimeOnboarding | undefined => {
  if (!shouldUsePiNativeFirstRunOnboarding(input, dependencies)) {
    return undefined;
  }

  const syncResult = syncProfileSource(
    input.homeDirectory,
    defaultProfilesSource,
    dependencies.synchronizer ?? createGitSynchronizer(resolveRunProgressWriter(dependencies)),
  );

  // Degraded-mode onboarding (OFTR-010.6): when the first-run default catalog sync fails,
  // continue with the bundled built-in profile and warn; `outfitter sync` upgrades later.
  if (syncResult.status === 'failed') {
    (dependencies.writeError ?? console.error)(formatDegradedOnboardingWarning(syncResult.message));
    const builtinProfilesPath = createBuiltinProfilesCachePath(input.homeDirectory);
    materializeBuiltinProfiles(builtinProfilesPath);

    return { defaultProfilesPath: builtinProfilesPath };
  }

  return { defaultProfilesPath: join(syncResult.cachePath, defaultProfilesSource.path) };
};

export const formatDegradedOnboardingWarning = (failureMessage: string): string =>
  `Warning: could not sync the default profiles source github:${defaultProfilesSource.github} (${failureMessage}). ` +
  `Continuing with the built-in '${builtinStarterProfileId}' profile; run \`outfitter sync\` to fetch the full catalog once the source is reachable.`;

const shouldUsePiNativeFirstRunOnboarding = (input: RunCommandInput, dependencies: RunCommandDependencies): boolean => {
  if (input.forceRuntimeOnboarding !== true && existsSync(join(input.homeDirectory, '.outfitter', 'settings.yml'))) {
    return false;
  }

  const selectedAgentId = dependencies.adapter?.id ?? selectRunAgentId(input.agentId, undefined);

  /* v8 ignore next -- explicit profile/non-pi paths are covered by normal run command selection tests. */
  if (input.profileId !== undefined || selectedAgentId !== 'pi') {
    return false;
  }

  if (isNonInteractivePiLaunch(input.passThroughArgs ?? [])) {
    return false;
  }

  return isInteractiveRunLaunch(dependencies);
};

// Network/build steps (catalog clones, extension caching) report per-source progress through this
// writer so first boot never stalls silently before launch.
export const resolveRunProgressWriter = (dependencies: RunCommandDependencies): ((message: string) => void) =>
  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject writeLine. */
  dependencies.writeLine ?? console.log;

export const isInteractiveRunLaunch = (dependencies: RunCommandDependencies): boolean => {
  if (dependencies.interactive !== undefined) {
    return dependencies.interactive;
  }

  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const inputIsTty = (dependencies.input ?? process.stdin).isTTY === true;
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const outputIsTty = (dependencies.output ?? process.stdout).isTTY === true;

  return inputIsTty && outputIsTty;
};
