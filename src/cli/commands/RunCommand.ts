// Provides the command object for launching selected profiles.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';
import { executeSetupCommand } from './SetupCommand.js';
import type { SetupCommandDependencies, SetupCommandResult } from './SetupCommand.js';
import {
  executeProfileLaunch,
  resolveChildExitCode,
  type AgentProcessLauncher,
  type ProfileLaunchInput,
  type ProfileLaunchResult,
} from './ProfileLaunch.js';

export type RunCommandInput = Omit<ProfileLaunchInput, 'launchContext' | 'setupResult'>;

export type RunCommandResult = ProfileLaunchResult;

export type { AgentProcessLauncher };
export { resolveChildExitCode };

export type RunCommandDependencies = SetupCommandDependencies;

export const executeRunCommand = async (
  input: RunCommandInput,
  dependencies: RunCommandDependencies = {},
): Promise<RunCommandResult> => {
  const setupResult = await runSetupIfNeeded(input, dependencies);
  return executeProfileLaunch({ ...input, setupResult }, dependencies);
};

/* v8 ignore start -- Commander registration is exercised through CLI integration, while command behavior is unit-tested through executeRunCommand. */
export const createRunCommand = (dependencies: RunCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'run',
    description: 'Assemble a profile compositeProfile and launch the selected agent CLI.',
    register(program: Command): void {
      const action = async (
        args: readonly string[],
        options: { profile?: string; agent?: string; strict?: boolean },
      ) => {
        const result = await executeRunCommand(
          {
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            profileId: options.profile,
            agentId: options.agent,
            strict: options.strict,
            passThroughArgs: args,
          },
          dependencies,
        );

        if (result.exitCode !== 0) {
          process.exitCode = result.exitCode;
        }
      };

      configureRunCommander(
        program.command(command.name, { isDefault: true }).description(command.description),
        action,
      );
    },
  };

  return command;
};

const configureRunCommander = (
  command: Command,
  action: (args: readonly string[], options: { profile?: string; agent?: string; strict?: boolean }) => Promise<void>,
): void => {
  command
    .argument('[args...]')
    .option('-p, --profile <profile>', 'Outfitter profile id to run')
    .option('--agent <agent>', 'agent adapter to launch: pi or claude')
    .option('--strict', 'Fail instead of warning when controls cannot be translated')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(action);
};
/* v8 ignore stop */

const runSetupIfNeeded = async (
  input: RunCommandInput,
  dependencies: RunCommandDependencies,
): Promise<SetupCommandResult | undefined> => {
  const settingsPath = join(input.homeDirectory, '.outfitter', 'settings.yml');

  if (existsSync(settingsPath)) {
    return undefined;
  }

  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
  (dependencies.writeLine ?? console.log)('`outfitter setup` has not been run yet - running now');
  return executeSetupCommand(input, { ...dependencies, interactive: shouldRunFirstSetupInteractively(dependencies) });
};

const shouldRunFirstSetupInteractively = (dependencies: RunCommandDependencies): boolean => {
  if (dependencies.interactive !== undefined) {
    return dependencies.interactive;
  }

  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const inputIsTty = (dependencies.input ?? process.stdin).isTTY === true;
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const outputIsTty = (dependencies.output ?? process.stdout).isTTY === true;

  return inputIsTty && outputIsTty;
};
