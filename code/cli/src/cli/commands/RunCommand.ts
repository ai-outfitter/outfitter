// Provides the command object for launching selected profiles.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ChildProcess } from 'node:child_process';
import type { Command } from 'commander';
import spawn from 'cross-spawn';

import type { AgentAdapter, AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import { createAgentAdapter } from '../../agents/AgentRegistry.js';
import { resolveOutfitterDocsDirectory } from '../../agents/OutfitterDocs.js';
import { exportSystemPromptIfEnabled } from '../../prompts/SystemPromptExport.js';
import {
  createCompositeProfileRootDirectory,
  writeCompositeProfile,
} from '../../compositeProfile/CompositeProfileAssembler.js';
import { renderCompositeProfileTemplates } from '../../compositeProfile/CompositeProfileTemplate.js';
import {
  createCompositeProfileStateBaseline,
  detectCompositeProfileStateWrites,
  updateCompositeProfileStateBaselinePaths,
} from '../../compositeProfile/StatePersistence.js';
import type {
  CompositeProfileStateBaseline,
  CompositeProfileStatePath,
  CompositeProfileStateWriteIssue,
} from '../../compositeProfile/StatePersistence.js';
import { watchCompositeProfileInputs } from '../../compositeProfile/CompositeProfileWatcher.js';
import type { AgentProcessLauncher } from '../../agents/AgentLaunch.js';
import { launchAgentProcess, resolveAgentLaunchExecutable } from '../../agents/AgentLaunch.js';
import type { CommandObject } from './CommandObject.js';
import { isNonInteractivePiLaunch, preparePiLoginLaunchPlan } from './PiLoginLaunch.js';
import type { SetupCommandDependencies } from './SetupCommand.js';
import { syncProfileSource, type RemoteProfileSource } from './SyncCommand.js';
import { emitLaunchSummary } from './run/RunLaunchSummary.js';
import {
  createFirstRunBootstrapProfile,
  createLaunchProfileLayers,
  loadProfileSources,
  loadResolvedProfile,
  selectRunAgentId,
  type ResolvedRunProfile,
} from './run/RunProfileResolution.js';

export { createLaunchProfileLayers, loadProfileSources };

export interface RunCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly profileId?: string;
  readonly agentId?: string;
  readonly strict?: boolean;
  readonly passThroughArgs?: readonly string[];
  readonly forceRuntimeOnboarding?: boolean;
  readonly setupSourceUri?: string;
  /** Bundled user-facing Outfitter docs to expose to the launched agent's system prompt. */
  readonly outfitterDocsDirectory?: string;
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
}

export const executeRunCommand = async (
  input: RunCommandInput,
  dependencies: RunCommandDependencies = {},
): Promise<RunCommandResult> => {
  const runtimeOnboarding = prepareFirstRunRuntimeOnboarding(input, dependencies);
  const resolvedProfile =
    runtimeOnboarding === undefined ? loadResolvedProfile(input) : createFirstRunBootstrapProfile(input);
  const adapter =
    dependencies.adapter ?? createAgentAdapter(selectRunAgentId(input.agentId, resolvedProfile.settings.defaultAgent));
  const compositeProfileRootDirectory = createCompositeProfileRootDirectory(resolvedProfile.profile.id, adapter.id);
  const compositeProfilePlan = createAdapterCompositeProfilePlan(
    adapter,
    resolvedProfile,
    compositeProfileRootDirectory,
  );
  const warnings = [...compositeProfilePlan.warnings, ...resolvedProfile.generatedSkillWarnings];

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
          generatedSkillProfiles: createLaunchProfileLayers(resolvedProfile.generatedSkillProfiles),
          projectDirectory: input.projectDirectory,
          cacheDirectory: resolvedProfile.cacheDirectory,
          outfitterDocsDirectory: input.outfitterDocsDirectory,
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

  try {
    const launcher =
      dependencies.launcher ??
      /* v8 ignore next -- tests inject launchers instead of spawning pi. */ createSpawnLauncher();
    const exitCode = await launchAgentProcess(launcher, launchPlan, adapter.id);
    const stateWriteWarnings = handleCompositeProfileStateWrites(
      adapter.id,
      compositeProfilePlan.compositeProfile.rootDirectory,
      compositeProfilePlan.compositeProfile.statePaths,
      stateBaseline,
    );

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
    watcher.close();
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
            outfitterDocsDirectory: resolveOutfitterDocsDirectory(),
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
    generatedSkillProfiles: createLaunchProfileLayers(resolvedProfile.generatedSkillProfiles),
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

const handleCompositeProfileStateWrites = (
  adapterId: string,
  compositeProfileRootDirectory: string,
  statePaths: readonly CompositeProfileStatePath[],
  stateBaseline: CompositeProfileStateBaseline,
): readonly string[] => {
  const warnings: string[] = [];

  for (const issue of detectCompositeProfileStateWrites(compositeProfileRootDirectory, statePaths, stateBaseline)) {
    if (issue.strategy === 'error') {
      throw new Error(formatCompositeProfileStateWriteIssue(adapterId, issue));
    }

    warnings.push(formatCompositeProfileStateWriteIssue(adapterId, issue));
  }

  return warnings;
};

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

  const syncResult = syncProfileSource(input.homeDirectory, defaultProfilesSource, dependencies.synchronizer);

  /* v8 ignore next -- network/cache failure path is integration-level behavior; setup fallback message is deterministic. */
  if (syncResult.status === 'failed') {
    throw new Error(
      `Cannot start Pi-native onboarding because the default profiles source failed to sync: ${syncResult.message}. ` +
        'Fix the network/git issue or run `outfitter setup` once the source is reachable.',
    );
  }

  return { defaultProfilesPath: join(syncResult.cachePath, defaultProfilesSource.path) };
};

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

const withSystemPromptExportPath = (launchPlan: AgentLaunchPlan, outputPath: string | undefined): AgentLaunchPlan =>
  outputPath === undefined
    ? launchPlan
    : { ...launchPlan, env: { ...launchPlan.env, OUTFITTER_SYSTEM_PROMPT_EXPORT_PATH: outputPath } };

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
