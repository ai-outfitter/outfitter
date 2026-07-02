// First-run onboarding for `outfitter run`: routes fresh machines into the pi-native
// bootstrap flow or the terminal-side claude profile picker, sharing the default-catalog
// sync and the degraded-offline builtin fallback between both paths.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';

import { defaultAgentId as registryDefaultAgentId } from '../../../agents/AgentRegistry.js';
import {
  builtinStarterProfileId,
  createBuiltinProfilesCachePath,
  materializeBuiltinProfiles,
} from '../../../profiles/BuiltinProfiles.js';
import { loadLocalProfileSource } from '../../../profiles/ProfileLoader.js';
import { isNonInteractivePiLaunch } from '../PiLoginLaunch.js';
import { createDefaultSettingsContent } from '../SetupCommand.js';
import { assertValidDefaultProfileId, chooseSetupPromptDefault } from '../setup/SetupProfileDiscovery.js';
import { promptForSetupProfileWithReadline, resolvePromptOutput } from '../setup/SetupPrompts.js';
import type { SetupProfileChoice } from '../setup/SetupTypes.js';
import { createGitSynchronizer, syncProfileSource, type RemoteProfileSource } from '../SyncCommand.js';
import { writeWelcomeIntro } from '../WelcomeCommand.js';
import type { RunCommandDependencies, RunCommandInput } from '../RunCommand.js';

export interface FirstRunRuntimeOnboarding {
  readonly defaultProfilesPath: string;
}

export const defaultProfilesSource = {
  github: 'ai-outfitter/default-profiles',
  path: 'profiles',
} as const satisfies RemoteProfileSource;

// Network/build steps (catalog clones, extension caching) report per-source progress through this
// writer so first boot never stalls silently before launch.
export const resolveRunProgressWriter = (dependencies: RunCommandDependencies): ((message: string) => void) =>
  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject writeLine. */
  dependencies.writeLine ?? console.log;

export const selectRunAgentId = (selectedAgentId: string | undefined, defaultAgentId: string | undefined): string =>
  selectedAgentId ?? defaultAgentId ?? registryDefaultAgentId;

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

  if (syncResult.status === 'failed') {
    (dependencies.writeError ?? console.error)(formatDegradedOnboardingWarning(syncResult.message));
    const builtinProfilesPath = createBuiltinProfilesCachePath(input.homeDirectory);
    materializeBuiltinProfiles(builtinProfilesPath);

    return { defaultProfilesPath: builtinProfilesPath };
  }

  return { defaultProfilesPath: join(syncResult.cachePath, defaultProfilesSource.path) };
};

const formatDegradedOnboardingWarning = (failureMessage: string): string =>
  `Warning: could not sync the default profiles source github:${defaultProfilesSource.github} (${failureMessage}). ` +
  `Continuing with the built-in '${builtinStarterProfileId}' profile; run \`outfitter sync\` to fetch the full catalog once the source is reachable.`;

