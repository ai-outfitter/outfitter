// Defines Claude Code-specific tack path metadata.
import { join } from 'node:path';

export interface ClaudeTackPaths {
  readonly configDirectory: string;
  readonly profileMetadataPath: string;
}

export const createClaudeTackPaths = (configDirectory: string): ClaudeTackPaths => ({
  configDirectory,
  profileMetadataPath: join(configDirectory, 'bridl', 'profile.json'),
});
