// Defines shared helpers for the profile command namespace.
import { Command } from 'commander';

export const profileCommandName = 'profile';
export const profileCommandDescription = 'List and manage Outfitter profiles.';

export interface ProfileCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
}

export const getOrCreateProfileCommander = (program: Command): Command => {
  const existingProfileCommand = program.commands.find((command) => command.name() === profileCommandName);

  if (existingProfileCommand !== undefined) {
    return existingProfileCommand;
  }

  return program.command(profileCommandName).description(profileCommandDescription);
};
