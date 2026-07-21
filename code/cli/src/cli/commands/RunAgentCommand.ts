// `outfitter run [agent]` — resolve → compose → project → launch on the .agents model.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command, Option } from 'commander';

import { launchThroughSpawn, spawnLauncher } from '../../agents/AgentLaunch.js';
import { compose } from '../../composer/Composer.js';
import { projectComposition } from '../../projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { Harness } from '../../settings/Settings.js';
import { HARNESSES } from '../../settings/Settings.js';
import type { SetupResult } from '../../setup/Setup.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';
import { runSetup } from './SetupCommand.js';

export type AgentProcessLauncher = (plan: AgentLaunchPlan) => Promise<number>;

/**
 * Runs first-run onboarding when `run` finds nothing configured. Returns the setup result, or
 * `undefined` when setup was not performed (e.g. non-interactive), so the caller falls back to the
 * normal "no agent selected" error.
 */
export type SetupRunner = (input: {
  homeDirectory: string;
  projectDirectory: string;
}) => Promise<SetupResult | undefined>;

export interface RunAgentInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly agent?: string;
  readonly harness?: string;
  readonly strict?: boolean;
  readonly passThroughArgs?: readonly string[];
  readonly launcher: AgentProcessLauncher;
  /** Onboarding to run once when no agent is selected and settings define no `default_agent`. */
  readonly setup?: SetupRunner;
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
  readonly setup?: SetupRunner;
  readonly writeLine?: (message: string) => void;
}

/* v8 ignore start -- real-TTY onboarding wiring; the setup state machine is tested via an injected runner. */
// Onboard only when attached to a real terminal; scripted/CI runs get the normal "no agent" error.
const interactiveSetupRunner: SetupRunner = async ({ homeDirectory, projectDirectory }) =>
  runSetup({ homeDirectory, projectDirectory });
/* v8 ignore stop */

const resolveAgentSlug = (settingsDefault: string | undefined, requested: string | undefined): string => {
  const slug = requested ?? settingsDefault;

  if (slug === undefined) {
    throw new Error("No agent selected and no 'default_agent' in settings. Pass an agent: outfitter run <agent>.");
  }

  return slug;
};

const resolveHarness = (settingsDefault: Harness | undefined, requested: string | undefined): Harness => {
  const harness = requested ?? settingsDefault ?? 'pi';

  if (!HARNESSES.includes(harness as Harness)) {
    throw new Error(`Unknown harness '${harness}'. Use --harness pi or --harness claude.`);
  }

  return harness as Harness;
};

const assertNoSettingsIssues = (issues: readonly { readonly message: string }[]): void => {
  if (issues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${issues.map((issue) => issue.message).join('; ')}`);
  }
};

export const executeRunAgentCommand = async (input: RunAgentInput): Promise<RunAgentResult> => {
  let resolved = resolveEffectiveSet(input);
  assertNoSettingsIssues(resolved.settingsIssues);

  // First run: nothing selected and no default configured — onboard, then resolve again.
  const setupMessages: string[] = [];
  if (input.agent === undefined && resolved.settings.defaultAgent === undefined && input.setup !== undefined) {
    const setupResult = await input.setup({
      homeDirectory: input.homeDirectory,
      projectDirectory: input.projectDirectory,
    });

    if (setupResult !== undefined) {
      setupMessages.push(...setupResult.messages);
      resolved = resolveEffectiveSet(input);
      assertNoSettingsIssues(resolved.settingsIssues);
    }
  }

  const { set, settings } = resolved;
  const agentSlug = resolveAgentSlug(settings.defaultAgent, input.agent);
  const harness = resolveHarness(settings.defaultHarness, input.harness);
  const composed = compose(set, agentSlug);

  if (composed.plan === undefined) {
    return { exitCode: 1, messages: [...setupMessages, ...composed.errors] };
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
        messages: [
          ...setupMessages,
          ...warnings,
          'Strict mode: composition warnings and unsupported elements are fatal.',
        ],
      };
    }

    const exitCode = await input.launcher(projection.launch);
    return { launchPlan: projection.launch, exitCode, messages: [...setupMessages, ...warnings] };
  } finally {
    if (input.retainProjection !== true) {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  }
};

// Re-exported for tests and sibling commands; the shared launcher lives in AgentLaunch.
export { launchThroughSpawn } from '../../agents/AgentLaunch.js';

/* v8 ignore next -- wiring to the real spawn boundary; launchThroughSpawn itself is unit-tested. */
const defaultLauncher: AgentProcessLauncher = (plan) => launchThroughSpawn(spawnLauncher, plan);

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
      .option('--strict', 'Treat composition warnings and unsupported loadout elements as fatal.')
      .allowUnknownOption(true)
      .action(
        async (
          agent: string | undefined,
          passThroughArgs: readonly string[],
          options: { harness?: string; strict?: boolean },
        ) => {
          /* v8 ignore next 3 -- process/launcher defaults are exercised by the CLI entrypoint, not unit tests. */
          const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
          const projectDirectory = resolveProjectDirectory(dependencies.projectDirectory);
          const launcher = dependencies.launcher ?? defaultLauncher;
          const result = await executeRunAgentCommand({
            homeDirectory,
            projectDirectory,
            agent,
            harness: options.harness,
            strict: options.strict,
            passThroughArgs,
            launcher,
            setup: dependencies.setup ?? interactiveSetupRunner,
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
