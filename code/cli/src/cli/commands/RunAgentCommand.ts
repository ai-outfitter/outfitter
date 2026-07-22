// `outfitter run [agent]` — resolve → compose → project → launch on the .agents model.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command, Option } from 'commander';

import { launchThroughSpawn, spawnLauncher } from '../../agents/AgentLaunch.js';
import {
  persistPiCredentials,
  resolvePiUserAgentDirectory,
  seedPiCredentials,
} from '../../agents/PiCredentialPersistence.js';
import { compose } from '../../composer/Composer.js';
import { ensurePiExtensions } from '../../extensions/PiExtensionCache.js';
import type { PiInstallSpawner } from '../../extensions/PiExtensionCache.js';
import { resolveOutfitterCacheDir } from '../../paths/OutfitterCache.js';
import { projectComposition } from '../../projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import type { ProjectionStateMonitorDependencies } from '../../projection/ProjectionStateMonitor.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { Harness } from '../../settings/Settings.js';
import { HARNESSES } from '../../settings/Settings.js';
import type { SetupResult } from '../../setup/Setup.js';
import type { CommandObject } from './CommandObject.js';
import { attachPiRuntimeExtension } from './PiRuntimeLaunch.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';
import { runSetup } from './SetupCommand.js';
import { resolveClaudeLoginHint } from './run/RunClaudeOnboarding.js';
import { runWithProjectionStateMonitoring } from './run/RunProjectionState.js';
import type { RunProjectionStateResult } from './run/RunProjectionState.js';

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
  /** Sink for setup notices and warnings; emitted before launch so they precede the pi session. */
  readonly writeLine?: (message: string) => void;
  /** Test seam for the `pi install` boundary used to cache pi extensions. */
  readonly extensionInstallSpawner?: PiInstallSpawner;
  /** Override terminal detection for Claude's native-login handoff. */
  readonly interactive?: boolean;
  /** Test seams for live runtime-projection state monitoring. */
  readonly stateWriteMonitor?: ProjectionStateMonitorDependencies;
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

const discardLine = (_message: string): void => undefined;

