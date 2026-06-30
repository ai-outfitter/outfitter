// Provides the parent profile command namespace for Outfitter profile management.
import type { Command } from 'commander';

import type { CommandObject } from '../CommandObject.js';
import { createProfileCreateCommand } from './CreateCommand.js';
import { createProfileListCommand } from './ListCommand.js';
import type { ProfileCommandDependencies } from './Shared.js';
import { getOrCreateProfileCommander, profileCommandDescription, profileCommandName } from './Shared.js';

export const createProfileCommands = (dependencies: ProfileCommandDependencies = {}): CommandObject[] => [
  createProfileCommand(),
  createProfileListCommand(dependencies),
  createProfileCreateCommand(dependencies),
];

export const createProfileCommand = (): CommandObject => {
  const command: CommandObject = {
    name: profileCommandName,
    description: profileCommandDescription,
    register(program: Command): void {
      getOrCreateProfileCommander(program);
    },
  };

  return command;
};

export { executeCreateProfileCommand } from './CreateCommand.js';
export { executeListProfilesCommand } from './ListCommand.js';
