// Defines the shared contract for Outfitter CLI command objects.
import type { Command } from 'commander';

export interface CommandObject {
  readonly name: string;
  readonly description: string;
  register(program: Command): void;
}
