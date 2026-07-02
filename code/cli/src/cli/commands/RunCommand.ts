/* eslint-disable max-lines */
// Provides the command object for launching selected profiles.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { ChildProcess } from 'node:child_process';
import chalk from 'chalk';
import type { Command } from 'commander';
import spawn from 'cross-spawn';

import type { AgentAdapter, AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import { createAgentAdapter, defaultAgentId as registryDefaultAgentId } from '../../agents/AgentRegistry.js';
import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  redactProfileSourceUriCredentials,
  resolveRemoteRepositorySubpath,
} from '../../profiles/ProfileCache.js';
import {
  builtinStarterProfileId,
  createBuiltinProfilesCachePath,
  materializeBuiltinProfiles,
} from '../../profiles/BuiltinProfiles.js';
import { loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import type { LoadedProfile } from '../../profiles/ProfileLoader.js';
import { createEmptyProfile, type Profile } from '../../profiles/Profile.js';
import type { ProfileSourceReference } from '../../profiles/ProfileSource.js';
import { resolveProfile } from '../../profiles/ProfileMerger.js';
import { emptySettings, type Settings } from '../../settings/Settings.js';
import { loadSettingsWithCachedRemoteSettings } from '../../settings/SettingsLoader.js';
import { exportSystemPromptIfEnabled } from '../../prompts/SystemPromptExport.js';
import {
  createCompositeProfileRootDirectory,
  writeCompositeProfile,
} from '../../compositeProfile/CompositeProfileAssembler.js';
import { renderCompositeProfileTemplates } from '../../compositeProfile/CompositeProfileTemplate.js';
import {
  createCompositeProfileStateBaseline,
  detectCompositeProfileStateWrites,
  persistCompositeProfileStateWrite,
  recordProfileStatePersistenceOverride,
  updateCompositeProfileStateBaselinePaths,
} from '../../compositeProfile/StatePersistence.js';
import type {
  CompositeProfileStateBaseline,
  CompositeProfileStatePath,
  CompositeProfileStateWriteIssue,
  CompositeProfileStateWritePrompt,
} from '../../compositeProfile/StatePersistence.js';
import {
  watchCompositeProfileInputs,
  watchCompositeProfileStateWrites,
} from '../../compositeProfile/CompositeProfileWatcher.js';
import {
  createCompositeProfileSessionJournal,
  reportAndClearCompositeProfileSessionJournals,
} from '../../compositeProfile/CompositeProfileSessionJournal.js';
import {
  registerCompositeProfileDirectoryCleanup,
  sweepStaleCompositeProfileDirectories,
} from '../../compositeProfile/CompositeProfileCleanup.js';
import type { AgentProcessLauncher } from '../../agents/AgentLaunch.js';
import { launchAgentProcess, resolveAgentLaunchExecutable } from '../../agents/AgentLaunch.js';
import type { CommandObject } from './CommandObject.js';
import { isNonInteractivePiLaunch, preparePiLoginLaunchPlan } from './PiLoginLaunch.js';
import type { SetupCommandDependencies } from './SetupCommand.js';
import { createGitSynchronizer, syncProfileSource, type RemoteProfileSource } from './SyncCommand.js';

export interface RunCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly profileId?: string;
  readonly agentId?: string;
  readonly strict?: boolean;
  readonly passThroughArgs?: readonly string[];
  readonly forceRuntimeOnboarding?: boolean;
  readonly setupSourceUri?: string;
}

export interface RunCommandResult {
  readonly profileId: string;
  readonly agentId: string;
  readonly launchPlan: AgentLaunchPlan;
  readonly compositeProfileDirectory: string;
  readonly warnings: readonly string[];
  readonly exitCode: number;
}

export type { AgentProcessLauncher } from '../../agents/AgentLaunch.js';
export { resolveAgentLaunchExecutable } from '../../agents/AgentLaunch.js';

export interface RunCommandDependencies extends SetupCommandDependencies {
  readonly adapter?: AgentAdapter;
  readonly launcher?: AgentProcessLauncher;
  readonly writeError?: (message: string) => void;
  readonly promptStateWritePersistence?: CompositeProfileStateWritePrompt;
}

