// Provides the command object for launching selected profiles.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ChildProcess } from 'node:child_process';
import type { Command } from 'commander';
import spawn from 'cross-spawn';

import type { AgentAdapter, AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import { createPiAdapter } from '../../agents/pi/PiAdapter.js';
import { createProfileSourceCachePath } from '../../profiles/ProfileCache.js';
import { loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import type { LoadedProfile } from '../../profiles/ProfileLoader.js';
import type { Profile } from '../../profiles/Profile.js';
import type { ProfileSourceReference } from '../../profiles/ProfileSource.js';
import { resolveProfile } from '../../profiles/ProfileMerger.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../settings/SettingsLoader.js';
import { createTackRootDirectory, writeTack } from '../../tack/TackAssembler.js';
import { createTackStateBaseline, detectTackStateWrites } from '../../tack/StatePersistence.js';
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
  const stateBaseline = createTackStateBaseline(tackPlan.tack.rootDirectory);
  const launchPlan = adapter.createLaunchPlan(tackPlan.tack, resolvedProfile.profile, input.passThroughArgs ?? []);
  const watcher = watchTackInputs({
    tack: tackPlan.tack,
    refreshTack: () => createAdapterTackPlan(adapter, loadResolvedProfile(input), tackRootDirectory).tack,
    /* v8 ignore next -- watcher warnings are covered in TackWatcher tests; this adapter passes the stderr writer through. */
    warn: (message) => (dependencies.writeError ?? console.error)(message),
  });

  try {
    const launcher =
      dependencies.launcher ??
      /* v8 ignore next -- tests inject launchers instead of spawning pi. */ createSpawnLauncher();
    const exitCode = await launcher.launch(launchPlan);
    const stateWriteWarnings = handleTackStateWrites(
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

const createAdapterTackPlan = (adapter: AgentAdapter, resolvedProfile: ResolvedRunProfile, rootDirectory: string) =>
  adapter.createTack(resolvedProfile.profile, {
    rootDirectory,
    profilePaths: resolvedProfile.profilePaths,
    profileFolders: resolvedProfile.profileFolders,
    homeDirectory: resolvedProfile.homeDirectory,
  });

const handleTackStateWrites = (
  tackRootDirectory: string,
  statePaths: readonly TackStatePath[],
  stateBaseline: TackStateBaseline,
): readonly string[] => {
  const warnings: string[] = [];

  for (const issue of detectTackStateWrites(tackRootDirectory, statePaths, stateBaseline)) {
    if (issue.strategy === 'error') {
      throw new Error(formatTackStateWriteIssue(issue));
    }

    warnings.push(formatTackStateWriteIssue(issue));
  }

  return warnings;
};

const formatTackStateWriteIssue = (issue: TackStateWriteIssue): string => {
  if (issue.unknown) {
    return `pi wrote undeclared tack state '${issue.relativePath}' and it was not persisted.`;
  }

  if (issue.strategy === 'symlink') {
    return `pi replaced symlinked state path '${issue.relativePath}' and the change was not persisted.`;
  }

  return `pi wrote '${issue.relativePath}' with state_persistence '${issue.strategy}' and it was not persisted.`;
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
  const loadedSettings = loadSettings(discoverSettingsLoadPlan(input));

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const loadedProfiles = loadProfileSources(input.homeDirectory, loadedSettings.settings.profileSources);

  if (loadedProfiles.issues.length > 0) {
    throw new Error(`Cannot run with invalid profiles: ${loadedProfiles.issues.map(formatProfileIssue).join('; ')}`);
  }

  const profileId = input.profileId ?? loadedSettings.settings.defaultProfile ?? 'default';
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
    profilePaths: findContributingProfilePaths(resolution.profileStack, loadedProfiles.profiles),
    profileFolders: findContributingProfileFolders(resolution.profileStack, loadedProfiles.profiles),
    homeDirectory: input.homeDirectory,
  };
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
  profileStack
    .map((profile) => loadedProfiles.find((loadedProfile) => loadedProfile.profile.id === profile.id))
    .filter((loadedProfile): loadedProfile is LoadedProfile => loadedProfile !== undefined);

const loadProfileSources = (
  homeDirectory: string,
  sources: readonly ProfileSourceReference[],
): {
  readonly profiles: readonly LoadedProfile[];
  readonly issues: readonly { readonly path: string; readonly message: string }[];
} => {
  const profiles: LoadedProfile[] = [];
  const issues: { readonly path: string; readonly message: string }[] = [];

  for (const source of sources.map((source) => materializeSource(homeDirectory, source))) {
    const result = loadLocalProfileSource(source);
    profiles.push(...result.profiles);
    issues.push(...result.issues);
  }

  return { profiles, issues };
};

const materializeSource = (homeDirectory: string, source: ProfileSourceReference): ProfileSourceReference => {
  if (source.uri === undefined) {
    return source;
  }

  return { path: createProfileSourceCachePath(homeDirectory, source.uri), only: source.only, except: source.except };
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
