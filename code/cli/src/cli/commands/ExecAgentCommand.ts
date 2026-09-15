// `outfitter exec <agent> <subcommand> [args...]` — run a harness CLI subcommand inside the
// composed projection, with the subcommand at argv[0] of the harness process.
import { Command, Option } from 'commander';

import { launchThroughSpawn, spawnLauncher } from '../../agents/AgentLaunch.js';
import type { SourceCachePolicy } from '../../settings/Settings.js';
import { HARNESSES, SOURCE_CACHE_POLICIES } from '../../settings/Settings.js';
import { startTerminalLoading } from '../TerminalLoading.js';
import type { LoadingStarter } from '../TerminalLoading.js';
import { executeAgentPipeline } from './AgentCommandPipeline.js';
import type {
  AgentPipelineResult,
  AgentProcessLauncher,
  HarnessSubcommand,
  RunLogLevel,
} from './AgentCommandPipeline.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface ExecAgentInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly agent: string;
  readonly subcommand: string;
  readonly subcommandArgs: readonly string[];
  readonly harness?: string;
  /** Launch from the projection alone, ignoring the machine's own harness configuration. */
  readonly isolated?: boolean;
  readonly strict?: boolean;
  readonly sourceCachePolicy?: SourceCachePolicy;
  readonly logLevel?: RunLogLevel;
  /** Keep the runtime projection directory after the subcommand exits (debugging). */
  readonly retainProjection?: boolean;
  readonly launcher: AgentProcessLauncher;
  /** Sink for notices and warnings; emitted before launch. */
  readonly writeLine?: (message: string) => void;
  /** Optional loading UI. The command wires a terminal spinner; tests can observe this boundary. */
  readonly startLoading?: LoadingStarter;
}

export type ExecAgentResult = AgentPipelineResult;

export interface ExecCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly launcher?: AgentProcessLauncher;
  readonly writeLine?: (message: string) => void;
  readonly startLoading?: LoadingStarter;
}

/* v8 ignore next -- wiring to the real spawn boundary; launchThroughSpawn itself is unit-tested. */
const defaultExecLauncher: AgentProcessLauncher = (plan, piBinary) => launchThroughSpawn(spawnLauncher, plan, piBinary);

// Exec never onboards: a management subcommand must not launch the first-run walkthrough, so no
// setup runner reaches the shared pipeline and the standard no-agent error applies instead.
export const executeExecAgentCommand = async (input: ExecAgentInput): Promise<ExecAgentResult> => {
  const subcommand: HarnessSubcommand = { name: input.subcommand, args: input.subcommandArgs };
  return executeAgentPipeline({
    homeDirectory: input.homeDirectory,
    projectDirectory: input.projectDirectory,
    agent: input.agent,
    harness: input.harness,
    isolated: input.isolated,
    strict: input.strict,
    sourceCachePolicy: input.sourceCachePolicy,
    logLevel: input.logLevel,
    retainProjection: input.retainProjection,
    launchMode: 'subcommand',
    subcommand,
    launcher: input.launcher,
    writeLine: input.writeLine,
    startLoading: input.startLoading,
  });
};

export const createExecAgentCommand = (dependencies: ExecCommandDependencies = {}): CommandObject => ({
  name: 'exec',
  description: 'Run a harness CLI subcommand (e.g. pi list, pi install) inside the composed projection.',
  register(program: Command): void {
    program
      .command('exec')
      .description('Run a harness CLI subcommand (e.g. pi list, pi install) inside the composed projection.')
      .argument('<agent>', 'Agent slug whose composed profile provides the environment.')
      .argument('<subcommand>', 'Harness CLI subcommand to run; it becomes argv[0] of the harness process.')
      .argument('[args...]', 'Arguments passed to the subcommand verbatim.')
      .addOption(new Option('--harness <harness>', 'Harness to launch.').choices([...HARNESSES]))
      .addOption(
        new Option('--log-level <level>', 'Set startup log detail.')
          .choices(['info', 'debug'])
          .default('info')
          .env('OUTFITTER_LOG_LEVEL'),
      )
      .option('--strict', 'Treat composition warnings and unsupported loadout elements as fatal.')
      .addOption(
        new Option('--source-cache-policy <policy>', 'Remote source cache startup policy.').choices([
          ...SOURCE_CACHE_POLICIES,
        ]),
      )
      .option(
        '--isolated',
        'Launch from the composed profile alone, ignoring your own harness configuration (trust, permissions, MCP servers, plugins).',
      )
      .option(
        '--retain-projection',
        'Keep the runtime projection directory after the subcommand exits, for inspection.',
      )
      .allowUnknownOption(true)
      .action(
        async (
          agent: string,
          subcommand: string,
          subcommandArgs: readonly string[],
          options: {
            harness?: string;
            logLevel: RunLogLevel;
            isolated?: boolean;
            retainProjection?: boolean;
            strict?: boolean;
            sourceCachePolicy?: SourceCachePolicy;
          },
        ) => {
          /* v8 ignore next 3 -- process/launcher defaults are exercised by the CLI entrypoint, not unit tests. */
          const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
          const projectDirectory = resolveProjectDirectory(dependencies.projectDirectory);
          const launcher = dependencies.launcher ?? defaultExecLauncher;
          const result = await executeExecAgentCommand({
            homeDirectory,
            projectDirectory,
            agent,
            subcommand,
            subcommandArgs,
            harness: options.harness,
            logLevel: options.logLevel,
            isolated: options.isolated,
            retainProjection: options.retainProjection,
            strict: options.strict,
            sourceCachePolicy: options.sourceCachePolicy,
            launcher,
            // executeExecAgentCommand emits messages (before launch) through this sink.
            /* v8 ignore next -- console.error fallback is direct CLI behavior; tests inject a writer. */
            writeLine: dependencies.writeLine ?? console.error,
            startLoading: dependencies.startLoading ?? startTerminalLoading,
          });

          process.exitCode = result.exitCode;
        },
      );
  },
});
