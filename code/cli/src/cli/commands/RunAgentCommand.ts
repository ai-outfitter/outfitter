// `outfitter run [agent]` — resolve → compose → project → launch on the .agents model.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command, Option } from 'commander';

import { launchThroughSpawn, spawnLauncher } from '../../agents/AgentLaunch.js';
import type { ClaudeConfigDecision, HarnessHelpReader } from '../../agents/ClaudeConfigStrategy.js';
import { decideClaudeConfigStrategy, resolveIsolation } from '../../agents/ClaudeConfigStrategy.js';
import {
  persistClaudeCredentials,
  persistClaudeSessions,
  seedClaudeCredentials,
  seedClaudeSessions,
} from '../../agents/ClaudeStatePersistence.js';
import {
  persistPiCredentials,
  resolvePiUserAgentDirectory,
  seedPiCredentials,
} from '../../agents/PiCredentialPersistence.js';
import { resolvePiSessionDirectory } from '../../agents/PiSessionDirectory.js';
import type { CompositionPlan } from '../../composer/Composition.js';
import { compose } from '../../composer/Composer.js';
import { ensurePiExtensions } from '../../extensions/PiExtensionCache.js';
import type { EnsurePiExtensionsResult, PiInstallSpawner } from '../../extensions/PiExtensionCache.js';
import { resolveOutfitterCacheDir } from '../../paths/OutfitterCache.js';
import { projectComposition } from '../../projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import { strictAmbiguityFailureMessage } from '../../resolver/AmbiguityWarnings.js';
import { findResource } from '../../resolver/Resource.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { Harness, Isolation, Settings, SourceCachePolicy } from '../../settings/Settings.js';
import { HARNESSES, SOURCE_CACHE_POLICIES } from '../../settings/Settings.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../settings/SettingsLoader.js';
import { prepareSourceCaches } from '../../sources/SourceCachePolicy.js';
import { setupNextStepMessage } from '../../setup/Setup.js';
import type { SetupResult } from '../../setup/Setup.js';
import { attachSystemExtensionHooks } from '../../system/SystemExtensionHook.js';
import { startTerminalLoading } from '../TerminalLoading.js';
import type { LoadingStarter } from '../TerminalLoading.js';
import type { CommandObject } from './CommandObject.js';
import { attachPiRuntimeExtension } from './PiRuntimeLaunch.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';
import { runSetup } from './SetupCommand.js';

export type AgentProcessLauncher = (plan: AgentLaunchPlan) => Promise<number>;
export type RunLogLevel = 'info' | 'debug';

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
  /** Launch from the projection alone, ignoring the machine's own harness configuration. */
  readonly isolated?: boolean;
  readonly strict?: boolean;
  readonly sourceCachePolicy?: SourceCachePolicy;
  readonly logLevel?: RunLogLevel;
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
  /** Test seam for the `claude --help` probe that confirms the installed CLI can inherit. */
  readonly harnessHelpReader?: HarnessHelpReader;
  /** Test seam for the `pi install` boundary used to cache pi extensions. */
  readonly extensionInstallSpawner?: PiInstallSpawner;
  /** Optional loading UI. The command wires a terminal spinner; tests can observe this boundary. */
  readonly startLoading?: LoadingStarter;
  /** Test seam for startup cache establishment. */
  readonly sourceCachePreparer?: typeof prepareSourceCaches;
}

export interface RunAgentResult {
  readonly launchPlan?: AgentLaunchPlan;
  readonly exitCode: number;
  readonly messages: readonly string[];
}

class ExtensionInstallInterrupted extends Error {
  constructor(readonly result: EnsurePiExtensionsResult & { readonly interruptedExitCode: number }) {
    super(result.warnings.join('\n'));
  }
}

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

// Claude is the only harness with an inherit path, so nothing else pays for the help probe.
const resolveClaudeConfig = (
  input: RunAgentInput,
  harness: Harness,
  settingsIsolation: Isolation | undefined,
): ClaudeConfigDecision => {
  if (harness !== 'claude') return { isolation: 'isolated' };
  return decideClaudeConfigStrategy(
    resolveIsolation(settingsIsolation, input.isolated === true),
    input.harnessHelpReader,
  );
};

