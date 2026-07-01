// Tests Claude Code MCP fragment merging into the composite profile and launch wiring.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createClaudeAdapter } from '../../src/agents/claude/ClaudeAdapter.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-claude-mcp-'));
  temporaryRoots.push(root);
  return root;
};

const writeClaudeMcpConfig = (profileFolder: string, content: object | string): void => {
  const claudeFolder = join(profileFolder, 'cli_specific', 'claude');
  mkdirSync(claudeFolder, { recursive: true });
  writeFileSync(
    join(claudeFolder, '.mcp.json'),
    typeof content === 'string' ? content : `${JSON.stringify(content)}\n`,
  );
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Claude Code adapter MCP composition', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges claude .mcp.json profile fragments and loads them through --mcp-config', () => {
    const root = createTemporaryRoot();
    const baseProfileFolder = join(root, 'base');
    const explicitProfileFolder = join(root, 'explicit');
    const rootDirectory = join(root, 'composite');

    writeClaudeMcpConfig(baseProfileFolder, {
      mcpServers: {
        shared: { command: 'base-command', args: ['--base-only'] },
        baseOnly: { command: 'base-only-command' },
      },
    });
    writeClaudeMcpConfig(explicitProfileFolder, {
      mcpServers: {
        shared: { command: 'explicit-command' },
        explicitOnly: { type: 'http', url: 'https://mcp.example.com/mcp' },
      },
    });

    const adapter = createClaudeAdapter();
    const profile = { id: 'engineering', inherits: [], controls: {} };
    const compositeProfilePlan = adapter.createCompositeProfile(profile, {
      rootDirectory,
      profilePaths: [],
      profileFolders: [baseProfileFolder, explicitProfileFolder],
    });
    const mcpFile = compositeProfilePlan.compositeProfile.files.find((file) => file.relativePath === '.mcp.json');

    expect(mcpFile?.strategy).toBe('merge');
    expect(mcpFile?.outputPath).toBe(join(rootDirectory, '.mcp.json'));
    expect(mcpFile?.sourceInputs).toEqual([
      join(baseProfileFolder, 'cli_specific', 'claude', '.mcp.json'),
      join(explicitProfileFolder, 'cli_specific', 'claude', '.mcp.json'),
    ]);
    expect(JSON.parse(mcpFile?.content ?? '{}')).toEqual({
      mcpServers: {
        shared: { command: 'explicit-command' },
        baseOnly: { command: 'base-only-command' },
        explicitOnly: { type: 'http', url: 'https://mcp.example.com/mcp' },
      },
    });

    const launchPlan = adapter.createLaunchPlan(
      compositeProfilePlan.compositeProfile,
      { ...profile, controls: { args: ['--verbose'] } },
      ['--pass-through'],
    );
    expect(launchPlan.args).toEqual(['--mcp-config', join(rootDirectory, '.mcp.json'), '--verbose', '--pass-through']);
  });

  it('omits MCP wiring when no claude .mcp.json fragments exist', () => {
    const root = createTemporaryRoot();
    const profileFolder = join(root, 'plain');
    mkdirSync(join(profileFolder, 'cli_specific', 'claude'), { recursive: true });

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'plain', inherits: [], controls: {} },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder] },
    );

    expect(
      compositeProfilePlan.compositeProfile.files.find((file) => file.relativePath === '.mcp.json'),
    ).toBeUndefined();
    expect(adapter.createLaunchPlan(compositeProfilePlan.compositeProfile).args).toEqual([]);
  });

  it('reports invalid claude MCP fragments with Claude-labeled errors', () => {
    const root = createTemporaryRoot();
    const adapter = createClaudeAdapter();
    const createPlan = (profileFolder: string) => () =>
      adapter.createCompositeProfile(
        { id: 'broken', inherits: [], controls: {} },
        { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder] },
      );

    const invalidJsonFolder = join(root, 'invalid-json');
    writeClaudeMcpConfig(invalidJsonFolder, '{not json');
    expect(createPlan(invalidJsonFolder)).toThrow(
      `Claude MCP config '${join(invalidJsonFolder, 'cli_specific', 'claude', '.mcp.json')}' must contain valid JSON.`,
    );

    const nonObjectFolder = join(root, 'non-object');
    writeClaudeMcpConfig(nonObjectFolder, '["not-an-object"]');
    expect(createPlan(nonObjectFolder)).toThrow(
      `Claude MCP config '${join(nonObjectFolder, 'cli_specific', 'claude', '.mcp.json')}' must contain a JSON object.`,
    );

    const unreadableFolder = join(root, 'unreadable');
    mkdirSync(join(unreadableFolder, 'cli_specific', 'claude', '.mcp.json'), { recursive: true });
    expect(createPlan(unreadableFolder)).toThrow(/Could not read Claude MCP config/u);
  });
});
