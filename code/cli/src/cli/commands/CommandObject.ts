// Defines the shared contract for Outfitter CLI command objects.
import type { Command } from 'commander';

export interface CommandObject {
  readonly name: string;
  readonly description: string;
  register(program: Command): void;
}

const readOnlyCommands = new WeakSet<Command>();

export const markCommandReadOnly = <T extends Command>(command: T): T => {
  readOnlyCommands.add(command);
  return command;
};

export const isCommandReadOnly = (command: Command): boolean => readOnlyCommands.has(command);
