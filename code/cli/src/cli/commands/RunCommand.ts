// Provides the command object for launching selected profiles.
import { homedir } from 'node:os';

import type { ChildProcess } from 'node:child_process';
import type { Command } from 'commander';
import spawn from 'cross-spawn';

import type { AgentAdapter, AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import { createAgentAdapter } from '../../agents/AgentRegistry.js';
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
import { watchCompositeProfileInputs } from '../../compositeProfile/CompositeProfileWatcher.js';
import {
  registerCompositeProfileDirectoryCleanup,
  sweepStaleCompositeProfileDirectories,
} from '../../compositeProfile/CompositeProfileCleanup.js';
import type { AgentProcessLauncher } from '../../agents/AgentLaunch.js';
import { launchAgentProcess, resolveAgentLaunchExecutable } from '../../agents/AgentLaunch.js';
import type { CommandObject } from './CommandObject.js';
import { preparePiLoginLaunchPlan } from './PiLoginLaunch.js';
import type { SetupCommandDependencies } from './SetupCommand.js';
import { emitLaunchSummary } from './run/RunLaunchSummary.js';
import {
  isInteractiveRunLaunch,
  prepareFirstRunRuntimeOnboarding,
  resolveRunProgressWriter,
} from './run/RunFirstRunOnboarding.js';
import { createTerminalStateWritePrompt } from './run/RunStateWritePrompt.js';
import { resolveProfileSkillControls } from '../../skills/ProfileSkillResolution.js';
import {
  createFirstRunBootstrapProfile,
  createLaunchProfileLayers,
  loadProfileSources,
  loadResolvedProfile,
  materializeProfileSourcePaths,
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
  sweepStaleCompositeProfileDirectories();
  const runtimeOnboarding = prepareFirstRunRuntimeOnboarding(input, dependencies);
  const loadedProfile =
    runtimeOnboarding === undefined ? loadResolvedProfile(input) : createFirstRunBootstrapProfile(input);
  const adapter =
    dependencies.adapter ?? createAgentAdapter(selectRunAgentId(input.agentId, loadedProfile.settings.defaultAgent));
  const compositeProfileRootDirectory = createCompositeProfileRootDirectory(loadedProfile.profile.id, adapter.id);
  prepareCompositeProfileTeardown(input, compositeProfileRootDirectory, dependencies);
  const resolvedProfile = resolveRunProfileSkills(loadedProfile, compositeProfileRootDirectory);
  const compositeProfilePlan = createAdapterCompositeProfilePlan(
    adapter,
    resolvedProfile,
    compositeProfileRootDirectory,
  );
  const warnings = [...resolvedProfile.skillWarnings, ...compositeProfilePlan.warnings];

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
    profile: { id: resolvedProfile.profile.id, label: resolvedProfile.profile.label },
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
          warn: dependencies.writeError ?? console.error,
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

type SkillResolvedRunProfile = ResolvedRunProfile & { readonly skillWarnings: readonly string[] };

// Catalog skill IDs are resolved to generated skill directories under the composite
// profile root before adapters run, so adapters keep receiving plain path sources and
// the generated skills are removed with the composite profile at exit.
const resolveRunProfileSkills = (
  resolvedProfile: ResolvedRunProfile,
  compositeProfileRootDirectory: string,
): SkillResolvedRunProfile => {
  const resolution = resolveProfileSkillControls({
    profile: resolvedProfile.profile,
    profileLayers: resolvedProfile.profileLayers,
    sourcePaths: materializeProfileSourcePaths(
      resolvedProfile.homeDirectory,
      resolvedProfile.settings.profileSources ?? [],
    ),
    projectDirectory: resolvedProfile.projectDirectory,
    outputDirectory: compositeProfileRootDirectory,
  });
  const errors = resolution.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

  if (errors.length > 0) {
    throw new Error(
      `Cannot resolve profile skills: ${errors.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
    );
  }

  return {
    ...resolvedProfile,
    profile: resolution.profile,
    skillWarnings: resolution.diagnostics.map((diagnostic) => diagnostic.message),
  };
};

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

const formatCompositeProfileStateWriteIssue = (adapterId: string, issue: CompositeProfileStateWriteIssue): string => {
  if (issue.unknown) {
    return `${adapterId} wrote undeclared composite profile state '${issue.relativePath}' and it was not persisted.`;
  }

  if (issue.strategy === 'symlink') {
    return `${adapterId} replaced symlinked state path '${issue.relativePath}' and the change was not persisted.`;
  }

  return `${adapterId} wrote '${issue.relativePath}' with state_persistence '${issue.strategy}' and it was not persisted.`;
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
