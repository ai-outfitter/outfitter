// Defines the shared contract for ApplePi CLI command objects.
import type { Command } from 'commander';

export interface CommandObject {
  readonly name: string;
  readonly description: string;
  register(program: Command): void;
}

export interface CommandDescriptor {
  readonly name: string;
  readonly description: string;
}

export const describeCommandObject = (command: CommandObject): CommandDescriptor => ({
  name: command.name,
  description: command.description,
});
