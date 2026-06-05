// Assembles the top-level ApplePi Commander program from command objects.
import { Command } from 'commander';

import type { CommandObject } from './commands/CommandObject.js';
import { createProfileCommands } from './commands/profile/Command.js';
import { createRunCommand } from './commands/RunCommand.js';
import { createSetupCommand } from './commands/SetupCommand.js';
import { createSyncCommand } from './commands/SyncCommand.js';

export const createDefaultCommands = (): CommandObject[] => [
  createRunCommand(),
  createSetupCommand(),
  createSyncCommand(),
  ...createProfileCommands(),
];

export const createApplePiProgram = (commands: readonly CommandObject[] = createDefaultCommands()): Command => {
  const program = new Command();

  program
    .name('applepi')
    .description('Profile-oriented wrapper for launching pi, Claude Code, and future agent CLIs.')
    .version('0.1.0');

  for (const command of commands) {
    command.register(program);
  }

  return program;
};
