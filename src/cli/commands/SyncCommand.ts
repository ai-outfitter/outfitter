// Provides the placeholder command object for synchronizing profile sources.
import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';

export const createSyncCommand = (): CommandObject => {
  const command: CommandObject = {
    name: 'sync',
    description: 'Synchronize URI-backed Bridl profile sources into the local cache.',
    register(program: Command): void {
      program.command(command.name).description(command.description);
    },
  };

  return command;
};
