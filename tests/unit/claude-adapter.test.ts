// Tests Claude Code adapter translation and run command selection.
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAgentAdapter, isSupportedAgentId } from '../../src/agents/AgentRegistry.js';
import { createClaudeAdapter } from '../../src/agents/claude/ClaudeAdapter.js';
import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'applepi-claude-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.applepi'), { recursive: true });
  writeFileSync(join(homeDirectory, '.applepi', 'settings.yml'), content);
};

const writeProfile = (root: string, id: string, content: string): void => {
  const profileDirectory = join(root, id);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Claude Code adapter support', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-006.1, APPLEPI-REQ-006.2, APPLEPI-REQ-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('translates generic and claude-specific profile controls into Claude Code env and argv', () => {
    const adapter = createClaudeAdapter();
    const profile = {
      id: 'engineering',
      inherits: [],
      controls: {
        model: 'generic-model',
        provider: 'anthropic',
        thinking: 'medium',
        environment: { GENERIC: '1' },
        sessionDirectory: '/tmp/generic-claude-sessions',
        extensions: ['generic-plugin'],
        skills: ['unsupported-skill'],
        promptTemplate: 'unsupported-template',
        systemPrompt: 'base prompt',
        appendSystemPrompt: 'extra prompt',
        claude: {
          model: 'claude-sonnet-4-6',
          thinking: 'high',
          args: ['--permission-mode', 'plan'],
          environment: { CLAUDE_ONLY: '1' },
          sessionDirectory: '/tmp/claude-specific-sessions',
          extensions: ['claude-plugin'],
          unsupportedClaudeControl: true,
        },
      },
    };
    const compositeProfilePlan = adapter.createCompositeProfile(profile, {
      rootDirectory: '/tmp/applepi-engineering-claude-123',
      profilePaths: ['/profiles/engineering/profile.yml'],
    });
    const launchPlan = adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, profile, ['--verbose']);

    expect(adapter.id).toBe('claude');
    expect(adapter.supportedControls).toContain('model');
    expect(adapter.supportedControls).toContain('sessionDirectory');
    expect(adapter.supportedControls).toContain('systemPrompt');
    expect(adapter.supportedControls).not.toContain('pi');
    expect(adapter.supportedControls).not.toContain('claude');
    expect(adapter.getUnsupportedControls(profile)).toEqual([
      'promptTemplate',
      'provider',
      'skills',
      'claude.unsupportedClaudeControl',
    ]);
    expect(compositeProfilePlan.warnings).toEqual([
      "claude adapter cannot translate requested control 'promptTemplate'.",
      "claude adapter cannot translate requested control 'provider'.",
      "claude adapter cannot translate requested control 'skills'.",
      "claude adapter cannot translate requested control 'claude.unsupportedClaudeControl'.",
    ]);
    expect(compositeProfilePlan.compositeProfile.rootDirectory).toBe('/tmp/applepi-engineering-claude-123');
    expect(compositeProfilePlan.compositeProfile.files[0]?.sourceInputs).toEqual(['/profiles/engineering/profile.yml']);
    expect(launchPlan.command).toBe('claude');
    expect(launchPlan.env).toEqual({
      GENERIC: '1',
      CLAUDE_ONLY: '1',
      CLAUDE_CONFIG_DIR: '/tmp/applepi-engineering-claude-123',
    });
    expect(launchPlan.args).toEqual([
      '--model',
      'claude-sonnet-4-6',
      '--effort',
      'high',
      '--system-prompt',
      'base prompt',
      '--append-system-prompt',
      'extra prompt',
      '--plugin-dir',
      'claude-plugin',
      '--plugin-dir',
      'generic-plugin',
      '--permission-mode',
      'plan',
      '--verbose',
    ]);

    const genericFallbackProfile = parseProfileYaml(
      [
        'id: fallback',
        'controls:',
        '  model: generic-model',
        '  thinking: low',
        '  extensions: [plugin-a]',
        '  claude:',
        '    system_prompt: Claude-specific prompt',
        '    append_system_prompt: Claude-specific extra prompt',
        '',
      ].join('\n'),
      'fallback',
    );
    expect('message' in genericFallbackProfile).toBe(false);
    if (!('message' in genericFallbackProfile)) {
      expect(adapter.getUnsupportedControls(genericFallbackProfile)).toEqual([]);
      expect(adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, genericFallbackProfile).args).toEqual([
        '--model',
        'generic-model',
        '--effort',
        'low',
        '--system-prompt',
        'Claude-specific prompt',
        '--append-system-prompt',
        'Claude-specific extra prompt',
        '--plugin-dir',
        'plugin-a',
      ]);
    }

    const unsupportedSnakeCaseProfile = parseProfileYaml(
      'id: unsupported\ncontrols:\n  claude:\n    prompt_template: team-template\n',
      'unsupported',
    );
    expect('message' in unsupportedSnakeCaseProfile).toBe(false);
    if (!('message' in unsupportedSnakeCaseProfile)) {
      expect(adapter.getUnsupportedControls(unsupportedSnakeCaseProfile)).toEqual(['claude.prompt_template']);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6, APPLEPI-REQ-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('declares Claude Code state paths and validates state persistence overrides', () => {
    const root = createTemporaryRoot();
    const profileFolder = join(root, 'profile');
    const profileSettingsPath = join(profileFolder, 'cli_specific', 'claude', 'settings.json');
    mkdirSync(join(profileFolder, 'cli_specific', 'claude'), { recursive: true });
    writeFileSync(profileSettingsPath, '{}\n');
    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      {
        id: 'stateful',
        inherits: [],
        controls: {
          sessionDirectory: join(root, 'generic-sessions'),
          claude: { sessionDirectory: join(root, 'claude-sessions') },
        },
        statePersistence: { 'debug/': 'discard' },
      },
      {
        rootDirectory: join(root, 'compositeProfile'),
        profilePaths: [],
        profileFolders: [profileFolder],
        homeDirectory: join(root, 'home'),
      },
    );

    expect(
      compositeProfilePlan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'settings.json'),
    ).toMatchObject({
      sourcePath: profileSettingsPath,
      strategy: 'symlink',
    });
    expect(
      compositeProfilePlan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'projects/'),
    ).toMatchObject({
      strategy: 'symlink',
      sourcePath: join(root, 'claude-sessions'),
    });
    expect(
      compositeProfilePlan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'debug/'),
    ).toMatchObject({
      strategy: 'discard',
      sourcePath: undefined,
    });
    expect(
      compositeProfilePlan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'agents/'),
    ).toMatchObject({
      sourcePath: join(root, 'home', '.claude', 'agents'),
    });
    expect(() =>
      adapter.createCompositeProfile(
        { id: 'bad', inherits: [], controls: {}, statePersistence: { 'settings.json': 'discard' } },
        { rootDirectory: join(root, 'bad-compositeProfile'), profilePaths: [] },
      ),
    ).toThrow('state_persistence strategy');
    expect(() =>
      adapter.createCompositeProfile(
        { id: 'bad', inherits: [], controls: {}, statePersistence: { 'missing.json': 'warn' } },
        { rootDirectory: join(root, 'missing-compositeProfile'), profilePaths: [] },
      ),
    ).toThrow("state_persistence path 'missing.json' is not declared by the claude adapter");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-006.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('selects supported adapters from the registry and rejects unknown agents', () => {
    expect(isSupportedAgentId('pi')).toBe(true);
    expect(isSupportedAgentId('claude')).toBe(true);
    expect(isSupportedAgentId('other')).toBe(false);
    expect(createAgentAdapter(undefined).id).toBe('pi');
    expect(createAgentAdapter('claude').id).toBe('claude');
    expect(() => createAgentAdapter('other')).toThrow("Unknown agent 'other'. Expected one of: pi, claude.");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.1, APPLEPI-REQ-006.2, APPLEPI-REQ-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('selects Claude Code from CLI input or settings while preserving pi as the default agent', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.applepi', 'profiles');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      profilesDirectory,
      'default',
      [
        'id: default',
        'controls:',
        '  model: generic-model',
        '  claude:',
        '    args: [--permission-mode, plan]',
        '',
      ].join('\n'),
    );
    const messages: string[] = [];

    const defaultResult = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
    const cliClaudeResult = await executeRunCommand(
      { homeDirectory, projectDirectory, agentId: 'claude', passThroughArgs: ['--verbose'] },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
    writeSettings(
      homeDirectory,
      'default_profile: default\ndefault_agent: claude\nprofile_sources:\n  - path: ./profiles\n',
    );
    const settingsClaudeResult = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(defaultResult.agentId).toBe('pi');
    expect(defaultResult.compositeProfileDirectory).toContain('applepi-default-pi-');
    expect(defaultResult.launchPlan.command).toBe('pi');
    expect(cliClaudeResult.agentId).toBe('claude');
    expect(cliClaudeResult.compositeProfileDirectory).toContain('applepi-default-claude-');
    expect(existsSync(join(cliClaudeResult.compositeProfileDirectory, 'applepi', 'profile.json'))).toBe(true);
    expect(cliClaudeResult.launchPlan.command).toBe('claude');
    expect(cliClaudeResult.launchPlan.env.CLAUDE_CONFIG_DIR).toBe(cliClaudeResult.compositeProfileDirectory);
    expect(cliClaudeResult.launchPlan.args).toEqual([
      '--model',
      'generic-model',
      '--permission-mode',
      'plan',
      '--verbose',
    ]);
    expect(settingsClaudeResult.agentId).toBe('claude');
    expect(messages).toContain('✓ merged controls  model=generic-model');
    expect(messages).toContain('↳ launching pi …');
    expect(messages).toContain('↳ launching claude …');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.5, APPLEPI-REQ-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes Claude Code unsupported control warnings fatal when strict is enabled', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.applepi', 'profiles'),
      'default',
      'id: default\ncontrols:\n  provider: anthropic\n',
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, agentId: 'claude', strict: true },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow("Strict failed for claude: claude adapter cannot translate requested control 'provider'.");
  });
});
