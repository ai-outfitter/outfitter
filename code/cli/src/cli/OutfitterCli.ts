// Assembles the top-level Outfitter Commander program from command objects.
import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import type { CommandObject } from './commands/CommandObject.js';
import { createDumpCommand } from './commands/DumpCommand.js';
import { createListCommand } from './commands/ListCommand.js';
import { createRunAgentCommand } from './commands/RunAgentCommand.js';
import { createValidateCommand } from './commands/ValidateCommand.js';

export const createDefaultCommands = (): CommandObject[] => [
  createRunAgentCommand(),
  createListCommand(),
  createValidateCommand(),
  createDumpCommand(),
];

export const createOutfitterProgram = (commands: readonly CommandObject[] = createDefaultCommands()): Command => {
  const program = new Command();

  program
    .name('outfitter')
    .description('Resolve, compose, and launch .agents agents in pi, Claude Code, and future harnesses.')
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
