// `outfitter run [agent]` — resolve → compose → project → launch on the .agents model.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command, Option } from 'commander';

import { launchThroughSpawn, spawnLauncher } from '../../agents/AgentLaunch.js';
import { persistClaudeCredentials, seedClaudeCredentials } from '../../agents/ClaudeCredentialPersistence.js';
import {
  persistPiCredentials,
  resolvePiUserAgentDirectory,
  seedPiCredentials,
} from '../../agents/PiCredentialPersistence.js';
import { resolvePiSessionDirectory } from '../../agents/PiSessionDirectory.js';
import { compose } from '../../composer/Composer.js';
import { ensurePiExtensions } from '../../extensions/PiExtensionCache.js';
import type { PiInstallSpawner } from '../../extensions/PiExtensionCache.js';
import { resolveOutfitterCacheDir } from '../../paths/OutfitterCache.js';
import { projectComposition } from '../../projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import { findResource } from '../../resolver/Resource.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { Harness } from '../../settings/Settings.js';
import { HARNESSES } from '../../settings/Settings.js';
import type { SetupResult } from '../../setup/Setup.js';
import { readOutfitterVersion } from '../../version/OutfitterVersion.js';
import type { CommandObject } from './CommandObject.js';
import { attachPiRuntimeExtension } from './PiRuntimeLaunch.js';
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
  /** `--append-prompt` documents appended to the system prompt after the agent's own, in order. */
  readonly appendPromptPaths?: readonly string[];
  readonly launcher: AgentProcessLauncher;
  /** Onboarding to run once when no agent is selected and settings define no `default_agent`. */
  readonly setup?: SetupRunner;
  /** Keep the runtime projection directory after the run (debugging). */
  readonly retainProjection?: boolean;
  /** Sink for setup notices and warnings; emitted before launch so they precede the pi session. */
  readonly writeLine?: (message: string) => void;
  /** Test seam for the `pi install` boundary used to cache pi extensions. */
  readonly extensionInstallSpawner?: PiInstallSpawner;
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
    throw new Error(`Unknown harness '${harness}'. Use --harness <${HARNESSES.join('|')}>.`);
  }

  return harness as Harness;
};

