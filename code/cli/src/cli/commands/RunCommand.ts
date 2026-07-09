// Provides the command object for launching selected profiles.
import type { watch } from 'node:fs';
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
  updateCompositeProfileStateBaselinePaths,
} from '../../compositeProfile/StatePersistence.js';
import type { CompositeProfileStateWritePrompt } from '../../compositeProfile/StatePersistence.js';
import {
  watchCompositeProfileInputs,
  watchCompositeProfileStateWrites,
} from '../../compositeProfile/CompositeProfileWatcher.js';
import type { StateWriteNoticeTimers } from '../../compositeProfile/CompositeProfileWatcher.js';
import {
  createCompositeProfileSessionJournal,
  reportAndClearCompositeProfileSessionJournals,
} from '../../compositeProfile/CompositeProfileSessionJournal.js';
import type { CompositeProfileSessionJournal } from '../../compositeProfile/CompositeProfileSessionJournal.js';
import type { CompositeProfile } from '../../compositeProfile/CompositeProfile.js';
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
import { prepareFirstRunRuntimeOnboarding, resolveRunProgressWriter } from './run/RunFirstRunOnboarding.js';
import {
  handleCompositeProfileStateWrites,
  recordAlwaysStatePersistenceChoice,
  resolveStateWritePrompt,
} from './run/RunStateWritePrompt.js';
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
  readonly promptStateWritePersistence?: CompositeProfileStateWritePrompt;
  // Deterministic overrides for the live state-write monitor (tests inject a fake
  // fs.watch and a manual notice-flush clock instead of racing platform timing).
  readonly stateWriteMonitor?: {
    readonly watchFactory?: typeof watch;
    readonly timers?: StateWriteNoticeTimers;
  };
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
          outfitterDocsDirectory: input.outfitterDocsDirectory,
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
  const stateWriteWatcher = createRunStateWriteWatcher(
    compositeProfilePlan.compositeProfile,
    adapter.id,
    sessionJournal,
    dependencies,
  );

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

const createRunStateWriteWatcher = (
  compositeProfile: CompositeProfile,
  agentId: string,
  journal: CompositeProfileSessionJournal,
  dependencies: RunCommandDependencies,
) =>
  watchCompositeProfileStateWrites({
    compositeProfile,
    agentId,
    journal,
    watchFactory: dependencies.stateWriteMonitor?.watchFactory,
    timers: dependencies.stateWriteMonitor?.timers,
    /* v8 ignore next 2 -- console fallbacks are direct CLI behavior; tests inject writers. */
    notify: (message) => (dependencies.writeError ?? console.error)(message),
    warn: (message) => (dependencies.writeError ?? console.error)(message),
  });

const reportPreviousSessionJournals = (sessionJournalDirectory: string, dependencies: RunCommandDependencies): void =>
  reportAndClearCompositeProfileSessionJournals(
    sessionJournalDirectory,
    /* v8 ignore next -- console fallback is direct CLI behavior; tests inject an error writer. */
    dependencies.writeError ?? console.error,
  );

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