// Launch facts rather than composition warnings: a forced fallback and a retained projection are
// both things the user must be told, and neither should make `--strict` fail an otherwise fine run.
const launchNotices = (
  input: RunAgentInput,
  claudeConfig: ClaudeConfigDecision,
  rootDirectory: string,
): readonly string[] => [
  ...(claudeConfig.warning === undefined ? [] : [claudeConfig.warning]),
  ...(input.retainProjection === true ? [`Retaining the runtime projection at ${rootDirectory}`] : []),
];

const assertNoSettingsIssues = (issues: readonly { readonly message: string }[]): void => {
  if (issues.length > 0) {
    throw new Error(`Cannot run with invalid settings: ${issues.map((issue) => issue.message).join('; ')}`);
  }
};

const establishSourceCaches = (input: RunAgentInput, policy?: SourceCachePolicy): SourceCachePolicy => {
  const localSettings = loadSettings(discoverSettingsLoadPlan(input));
  assertNoSettingsIssues(localSettings.issues);
  const selected = policy ?? input.sourceCachePolicy ?? localSettings.settings.sourceCache?.policy ?? 'repair';
  (input.sourceCachePreparer ?? prepareSourceCaches)({ ...input, policy: selected });
  return selected;
};

// Pi, and an isolated Claude, read credentials — and Claude its session history — from their
// ephemeral projection root. Seed the durable state before launch and persist changes in a finally
// block so login and session changes survive both a normal exit and a failed launcher. An inherited
// Claude run reads and writes the real ~/.claude directly, so it needs neither seed nor copy-back.
const persistUserPiModels = (plan: CompositionPlan): boolean => plan.models?.configured !== true;