export const executeRunCommand = async (
  input: RunCommandInput,
  dependencies: RunCommandDependencies = {},
): Promise<RunCommandResult> => {
  const sessionJournalDirectory = join(input.homeDirectory, '.outfitter', 'state', 'session-journals');
  // Leftover crash journals are reported before any cleanup runs; journals live under
  // ~/.outfitter/state rather than the tmp root, so the sweep can never delete one.
  reportPreviousSessionJournals(sessionJournalDirectory, dependencies);
  sweepStaleCompositeProfileDirectories();
  const runtimeOnboarding = prepareFirstRunRuntimeOnboarding(input, dependencies);
  const resolvedProfile =
    runtimeOnboarding === undefined ? loadResolvedProfile(input) : createFirstRunBootstrapProfile(input);
  const adapter =
    dependencies.adapter ?? createAgentAdapter(selectRunAgentId(input.agentId, resolvedProfile.settings.defaultAgent));
  const compositeProfileRootDirectory = createCompositeProfileRootDirectory(resolvedProfile.profile.id, adapter.id);
  prepareCompositeProfileTeardown(input, compositeProfileRootDirectory, dependencies);
  const compositeProfilePlan = createAdapterCompositeProfilePlan(
    adapter,
    resolvedProfile,
    compositeProfileRootDirectory,
  );
  const warnings = compositeProfilePlan.warnings;

  failStrictOnWarnings(adapter.id, warnings, input.strict);
  emitWarnings(warnings, dependencies.writeError);
  writeCompositeProfile(compositeProfilePlan.compositeProfile);
  const systemPromptExport = exportSystemPromptIfEnabled({
    profile: resolvedProfile.profile,
    settings: resolvedProfile.settings,
    profileLayers: resolvedProfile.profileLayers,
    cacheDirectory: resolvedProfile.cacheDirectory,
    warn: dependencies.writeError ?? console.error,
  });
  let stateBaseline = createCompositeProfileStateBaseline(
    compositeProfilePlan.compositeProfile.rootDirectory,
    compositeProfilePlan.compositeProfile.statePaths,
  );
  const launchPlan = preparePiLoginLaunchPlan({
    adapterId: adapter.id,
    homeDirectory: input.homeDirectory,
    launchPlan: withSystemPromptExportPath(
      adapter.createLaunchPlan(
        compositeProfilePlan.compositeProfile,
        resolvedProfile.profile,
        input.passThroughArgs ?? [],
        {
          profileFolders: resolvedProfile.profileFolders,
          profileLayers: createLaunchProfileLayers(resolvedProfile.profileLayers),
          projectDirectory: input.projectDirectory,
          cacheDirectory: resolvedProfile.cacheDirectory,
          onProgress: resolveRunProgressWriter(dependencies),
        },
      ),
      systemPromptExport.outputPath,
    ),
    runtimeOnboarding:
      runtimeOnboarding === undefined
        ? undefined
        : {
            autoOpenOutfitter: true,
            defaultProfilesPath: runtimeOnboarding.defaultProfilesPath,
            projectDirectory: input.projectDirectory,
            setupSourceUri: input.setupSourceUri,
          },
    startupAsciiArt: resolvedProfile.settings.startup?.asciiArt,
    writeLine: dependencies.writeLine,
  });
  emitLaunchSummary(
    resolvedProfile,
    adapter.id,
    compositeProfilePlan.compositeProfile.rootDirectory,
    dependencies.writeLine,
  );
  const watcher = watchCompositeProfileInputs({
    compositeProfile: compositeProfilePlan.compositeProfile,
    refreshCompositeProfile: () => {
      const refreshedProfile = loadResolvedProfile(input);
      exportSystemPromptIfEnabled({
        profile: refreshedProfile.profile,
        settings: refreshedProfile.settings,
        profileLayers: refreshedProfile.profileLayers,
        cacheDirectory: refreshedProfile.cacheDirectory,
        warn: dependencies.writeError ?? console.error,
      });

      return createAdapterCompositeProfilePlan(adapter, refreshedProfile, compositeProfileRootDirectory)
        .compositeProfile;
    },
    onCompositeProfileWritten: (compositeProfile) => {
      stateBaseline = updateCompositeProfileStateBaselinePaths(
        compositeProfile.rootDirectory,
        stateBaseline,
        compositeProfile.files.map((file) => file.outputPath),
      );
    },
    /* v8 ignore next -- watcher warnings are covered in CompositeProfileWatcher tests; this adapter passes the stderr writer through. */
    warn: (message) => (dependencies.writeError ?? console.error)(message),
  });
  const sessionJournal = createCompositeProfileSessionJournal({
    journalDirectory: sessionJournalDirectory,
    agentId: adapter.id,
    profileId: resolvedProfile.profile.id,
    compositeProfileDirectory: compositeProfilePlan.compositeProfile.rootDirectory,
    baseline: stateBaseline,
  });
  const stateWriteWatcher = watchCompositeProfileStateWrites({
    compositeProfile: compositeProfilePlan.compositeProfile,
    agentId: adapter.id,
    journal: sessionJournal,
    /* v8 ignore next 2 -- console fallbacks are direct CLI behavior; tests inject writers. */
    notify: (message) => (dependencies.writeError ?? console.error)(message),
    warn: (message) => (dependencies.writeError ?? console.error)(message),
  });

  try {
    const launcher =
      dependencies.launcher ??
      /* v8 ignore next -- tests inject launchers instead of spawning pi. */ createSpawnLauncher();
    const exitCode = await launchAgentProcess(launcher, launchPlan, adapter.id);
    const stateWriteWarnings = await handleCompositeProfileStateWrites({
      adapterId: adapter.id,
      rootDirectory: compositeProfilePlan.compositeProfile.rootDirectory,
      statePaths: compositeProfilePlan.compositeProfile.statePaths,
      stateBaseline,
      prompt: resolveStateWritePrompt(dependencies),
      recordAlwaysChoice: (relativePath) => recordAlwaysStatePersistenceChoice(adapter, resolvedProfile, relativePath),
      /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a line writer. */
      notify: dependencies.writeLine ?? console.log,
    });

    failStrictOnWarnings(adapter.id, stateWriteWarnings, input.strict);
    emitWarnings(stateWriteWarnings, dependencies.writeError);

    return {
      profileId: resolvedProfile.profile.id,
      agentId: adapter.id,
      launchPlan,
      compositeProfileDirectory: compositeProfilePlan.compositeProfile.rootDirectory,
      warnings: [...warnings, ...stateWriteWarnings],
      exitCode,
    };
  } finally {
    stateWriteWatcher.close();
    watcher.close();
    // The journal only outlives sessions that never reach this point (crash, SIGKILL, or a
    // handled signal); any in-process completion has run the authoritative exit-time diff.
    sessionJournal.discard();
  }
};