const assertNoSettingsIssues = (issues: readonly { readonly message: string }[]): void => {
  if (issues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${issues.map((issue) => issue.message).join('; ')}`);
  }
};

// Pi and Claude both read credentials from their ephemeral projection root. Seed their durable
// credentials before launch and persist changes in a finally block so login changes survive both a
// normal exit and a failed launcher.
const launchWithCredentialPersistence = async (
  input: RunAgentInput,
  harness: Harness,
  rootDirectory: string,
  launch: AgentLaunchPlan,
): Promise<number> => {
  const piUserAgentDirectory = harness === 'pi' ? resolvePiUserAgentDirectory(input.homeDirectory) : undefined;
  if (piUserAgentDirectory !== undefined) seedPiCredentials(rootDirectory, piUserAgentDirectory);
  if (harness === 'claude') {
    seedClaudeCredentials(rootDirectory, input.homeDirectory, input.projectDirectory);
  }

  try {
    return await input.launcher(launch);
  } finally {
    if (piUserAgentDirectory !== undefined) persistPiCredentials(rootDirectory, piUserAgentDirectory);
    if (harness === 'claude') persistClaudeCredentials(rootDirectory, input.homeDirectory);
  }
};

// pi writes sessions inside PI_CODING_AGENT_DIR — the projection root Outfitter deletes after the
// run — so resolve pi's durable per-project store instead and let `--continue` outlive the run. An
// inherited PI_CODING_AGENT_SESSION_DIR keeps precedence (undefined), as do non-pi harnesses.
const resolveSessionDirectory = (input: RunAgentInput, harness: Harness): string | undefined =>
  harness === 'pi' ? resolvePiSessionDirectory(process.env, input.homeDirectory, input.projectDirectory) : undefined;

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

const piConfigurationOverlays = (
  plan: NonNullable<ReturnType<typeof compose>['plan']>,
  selectedAgent: NonNullable<ReturnType<typeof findResource>>,
): readonly string[] =>
  [...(plan.contributingAgents ?? [selectedAgent])].reverse().flatMap((agent) => agent.piConfigDirectories ?? []);

// Validated before launch rather than inside projection: pi never reads these paths itself, so an
// unreadable one would otherwise fail differently per harness — a raw ENOENT out of the Claude
// concatenation, and a harness-generated error on pi.
const assertReadableAppendPrompts = (paths: readonly string[] | undefined): void => {
  const unreadable = (paths ?? []).filter((path) => statSync(path, { throwIfNoEntry: false })?.isFile() !== true);

  if (unreadable.length > 0) {
    throw new Error(`--append-prompt: not a readable file: ${unreadable.join(', ')}`);
  }
};

export const executeRunAgentCommand = async (input: RunAgentInput): Promise<RunAgentResult> => {
  // Flush messages to the terminal (before launch); they are also returned so callers can inspect them.
  const emit = (messages: readonly string[]): void => {
    for (const message of messages) input.writeLine?.(message);
  };

  let resolved = resolveEffectiveSet(input);
  assertNoSettingsIssues(resolved.settingsIssues);
  assertReadableAppendPrompts(input.appendPromptPaths);
  emit(resolved.warnings.map((warning) => `warning: ${warning}`));

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
  const composed = compose(set, agentSlug, { projectDirectory: input.projectDirectory });

  if (composed.plan === undefined) {
    const messages = [...setupMessages, ...composed.warnings, ...composed.errors];
    emit(messages);
    return { exitCode: 1, messages };
  }

  // Install/cache the pi extensions into a shared XDG cache and load them at launch (pi only).
  const extensions = await resolvePiExtensions(input, harness, composed.plan.loadout.extensions);
  const selectedAgent = findResource(set, 'agent', agentSlug)!;
  const configurationOverlays = piConfigurationOverlays(composed.plan, selectedAgent);

  const rootDirectory = mkdtempSync(join(tmpdir(), `outfitter-${agentSlug}-${harness}-`));

  try {
    const projection = projectComposition(composed.plan, {
      harness,
      rootDirectory,
      homeDirectory: input.homeDirectory,
      sessionDirectory: resolveSessionDirectory(input, harness),
      passThroughArgs: input.passThroughArgs,
      appendPromptPaths: input.appendPromptPaths,
      extensionLoadDirs: harness === 'pi' ? extensions.loadDirs : undefined,
      // ProjectHarness only overlays these for the pi harness, so pass them through unconditionally.
      configurationOverlayDirectories: configurationOverlays,
    });

    // Composition warnings, unsupported harness elements, and extension-install failures are all
    // advisory; --strict makes the combined set fatal before launch.
    const warnings = [
      ...composed.plan.warnings,
      ...projection.unsupported.map((element) => `harness '${harness}' cannot project loadout element '${element}'.`),
      ...projection.warnings,
      ...extensions.warnings,
    ];

    if (input.strict === true && warnings.length > 0) {
      const messages = [
        ...setupMessages,
        ...warnings,
        'Strict mode: composition warnings and unsupported elements are fatal.',
      ];
      emit(messages);
      return { exitCode: 1, messages };
    }

    // Emit setup notices and warnings before launch so they precede the pi session on the terminal.
    const messages = [...setupMessages, ...warnings];
    emit(messages);

    // Attach the Outfitter runtime UI and sign-in extension to interactive pi sessions.
    const launch = attachPiRuntimeExtension(projection.launch, {
      outfitterVersion: readOutfitterVersion(),
      profile: { id: agentSlug, label: composed.plan.identity.label },
      rootDirectory,
    });
    const exitCode = await launchWithCredentialPersistence(input, harness, rootDirectory, launch);

    return { launchPlan: launch, exitCode, messages };
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
          options: { harness?: string; strict?: boolean; appendPrompt?: readonly string[] },
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
            appendPromptPaths: options.appendPrompt,
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
