#!/usr/bin/env node

// Defines the initial Outfitter executable entrypoint.
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import type { Command } from 'commander';

import { createOutfitterProgram } from './cli/OutfitterCli.js';
import { discoverSettingsLoadPlan, loadSettingsFiles } from './settings/SettingsLoader.js';
import { HARNESSES } from './settings/Settings.js';
import { createTelemetryService } from './telemetry/TelemetryService.js';
import type { TelemetryCommandContext, TelemetryService } from './telemetry/TelemetryService.js';
import { createTelemetryStateStore, resolveTelemetryStatePath } from './telemetry/TelemetryState.js';
import { readOutfitterVersion } from './version/OutfitterVersion.js';

export const createProgram = createOutfitterProgram;

export interface CliTelemetryDependencies {
  readonly telemetry?: TelemetryService;
  readonly now?: () => number;
  readonly version?: string;
  readonly nodeVersion?: string;
  readonly platform?: string;
  readonly architecture?: string;
  readonly interactive?: boolean;
}

const topLevelAction = (program: Command, actionCommand: Command): Command => {
  let command = actionCommand;
  while (command.parent !== null && command.parent !== program) command = command.parent;
  return command;
};

export const resolveTelemetryCommandName = (program: Command, actionCommand: Command): string => {
  const topLevel = topLevelAction(program, actionCommand);
  const registered = new Set(program.commands.map((command) => command.name()));
  return registered.has(topLevel.name()) ? topLevel.name() : 'unknown';
};

const commandContext = (
  program: Command,
  actionCommand: Command,
  dependencies: CliTelemetryDependencies,
): TelemetryCommandContext => {
  const command = resolveTelemetryCommandName(program, actionCommand);
  const options = actionCommand.opts<{ harness?: unknown; strict?: unknown }>();
  const harness =
    typeof options.harness === 'string' && HARNESSES.some((candidate) => candidate === options.harness)
      ? options.harness
      : undefined;

  return {
    command,
    outfitterVersion: dependencies.version ?? readOutfitterVersion(),
    nodeVersion: dependencies.nodeVersion ?? process.versions.node,
    platform: dependencies.platform ?? process.platform,
    architecture: dependencies.architecture ?? process.arch,
    interactive: dependencies.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
    harness,
    strict: options.strict === true,
  };
};

export const createProcessTelemetryService = (): TelemetryService => {
  const homeDirectory = homedir();
  const projectDirectory = process.cwd();
  return createTelemetryService({
    settingsReader: () => loadSettingsFiles(discoverSettingsLoadPlan({ homeDirectory, projectDirectory })),
    stateStore: createTelemetryStateStore(resolveTelemetryStatePath(homeDirectory, process.env)),
    env: process.env,
    writeError: (message) => console.error(message),
  });
};

const captureCompletion = async (
  telemetry: TelemetryService,
  context: TelemetryCommandContext | undefined,
  startedAt: number | undefined,
  now: () => number,
  exitCode: number,
): Promise<void> => {
  if (context === undefined || startedAt === undefined) return;
  await telemetry.captureCommandCompleted({
    ...context,
    outcome: exitCode === 0 ? 'success' : 'error',
    durationMs: now() - startedAt,
    exitCode,
  });
};

export const runCli = async (
  program: Command,
  argv: readonly string[],
  dependencies: CliTelemetryDependencies = {},
): Promise<void> => {
  const telemetry = dependencies.telemetry ?? createProcessTelemetryService();
  const now = dependencies.now ?? Date.now;
  let startedAt: number | undefined;
  let context: TelemetryCommandContext | undefined;

  program.hook('preAction', async (_thisCommand, actionCommand) => {
    startedAt = now();
    context = commandContext(program, actionCommand, dependencies);
    await telemetry.captureCommandStarted(context);
  });

  try {
    await program.parseAsync(argv);
    const exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
    await captureCompletion(telemetry, context, startedAt, now, exitCode);
  } catch (error) {
    await captureCompletion(telemetry, context, startedAt, now, 1);
    throw error;
  } finally {
    await telemetry.shutdown();
  }
};

export const isDirectCliExecution = (moduleUrl: string, argvPath: string | undefined): boolean => {
  if (argvPath === undefined) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
};

/* v8 ignore next 8 -- direct bin execution is covered by local install smoke tests. */
if (isDirectCliExecution(import.meta.url, process.argv[1])) {
  try {
    await runCli(createProgram(), process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
