// `outfitter run [agent]` — resolve → compose → project → launch on the .agents model.
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command, Option } from 'commander';

import { launchAgentProcess, resolveAgentLaunchExecutable } from '../../agents/AgentLaunch.js';
import { compose } from '../../composer/Composer.js';
import { projectComposition } from '../../projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import { loadSettingsWithCachedRemoteSettings } from '../../settings/SettingsLoader.js';
import type { Harness } from '../../settings/Settings.js';
import type { CommandObject } from './CommandObject.js';

export type AgentProcessLauncher = (plan: AgentLaunchPlan) => Promise<number>;

export interface RunAgentInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly agent?: string;
  readonly harness?: string;
  readonly strict?: boolean;
  readonly passThroughArgs?: readonly string[];
  readonly launcher: AgentProcessLauncher;
  /** Keep the runtime projection directory after the run (debugging). */
  readonly retainProjection?: boolean;
}

export interface RunAgentResult {
  readonly launchPlan?: AgentLaunchPlan;
  readonly exitCode: number;
  readonly messages: readonly string[];
}

export interface RunAgentDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly launcher?: AgentProcessLauncher;
  readonly writeLine?: (message: string) => void;
}

const harnesses: readonly Harness[] = ['pi', 'claude'];

const resolveAgentSlug = (settingsDefault: string | undefined, requested: string | undefined): string => {
  const slug = requested ?? settingsDefault;

  if (slug === undefined) {
    throw new Error("No agent selected and no 'default_agent' in settings. Pass an agent: outfitter run <agent>.");
  }

  return slug;
};

const resolveHarness = (settingsDefault: Harness | undefined, requested: string | undefined): Harness => {
  const harness = requested ?? settingsDefault ?? 'pi';

  if (harness !== 'pi' && harness !== 'claude') {
    throw new Error(`Unknown harness '${harness}'. Use --harness pi or --harness claude.`);
  }

  return harness;
};

export const executeRunAgentCommand = async (input: RunAgentInput): Promise<RunAgentResult> => {
  const { settings } = loadSettingsWithCachedRemoteSettings(input);
  const { set, settingsIssues } = resolveEffectiveSet(input);

  if (settingsIssues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${settingsIssues.map((issue) => issue.message).join('; ')}`);
  }

  const agentSlug = resolveAgentSlug(settings.defaultAgent, input.agent);
  const harness = resolveHarness(settings.defaultHarness, input.harness);
  const composed = compose(set, agentSlug);

  if (composed.plan === undefined) {
    return { exitCode: 1, messages: composed.errors };
  }

  const rootDirectory = mkdtempSync(join(tmpdir(), `outfitter-${agentSlug}-${harness}-`));

  try {
    const projection = projectComposition(composed.plan, {
      harness,
      rootDirectory,
      homeDirectory: input.homeDirectory,
      passThroughArgs: input.passThroughArgs,
    });

    // Composition warnings (e.g. an unresolved skill) and unsupported harness elements are both
    // advisory; --strict makes the combined set fatal before launch.
    const warnings = [
      ...composed.plan.warnings,
      ...projection.unsupported.map((element) => `harness '${harness}' cannot project loadout element '${element}'.`),
    ];

    if (input.strict === true && warnings.length > 0) {
      return {
        exitCode: 1,
        messages: [...warnings, 'Strict mode: composition warnings and unsupported elements are fatal.'],
      };
    }

    const exitCode = await input.launcher(projection.launch);
    return { launchPlan: projection.launch, exitCode, messages: warnings };
  } finally {
    if (input.retainProjection !== true) {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  }
};

/* v8 ignore start -- real process spawn is covered by end-to-end smoke usage, not unit tests. */
const spawnLauncher = {
  async launch(plan: AgentLaunchPlan): Promise<number> {
    const { default: spawn } = await import('cross-spawn');
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(plan.command, [...plan.args], { stdio: 'inherit', env: { ...process.env, ...plan.env } });
      child.on('error', reject); // ENOENT surfaces as an actionable install message
      child.on('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  },
};

const makeDefaultLauncher =
  (agentId: Harness): AgentProcessLauncher =>
  (plan) =>
    launchAgentProcess(spawnLauncher, resolveAgentLaunchExecutable(plan), agentId);
/* v8 ignore stop */

export const createRunAgentCommand = (dependencies: RunAgentDependencies = {}): CommandObject => ({
  name: 'run',
  description: 'Resolve, compose, and launch an agent in the selected harness.',
  register(program: Command): void {
    program
      .command('run', { isDefault: true })
      .description('Resolve, compose, and launch an agent in the selected harness.')
      .argument('[agent]', 'Agent slug to run (default: settings default_agent).')
      .argument('[args...]', 'Arguments passed through to the harness after --.')
      .addOption(new Option('--harness <harness>', 'Harness to launch.').choices([...harnesses]))
      .option('--strict', 'Treat composition warnings and unsupported loadout elements as fatal.')
      .allowUnknownOption(true)
      .action(
        async (
          agent: string | undefined,
          passThroughArgs: readonly string[],
          options: { harness?: string; strict?: boolean },
        ) => {
          const result = await executeRunAgentCommand({
            /* v8 ignore next 2 -- process defaults exercised by the CLI entrypoint, not unit tests. */
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            agent,
            harness: options.harness,
            strict: options.strict,
            passThroughArgs,
            /* v8 ignore next -- the default spawn launcher is exercised by end-to-end usage. */
            launcher: dependencies.launcher ?? makeDefaultLauncher(resolveHarness(undefined, options.harness)),
          });

          for (const message of result.messages) {
            /* v8 ignore next -- console.error fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.error)(message);
          }

          process.exitCode = result.exitCode;
        },
      );
  },
});
