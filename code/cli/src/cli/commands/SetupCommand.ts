/* eslint-disable complexity */
// Provides the universal Pi-hosted `/outfitter` setup walkthrough.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Command, Option } from 'commander';

import { launchThroughSpawn, spawnLauncher } from '../../agents/AgentLaunch.js';
import {
  persistPiCredentials,
  resolvePiUserAgentDirectory,
  seedPiCredentials,
} from '../../agents/PiCredentialPersistence.js';
import { readRepositoryCodeAsset } from '../../paths/RepositoryAssets.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import type { Harness } from '../../settings/Settings.js';
import { HARNESSES } from '../../settings/Settings.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../settings/SettingsLoader.js';
import type { SetupAgentChoice, SetupResult, SetupSelection } from '../../setup/Setup.js';
import {
  applySetupSelection,
  discoverSetupAgentChoices,
  providerLoginHint,
  setupNextStepMessage,
} from '../../setup/Setup.js';
import { bootstrapDefaultCatalog } from '../../setup/DefaultCatalog.js';
import { startTerminalLoading } from '../TerminalLoading.js';
import type { LoadingStarter } from '../TerminalLoading.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';
import { executeRunAgentCommand } from './RunAgentCommand.js';
import type { RunAgentInput, RunLogLevel } from './RunAgentCommand.js';

export type SetupProcessLauncher = (plan: AgentLaunchPlan) => Promise<number>;

export interface SetupCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly defaultCatalogBootstrap?: (homeDirectory: string, cacheDirectory?: string) => string;
  readonly setupSourceUri?: string;
  readonly interactive?: boolean;
  readonly launcher?: SetupProcessLauncher;
  /** Launcher for the profile pi started after setup; defaults to the real spawn boundary. */
  readonly runLauncher?: SetupProcessLauncher;
  readonly sourceCachePreparer?: RunAgentInput['sourceCachePreparer'];
  readonly writeLine?: (message: string) => void;
  readonly startLoading?: LoadingStarter;
  readonly logLevel?: RunLogLevel;
}

export interface PiSetupLaunch {
  readonly plan: AgentLaunchPlan;
  readonly resultPath: string;
  /** The setup shell's `PI_CODING_AGENT_DIR`; a `/login` inside the walkthrough saves credentials here. */
  readonly piConfigDirectory: string;
}

/**
 * The offline placeholder provider given to the setup shell so pi starts without a login warning.
 * The walkthrough's provider check ignores it, so only real providers count as connected.
 */
export const setupPlaceholderProviderId = 'outfitter-setup';

interface PreparePiSetupLaunchInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly setupDirectory: string;
  readonly availableAgents: readonly SetupAgentChoice[];
  readonly setupSourceUri?: string;
}