/* v8 ignore start -- Commander registration is exercised through CLI integration, while command behavior is unit-tested through executeRunCommand. */
export const createRunCommand = (dependencies: RunCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'run',
    description: 'Assemble a profile compositeProfile and launch the selected agent CLI.',
    register(program: Command): void {
      const action = async (
        args: readonly string[],
        options: { profile?: string; agent?: string; strict?: boolean },
      ) => {
        const result = await executeRunCommand(
          {
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            profileId: options.profile,
            agentId: options.agent,
            strict: options.strict,
            passThroughArgs: args,
          },
          dependencies,
        );

        if (result.exitCode !== 0) {
          process.exitCode = result.exitCode;
        }
      };

      configureRunCommander(
        program.command(command.name, { isDefault: true }).description(command.description),
        action,
      );
    },
  };

  return command;
};

const configureRunCommander = (
  command: Command,
  action: (args: readonly string[], options: { profile?: string; agent?: string; strict?: boolean }) => Promise<void>,
): void => {
  command
    .argument('[args...]')
    .option('-p, --profile <profile>', 'Outfitter profile id to run')
    .option('--agent <agent>', 'agent adapter to launch: pi or claude')
    .option('--strict', 'Fail instead of warning when controls cannot be translated')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(action);
};

/* v8 ignore stop */

