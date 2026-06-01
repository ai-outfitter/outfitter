// Provides the command object for launching selected profiles.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ChildProcess } from 'node:child_process';
import chalk from 'chalk';
import type { Command } from 'commander';
import spawn from 'cross-spawn';

import type { AgentAdapter, AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import { createPiAdapter } from '../../agents/pi/PiAdapter.js';
import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  redactProfileSourceUriCredentials,
  resolveRemoteRepositorySubpath,
} from '../../profiles/ProfileCache.js';
import { loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import type { LoadedProfile } from '../../profiles/ProfileLoader.js';
import type { Profile } from '../../profiles/Profile.js';
import type { ProfileSourceReference } from '../../profiles/ProfileSource.js';
import { resolveProfile } from '../../profiles/ProfileMerger.js';
import type { Settings } from '../../settings/Settings.js';
import { loadSettingsWithCachedRemoteSettings } from '../../settings/SettingsLoader.js';
import { createTackRootDirectory, writeTack } from '../../tack/TackAssembler.js';
import { renderTackTemplates } from '../../tack/TackTemplate.js';
import {
  createTackStateBaseline,
  detectTackStateWrites,
  updateTackStateBaselinePaths,
} from '../../tack/StatePersistence.js';
import type { TackStateBaseline, TackStatePath, TackStateWriteIssue } from '../../tack/StatePersistence.js';
import { watchTackInputs } from '../../tack/TackWatcher.js';
import type { CommandObject } from './CommandObject.js';
import { executeSetupCommand } from './SetupCommand.js';
import type { SetupCommandDependencies } from './SetupCommand.js';

export interface RunCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly profileId?: string;
  readonly hardTack?: boolean;
  readonly passThroughArgs?: readonly string[];
}

export interface RunCommandResult {
  readonly profileId: string;
  readonly agentId: string;
  readonly launchPlan: AgentLaunchPlan;
  readonly tackDirectory: string;
  readonly warnings: readonly string[];
  readonly exitCode: number;
}

export interface AgentProcessLauncher {
  launch(plan: AgentLaunchPlan): Promise<number>;
}

export interface RunCommandDependencies extends SetupCommandDependencies {
  readonly adapter?: AgentAdapter;
  readonly launcher?: AgentProcessLauncher;
  readonly writeError?: (message: string) => void;
}

export const executeRunCommand = async (
  input: RunCommandInput,
  dependencies: RunCommandDependencies = {},
): Promise<RunCommandResult> => {
  runSetupIfNeeded(input, dependencies);
  const resolvedProfile = loadResolvedProfile(input);
  const adapter = dependencies.adapter ?? createPiAdapter();
  const tackRootDirectory = createTackRootDirectory(resolvedProfile.profile.id, adapter.id);
  const tackPlan = createAdapterTackPlan(adapter, resolvedProfile, tackRootDirectory);
  const warnings = tackPlan.warnings;

  failHardTackOnWarnings(adapter.id, warnings, input.hardTack);
  emitWarnings(warnings, dependencies.writeError);

  writeTack(tackPlan.tack);
  let stateBaseline = createTackStateBaseline(tackPlan.tack.rootDirectory, tackPlan.tack.statePaths);
  const launchPlan = adapter.createLaunchPlan(tackPlan.tack, resolvedProfile.profile, input.passThroughArgs ?? []);
  emitLaunchSummary(resolvedProfile, adapter.id, tackPlan.tack.rootDirectory, dependencies.writeLine);
  const watcher = watchTackInputs({
    tack: tackPlan.tack,
    refreshTack: () => createAdapterTackPlan(adapter, loadResolvedProfile(input), tackRootDirectory).tack,
    onTackWritten: (tack) => {
      stateBaseline = updateTackStateBaselinePaths(
        tack.rootDirectory,
        stateBaseline,
        tack.files.map((file) => file.outputPath),
      );
    },
    /* v8 ignore next -- watcher warnings are covered in TackWatcher tests; this adapter passes the stderr writer through. */
    warn: (message) => (dependencies.writeError ?? console.error)(message),
  });

  try {
    const launcher =
      dependencies.launcher ??
      /* v8 ignore next -- tests inject launchers instead of spawning pi. */ createSpawnLauncher();
    const exitCode = await launcher.launch(launchPlan);
    const stateWriteWarnings = handleTackStateWrites(
      adapter.id,
      tackPlan.tack.rootDirectory,
      tackPlan.tack.statePaths,
      stateBaseline,
    );

    failHardTackOnWarnings(adapter.id, stateWriteWarnings, input.hardTack);
    emitWarnings(stateWriteWarnings, dependencies.writeError);

    return {
      profileId: resolvedProfile.profile.id,
      agentId: adapter.id,
      launchPlan,
      tackDirectory: tackPlan.tack.rootDirectory,
      warnings: [...warnings, ...stateWriteWarnings],
      exitCode,
    };
  } finally {
    watcher.close();
  }
};

