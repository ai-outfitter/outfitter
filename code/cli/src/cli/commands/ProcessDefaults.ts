// Resolves process-derived command defaults (home/project directories) in one tested place.
import { homedir } from 'node:os';

export const resolveHomeDirectory = (provided?: string, nativeHomedir: () => string = homedir): string => {
  if (provided !== undefined) return provided;
  try {
    return nativeHomedir();
  } catch {
    return process.env.HOME ?? '.';
  }
};

export const resolveProjectDirectory = (provided?: string): string => provided ?? process.cwd();
