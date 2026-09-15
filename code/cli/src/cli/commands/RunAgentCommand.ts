// `outfitter run [agent]` — command object over the shared agent pipeline (session launch mode).
import { Command, Option } from 'commander';

import { launchThroughSpawn, spawnLauncher } from '../../agents/AgentLaunch.js';
import type { SourceCachePolicy } from '../../settings/Settings.js';
import { HARNESSES, SOURCE_CACHE_POLICIES } from '../../settings/Settings.js';
import { startTerminalLoading } from '../TerminalLoading.js';
import type { LoadingStarter } from '../TerminalLoading.js';
import type { CommandObject } from './CommandObject.js';
import { executeAgentPipeline } from './AgentCommandPipeline.js';
import type {
  AgentPipelineInput,
  AgentPipelineResult,
  AgentProcessLauncher,
  RunLogLevel,
  SetupRunner,
} from './AgentCommandPipeline.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';
import { runSetup } from './SetupCommand.js';

export type { AgentProcessLauncher, RunLogLevel, SetupRunner };
export type RunAgentInput = Omit<AgentPipelineInput, 'launchMode' | 'subcommand'>;
export type RunAgentResult = AgentPipelineResult;

export interface RunAgentDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly launcher?: AgentProcessLauncher;
  readonly setup?: SetupRunner;
  readonly writeLine?: (message: string) => void;
  readonly startLoading?: LoadingStarter;
}

/* v8 ignore start -- real-TTY onboarding wiring; the setup state machine is tested via an injected runner. */
// Onboard only when attached to a real terminal; scripted/CI runs get the normal "no agent" error.
const interactiveSetupRunner: SetupRunner = async ({ homeDirectory, projectDirectory }) =>
  runSetup({ homeDirectory, projectDirectory });
/* v8 ignore stop */

export const executeRunAgentCommand = async (input: RunAgentInput): Promise<RunAgentResult> =>
  executeAgentPipeline({ ...input, launchMode: 'session' });

// Re-exported for tests and sibling commands; the shared launcher lives in AgentLaunch.
export { launchThroughSpawn } from '../../agents/AgentLaunch.js';

/* v8 ignore next -- wiring to the real spawn boundary; launchThroughSpawn itself is unit-tested. */
const defaultLauncher: AgentProcessLauncher = (plan, piBinary) => launchThroughSpawn(spawnLauncher, plan, piBinary);

export const createRunAgentCommand = (dependencies: RunAgentDependencies = {}): CommandObject => ({
  name: 'run',
  description: 'Resolve, compose, and launch an agent in the selected harness.',
  register(program: Command): void {
    program
      .command('run', { isDefault: true })
      .description('Resolve, compose, and launch an agent in the selected harness.')
      .argument('[agent]', 'Agent slug to run (default: settings default_agent).')
      .argument('[args...]', 'Arguments passed through to the harness after --.')
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
      .option('--retain-projection', 'Keep the runtime projection directory after the run, for inspection.')
      .option(
        '--append-prompt <path>',
        'Append a Markdown document to the system prompt. Repeatable; applied in the order given.',
        (value: string, previous: readonly string[] = []) => [...previous, value],
      )
      .allowUnknownOption(true)
      .action(
        async (
          agent: string | undefined,
          passThroughArgs: readonly string[],
          options: {
            harness?: string;
            logLevel: RunLogLevel;
            isolated?: boolean;
            retainProjection?: boolean;
            strict?: boolean;
            sourceCachePolicy?: SourceCachePolicy;
            appendPrompt?: readonly string[];
          },
        ) => {
          // When run is the default command, Commander consumes leading flags like `-r` or `--resume`
          // as the optional [agent] positional. Reclassify option-shaped agent values as pass-through
          // arguments so they reach the harness CLI instead of failing agent resolution.
          let effectiveAgent = agent;
          let effectivePassThrough = passThroughArgs;
          if (agent !== undefined && agent.startsWith('-')) {
            effectiveAgent = undefined;
            effectivePassThrough = [agent, ...passThroughArgs];
          }

          /* v8 ignore next 3 -- process/launcher defaults are exercised by the CLI entrypoint, not unit tests. */
          const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
          const projectDirectory = resolveProjectDirectory(dependencies.projectDirectory);
          const launcher = dependencies.launcher ?? defaultLauncher;
          const result = await executeRunAgentCommand({
            homeDirectory,
            projectDirectory,
            agent: effectiveAgent,
            harness: options.harness,
            logLevel: options.logLevel,
            isolated: options.isolated,
            retainProjection: options.retainProjection,
            strict: options.strict,
            sourceCachePolicy: options.sourceCachePolicy,
            passThroughArgs: effectivePassThrough,
            appendPromptPaths: options.appendPrompt,
            launcher,
            setup: dependencies.setup ?? interactiveSetupRunner,
            // executeRunAgentCommand emits messages (before launch) through this sink.
            /* v8 ignore next -- console.error fallback is direct CLI behavior; tests inject a writer. */
            writeLine: dependencies.writeLine ?? console.error,
            startLoading: dependencies.startLoading ?? startTerminalLoading,
          });

          process.exitCode = result.exitCode;
        },
      );
  },
});
