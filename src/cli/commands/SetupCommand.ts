// Provides the placeholder command object for first-run Bridl setup.
import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';

export const createSetupCommand = (): CommandObject => {
  const command: CommandObject = {
    name: 'setup',
    description: 'Create initial Bridl settings and a default profile.',
    register(program: Command): void {
      program.command(command.name).description(command.description);
    },
  };

  return command;
};