interface ResolvedRunProfile {
  readonly profile: Profile;
  readonly profilePaths: readonly string[];
  readonly profileFolders: readonly string[];
  readonly homeDirectory: string;
  readonly cacheDirectory: string;
  readonly projectDirectory: string;
  readonly settings: Settings;
  readonly settingsPaths: readonly string[];
  readonly profileLayers: readonly LoadedProfile[];
}

const failStrictOnWarnings = (adapterId: string, warnings: readonly string[], strict: boolean | undefined): void => {
  if (strict === true && warnings.length > 0) {
    throw new Error(`Strict failed for ${adapterId}: ${warnings.join('; ')}`);
  }
};

const emitWarnings = (warnings: readonly string[], writeError: ((message: string) => void) | undefined): void => {
  const writer = writeError ?? console.error;

  for (const warning of warnings) {
    writer(warning);
  }
};

const emitLaunchSummary = (
  resolvedProfile: ResolvedRunProfile,
  adapterId: string,
  compositeProfileRootDirectory: string,
  writeLine: ((message: string) => void) | undefined,
): void => {
  const writer = writeLine ?? console.log;
  const model = selectSummaryModel(resolvedProfile.profile, adapterId);

  writer(`${chalk.magenta('→')} resolving profile ${chalk.yellow(resolvedProfile.profile.id)}`);

  for (const layer of resolvedProfile.profileLayers) {
    writer(
      `${chalk.green('✓')} profile layer ${chalk.yellow(layer.profile.id)}  ${chalk.dim(formatProfileLayerSource(layer))}`,
    );
  }

  writer(`${chalk.green('✓')} merged controls${model === undefined ? '' : `  model=${chalk.yellow(model)}`}`);
  writer(`${chalk.green('✓')} prepared composite profile  ${chalk.dim(compositeProfileRootDirectory)}`);
  writer(`${chalk.blue('↳')} launching ${chalk.cyan(adapterId)} …`);
};

const selectSummaryModel = (profile: Profile, adapterId: string): string | undefined => {
  if (adapterId === 'claude') {
    return profile.controls.claude?.model ?? profile.controls.model;
  }

  return profile.controls.pi?.model ?? profile.controls.model;
};

const formatProfileLayerSource = (layer: LoadedProfile): string => {
  if (layer.source.github !== undefined) {
    return formatRemoteProfileSource(`github:${layer.source.github}`, layer.source.ref, layer.source.path);
  }

  if (layer.source.uri !== undefined) {
    return formatRemoteProfileSource(
      redactProfileSourceUriCredentials(layer.source.uri),
      layer.source.ref,
      layer.source.path,
    );
  }

  return layer.folderPath;
};

const formatRemoteProfileSource = (source: string, ref: string | undefined, path: string | undefined): string => {
  const refSuffix = ref === undefined ? '' : `@${ref}`;
  const pathSuffix = path === undefined ? '' : `/${path}`;

  return `${source}${refSuffix}${pathSuffix}`;
};

const createAdapterCompositeProfilePlan = (
  adapter: AgentAdapter,
  resolvedProfile: ResolvedRunProfile,
  rootDirectory: string,
) => {
  const compositeProfilePlan = adapter.createCompositeProfile(resolvedProfile.profile, {
    rootDirectory,
    profilePaths: resolvedProfile.profilePaths,
    profileFolders: resolvedProfile.profileFolders,
    profileLayers: createLaunchProfileLayers(resolvedProfile.profileLayers),
    homeDirectory: resolvedProfile.homeDirectory,
    cacheDirectory: resolvedProfile.cacheDirectory,
    settings: resolvedProfile.settings,
    projectDirectory: resolvedProfile.projectDirectory,
  });

  return {
    ...compositeProfilePlan,
    compositeProfile: renderCompositeProfileTemplates({
      compositeProfile: compositeProfilePlan.compositeProfile,
      settings: resolvedProfile.settings,
      settingsPaths: resolvedProfile.settingsPaths,
      profile: resolvedProfile.profile,
      agentId: adapter.id,
      projectDirectory: resolvedProfile.projectDirectory,
    }),
  };
};

