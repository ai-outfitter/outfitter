// Merges profile-provided Claude Code MCP configuration fragments into a composite profile file.
import { join } from 'node:path';

import type { CompositeProfile } from '../../compositeProfile/CompositeProfile.js';
import type { CompositeProfileFile } from '../../compositeProfile/CompositeProfileFile.js';
import { createMergedMcpConfigFile, mcpConfigFragmentPath } from '../McpConfigMerge.js';

export const claudeMcpConfigPath = mcpConfigFragmentPath;

export const createClaudeMcpConfigFile = (
  rootDirectory: string,
  profileFolders: readonly string[] = [],
): CompositeProfileFile | undefined =>
  createMergedMcpConfigFile({
    rootDirectory,
    adapterId: 'claude',
    configLabel: 'Claude MCP config',
    profileFolders,
  });

// Claude Code does not discover `.mcp.json` inside `CLAUDE_CONFIG_DIR` (project
// `.mcp.json` is read from the project root, user-scope servers from
// `.claude.json`), so the generated merged config is loaded explicitly through
// the documented `--mcp-config` flag.
export const createClaudeMcpConfigArgs = (compositeProfile: CompositeProfile): readonly string[] =>
  compositeProfile.files.some((file) => file.relativePath === claudeMcpConfigPath)
    ? ['--mcp-config', join(compositeProfile.rootDirectory, claudeMcpConfigPath)]
    : [];
