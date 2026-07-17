// Assembles the top-level Outfitter Commander program from command objects.
import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import type { CommandObject } from './commands/CommandObject.js';
import { createListCommand } from './commands/ListCommand.js';
import { createRunCommand, executeRunCommand } from './commands/RunCommand.js';
import { createSetupCommand } from './commands/SetupCommand.js';
import { createSyncCommand } from './commands/SyncCommand.js';
import { createValidateCommand } from './commands/ValidateCommand.js';
import { createWelcomeCommand } from './commands/WelcomeCommand.js';

export const createDefaultCommands = (): CommandObject[] => [
  createRunCommand(),
  createSetupCommand({
    /* v8 ignore next 2 -- covered by end-to-end CLI smoke usage; unit tests inject this dependency. */
    async launchSetupSourceProfile(input) {
      await executeRunCommand({
        ...input,
        profileId: input.profileId,
      });
    },
  }),
  createSyncCommand(),
  createWelcomeCommand(),
  createListCommand(),
  createValidateCommand(),
];

export const createOutfitterProgram = (commands: readonly CommandObject[] = createDefaultCommands()): Command => {
  const program = new Command();

  program
    .name('outfitter')
    .description('Profile-oriented wrapper for launching pi, Claude Code, and future agent CLIs.')
    .version(readPackageVersion());

  for (const command of commands) {
    command.register(program);
  }

  return program;
};

const readPackageVersion = (): string => {
  const packageJsonPath = new URL('../../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string };

  return packageJson.version;
};