// Composite directories are removed at process exit and on handled signals. When the agent
// is launched with --debug the directory is kept for inspection and its path is printed.
const prepareCompositeProfileTeardown = (
  input: RunCommandInput,
  compositeProfileRootDirectory: string,
  dependencies: RunCommandDependencies,
): void => {
  if (isDebugRunLaunch(input.passThroughArgs)) {
    /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a line writer. */
    (dependencies.writeLine ?? console.log)(
      `--debug: keeping composite profile directory ${compositeProfileRootDirectory}`,
    );
    return;
  }

  registerCompositeProfileDirectoryCleanup(compositeProfileRootDirectory);
};

const isDebugRunLaunch = (passThroughArgs: readonly string[] | undefined): boolean =>
  (passThroughArgs ?? []).includes('--debug');

const reportPreviousSessionJournals = (sessionJournalDirectory: string, dependencies: RunCommandDependencies): void =>
  reportAndClearCompositeProfileSessionJournals(
    sessionJournalDirectory,
    /* v8 ignore next -- console fallback is direct CLI behavior; tests inject an error writer. */
    dependencies.writeError ?? console.error,
  );

interface CompositeProfileStateWriteHandlingInput {
  readonly adapterId: string;
  readonly rootDirectory: string;
  readonly statePaths: readonly CompositeProfileStatePath[];
  readonly stateBaseline: CompositeProfileStateBaseline;
  readonly prompt?: CompositeProfileStateWritePrompt;
  readonly recordAlwaysChoice: (relativePath: string) => string | undefined;
  readonly notify: (message: string) => void;
}

const handleCompositeProfileStateWrites = async (
  input: CompositeProfileStateWriteHandlingInput,
): Promise<readonly string[]> => {
  const warnings: string[] = [];

  for (const issue of detectCompositeProfileStateWrites(input.rootDirectory, input.statePaths, input.stateBaseline)) {
    if (issue.strategy === 'error') {
      throw new Error(formatCompositeProfileStateWriteIssue(input.adapterId, issue));
    }

    if (issue.strategy === 'prompt') {
      warnings.push(...(await handlePromptStateWriteIssue(input, issue)));
      continue;
    }

    warnings.push(formatCompositeProfileStateWriteIssue(input.adapterId, issue));
  }

  return warnings;
};

const handlePromptStateWriteIssue = async (
  input: CompositeProfileStateWriteHandlingInput,
  issue: CompositeProfileStateWriteIssue,
): Promise<readonly string[]> => {
  if (issue.unknown) {
    return [
      formatCompositeProfileStateWriteIssue(input.adapterId, issue),
      `state_persistence 'prompt' cannot persist undeclared writes; '${issue.relativePath}' was reported instead.`,
    ];
  }

  if (input.prompt === undefined) {
    return [
      formatCompositeProfileStateWriteIssue(input.adapterId, issue),
      `state_persistence prompt for '${issue.relativePath}' skipped: non-interactive session.`,
    ];
  }

  const statePath = findDeclaredStatePath(input.statePaths, issue.relativePath);
  const choice = await input.prompt({
    agentId: input.adapterId,
    relativePath: issue.relativePath,
    sourcePath: statePath.sourcePath,
  });

  return applyPromptStateWriteChoice(input, statePath, choice);
};

const applyPromptStateWriteChoice = (
  input: CompositeProfileStateWriteHandlingInput,
  statePath: CompositeProfileStatePath,
  choice: 'persist' | 'discard' | 'always',
): readonly string[] => {
  if (choice === 'discard') {
    input.notify(`Discarded ${input.adapterId} state write to '${statePath.relativePath}'.`);
    return [];
  }

  try {
    persistCompositeProfileStateWrite(input.rootDirectory, statePath);
  } catch (error) {
    return [`Could not persist state path '${statePath.relativePath}': ${String(error)}`];
  }

  input.notify(`Persisted ${input.adapterId} state write '${statePath.relativePath}' to ${statePath.sourcePath}.`);

  if (choice === 'always') {
    const warning = input.recordAlwaysChoice(statePath.relativePath);
    return warning === undefined ? [] : [warning];
  }

  return [];
};

