/* eslint-disable complexity */
// Prepares Pi launch-time bootstrap extensions for Outfitter UX, login, and setup handoffs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import { createDefaultSettingsContent as createSetupDefaultSettingsContent } from './SetupCommand.js';

export interface PiRuntimeOnboardingLaunchInput {
  readonly autoOpenOutfitter?: boolean;
  readonly defaultProfilesPath?: string;
  readonly projectDirectory?: string;
  readonly setupSourceUri?: string;
}

export interface PiLoginLaunchPlanInput {
  readonly adapterId: string;
  readonly homeDirectory: string;
  readonly launchPlan: AgentLaunchPlan;
  readonly runtimeOnboarding?: PiRuntimeOnboardingLaunchInput;
  readonly startupAsciiArt?: boolean;
  readonly writeLine?: (message: string) => void;
}

const runtimeLoginMessage =
  'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.';

const nonInteractivePiLaunchFlags = new Set(['--print', '-p', '--export', '--list-models']);
const nonInteractivePiModes = new Set(['json', 'print', 'rpc']);

export const preparePiLoginLaunchPlan = (input: PiLoginLaunchPlanInput): AgentLaunchPlan => {
  if (input.adapterId !== 'pi') {
    return input.launchPlan;
  }

  // Load the Outfitter runtime extension for every interactive pi session. It brands the
  // startup header, owns Outfitter-specific shortcuts, and registers native /outfitter
  // onboarding after pi has started. Non-interactive launches (--print, --export, …) keep
  // pi untouched and must not prompt, auto-submit commands, or mutate user settings.
  let launchPlan = input.launchPlan;
  const piConfigDirectory = input.launchPlan.env.PI_CODING_AGENT_DIR ?? join(input.homeDirectory, '.pi', 'agent');
  const interactiveLaunch = !isNonInteractivePiLaunch(input.launchPlan.args);

  if (!interactiveLaunch) {
    return launchPlan;
  }

  // First-run onboarding intentionally passes no `--model`: pi applies its own default from the
  // models it knows about, and the runtime extension opens `/login` when no model is available.
  // Injecting a hardcoded model ID here would break every new user when pi rotates its catalog.
  if (input.runtimeOnboarding?.autoOpenOutfitter === true) {
    writeQuietPiStartupSettings(piConfigDirectory);
  }

  writePiOutfitterEnterpriseSupportFiles(piConfigDirectory);

  launchPlan = addExtension(
    launchPlan,
    piConfigDirectory,
    'outfitter-extension.js',
    createPiOutfitterExtensionContent({
      autoOpenOutfitter: input.runtimeOnboarding?.autoOpenOutfitter === true,
      defaultProfilesPath: input.runtimeOnboarding?.defaultProfilesPath,
      homeDirectory: input.homeDirectory,
      projectDirectory: resolve(input.runtimeOnboarding?.projectDirectory ?? process.cwd()),
      setupSourceUri: input.runtimeOnboarding?.setupSourceUri,
      startupAsciiArt: input.startupAsciiArt ?? true,
    }),
  );

  if (!hasConfiguredPiLoginState(piConfigDirectory)) {
    writePiLaunchMessage(input.writeLine, runtimeLoginMessage);
  }

  return launchPlan;
};

const writeQuietPiStartupSettings = (piConfigDirectory: string): void => {
  const settingsPath = join(piConfigDirectory, 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
      /* v8 ignore next -- defensive against hand-edited Pi settings with non-object JSON. */
      settings =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      settings = {};
    }
  }

  writeFileSync(settingsPath, `${JSON.stringify({ ...settings, quietStartup: true }, null, 2)}\n`);
};

const addExtension = (
  launchPlan: AgentLaunchPlan,
  piConfigDirectory: string,
  fileName: string,
  content: string,
): AgentLaunchPlan => {
  const extensionPath = join(piConfigDirectory, 'outfitter', fileName);
  mkdirSync(dirname(extensionPath), { recursive: true });
  writeFileSync(extensionPath, content);

  return {
    ...launchPlan,
    args: ['--extension', extensionPath, ...launchPlan.args],
    env: { ...launchPlan.env, PI_CODING_AGENT_DIR: piConfigDirectory },
  };
};

const writePiOutfitterEnterpriseSupportFiles = (piConfigDirectory: string): void => {
  const extensionDirectory = join(piConfigDirectory, 'outfitter');
  const supportFiles = [
    ['enterprise/pi-extension/privateCatalogOnboarding.js', 'pi-extension/privateCatalogOnboarding.js'],
    ['enterprise/shared/privateCatalogPolicy.cjs', 'shared/privateCatalogPolicy.cjs'],
  ] as const;

  for (const [from, to] of supportFiles) {
    const destination = join(extensionDirectory, to);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readRepositoryCodeAsset(from));
  }
};