const shouldUsePiNativeFirstRunOnboarding = (input: RunCommandInput, dependencies: RunCommandDependencies): boolean => {
  if (input.forceRuntimeOnboarding !== true && hasUserSettings(input.homeDirectory)) {
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

const hasUserSettings = (homeDirectory: string): boolean =>
  existsSync(join(homeDirectory, '.outfitter', 'settings.yml'));

// Claude Code has no pi-tui equivalent for embedded onboarding UI, so first runs with
// `--agent claude` finish profile setup with a terminal-side picker before launching claude.
export const runClaudeFirstRunOnboardingIfNeeded = async (
  input: RunCommandInput,
  dependencies: RunCommandDependencies,
): Promise<void> => {
  if (!shouldUseClaudeFirstRunOnboarding(input, dependencies)) {
    return;
  }

  const catalog = syncClaudeFirstRunProfileCatalog(input, dependencies);
  const profiles = discoverClaudeFirstRunProfileChoices(catalog.profilesPath);
  const promptDefault = chooseSetupPromptDefault(profiles, 'founder', builtinStarterProfileId);
  const selectedProfileId = await selectClaudeFirstRunProfile(profiles, promptDefault, dependencies);
  assertValidSelectedClaudeProfile(selectedProfileId, profiles);
  writeClaudeFirstRunSettings(input.homeDirectory, selectedProfileId);
  resolveRunProgressWriter(dependencies)(
    `Saved ~/.outfitter/settings.yml with default profile '${selectedProfileId}' and default agent 'claude'.`,
  );
};

const shouldUseClaudeFirstRunOnboarding = (input: RunCommandInput, dependencies: RunCommandDependencies): boolean => {
  if (hasUserSettings(input.homeDirectory)) {
    return false;
  }

  const selectedAgentId = dependencies.adapter?.id ?? selectRunAgentId(input.agentId, undefined);

  if (input.profileId !== undefined || selectedAgentId !== 'claude') {
    return false;
  }

  if (isNonInteractiveClaudeLaunch(input.passThroughArgs ?? [])) {
    return false;
  }

  return isInteractiveRunLaunch(dependencies);
};

// `--print`/`-p` launches are claude's non-interactive mode: no picker, no settings writes.
const isNonInteractiveClaudeLaunch = (args: readonly string[]): boolean =>
  args.some((arg) => arg === '--print' || arg === '-p');

interface ClaudeFirstRunProfileCatalog {
  readonly profilesPath: string;
}

const syncClaudeFirstRunProfileCatalog = (
  input: RunCommandInput,
  dependencies: RunCommandDependencies,
): ClaudeFirstRunProfileCatalog => {
  const syncResult = syncProfileSource(
    input.homeDirectory,
    defaultProfilesSource,
    dependencies.synchronizer ?? createGitSynchronizer(resolveRunProgressWriter(dependencies)),
  );

  if (syncResult.status === 'failed') {
    (dependencies.writeError ?? console.error)(formatDegradedOnboardingWarning(syncResult.message));
    // The written settings reference `./profiles` next to settings.yml, so the degraded
    // builtin starter materializes there (mirrors the setup command's degraded fallback).
    const localProfilesPath = join(input.homeDirectory, '.outfitter', 'profiles');
    materializeBuiltinProfiles(localProfilesPath);

    return { profilesPath: localProfilesPath };
  }

  return { profilesPath: join(syncResult.cachePath, defaultProfilesSource.path) };
};

const discoverClaudeFirstRunProfileChoices = (profilesPath: string): readonly SetupProfileChoice[] =>
  loadLocalProfileSource({ path: profilesPath })
    .profiles.filter((loadedProfile) => loadedProfile.profile.template !== true)
    .map((loadedProfile) => ({
      id: loadedProfile.profile.id,
      label: loadedProfile.profile.label,
      description: loadedProfile.profile.description,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

const selectClaudeFirstRunProfile = async (
  profiles: readonly SetupProfileChoice[],
  promptDefault: string,
  dependencies: RunCommandDependencies,
): Promise<string> => {
  if (dependencies.selectDefaultProfile !== undefined) {
    return dependencies.selectDefaultProfile(profiles, promptDefault);
  }

  return promptForClaudeFirstRunProfile(profiles, promptDefault, dependencies);
};

const promptForClaudeFirstRunProfile = async (
  profiles: readonly SetupProfileChoice[],
  promptDefault: string,
  dependencies: RunCommandDependencies,
): Promise<string> => {
  const output = resolvePromptOutput(dependencies);
  /* v8 ignore next 2 -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({
    input: dependencies.input ?? process.stdin,
    output: resolveClaudeReadlineOutput(dependencies),
  });

  try {
    writeWelcomeIntro(output);
    output.write("\nYou're setting up Outfitter for Claude Code.\n");
    return await promptForSetupProfileWithReadline(
      readline,
      output,
      profiles,
      promptDefault,
      'Choose the default profile for your sessions:',
    );
  } finally {
    readline.close();
  }
};

/* v8 ignore next 2 -- default process stdout is direct terminal behavior; tests inject writable streams. */
const resolveClaudeReadlineOutput = (dependencies: RunCommandDependencies): NodeJS.WritableStream =>
  typeof dependencies.output?.write === 'function' ? dependencies.output : process.stdout;

const assertValidSelectedClaudeProfile = (selectedProfileId: string, profiles: readonly SetupProfileChoice[]): void => {
  assertValidDefaultProfileId(selectedProfileId);

  if (profiles.length > 0 && profiles.every((profile) => profile.id !== selectedProfileId)) {
    throw new Error(`Selected default profile '${selectedProfileId}' was not one of the available setup profiles.`);
  }
};

// The claude-first user keeps `outfitter` working without flags on later runs: the picker
// persists both the chosen default profile and `default_agent: claude`.
const writeClaudeFirstRunSettings = (homeDirectory: string, selectedProfileId: string): void => {
  const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
  mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
  writeFileSync(settingsPath, `default_agent: claude\n${createDefaultSettingsContent(selectedProfileId)}`);
};

export interface ClaudeLoginHintInput {
  readonly adapterId: string;
  readonly homeDirectory: string;
  readonly passThroughArgs?: readonly string[];
  readonly dependencies: RunCommandDependencies;
}

const claudeLoginHintMessage =
  'Claude Code manages its own credentials; if it reports that you are not logged in, run `/login` inside ' +
  'Claude Code. Outfitter never reads or stores Claude credentials.';

// Credentials never touch Outfitter: claude's own `/login` flow owns authentication. When no
// prior claude login state is cheaply detectable on disk, interactive launches get a one-line
// hint so a fresh user knows what to do if claude starts logged out.
export const emitClaudeLoginHintIfNeeded = (input: ClaudeLoginHintInput): void => {
  if (input.adapterId !== 'claude' || isNonInteractiveClaudeLaunch(input.passThroughArgs ?? [])) {
    return;
  }

  if (!isInteractiveRunLaunch(input.dependencies) || hasConfiguredClaudeLoginState(input.homeDirectory)) {
    return;
  }

  resolveRunProgressWriter(input.dependencies)(claudeLoginHintMessage);
};

// Filesystem-only pre-start guidance (never authoritative): claude stores OAuth/API-key state
// in `~/.claude/.credentials.json` (Linux) or records the account in `~/.claude.json` (macOS
// keeps the secret itself in the Keychain).
const hasConfiguredClaudeLoginState = (homeDirectory: string): boolean => {
  if (existsSync(join(homeDirectory, '.claude', '.credentials.json'))) {
    return true;
  }

  const claudeConfigPath = join(homeDirectory, '.claude.json');

  if (!existsSync(claudeConfigPath)) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(claudeConfigPath, 'utf8'));

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }

    const record = parsed as Readonly<Record<string, unknown>>;
    return record.oauthAccount !== undefined || record.primaryApiKey !== undefined;
  } catch {
    return false;
  }
};