const findDeclaredStatePath = (
  statePaths: readonly CompositeProfileStatePath[],
  relativePath: string,
): CompositeProfileStatePath => {
  const statePath = statePaths.find((candidate) => candidate.relativePath === relativePath);

  /* v8 ignore next 3 -- declared prompt issues always originate from a declared state path. */
  if (statePath === undefined) {
    throw new Error(`State path '${relativePath}' is not declared by the composite profile.`);
  }

  return statePath;
};

// The "always" choice is recorded in the selected profile's own YAML file because profiles
// are the single source of truth for state_persistence policy; a parallel settings-layer
// override would create a second precedence system that adapter validation cannot see.
// Remote/cached profiles are never mutated, so the choice degrades to a one-run persist
// with an actionable warning.
const recordAlwaysStatePersistenceChoice = (
  adapter: AgentAdapter,
  resolvedProfile: ResolvedRunProfile,
  relativePath: string,
): string | undefined => {
  const declaration = adapter.statePaths?.[relativePath];

  if (declaration === undefined || !declaration.allowedStrategies.includes('symlink')) {
    return (
      `Cannot always-persist '${relativePath}': the ${adapter.id} adapter does not allow 'symlink' for it; ` +
      `the write was persisted once.`
    );
  }

  const selectedLayer = [...resolvedProfile.profileLayers]
    .reverse()
    .find((layer) => layer.profile.id === resolvedProfile.profile.id);

  if (
    selectedLayer === undefined ||
    selectedLayer.source.uri !== undefined ||
    selectedLayer.source.github !== undefined
  ) {
    return (
      `Cannot record the always-persist choice for '${relativePath}' because profile ` +
      `'${resolvedProfile.profile.id}' is not a local profile file; the write was persisted once.`
    );
  }

  recordProfileStatePersistenceOverride(selectedLayer.profilePath, relativePath, 'symlink');
  return undefined;
};

const resolveStateWritePrompt = (
  dependencies: RunCommandDependencies,
): CompositeProfileStateWritePrompt | undefined => {
  if (!isInteractiveRunLaunch(dependencies)) {
    return undefined;
  }

  return (
    dependencies.promptStateWritePersistence ??
    /* v8 ignore next -- terminal prompting is direct CLI behavior; tests inject a prompt. */
    createTerminalStateWritePrompt(dependencies.input ?? process.stdin, dependencies.output ?? process.stdout)
  );
};

/* v8 ignore start -- readline prompting is direct terminal behavior; tests inject a prompt. */
const createTerminalStateWritePrompt =
  (input: NodeJS.ReadableStream, output: NodeJS.WritableStream): CompositeProfileStateWritePrompt =>
  async (request) => {
    const readline = createInterface({ input, output });

    try {
      for (;;) {
        const answer = (
          await readline.question(
            `${request.agentId} wrote state path '${request.relativePath}' (state_persistence 'prompt'). ` +
              `[p]ersist to ${request.sourcePath ?? 'its durable source'} / [d]iscard / ` +
              `[a]lways persist for this profile: `,
          )
        )
          .trim()
          .toLowerCase();

        if (answer === 'p' || answer === 'persist') {
          return 'persist';
        }

        if (answer === 'd' || answer === 'discard') {
          return 'discard';
        }

        if (answer === 'a' || answer === 'always') {
          return 'always';
        }
      }
    } finally {
      readline.close();
    }
  };
/* v8 ignore stop */

const formatCompositeProfileStateWriteIssue = (adapterId: string, issue: CompositeProfileStateWriteIssue): string => {
  if (issue.unknown) {
    return `${adapterId} wrote undeclared composite profile state '${issue.relativePath}' and it was not persisted.`;
  }

  if (issue.strategy === 'symlink') {
    return `${adapterId} replaced symlinked state path '${issue.relativePath}' and the change was not persisted.`;
  }

  return `${adapterId} wrote '${issue.relativePath}' with state_persistence '${issue.strategy}' and it was not persisted.`;
};

interface FirstRunRuntimeOnboarding {
  readonly defaultProfilesPath: string;
}

const defaultProfilesSource = {
  github: 'ai-outfitter/default-profiles',
  path: 'profiles',
} as const satisfies RemoteProfileSource;

