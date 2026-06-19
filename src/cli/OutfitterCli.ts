// Assembles the top-level Outfitter Commander program from command objects.
import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import type { CommandObject } from './commands/CommandObject.js';
import { createProfileCommands } from './commands/profile/Command.js';
import { createRunCommand } from './commands/RunCommand.js';
import { createSetupCommand } from './commands/SetupCommand.js';
import { createSyncCommand } from './commands/SyncCommand.js';
import { createWelcomeCommand } from './commands/WelcomeCommand.js';

export const createDefaultCommands = (): CommandObject[] => [
  createRunCommand(),
  createSetupCommand(),
  createSyncCommand(),
  createWelcomeCommand(),
  ...createProfileCommands(),
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
