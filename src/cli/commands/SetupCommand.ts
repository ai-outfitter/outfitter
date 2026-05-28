// Provides the placeholder command object for first-run Bridl setup.
import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';

export const createSetupCommand = (): CommandObject => ({
  name: 'setup',
  description: 'Create initial Bridl settings and a default profile.',
  register(program: Command): void {
    program.command('setup').description(this.description);
  },
});
