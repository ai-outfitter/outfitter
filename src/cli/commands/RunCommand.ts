// Provides the placeholder command object for the default profile run command.
import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';

export const createRunCommand = (): CommandObject => ({
  name: 'run',
  description: 'Assemble a profile tack and launch the selected agent CLI.',
  register(program: Command): void {
    program.command('run').description(this.description);
  },
});