const prepareFirstRunRuntimeOnboarding = (
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
const resolveRunProgressWriter = (dependencies: RunCommandDependencies): ((message: string) => void) =>
  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject writeLine. */
  dependencies.writeLine ?? console.log;

const isInteractiveRunLaunch = (dependencies: RunCommandDependencies): boolean => {
  if (dependencies.interactive !== undefined) {
    return dependencies.interactive;
  }

  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const inputIsTty = (dependencies.input ?? process.stdin).isTTY === true;
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const outputIsTty = (dependencies.output ?? process.stdout).isTTY === true;

  return inputIsTty && outputIsTty;
};

const createFirstRunBootstrapProfile = (input: RunCommandInput): ResolvedRunProfile => ({
  profile: {
    ...createEmptyProfile('outfitter-bootstrap'),
    label: 'Outfitter Bootstrap',
    description: 'Temporary first-run profile that starts Pi before Outfitter settings exist.',
  },
  profilePaths: [],
  profileFolders: [],
  homeDirectory: input.homeDirectory,
  cacheDirectory: join(input.homeDirectory, '.outfitter', 'cache'),
  projectDirectory: input.projectDirectory,
  settings: emptySettings(),
  settingsPaths: [],
  profileLayers: [],
});

const loadResolvedProfile = (input: RunCommandInput): ResolvedRunProfile => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  ensureConventionalLocalProfileSourceDirectories(loadedSettings.files);
  const loadedProfiles = loadProfileSources(input.homeDirectory, loadedSettings.settings.profileSources!);

  if (loadedProfiles.issues.length > 0) {
    throw new Error(`Cannot run with invalid profiles: ${loadedProfiles.issues.map(formatProfileIssue).join('; ')}`);
  }

  const profileId = selectRunProfileId(input.profileId, loadedSettings.settings.defaultProfile);
  const resolution = resolveProfile({
    profiles: loadedProfiles.profiles,
    profileId,
  });

  if (resolution.profile === undefined || resolution.issues.length > 0) {
    throw new Error(`Cannot resolve profile '${profileId}': ${resolution.issues.map(formatProfileIssue).join('; ')}`);
  }

  const selectedProfile = resolution.profileStack.find((profile) => profile.id === profileId) as Profile;

  if (selectedProfile.template === true) {
    throw new Error(`Profile '${profileId}' is a template profile and must be inherited by a runnable profile.`);
  }

  return {
    profile: resolution.profile,
    profileLayers: findContributingLoadedProfiles(resolution.profileStack, loadedProfiles.profiles),
    profilePaths: findContributingProfilePaths(resolution.profileStack, loadedProfiles.profiles),
    profileFolders: findContributingProfileFolders(resolution.profileStack, loadedProfiles.profiles),
    homeDirectory: input.homeDirectory,
    cacheDirectory: loadedSettings.settings.cacheDirectory ?? join(input.homeDirectory, '.outfitter', 'cache'),
    projectDirectory: input.projectDirectory,
    settings: loadedSettings.settings,
    settingsPaths: loadedSettings.files.map((file) => file.location.path),
  };
};

const ensureConventionalLocalProfileSourceDirectories = (files: readonly ResolvedRunProfileSettingsFile[]): void => {
  for (const file of files) {
    const settingsProfilesPath = join(dirname(file.location.path), 'profiles');
    const hasConventionalLocalSource = file.settings.profileSources?.some(
      (source) => source.uri === undefined && source.github === undefined && source.path === settingsProfilesPath,
    );

    if (hasConventionalLocalSource === true) {
      mkdirSync(settingsProfilesPath, { recursive: true });
    }
  }
};

type ResolvedRunProfileSettingsFile = ReturnType<typeof loadSettingsWithCachedRemoteSettings>['files'][number];

const withSystemPromptExportPath = (launchPlan: AgentLaunchPlan, outputPath: string | undefined): AgentLaunchPlan =>
  outputPath === undefined
    ? launchPlan
    : { ...launchPlan, env: { ...launchPlan.env, OUTFITTER_SYSTEM_PROMPT_EXPORT_PATH: outputPath } };

const selectRunAgentId = (selectedAgentId: string | undefined, defaultAgentId: string | undefined): string =>
  selectedAgentId ?? defaultAgentId ?? registryDefaultAgentId;

