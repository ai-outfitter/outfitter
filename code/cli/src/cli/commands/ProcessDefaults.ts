// Resolves process-derived command defaults (home/project directories) in one tested place.
import { homedir } from 'node:os';

export const resolveHomeDirectory = (provided?: string): string =>
  provided ?? (process.env.OUTFITTER_USER_HOME || homedir());

export const resolveProjectDirectory = (provided?: string): string => provided ?? process.cwd();
