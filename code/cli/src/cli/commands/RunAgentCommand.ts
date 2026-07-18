// `outfitter run [agent]` — resolve → compose → project → launch on the .agents model.
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { compose } from '../../composer/Composer.js';
import { projectComposition } from '../../projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import { loadSettingsWithCachedRemoteSettings } from '../../settings/SettingsLoader.js';
import type { Harness } from '../../settings/Settings.js';
import { Command } from 'commander';
import type { CommandObject } from './CommandObject.js';

export type AgentProcessLauncher = (plan: AgentLaunchPlan) => Promise<number>;

export interface RunAgentInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly agent?: string;
  readonly harness?: Harness;
  readonly strict?: boolean;
  readonly passThroughArgs?: readonly string[];
  readonly launcher: AgentProcessLauncher;
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

const resolveAgentSlug = (settingsDefault: string | undefined, requested: string | undefined): string => {
  const slug = requested ?? settingsDefault;

  if (slug === undefined) {
    throw new Error("No agent selected and no 'default_agent' in settings. Pass an agent: outfitter run <agent>.");
  }

  return slug;
};

const resolveHarness = (settingsDefault: Harness | undefined, requested: Harness | undefined): Harness =>
  requested ?? settingsDefault ?? 'pi';

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
  const projection = projectComposition(composed.plan, {
    harness,
    rootDirectory,
    homeDirectory: input.homeDirectory,
    passThroughArgs: input.passThroughArgs,
  });

  const warnings = [
    ...composed.plan.warnings,
    ...projection.unsupported.map((element) => `harness '${harness}' cannot project loadout element '${element}'.`),
  ];

  if (input.strict === true && projection.unsupported.length > 0) {
    return { exitCode: 1, messages: [...warnings, 'Strict mode: unsupported loadout elements are fatal.'] };
  }

  const exitCode = await input.launcher(projection.launch);
  return { launchPlan: projection.launch, exitCode, messages: warnings };
};

/* v8 ignore start -- real process spawn is covered by end-to-end smoke usage, not unit tests. */
const defaultLauncher: AgentProcessLauncher = async (plan) => {
  const { default: spawn } = await import('cross-spawn');
  return await new Promise<number>((resolve) => {
    const child = spawn(plan.command, [...plan.args], { stdio: 'inherit', env: { ...process.env, ...plan.env } });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
};
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
      .option('--harness <harness>', 'Harness to launch: pi or claude.')
      .option('--strict', 'Treat unsupported loadout elements as fatal.')
      .allowUnknownOption(true)
      .action(
        async (
          agent: string | undefined,
          passThroughArgs: readonly string[],
          options: { harness?: Harness; strict?: boolean },
        ) => {
          const result = await executeRunAgentCommand({
            /* v8 ignore next 2 -- process defaults exercised by the CLI entrypoint, not unit tests. */
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            agent,
            harness: options.harness,
            strict: options.strict,
            passThroughArgs,
            launcher: dependencies.launcher ?? defaultLauncher,
          });

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }

          process.exitCode = result.exitCode;
        },
      );
  },
});
