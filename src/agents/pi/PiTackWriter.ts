// Defines pi-specific tack path metadata.
import { join } from 'node:path';

export interface PiTackPaths {
  readonly agentDirectory: string;
  readonly profileMetadataPath: string;
}

export const createPiTackPaths = (agentDirectory: string): PiTackPaths => ({
  agentDirectory,
  profileMetadataPath: join(agentDirectory, 'bridl', 'profile.json'),
});
