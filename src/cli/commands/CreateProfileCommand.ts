// Provides the placeholder command object for creating a Bridl profile folder.
import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';

export const createCreateProfileCommand = (): CommandObject => {
  const command: CommandObject = {
    name: 'create_profile',
    description: 'Create a new Bridl profile skeleton.',
    register(program: Command): void {
      program.command(command.name).alias('create-profile').description(command.description);
    },
  };

  return command;
};