// Reads a file from a sibling workspace under code/ (e.g. code/enterprise or
// code/pi-extension), supporting both the repository layout and the packaged npm
// layout where prepack copies those workspaces under the package's code/ folder.
const readRepositoryCodeAsset = (relativePath: string): string => {
  const sourcePath = fileURLToPath(new URL(`../../../../${relativePath}`, import.meta.url));
  const packagePath = fileURLToPath(new URL(`../../../code/${relativePath}`, import.meta.url));

  /* v8 ignore else -- packaged npm layout is exercised after build, not unit tests. */
  if (existsSync(sourcePath)) {
    return readFileSync(sourcePath, 'utf8');
  }

  /* v8 ignore next -- packaged npm layout is exercised after build, not unit tests. */
  if (existsSync(packagePath)) {
    return readFileSync(packagePath, 'utf8');
  }

  /* v8 ignore next -- defensive packaging assertion for missing repository code assets. */
  throw new Error(`Outfitter support file '${relativePath}' was not found.`);
};

// The general Outfitter pi extension. It brands the startup header, owns
// Outfitter-specific interactive shortcuts, registers native /outfitter, and
// keeps credential entry delegated to Pi's native /login command. The extension
// source lives in the code/pi-extension workspace; the CLI stamps launch-time
// runtime values into it before handing the file to pi via --extension.
const createPiOutfitterExtensionContent = (input: {
  readonly autoOpenOutfitter: boolean;
  readonly defaultProfilesPath?: string;
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly setupSourceUri?: string;
  readonly startupAsciiArt: boolean;
}): string => {
  const runtimeValues = {
    OUTFITTER_HOME: input.homeDirectory,
    OUTFITTER_PROJECT: input.projectDirectory,
    OUTFITTER_DEFAULT_PROFILES_PATH: input.defaultProfilesPath,
    OUTFITTER_SETUP_SOURCE_URI: input.setupSourceUri,
    OUTFITTER_AUTO_OPEN: input.autoOpenOutfitter,
    OUTFITTER_DEFAULT_SETTINGS_TEMPLATE: createSetupDefaultSettingsContent('__OUTFITTER_PROFILE_ID__'),
    OUTFITTER_STARTUP_ASCII_ART: input.startupAsciiArt,
    OUTFITTER_ASCII_ART: readFileSync(new URL('./assets/outfitter-ascii.txt', import.meta.url), 'utf8').trimEnd(),
  } as const;

  return Object.entries(runtimeValues).reduce(
    (content, [name, value]) => content.replace(`"__${name}__"`, () => String(JSON.stringify(value))),
    readRepositoryCodeAsset('pi-extension/src/outfitter-extension.js'),
  );
};

const writePiLaunchMessage = (writeLine: ((message: string) => void) | undefined, message: string): void => {
  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer for launch messages. */
  (writeLine ?? console.log)(message);
};

export const isNonInteractivePiLaunch = (args: readonly string[]): boolean =>
  args.some((arg, index) => {
    if (nonInteractivePiLaunchFlags.has(arg)) {
      return true;
    }

    if (arg === '--mode') {
      return nonInteractivePiModes.has(args[index + 1] ?? '');
    }

    if (arg.startsWith('--mode=')) {
      return nonInteractivePiModes.has(arg.slice('--mode='.length));
    }

    return false;
  });

const hasConfiguredPiLoginState = (piConfigDirectory: string): boolean =>
  hasConfiguredPiStateFile(piConfigDirectory, 'auth.json') ||
  hasConfiguredPiStateFile(piConfigDirectory, 'models.json');

const hasConfiguredPiStateFile = (piConfigDirectory: string, fileName: string): boolean => {
  const statePath = join(piConfigDirectory, fileName);

  if (!existsSync(statePath)) {
    return false;
  }

  try {
    return hasConfiguredPiStateEntries(JSON.parse(readFileSync(statePath, 'utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return false;
    }

    throw new Error(`Could not read pi login state file '${statePath}': ${String(error)}`, { cause: error });
  }
};

const hasConfiguredPiStateEntries = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value === null || typeof value !== 'object') {
    return false;
  }

  const record = value as Readonly<Record<string, unknown>>;
  const containerKeys = ['models', 'providers', 'model_providers'];
  const presentContainers = containerKeys.filter((key) => Object.hasOwn(record, key));

  if (presentContainers.length > 0) {
    return presentContainers.some((key) => hasConfiguredPiStateEntries(record[key]));
  }

  return Object.keys(record).length > 0;
};