const selectRunProfileId = (selectedProfileId: string | undefined, defaultProfileId: string | undefined): string => {
  if (selectedProfileId !== undefined) {
    return selectedProfileId;
  }

  if (defaultProfileId !== undefined) {
    return defaultProfileId;
  }

  throw new Error(
    'Cannot run without a selected profile or default_profile in settings.yml; pass --profile or run `outfitter setup`.',
  );
};

const findContributingProfilePaths = (
  profileStack: readonly Profile[],
  loadedProfiles: readonly LoadedProfile[],
): readonly string[] =>
  findContributingLoadedProfiles(profileStack, loadedProfiles).map((loadedProfile) => loadedProfile.profilePath);

const findContributingProfileFolders = (
  profileStack: readonly Profile[],
  loadedProfiles: readonly LoadedProfile[],
): readonly string[] =>
  findContributingLoadedProfiles(profileStack, loadedProfiles).flatMap((loadedProfile) =>
    loadedProfile.resourceRootPath === undefined ? [] : [loadedProfile.resourceRootPath],
  );

export const createLaunchProfileLayers = (loadedProfiles: readonly LoadedProfile[]) =>
  loadedProfiles.map((loadedProfile) => ({
    profile: loadedProfile.profile,
    profilePath: loadedProfile.profilePath,
    sourceRootPath: loadedProfile.sourceRootPath,
    resourceRootPath: loadedProfile.resourceRootPath,
    layout: loadedProfile.layout,
  }));

const findContributingLoadedProfiles = (
  profileStack: readonly Profile[],
  loadedProfiles: readonly LoadedProfile[],
): readonly LoadedProfile[] =>
  profileStack.flatMap((profile) => loadedProfiles.filter((loadedProfile) => loadedProfile.profile.id === profile.id));

export const loadProfileSources = (
  homeDirectory: string,
  sources: readonly ProfileSourceReference[],
): {
  readonly profiles: readonly LoadedProfile[];
  readonly issues: readonly { readonly path: string; readonly message: string }[];
} => {
  const profiles: LoadedProfile[] = [];
  const issues: { readonly path: string; readonly message: string }[] = [];

  for (const source of sources) {
    const materializedSource = materializeSource(homeDirectory, source);
    const result = loadLocalProfileSource(materializedSource);
    profiles.push(...result.profiles.map((profile) => ({ ...profile, source })));
    issues.push(...result.issues);
  }

  return { profiles, issues };
};

const materializeSource = (homeDirectory: string, source: ProfileSourceReference): ProfileSourceReference => {
  if (source.uri === undefined && source.github === undefined) {
    return source;
  }

  if (source.uri !== undefined && source.ref === undefined && source.path === undefined) {
    return { path: createProfileSourceCachePath(homeDirectory, source.uri), only: source.only, except: source.except };
  }

  return {
    path: resolveRemoteRepositorySubpath(createRemoteRepositoryCachePath(homeDirectory, source), source.path),
    only: source.only,
    except: source.except,
  };
};

/* v8 ignore start -- the real child-process launcher is direct runtime behavior; tests inject a launcher. */
const createSpawnLauncher = (): AgentProcessLauncher => ({
  launch(plan) {
    const resolvedPlan = resolveAgentLaunchExecutable(plan);

    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(resolvedPlan.command, resolvedPlan.args, {
        env: { ...process.env, ...resolvedPlan.env },
        stdio: 'inherit',
      });

      child.on('error', reject);
      child.on('close', (code, signal) => resolve(resolveChildExitCode(code, signal)));
    });
  },
});
/* v8 ignore stop */

export const resolveChildExitCode = (code: number | null, signal: NodeJS.Signals | null): number => {
  if (code !== null) {
    return code;
  }

  if (signal !== null) {
    return 128 + (signalNumbers[signal] ?? 1);
  }

  return 1;
};

const signalNumbers: Readonly<Partial<Record<NodeJS.Signals, number>>> = {
  SIGINT: 2,
  SIGTERM: 15,
};

const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;

const formatProfileIssue = (issue: { readonly path: string; readonly message: string }): string =>
  `${issue.path} ${issue.message}`;