/* v8 ignore start -- Commander registration is exercised through CLI integration, while command behavior is unit-tested through executeRunCommand. */
export const createRunCommand = (dependencies: RunCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'run',
    description: 'Assemble a profile tack and launch the selected agent CLI.',
    register(program: Command): void {
      const action = async (args: readonly string[], options: { profile?: string; hardTack?: boolean }) => {
        const result = await executeRunCommand(
          {
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            profileId: options.profile,
            hardTack: options.hardTack,
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
  action: (args: readonly string[], options: { profile?: string; hardTack?: boolean }) => Promise<void>,
): void => {
  command
    .argument('[args...]')
    .option('-p, --profile <profile>', 'Bridl profile id to run')
    .option('--hard-tack', 'Fail instead of warning when controls cannot be translated')
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

const failHardTackOnWarnings = (
  adapterId: string,
  warnings: readonly string[],
  hardTack: boolean | undefined,
): void => {
  if (hardTack === true && warnings.length > 0) {
    throw new Error(`Hard-tack failed for ${adapterId}: ${warnings.join('; ')}`);
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
  tackRootDirectory: string,
  writeLine: ((message: string) => void) | undefined,
): void => {
  const writer = writeLine ?? console.log;
  const model = selectSummaryModel(resolvedProfile.profile);

  writer(`${chalk.magenta('→')} resolving profile ${chalk.yellow(resolvedProfile.profile.id)}`);

  for (const layer of resolvedProfile.profileLayers) {
    writer(
      `${chalk.green('✓')} profile layer ${chalk.yellow(layer.profile.id)}  ${chalk.dim(formatProfileLayerSource(layer))}`,
    );
  }

  writer(`${chalk.green('✓')} merged controls${model === undefined ? '' : `  model=${chalk.yellow(model)}`}`);
  writer(`${chalk.green('✓')} prepared tack  ${chalk.dim(tackRootDirectory)}`);
  writer(`${chalk.blue('↳')} launching ${chalk.cyan(adapterId)} …`);
};

const selectSummaryModel = (profile: Profile): string | undefined =>
  profile.controls.pi?.model ?? profile.controls.model;

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

const createAdapterTackPlan = (adapter: AgentAdapter, resolvedProfile: ResolvedRunProfile, rootDirectory: string) => {
  const tackPlan = adapter.createTack(resolvedProfile.profile, {
    rootDirectory,
    profilePaths: resolvedProfile.profilePaths,
    profileFolders: resolvedProfile.profileFolders,
    homeDirectory: resolvedProfile.homeDirectory,
    cacheDirectory: resolvedProfile.cacheDirectory,
    settings: resolvedProfile.settings,
    projectDirectory: resolvedProfile.projectDirectory,
  });

  return {
    ...tackPlan,
    tack: renderTackTemplates({
      tack: tackPlan.tack,
      settings: resolvedProfile.settings,
      settingsPaths: resolvedProfile.settingsPaths,
      profile: resolvedProfile.profile,
      agentId: adapter.id,
      projectDirectory: resolvedProfile.projectDirectory,
    }),
  };
};

const handleTackStateWrites = (
  adapterId: string,
  tackRootDirectory: string,
  statePaths: readonly TackStatePath[],
  stateBaseline: TackStateBaseline,
): readonly string[] => {
  const warnings: string[] = [];

  for (const issue of detectTackStateWrites(tackRootDirectory, statePaths, stateBaseline)) {
    if (issue.strategy === 'error') {
      throw new Error(formatTackStateWriteIssue(adapterId, issue));
    }

    warnings.push(formatTackStateWriteIssue(adapterId, issue));
  }

  return warnings;
};

const formatTackStateWriteIssue = (adapterId: string, issue: TackStateWriteIssue): string => {
  if (issue.unknown) {
    return `${adapterId} wrote undeclared tack state '${issue.relativePath}' and it was not persisted.`;
  }

  if (issue.strategy === 'symlink') {
    return `${adapterId} replaced symlinked state path '${issue.relativePath}' and the change was not persisted.`;
  }

  return `${adapterId} wrote '${issue.relativePath}' with state_persistence '${issue.strategy}' and it was not persisted.`;
};

const runSetupIfNeeded = (input: RunCommandInput, dependencies: RunCommandDependencies): void => {
  const settingsPath = join(input.homeDirectory, '.bridl', 'settings.yml');

  if (existsSync(settingsPath)) {
    return;
  }

  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
  (dependencies.writeLine ?? console.log)('`bridl setup` has not been run yet - running now');
  executeSetupCommand(input, dependencies);
};

const loadResolvedProfile = (input: RunCommandInput): ResolvedRunProfile => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const loadedProfiles = loadProfileSources(input.homeDirectory, loadedSettings.settings.profileSources!);

  if (loadedProfiles.issues.length > 0) {
    throw new Error(`Cannot run with invalid profiles: ${loadedProfiles.issues.map(formatProfileIssue).join('; ')}`);
  }

  const profileId = selectRunProfileId(input.profileId, loadedSettings.settings.defaultProfile);
  const resolution = resolveProfile({
    profiles: loadedProfiles.profiles,
    profileId,
    defaultProfileId: loadedSettings.settings.defaultProfile,
  });

  if (resolution.profile === undefined || resolution.issues.length > 0) {
    throw new Error(`Cannot resolve profile '${profileId}': ${resolution.issues.map(formatProfileIssue).join('; ')}`);
  }

  return {
    profile: resolution.profile,
    profileLayers: findContributingLoadedProfiles(resolution.profileStack, loadedProfiles.profiles),
    profilePaths: findContributingProfilePaths(resolution.profileStack, loadedProfiles.profiles),
    profileFolders: findContributingProfileFolders(resolution.profileStack, loadedProfiles.profiles),
    homeDirectory: input.homeDirectory,
    cacheDirectory: loadedSettings.settings.cacheDirectory ?? join(input.homeDirectory, '.bridl', 'cache'),
    projectDirectory: input.projectDirectory,
    settings: loadedSettings.settings,
    settingsPaths: loadedSettings.files.map((file) => file.location.path),
  };
};

const selectRunProfileId = (selectedProfileId: string | undefined, defaultProfileId: string | undefined): string => {
  if (selectedProfileId !== undefined) {
    return selectedProfileId;
  }

  if (defaultProfileId !== undefined) {
    return defaultProfileId;
  }

  throw new Error(
    'Cannot run without a selected profile or default_profile in settings.yml; pass --profile or run `bridl setup`.',
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
  findContributingLoadedProfiles(profileStack, loadedProfiles).map((loadedProfile) => loadedProfile.folderPath);

const findContributingLoadedProfiles = (
  profileStack: readonly Profile[],
  loadedProfiles: readonly LoadedProfile[],
): readonly LoadedProfile[] =>
  profileStack.flatMap((profile) => loadedProfiles.filter((loadedProfile) => loadedProfile.profile.id === profile.id));

const loadProfileSources = (
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
    return new Promise((resolve, reject) => {
      const child: ChildProcess = spawn(plan.command, plan.args, {
        env: { ...process.env, ...plan.env },
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
