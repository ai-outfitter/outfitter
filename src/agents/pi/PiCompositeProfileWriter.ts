// Defines pi-specific compositeProfile path metadata.
import { join } from 'node:path';

export interface PiCompositeProfilePaths {
  readonly agentDirectory: string;
  readonly profileMetadataPath: string;
}

export const createPiCompositeProfilePaths = (agentDirectory: string): PiCompositeProfilePaths => ({
  agentDirectory,
  profileMetadataPath: join(agentDirectory, 'applepi', 'profile.json'),
});
