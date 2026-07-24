// Assembles the top-level Outfitter Commander program from command objects.
import { Command } from 'commander';

import { readOutfitterVersion } from '../version/OutfitterVersion.js';
import type { CommandObject } from './commands/CommandObject.js';
import { createDumpCommand } from './commands/DumpCommand.js';
import { createListCommand } from './commands/ListCommand.js';
import { createRunAgentCommand } from './commands/RunAgentCommand.js';
import { createSetupCommand } from './commands/SetupCommand.js';
import { createValidateCommand } from './commands/ValidateCommand.js';

export const createDefaultCommands = (): CommandObject[] => [
  createRunAgentCommand(),
  createSetupCommand(),
  createListCommand(),
  createValidateCommand(),
  createDumpCommand(),
];

export const createOutfitterProgram = (commands: readonly CommandObject[] = createDefaultCommands()): Command => {
  const program = new Command();

  program
    .name('outfitter')
    .description('Resolve, compose, and launch .agents agents in pi, Claude Code, and future harnesses.')
    .version(readOutfitterVersion());

  for (const command of commands) {
    command.register(program);
  }

  return program;
};