export const createPiSetupExtensionContent = (input: {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly resultPath: string;
  readonly availableAgents: readonly SetupAgentChoice[];
  readonly currentDefault?: string;
  readonly setupSourceUri?: string;
}): string => {
  const values = {
    OUTFITTER_HOME: input.homeDirectory,
    OUTFITTER_PROJECT: input.projectDirectory,
    OUTFITTER_SETUP_RESULT_PATH: input.resultPath,
    OUTFITTER_AGENT_CHOICES: input.availableAgents,
    OUTFITTER_CURRENT_DEFAULT: input.currentDefault,
    OUTFITTER_SETUP_SOURCE_URI: input.setupSourceUri,
    OUTFITTER_AUTO_OPEN: true,
    OUTFITTER_SETUP_PROVIDER: setupPlaceholderProviderId,
  } as const;

  // One pass over the asset: every `'__OUTFITTER_X__'` placeholder is replaced with its stamped
  // JSON value; unknown placeholders are left intact.
  return readRepositoryCodeAsset('pi-extension/src/outfitter-extension.js').replace(
    /["']__(OUTFITTER_[A-Z_]+)__["']/gu,
    (match, name: string) =>
      Object.hasOwn(values, name) ? JSON.stringify((values as Record<string, unknown>)[name]) : match,
  );
};

// The walkthrough's provider check must see the same providers the real session will, so the
// user's own models.json providers join the placeholder; without them a custom-provider-only user
// would be asked to connect a provider they already have.
const readUserModelProviders = (piUserAgentDirectory: string): Record<string, unknown> => {
  const modelsPath = join(piUserAgentDirectory, 'models.json');
  if (!existsSync(modelsPath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(modelsPath, 'utf8'));
    const providers = (parsed as { providers?: unknown } | null)?.providers;
    return providers !== null && typeof providers === 'object' ? (providers as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * Creates an isolated, offline Pi setup launch using the bundled extension. The shell starts on a
 * placeholder provider and is seeded with pi's durable credentials so the walkthrough's provider
 * check reflects what the user already has; `runSetup` copies any `/login` result back.
 */
export const preparePiSetupLaunch = (input: PreparePiSetupLaunchInput): PiSetupLaunch => {
  const piConfigDirectory = join(input.setupDirectory, 'pi');
  const extensionPath = join(piConfigDirectory, 'outfitter-extension.js');
  const resultPath = join(input.setupDirectory, 'selection.json');
  mkdirSync(piConfigDirectory, { recursive: true });
  writeFileSync(
    extensionPath,
    createPiSetupExtensionContent({
      homeDirectory: input.homeDirectory,
      projectDirectory: input.projectDirectory,
      resultPath,
      availableAgents: input.availableAgents,
      currentDefault: readCurrentDefaultAgent(input.homeDirectory),
      setupSourceUri: input.setupSourceUri,
    }),
  );
  for (const [source, destination] of [
    ['enterprise/pi-extension/privateCatalogOnboarding.js', 'pi-extension/privateCatalogOnboarding.js'],
    ['enterprise/shared/privateCatalogPolicy.cjs', 'shared/privateCatalogPolicy.cjs'],
  ] as const) {
    const destinationPath = join(piConfigDirectory, destination);
    mkdirSync(join(destinationPath, '..'), { recursive: true });
    writeFileSync(destinationPath, readRepositoryCodeAsset(source));
  }
  // Pi currently renders a provider-login warning before extensions can open their UI when its
  // registry is empty. This isolated, offline-only placeholder is never called; it simply gives
  // the setup shell a selected model so the walkthrough can start cleanly without user credentials.
  const piUserAgentDirectory = resolvePiUserAgentDirectory(input.homeDirectory);
  writeFileSync(
    join(piConfigDirectory, 'models.json'),
    `${JSON.stringify(
      {
        providers: {
          ...readUserModelProviders(piUserAgentDirectory),
          [setupPlaceholderProviderId]: {
            baseUrl: 'http://127.0.0.1:9/v1',
            api: 'openai-completions',
            apiKey: 'outfitter-setup-no-network',
            models: [{ id: 'walkthrough', name: 'Outfitter setup UI' }],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(piConfigDirectory, 'settings.json'),
    `${JSON.stringify(
      { quietStartup: true, defaultProvider: setupPlaceholderProviderId, defaultModel: 'walkthrough' },
      null,
      2,
    )}\n`,
  );
  // auth.json only: the placeholder models.json above already exists, so it is left in place.
  seedPiCredentials(piConfigDirectory, piUserAgentDirectory);

  return {
    resultPath,
    piConfigDirectory,
    plan: {
      command: 'pi',
      args: [
        '--no-session',
        '--offline',
        '--no-tools',
        '--no-skills',
        '--no-prompt-templates',
        '--extension',
        extensionPath,
      ],
      env: { PI_CODING_AGENT_DIR: piConfigDirectory },
    },
  };
};

const readCurrentDefaultAgent = (homeDirectory: string): string | undefined => {
  const settingsPath = join(homeDirectory, '.agents', 'settings.yml');
  if (!existsSync(settingsPath)) return undefined;
  const match = /^default_agent:\s*([^\n#]+)/mu.exec(readFileSync(settingsPath, 'utf8'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, '');
};

const parseSetupSelection = (path: string): SetupSelection | undefined => {
  if (!existsSync(path)) return undefined;
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const invalid = (): never => {
    throw new Error('Pi setup returned an invalid selection.');
  };
  if (value === null || typeof value !== 'object') return invalid();
  const selection = value as Partial<SetupSelection>;
  if (!['default', 'create', 'catalog', 'source'].includes(String(selection.setupMode))) return invalid();
  if (!HARNESSES.includes(String(selection.harness) as Harness)) return invalid();
  if (!['catalog', 'source'].includes(String(selection.setupMode)) && typeof selection.agentId !== 'string')
    return invalid();
  if (
    selection.setupMode === 'catalog' &&
    (typeof selection.github !== 'string' ||
      typeof selection.ref !== 'string' ||
      typeof selection.settingsPath !== 'string')
  )
    return invalid();
  if (selection.setupMode === 'source' && typeof selection.sourceUri !== 'string') return invalid();
  if (!['home', 'project'].includes(String(selection.target))) return invalid();
  if (selection.providerConnection !== undefined && selection.providerConnection !== 'skipped') return invalid();
  return selection as SetupSelection;
};

/* v8 ignore next -- wiring to the shared spawn boundary; launchThroughSpawn itself is unit-tested. */
const defaultLauncher: SetupProcessLauncher = (plan) => launchThroughSpawn(spawnLauncher, plan);

/** Launches the walkthrough, then applies its result through the shared setup state machine. */
export const runSetup = async (dependencies: SetupCommandDependencies = {}): Promise<SetupResult | undefined> => {
  /* v8 ignore next -- the process TTY default is exercised through outfitter-dev. */
  const interactive = dependencies.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) return undefined;

  const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
  const projectDirectory = resolve(resolveProjectDirectory(dependencies.projectDirectory));
  const localSettings = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));
  const bootstrap =
    dependencies.defaultCatalogBootstrap ??
    ((home: string, cacheDirectory?: string) => bootstrapDefaultCatalog(home, cacheDirectory).root);
  const defaultCatalogRoot =
    dependencies.setupSourceUri === undefined
      ? bootstrap(homeDirectory, localSettings.settings.cacheDirectory)
      : undefined;
  const availableAgents = discoverSetupAgentChoices({ defaultCatalogRoot });
  const setupDirectory = mkdtempSync(join(tmpdir(), 'outfitter-setup-'));

  try {
    const launch = preparePiSetupLaunch({
      homeDirectory,
      projectDirectory,
      setupDirectory,
      availableAgents,
      setupSourceUri: dependencies.setupSourceUri,
    });
    /* v8 ignore next -- the bundled default launcher is exercised through outfitter-dev. */
    const exitCode = await (dependencies.launcher ?? defaultLauncher)(launch.plan);
    // A /login inside the walkthrough wrote to the setup shell's auth.json; keep it durable so the
    // relaunched profile (and later runs) start with the provider connected. Credentials only: the
    // placeholder models.json is setup scaffolding, not user state.
    persistPiCredentials(launch.piConfigDirectory, resolvePiUserAgentDirectory(homeDirectory), false);
    if (exitCode !== 0) throw new Error(`The Outfitter setup walkthrough exited with code ${exitCode}.`);
    const selection = parseSetupSelection(launch.resultPath);
    if (selection === undefined) return undefined;
    return applySetupSelection({
      homeDirectory,
      projectDirectory,
      selection,
      availableAgents,
      defaultCatalogRoot,
    });
  } finally {
    rmSync(setupDirectory, { recursive: true, force: true });
  }
};

/* v8 ignore next -- wiring to the shared spawn boundary; launchThroughSpawn itself is unit-tested. */
const defaultRunLauncher: SetupProcessLauncher = (plan) => launchThroughSpawn(spawnLauncher, plan);

// After an explicit `outfitter setup`, start the just-selected profile in pi so the user lands in a
// working session instead of being told to restart. Only a concrete agent choice (default/create
// modes set `defaultAgent`) launches immediately; catalog/source setups still need a sync, so they
// keep their "run outfitter sync / restart" guidance and are skipped here.
const autoLaunchSelectedProfile = async (
  dependencies: SetupCommandDependencies,
  result: SetupResult,
  writeLine: (message: string) => void,
): Promise<void> => {
  if (result.defaultAgent === undefined) return;

  const runResult = await executeRunAgentCommand({
    homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
    projectDirectory: resolve(resolveProjectDirectory(dependencies.projectDirectory)),
    harness: result.defaultHarness,
    logLevel: dependencies.logLevel,
    providerPromptSkipped: result.providerPromptSkipped,
    launcher: dependencies.runLauncher ?? defaultRunLauncher,
    startLoading: dependencies.startLoading ?? startTerminalLoading,
    sourceCachePreparer: dependencies.sourceCachePreparer,
  });
  for (const message of runResult.messages) writeLine(message);
  /* v8 ignore next -- surfaces a nonzero profile-launch exit to the shell; happy path returns 0. */
  if (runResult.exitCode !== 0) process.exitCode = runResult.exitCode;
};

export const createSetupCommand = (dependencies: SetupCommandDependencies = {}): CommandObject => ({
  name: 'setup',
  description: 'Configure .agents through the bundled Pi walkthrough.',
  register(program: Command): void {
    program.addCommand(
      new Command('setup')
        .description('Configure .agents through the bundled Pi walkthrough.')
        .argument('[source]', 'Optional setup source URI or path.')
        .addOption(
          new Option('--log-level <level>', 'Set startup log detail.')
            .choices(['info', 'debug'])
            .default('info')
            .env('OUTFITTER_LOG_LEVEL'),
        )
        .action(async (source: string | undefined, options: { logLevel: RunLogLevel }) => {
          const result = await runSetup({ ...dependencies, setupSourceUri: source ?? dependencies.setupSourceUri });
          /* v8 ignore next -- console fallback is direct CLI behavior. */
          const writeLine = dependencies.writeLine ?? console.log;
          if (result === undefined) {
            writeLine('Outfitter setup made no changes. Run it from an interactive terminal to configure .agents.');
            return;
          }
          // Concrete profile selections launch immediately, so their profile UI is the success
          // confirmation. Setups that still need sync receive one concise next action.
          if (result.defaultAgent === undefined) {
            writeLine(setupNextStepMessage);
            if (result.providerPromptSkipped === true) writeLine(providerLoginHint);
          }
          await autoLaunchSelectedProfile({ ...dependencies, logLevel: options.logLevel }, result, writeLine);
        }),
    );
  },
});