const assertNoSettingsIssues = (issues: readonly { readonly message: string }[]): void => {
  if (issues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${issues.map((issue) => issue.message).join('; ')}`);
  }
};

// pi stores credentials under PI_CODING_AGENT_DIR (the ephemeral projection root), so seed them from
// pi's durable agent dir before launch and copy any /login changes back afterward. Non-pi harnesses
// launch unchanged.
const launchWithCredentialPersistence = async (
  input: RunAgentInput,
  harness: Harness,
  agent: string,
  rootDirectory: string,
  launch: AgentLaunchPlan,
  statePaths: ReturnType<typeof projectComposition>['statePaths'],
): Promise<{ readonly exitCode: number; readonly warnings: readonly string[] }> => {
  const piUserAgentDirectory = harness === 'pi' ? resolvePiUserAgentDirectory(input.homeDirectory) : undefined;
  if (piUserAgentDirectory !== undefined) seedPiCredentials(rootDirectory, piUserAgentDirectory);

  return runWithProjectionStateMonitoring({
    rootDirectory,
    homeDirectory: input.homeDirectory,
    harness,
    agent,
    statePaths,
    notify: input.writeLine ?? discardLine,
    monitor: input.stateWriteMonitor,
    launch: async () => {
      const exitCode = await input.launcher(launch);
      if (piUserAgentDirectory !== undefined) persistPiCredentials(rootDirectory, piUserAgentDirectory);
      return exitCode;
    },
  });
};

// Installs/caches the pi extensions for the composed agent (pi only) so they load at launch.
const resolvePiExtensions = async (
  input: RunAgentInput,
  harness: Harness,
  extensionSpecs: readonly string[],
): Promise<{ readonly loadDirs: readonly string[]; readonly warnings: readonly string[] }> => {
  if (harness !== 'pi') return { loadDirs: [], warnings: [] };
  return ensurePiExtensions(extensionSpecs, {
    cacheAgentDir: join(resolveOutfitterCacheDir(process.env, input.homeDirectory), 'pi-extensions'),
    offline: process.env.PI_OFFLINE === '1' || process.env.PI_OFFLINE === 'true',
    spawn: input.extensionInstallSpawner,
  });
};

const emitMessages = (input: RunAgentInput, messages: readonly string[]): void => {
  for (const message of messages) input.writeLine?.(message);
};

const createPrelaunchMessages = (
  input: RunAgentInput,
  harness: Harness,
  setupMessages: readonly string[],
  warnings: readonly string[],
): readonly string[] => {
  const claudeLoginHint = resolveClaudeLoginHint({
    harness,
    homeDirectory: input.homeDirectory,
    passThroughArgs: input.passThroughArgs ?? [],
    interactive: input.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });
  return [...setupMessages, ...warnings, ...(claudeLoginHint === undefined ? [] : [claudeLoginHint])];
};

const finishProjectionStateRun = (
  input: RunAgentInput,
  launch: AgentLaunchPlan,
  messages: readonly string[],
  stateResult: RunProjectionStateResult,
): RunAgentResult => {
  emitMessages(input, stateResult.warnings);
  if (input.strict !== true || stateResult.warnings.length === 0) {
    return { launchPlan: launch, exitCode: stateResult.exitCode, messages: [...messages, ...stateResult.warnings] };
  }

  const strictMessage = 'Strict mode: undeclared runtime projection writes are fatal.';
  emitMessages(input, [strictMessage]);
  return {
    launchPlan: launch,
    exitCode: 1,
    messages: [...messages, ...stateResult.warnings, strictMessage],
  };
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
    const messages = [...setupMessages, ...composed.errors];
    emitMessages(input, messages);
    return { exitCode: 1, messages };
  }

  // Install/cache the pi extensions into a shared XDG cache and load them at launch (pi only).
  const extensions = await resolvePiExtensions(input, harness, composed.plan.loadout.extensions);

  const rootDirectory = mkdtempSync(join(tmpdir(), `outfitter-${agentSlug}-${harness}-`));

  try {
    const projection = projectComposition(composed.plan, {
      harness,
      rootDirectory,
      homeDirectory: input.homeDirectory,
      passThroughArgs: input.passThroughArgs,
      extensionLoadDirs: harness === 'pi' ? extensions.loadDirs : undefined,
    });

    // Composition warnings, unsupported harness elements, and extension-install failures are all
    // advisory; --strict makes the combined set fatal before launch.
    const warnings = [
      ...composed.plan.warnings,
      ...projection.unsupported.map((element) => `harness '${harness}' cannot project loadout element '${element}'.`),
      ...extensions.warnings,
    ];

    if (input.strict === true && warnings.length > 0) {
      const messages = [
        ...setupMessages,
        ...warnings,
        'Strict mode: composition warnings and unsupported elements are fatal.',
      ];
      emitMessages(input, messages);
      return { exitCode: 1, messages };
    }

    // Emit setup notices and warnings before launch so they precede the pi session on the terminal.
    const messages = createPrelaunchMessages(input, harness, setupMessages, warnings);
    emitMessages(input, messages);

    // Attach the Outfitter runtime extension so interactive pi sessions restore the "connect a
    // model provider" sign-in prompt when no models are available, instead of pi's raw warning.
    const launch = attachPiRuntimeExtension(projection.launch);
    const stateResult = await launchWithCredentialPersistence(
      input,
      harness,
      agentSlug,
      rootDirectory,
      launch,
      projection.statePaths,
    );
    return finishProjectionStateRun(input, launch, messages, stateResult);
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
            // executeRunAgentCommand emits messages (before launch) through this sink.
            /* v8 ignore next -- console.error fallback is direct CLI behavior; tests inject a writer. */
            writeLine: dependencies.writeLine ?? console.error,
          });

          process.exitCode = result.exitCode;
        },
      );
  },
});
