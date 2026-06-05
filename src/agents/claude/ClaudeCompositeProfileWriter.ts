// Defines Claude Code-specific compositeProfile path metadata.
import { join } from 'node:path';

export interface ClaudeCompositeProfilePaths {
  readonly configDirectory: string;
  readonly profileMetadataPath: string;
}

export const createClaudeCompositeProfilePaths = (configDirectory: string): ClaudeCompositeProfilePaths => ({
  configDirectory,
  profileMetadataPath: join(configDirectory, 'applepi', 'profile.json'),
});
