// Assembles the top-level Bridl Commander program from command objects.
import { Command } from 'commander';

import type { CommandObject } from './commands/CommandObject.js';
import { createCreateProfileCommand } from './commands/CreateProfileCommand.js';
import { createRunCommand } from './commands/RunCommand.js';
import { createSetupCommand } from './commands/SetupCommand.js';
import { createSyncCommand } from './commands/SyncCommand.js';

export const createDefaultCommands = (): CommandObject[] => [
  createRunCommand(),
  createSetupCommand(),
  createSyncCommand(),
  createCreateProfileCommand(),
];

export const createBridlProgram = (commands: readonly CommandObject[] = createDefaultCommands()): Command => {
  const program = new Command();

  program
    .name('bridl')
    .description('Profile-oriented wrapper for launching pi, Claude Code, and future agent CLIs.')
    .version('0.1.0');

  for (const command of commands) {
    command.register(program);
  }

  return program;
};
