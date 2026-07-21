/* eslint-disable complexity */
// Provides the universal Pi-hosted `/outfitter` setup walkthrough.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { launchThroughSpawn, spawnLauncher } from '../../agents/AgentLaunch.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import type { Harness } from '../../settings/Settings.js';
import { HARNESSES } from '../../settings/Settings.js';
import type { SetupAgentChoice, SetupResult, SetupSelection } from '../../setup/Setup.js';
import { applySetupSelection, discoverSetupAgentChoices } from '../../setup/Setup.js';
import { bootstrapDefaultCatalog } from '../../setup/DefaultCatalog.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';
import { executeRunAgentCommand } from './RunAgentCommand.js';

export type SetupProcessLauncher = (plan: AgentLaunchPlan) => Promise<number>;

export interface SetupCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly defaultCatalogBootstrap?: (homeDirectory: string) => string;
  readonly setupSourceUri?: string;
  readonly interactive?: boolean;
  readonly launcher?: SetupProcessLauncher;
  /** Launcher for the profile pi started after setup; defaults to the real spawn boundary. */
  readonly runLauncher?: SetupProcessLauncher;
  readonly writeLine?: (message: string) => void;
}

export interface PiSetupLaunch {
  readonly plan: AgentLaunchPlan;
  readonly resultPath: string;
}

interface PreparePiSetupLaunchInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly setupDirectory: string;
  readonly availableAgents: readonly SetupAgentChoice[];
  readonly setupSourceUri?: string;
}

const readRepositoryCodeAsset = (relativePath: string): string => {
  const sourcePath = fileURLToPath(new URL(`../../../../${relativePath}`, import.meta.url));
  const packagePath = fileURLToPath(new URL(`../../../code/${relativePath}`, import.meta.url));

  /* v8 ignore else -- packaged layout is exercised by the npm package smoke test. */
  if (existsSync(sourcePath)) return readFileSync(sourcePath, 'utf8');
  /* v8 ignore next 3 -- packaged layout is covered by the package smoke test. */
  if (existsSync(packagePath)) return readFileSync(packagePath, 'utf8');
  throw new Error(`Outfitter support file '${relativePath}' was not found.`);
};

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
  } as const;

  // One pass over the asset: every `'__OUTFITTER_X__'` placeholder is replaced with its stamped
  // JSON value; unknown placeholders are left intact.
  return readRepositoryCodeAsset('pi-extension/src/outfitter-extension.js').replace(
    /["']__(OUTFITTER_[A-Z_]+)__["']/gu,
    (match, name: string) =>
      Object.hasOwn(values, name) ? JSON.stringify((values as Record<string, unknown>)[name]) : match,
  );
};

/** Creates an isolated, model-free Pi setup launch using the bundled extension. */
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
  writeFileSync(
    join(piConfigDirectory, 'models.json'),
    `${JSON.stringify(
      {
        providers: {
          'outfitter-setup': {
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
      { quietStartup: true, defaultProvider: 'outfitter-setup', defaultModel: 'walkthrough' },
      null,
      2,
    )}\n`,
  );

  return {
    resultPath,
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
  const defaultCatalogRoot =
    dependencies.setupSourceUri === undefined
      ? (dependencies.defaultCatalogBootstrap ?? ((home) => bootstrapDefaultCatalog(home).root))(homeDirectory)
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

  writeLine(`Starting '${result.defaultAgent}' in ${result.defaultHarness}…`);
  const runResult = await executeRunAgentCommand({
    homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
    projectDirectory: resolve(resolveProjectDirectory(dependencies.projectDirectory)),
    harness: result.defaultHarness,
    launcher: dependencies.runLauncher ?? defaultRunLauncher,
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
        .action(async (source?: string) => {
          const result = await runSetup({ ...dependencies, setupSourceUri: source ?? dependencies.setupSourceUri });
          /* v8 ignore next -- console fallback is direct CLI behavior. */
          const writeLine = dependencies.writeLine ?? console.log;
          if (result === undefined) {
            writeLine('Outfitter setup made no changes. Run it from an interactive terminal to configure .agents.');
            return;
          }
          for (const message of result.messages) writeLine(message);
          await autoLaunchSelectedProfile(dependencies, result, writeLine);
        }),
    );
  },
});
