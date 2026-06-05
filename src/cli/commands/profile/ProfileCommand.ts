// Provides the parent profile command namespace for ApplePi profile management.
import { Command } from 'commander';

import type { CommandObject } from '../CommandObject.js';
import { createProfileCreateCommand } from './CreateCommand.js';
import { createProfileListCommand } from './ListCommand.js';

export interface ProfileCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
}

export const createProfileCommand = (dependencies: ProfileCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'profile',
    description: 'List and manage ApplePi profiles.',
    register(program: Command): void {
      program.addCommand(
        new Command(command.name)
          .description(command.description)
          .addCommand(createProfileListCommand(dependencies))
          .addCommand(createProfileCreateCommand(dependencies)),
      );
    },
  };

  return command;
};

export { executeCreateProfileCommand } from './CreateCommand.js';
export { executeListProfilesCommand } from './ListCommand.js';
