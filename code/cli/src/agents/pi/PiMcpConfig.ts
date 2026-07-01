// Merges profile-provided Pi MCP configuration fragments into a composite profile file.
import type { CompositeProfileFile } from '../../compositeProfile/CompositeProfileFile.js';
import { createMergedMcpConfigFile } from '../McpConfigMerge.js';

export const createPiMcpConfigFile = (
  rootDirectory: string,
  profileFolders: readonly string[] = [],
): CompositeProfileFile | undefined =>
  createMergedMcpConfigFile({
    rootDirectory,
    adapterId: 'pi',
    configLabel: 'Pi MCP config',
    profileFolders,
  });