const launchWithStatePersistence = async (
  input: RunAgentInput,
  harness: Harness,
  isolation: Isolation,
  rootDirectory: string,
  launch: AgentLaunchPlan,
  lateMessages: string[],
  persistPiModels: boolean,
): Promise<number> => {
  // Persist warnings surface after launch, and writeLine alone can be a dropped sink (setup's
  // auto-launch passes none), so they also go into lateMessages to reach the returned result.
  const warn = (message: string): void => {
    lateMessages.push(message);
    try {
      input.writeLine?.(message);
    } catch {
      // The returned late-message channel is authoritative; output sinks must never mask launch.
    }
  };
  const attempt = (label: string, action: () => void): void => {
    try {
      action();
    } catch (error) {
      warn(`Warning: failed to ${label}: ${String(error)}`);
    }
  };
  const piUserAgentDirectory = harness === 'pi' ? resolvePiUserAgentDirectory(input.homeDirectory) : undefined;
  const bridgesClaudeState = harness === 'claude' && isolation === 'isolated';
  let seededClaudeCredentialsHash: string | undefined;
  let seededClaudeSessionHashes: ReadonlyMap<string, string> = new Map();
  if (piUserAgentDirectory !== undefined) seedPiCredentials(rootDirectory, piUserAgentDirectory);
  if (bridgesClaudeState) {
    seededClaudeCredentialsHash = seedClaudeCredentials(rootDirectory, input.homeDirectory, input.projectDirectory);
    attempt('seed Claude session history', () => {
      const seed = seedClaudeSessions(rootDirectory, input.homeDirectory, input.projectDirectory);
      seededClaudeSessionHashes = seed.hashes;
      if (seed.warning !== undefined) warn(seed.warning);
    });
  }

  try {
    return await input.launcher(launch);
  } finally {
    if (piUserAgentDirectory !== undefined) {
      attempt('persist Pi credentials', () =>
        persistPiCredentials(rootDirectory, piUserAgentDirectory, persistPiModels),
      );
    }
    if (bridgesClaudeState) {
      attempt('persist Claude credentials', () => {
        const conflictWarning = persistClaudeCredentials(
          rootDirectory,
          input.homeDirectory,
          seededClaudeCredentialsHash,
        );
        if (conflictWarning !== undefined) warn(conflictWarning);
      });
      attempt('persist Claude session history', () => {
        const warning = persistClaudeSessions(rootDirectory, input.homeDirectory, seededClaudeSessionHashes);
        if (warning !== undefined) warn(warning);
      });
    }
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
): Promise<EnsurePiExtensionsResult> => {
  if (harness !== 'pi') return { loadDirs: [], warnings: [] };
  return ensurePiExtensions(extensionSpecs, {
    cacheAgentDir: join(resolveOutfitterCacheDir(process.env, input.homeDirectory), 'pi-extensions'),
    offline: process.env.PI_OFFLINE === '1' || process.env.PI_OFFLINE === 'true',
    debug: input.logLevel === 'debug',
    spawn: input.extensionInstallSpawner,
  });
};

const loadPiExtensions = async (
  input: RunAgentInput,
  harness: Harness,
  agentSlug: string,
  extensionSpecs: readonly string[],
): ReturnType<typeof resolvePiExtensions> => {
  const showLoading = harness === 'pi' && input.logLevel !== 'debug' && extensionSpecs.length > 0;
  const stopLoading = showLoading
    ? (input.startLoading?.(`Loading ${agentSlug} profile…`) ?? (() => undefined))
    : () => undefined;
  try {
    const result = await resolvePiExtensions(input, harness, extensionSpecs);
    if (result.interruptedExitCode !== undefined) {
      throw new ExtensionInstallInterrupted({ ...result, interruptedExitCode: result.interruptedExitCode });
    }
    return result;
  } finally {
    stopLoading();
  }
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

const shouldRunSetup = (
  input: RunAgentInput,
  resolved: ReturnType<typeof resolveEffectiveSet>,
): input is RunAgentInput & { readonly setup: NonNullable<RunAgentInput['setup']> } =>
  input.agent === undefined && resolved.settings.defaultAgent === undefined && input.setup !== undefined;

const setupDidNotSelectAgent = (result: SetupResult | undefined): result is SetupResult =>
  result !== undefined && result.defaultAgent === undefined;

const resolutionWarningsForRun = (
  resolved: ReturnType<typeof resolveEffectiveSet>,
  strict: boolean | undefined,
): readonly string[] => (strict === true ? resolved.warnings.map((warning) => `warning: ${warning}`) : []);

const failedCompositionMessages = (
  resolved: ReturnType<typeof resolveEffectiveSet>,
  composed: ReturnType<typeof compose>,
): readonly string[] => {
  return [
    ...composed.warnings,
    ...composed.errors,
    ...(resolved.unsynchronizedWarnings.length === 0
      ? []
      : ["Some configured sources are not synchronized. Run 'outfitter sync', then try again."]),
  ];
};

const harnessDefaultsFor = (settings: Settings, harness: Harness) => settings.harnessDefaults?.[harness];

const executeRunAgentCommandInner = async (input: RunAgentInput): Promise<RunAgentResult> => {
  // Flush messages to the terminal (before launch); they are also returned so callers can inspect them.
  const emit = (messages: readonly string[]): void => {
    for (const message of messages) input.writeLine?.(message);
  };

  const sourceCachePolicy = establishSourceCaches(input);
  let resolved = resolveEffectiveSet(input);
  assertNoSettingsIssues(resolved.settingsIssues);
  assertReadableAppendPrompts(input.appendPromptPaths);

  // First run: nothing selected and no default configured — onboard, then resolve again.
  if (shouldRunSetup(input, resolved)) {
    const setupResult = await input.setup({
      homeDirectory: input.homeDirectory,
      projectDirectory: input.projectDirectory,
    });

    if (setupDidNotSelectAgent(setupResult)) {
      const messages = [setupNextStepMessage];
      emit(messages);
      return { exitCode: 0, messages };
    }
    // Keep the transition quiet so the real profile UI is the first persistent output.
    establishSourceCaches(input, sourceCachePolicy);
    resolved = resolveEffectiveSet(input);
    assertNoSettingsIssues(resolved.settingsIssues);
  }

  // Strict mode exposes the complete final resolution state. Normal startup uses these diagnostics
  // only to turn an unavailable selected agent into a concise synchronization action.
  const resolutionWarnings = resolutionWarningsForRun(resolved, input.strict);

  if (input.strict === true && resolved.ambiguityWarnings.length > 0) {
    const messages = [...resolutionWarnings, strictAmbiguityFailureMessage];
    emit(messages);
    return { exitCode: 1, messages };
  }

  const { set, settings } = resolved;
  const agentSlug = resolveAgentSlug(settings.defaultAgent, input.agent);
  const harness = resolveHarness(settings.defaultHarness, input.harness);
  const claudeConfig = resolveClaudeConfig(input, harness, settings.isolation);
  const composed = compose(set, agentSlug, {
    projectDirectory: input.projectDirectory,
    agentDefaults: settings.agentDefaults,
  });

  if (composed.plan === undefined) {
    const messages = [...resolutionWarnings, ...failedCompositionMessages(resolved, composed)];
    emit(messages);
    return { exitCode: 1, messages };
  }

  // Install/cache the pi extensions into a shared XDG cache and load them at launch (pi only).
  // Normal startup keeps installer chatter behind one loading state. Debug mode exposes it.
  const extensions = await loadPiExtensions(input, harness, agentSlug, composed.plan.loadout.extensions);
  const selectedAgent = findResource(set, 'agent', agentSlug)!;
  const configurationOverlays = piConfigurationOverlays(composed.plan, selectedAgent);

  const rootDirectory = mkdtempSync(join(tmpdir(), `outfitter-${agentSlug}-${harness}-`));

  try {
    const projection = projectComposition(composed.plan, {
      harness,
      rootDirectory,
      homeDirectory: input.homeDirectory,
      processEnvironment: process.env,
      isolation: claudeConfig.isolation,
      profileSlug: agentSlug,
      sessionDirectory: resolveSessionDirectory(input, harness),
      passThroughArgs: input.passThroughArgs,
      appendPromptPaths: input.appendPromptPaths,
      extensionLoadDirs: harness === 'pi' ? extensions.loadDirs : undefined,
      // ProjectHarness only overlays these for the pi harness, so pass them through unconditionally.
      configurationOverlayDirectories: configurationOverlays,
      harnessDefaults: harnessDefaultsFor(settings, harness),
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
        ...resolutionWarnings,
        ...warnings,
        'Strict mode: composition warnings and unsupported elements are fatal.',
      ];
      emit(messages);
      return { exitCode: 1, messages };
    }

    // Normal startup stays quiet. Strict mode retains the complete resolution diagnostics, while
    // composition/projection warnings stay visible because they describe a degraded launch.
    const messages = [...resolutionWarnings, ...warnings, ...launchNotices(input, claudeConfig, rootDirectory)];
    emit(messages);

    // Attach the Outfitter runtime UI and sign-in extension to interactive pi sessions.
    const launch = attachPiRuntimeExtension(projection.launch, {
      profile: { id: agentSlug, label: composed.plan.identity.label },
      rootDirectory,
    });
    // System hooks attach last, after projection and after the runtime extension,
    // so an organization's collector applies to every launch — including
    // `--mode rpc`, which fleet agents run — and cannot trip strict mode.
    const systemHooks = attachSystemExtensionHooks(launch);
    messages.push(...systemHooks.warnings);
    emit(systemHooks.warnings);
    const exitCode = await launchWithStatePersistence(
      input,
      harness,
      claudeConfig.isolation,
      rootDirectory,
      systemHooks.launch,
      messages,
      persistUserPiModels(composed.plan),
    );

    return { launchPlan: systemHooks.launch, exitCode, messages };
  } finally {
    if (input.retainProjection !== true) {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
  }
};

export const executeRunAgentCommand = async (input: RunAgentInput): Promise<RunAgentResult> => {
  try {
    return await executeRunAgentCommandInner(input);
  } catch (error) {
    if (!(error instanceof ExtensionInstallInterrupted)) throw error;
    for (const message of error.result.warnings) input.writeLine?.(message);
    return { exitCode: error.result.interruptedExitCode, messages: error.result.warnings };
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
      .addOption(
        new Option('--log-level <level>', 'Set startup log detail.')
          .choices(['info', 'debug'])
          .default('info')
          .env('OUTFITTER_LOG_LEVEL'),
      )
      .option('--strict', 'Treat ambiguity, composition warnings, and unsupported loadout elements as fatal.')
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
