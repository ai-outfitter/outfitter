// Tests pi adapter launch translation and composite file behavior.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { writeCompositeProfile } from '../../src/compositeProfile/CompositeProfileAssembler.js';
import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';

const temporaryPiAdapterTestRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryPiAdapterTestRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const writePiMcpConfig = (profileFolder: string, content: object | string): void => {
  const piFolder = join(profileFolder, 'cli_specific', 'pi');
  mkdirSync(piFolder, { recursive: true });
  writeFileSync(join(piFolder, '.mcp.json'), typeof content === 'string' ? content : `${JSON.stringify(content)}\n`);
};

describe('pi adapter', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.1, OFTR-006.2, OFTR-006.3, OFTR-006.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('translates generic and pi-specific profile controls into pi env and argv', () => {
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      {
        id: 'engineering',
        inherits: [],
        controls: {
          model: 'generic-model',
          provider: 'anthropic',
          environment: { GENERIC: '1' },
          extensions: ['ext-a'],
          skills: ['skill-a'],
          promptTemplate: 'template-a',
          systemPrompt: 'base prompt',
          appendSystemPrompt: 'extra prompt',
          pi: {
            model: 'pi-model',
            thinking: 'medium',
            sessionDirectory: '/tmp/pi-sessions',
            args: ['--share'],
            environment: { PI_ONLY: '1' },
            extensions: ['npm:pi-subagents@2'],
            skills: ['skill-pi'],
          },
        },
      },
      { rootDirectory: '/tmp/outfitter-engineering-pi-123', profilePaths: ['/profiles/engineering/profile.yml'] },
    );
    const launchPlan = adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, {
      id: 'engineering',
      inherits: [],
      controls: {
        model: 'generic-model',
        provider: 'anthropic',
        environment: { GENERIC: '1' },
        extensions: ['npm:pi-subagents@1', 'ext-a'],
        skills: ['skill-a'],
        promptTemplate: 'template-a',
        systemPrompt: 'base prompt',
        appendSystemPrompt: 'extra prompt',
        pi: {
          model: 'pi-model',
          thinking: 'medium',
          sessionDirectory: '/tmp/pi-sessions',
          args: ['--share'],
          environment: { PI_ONLY: '1' },
          extensions: ['npm:pi-subagents@2'],
          skills: ['skill-pi'],
        },
      },
    });

    expect(adapter.id).toBe('pi');
    expect(adapter.supportedControls).toContain('model');
    expect(adapter.supportedControls).toContain('promptTemplate');
    expect(
      adapter.getUnsupportedControls({
        id: 'engineering',
        inherits: [],
        controls: { pi: { unsupportedPiControl: true } },
      }),
    ).toEqual(['pi.unsupportedPiControl']);
    expect(compositeProfilePlan.compositeProfile.rootDirectory).toBe('/tmp/outfitter-engineering-pi-123');
    expect(compositeProfilePlan.compositeProfile.files[0]?.sourceInputs).toEqual(['/profiles/engineering/profile.yml']);
    expect(launchPlan.command).toBe('pi');
    expect(launchPlan.env).toEqual({
      GENERIC: '1',
      PI_ONLY: '1',
      PI_CODING_AGENT_DIR: '/tmp/outfitter-engineering-pi-123',
    });
    expect(launchPlan.args).toEqual([
      '--model',
      'pi-model',
      '--provider',
      'anthropic',
      '--thinking',
      'medium',
      '--session-dir',
      '/tmp/pi-sessions',
      '--prompt-template',
      'template-a',
      '--system-prompt',
      'base prompt',
      '--append-system-prompt',
      'extra prompt',
      '--extension',
      'npm:pi-subagents@2',
      '--extension',
      'ext-a',
      '--skill',
      'skill-pi',
      '--skill',
      'skill-a',
      '--share',
    ]);

    const genericFallbackProfile = parseProfileYaml(
      'id: fallback\ncontrols:\n  model: generic-model\n  pi: {}\n',
      'fallback',
    );
    expect('message' in genericFallbackProfile).toBe(false);
    if (!('message' in genericFallbackProfile)) {
      expect(adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, genericFallbackProfile).args).toEqual([
        '--model',
        'generic-model',
      ]);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes native pi models config available inside the composite profile', () => {
    const { homeDirectory } = createPiSettingsTestHome();
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      {
        rootDirectory: '/tmp/outfitter-engineering-pi-models',
        profilePaths: ['/profiles/engineering/profile.yml'],
        homeDirectory,
      },
    );

    expect(
      compositeProfilePlan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'models.json'),
    ).toEqual({
      relativePath: 'models.json',
      strategy: 'symlink',
      directory: false,
      sourcePath: join(homeDirectory, '.pi', 'agent', 'models.json'),
    });
  });

  it('initializes missing native mcp and models configs as valid empty JSON documents', () => {
    const { homeDirectory } = createPiSettingsTestHome();
    const adapter = createPiAdapter();

    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      {
        rootDirectory: join(homeDirectory, 'composite'),
        profilePaths: ['/profiles/engineering/profile.yml'],
        homeDirectory,
      },
    );

    expect(
      compositeProfilePlan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'mcp.json'),
    ).toMatchObject({ sourcePath: join(homeDirectory, '.pi', 'agent', 'mcp.json') });

    writeCompositeProfile(compositeProfilePlan.compositeProfile);

    expect(readFileSync(join(homeDirectory, '.pi', 'agent', 'mcp.json'), 'utf8')).toBe('{}\n');
    expect(readFileSync(join(homeDirectory, '.pi', 'agent', 'models.json'), 'utf8')).toBe('{"providers":{}}\n');

    writeFileSync(join(homeDirectory, '.pi', 'agent', 'mcp.json'), '');
    writeFileSync(join(homeDirectory, '.pi', 'agent', 'models.json'), '');
    writeCompositeProfile(compositeProfilePlan.compositeProfile);
    expect(readFileSync(join(homeDirectory, '.pi', 'agent', 'mcp.json'), 'utf8')).toBe('{}\n');
    expect(readFileSync(join(homeDirectory, '.pi', 'agent', 'models.json'), 'utf8')).toBe('{"providers":{}}\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('transforms pi settings packages when profile extensions would duplicate native packages', () => {
    const { homeDirectory, settingsPath } = createPiSettingsTestHome();
    writeFileSync(
      settingsPath,
      JSON.stringify({
        packages: [
          'npm:pi-subagents',
          { source: 'npm:kept-package', extensions: ['index.ts'] },
          { source: 'git+https://github.com/ai-outfitter/deepwork.git#main' },
          { source: 42, note: 'kept because it has no string source' },
          null,
        ],
        theme: 'dark',
      }),
    );

    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      {
        id: 'engineering',
        inherits: [],
        controls: {
          pi: {
            extensions: ['npm:pi-subagents@2', 'git:github.com/ai-outfitter/deepwork#v1'],
          },
        },
      },
      {
        rootDirectory: '/tmp/outfitter-engineering-pi-456',
        profilePaths: ['/profiles/engineering/profile.yml'],
        homeDirectory,
      },
    );

    const transformedSettings = compositeProfilePlan.compositeProfile.files.find(
      (file) => file.relativePath === 'settings.json',
    );

    expect(transformedSettings?.sourceInputs).toEqual([settingsPath, '/profiles/engineering/profile.yml']);
    expect(JSON.parse(transformedSettings?.content ?? '{}')).toEqual({
      packages: [
        { source: 'npm:kept-package', extensions: ['index.ts'] },
        { source: 42, note: 'kept because it has no string source' },
        null,
      ],
      theme: 'dark',
    });
    expect(
      compositeProfilePlan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'settings.json'),
    ).toEqual({
      relativePath: 'settings.json',
      strategy: 'discard',
      directory: false,
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps native pi settings state when settings do not need reconciliation or cannot be parsed', () => {
    const noDuplicate = createPiSettingsTestHome();
    writeFileSync(noDuplicate.settingsPath, JSON.stringify({ packages: ['npm:kept-package'] }));

    const invalid = createPiSettingsTestHome();
    writeFileSync(invalid.settingsPath, 'not json');

    const nonObject = createPiSettingsTestHome();
    writeFileSync(nonObject.settingsPath, '[]');

    const malformedPackages = createPiSettingsTestHome();
    writeFileSync(malformedPackages.settingsPath, JSON.stringify({ packages: {} }));

    const adapter = createPiAdapter();
    const profile = {
      id: 'engineering',
      inherits: [],
      controls: { pi: { extensions: ['npm:pi-subagents'] } },
    };

    for (const homeDirectory of [
      noDuplicate.homeDirectory,
      invalid.homeDirectory,
      nonObject.homeDirectory,
      malformedPackages.homeDirectory,
    ]) {
      const compositeProfilePlan = adapter.createCompositeProfile(profile, {
        rootDirectory: '/tmp/outfitter-engineering-pi-789',
        profilePaths: ['/profiles/engineering/profile.yml'],
        homeDirectory,
      });

      expect(compositeProfilePlan.compositeProfile.files.some((file) => file.relativePath === 'settings.json')).toBe(
        false,
      );
      expect(
        compositeProfilePlan.compositeProfile.statePaths.some(
          (statePath) => statePath.relativePath === 'settings.json',
        ),
      ).toBe(true);
    }

    const unreadable = createPiSettingsTestHome();
    mkdirSync(unreadable.settingsPath);

    expect(() =>
      adapter.createCompositeProfile(profile, {
        rootDirectory: '/tmp/outfitter-engineering-pi-789',
        profilePaths: ['/profiles/engineering/profile.yml'],
        homeDirectory: unreadable.homeDirectory,
      }),
    ).toThrow(/Could not read pi settings file/u);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges pi .mcp.json profile fragments with unique array identities keeping the last entry', () => {
    const root = createTemporaryPiAdapterTestRoot('outfitter-pi-mcp-test-');
    const baseProfileFolder = join(root, 'base');
    const explicitProfileFolder = join(root, 'explicit');

    writePiMcpConfig(baseProfileFolder, {
      mcpServers: {
        shared: { command: 'base-command', args: ['--base-only'] },
        baseOnly: { command: 'base-only-command' },
      },
      metadata: {
        labels: [
          { identity: 'shared', value: 'base' },
          { name: 'base-label', value: 'base' },
          { identity: 7, value: 'numeric-base' },
          { value: 'anonymous-base' },
          { value: { nested: 'base' } },
          { z: 'last', a: 'first' },
          ['base-array'],
          'stable-string',
          '7',
          'null',
          7,
          null,
        ],
        nested: { enabled: true, owner: 'base' },
        scalarToArray: 'base',
      },
    });
    writePiMcpConfig(explicitProfileFolder, {
      mcpServers: {
        shared: { command: 'explicit-command' },
        explicitOnly: { command: 'explicit-only-command' },
      },
      metadata: {
        labels: [
          { identity: 'shared', value: 'explicit' },
          { id: 'explicit-label', value: 'explicit' },
          { identity: 7, value: 'numeric-explicit' },
          { value: 'anonymous-explicit' },
          { value: { other: 'explicit' } },
          ['explicit-array'],
          'stable-string',
          7,
          null,
        ],
        nested: { owner: 'explicit' },
        scalarToArray: ['explicit'],
      },
    });

    const compositeProfilePlan = createPiAdapter().createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      {
        rootDirectory: join(root, 'composite'),
        profilePaths: [],
        profileFolders: [baseProfileFolder, explicitProfileFolder],
      },
    );

    const mcpFile = compositeProfilePlan.compositeProfile.files.find((file) => file.relativePath === '.mcp.json');

    expect(mcpFile?.strategy).toBe('merge');
    expect(mcpFile?.sourceInputs).toEqual([
      join(baseProfileFolder, 'cli_specific', 'pi', '.mcp.json'),
      join(explicitProfileFolder, 'cli_specific', 'pi', '.mcp.json'),
    ]);
    expect(JSON.parse(mcpFile?.content ?? '{}')).toEqual({
      mcpServers: {
        shared: { command: 'explicit-command' },
        baseOnly: { command: 'base-only-command' },
        explicitOnly: { command: 'explicit-only-command' },
      },
      metadata: {
        labels: [
          { name: 'base-label', value: 'base' },
          { value: 'anonymous-base' },
          { value: { nested: 'base' } },
          { z: 'last', a: 'first' },
          ['base-array'],
          '7',
          'null',
          { identity: 'shared', value: 'explicit' },
          { id: 'explicit-label', value: 'explicit' },
          { identity: 7, value: 'numeric-explicit' },
          { value: 'anonymous-explicit' },
          { value: { other: 'explicit' } },
          ['explicit-array'],
          'stable-string',
          7,
          null,
        ],
        nested: { enabled: true, owner: 'explicit' },
        scalarToArray: ['explicit'],
      },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('adds profile-bundled Pi skills to the launch args', () => {
    const root = createTemporaryPiAdapterTestRoot('outfitter-pi-profile-skills-');
    const profileFolder = join(root, 'profiles', 'data_analyst');
    const skillFolder = join(profileFolder, 'cli_specific', 'pi', 'skills', 'demos');
    const incompleteSkillFolder = join(profileFolder, 'cli_specific', 'pi', 'skills', 'draft');
    mkdirSync(skillFolder, { recursive: true });
    mkdirSync(incompleteSkillFolder, { recursive: true });
    writeFileSync(join(skillFolder, 'SKILL.md'), '---\nname: demos\ndescription: Demo runner\n---\n');

    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'data_analyst', inherits: [], controls: {} },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder] },
    );
    const launchPlan = adapter.createLaunchPlan(
      compositeProfilePlan.compositeProfile,
      { id: 'data_analyst', inherits: [], controls: { pi: { skills: ['user-skill'] } } },
      [],
      { profileFolders: [profileFolder] },
    );

    expect(launchPlan.args).toEqual(['--skill', 'user-skill', '--skill', skillFolder]);
  });

  it('reports invalid profile-bundled Pi resource paths', () => {
    const root = createTemporaryPiAdapterTestRoot('outfitter-pi-profile-resource-errors-');
    const adapter = createPiAdapter();
    const profileFolder = join(root, 'profiles', 'data_analyst');
    const skillsFolder = join(profileFolder, 'cli_specific', 'pi', 'skills');
    const jobsFolder = join(profileFolder, 'cli_specific', 'pi', 'deepwork', 'jobs');
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'data_analyst', inherits: [], controls: {} },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder] },
    );

    mkdirSync(join(profileFolder, 'cli_specific', 'pi'), { recursive: true });
    writeFileSync(skillsFolder, 'not a directory');
    expect(() =>
      adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, undefined, [], {
        profileFolders: [profileFolder],
      }),
    ).toThrow(`Could not read profile Pi skills folder '${skillsFolder}'`);

    rmSync(skillsFolder, { force: true });
    mkdirSync(join(profileFolder, 'cli_specific', 'pi', 'deepwork'), { recursive: true });
    writeFileSync(jobsFolder, 'not a directory');
    expect(() =>
      adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, undefined, [], {
        profileFolders: [profileFolder],
      }),
    ).toThrow(`Could not read profile DeepWork jobs folder '${jobsFolder}'`);

    rmSync(jobsFolder, { force: true });
    const loopingSkillFile = join(skillsFolder, 'loop', 'SKILL.md');
    mkdirSync(join(skillsFolder, 'loop'), { recursive: true });
    symlinkSync(loopingSkillFile, loopingSkillFile);
    expect(() =>
      adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, undefined, [], {
        profileFolders: [profileFolder],
      }),
    ).toThrow(`Could not inspect file '${loopingSkillFile}'`);
  });

  it('rejects pi .mcp.json profile fragments that are invalid or not JSON objects', () => {
    const root = createTemporaryPiAdapterTestRoot('outfitter-pi-mcp-invalid-test-');
    const nonObjectProfileFolder = join(root, 'non-object-profile');
    const malformedProfileFolder = join(root, 'malformed-profile');
    const unreadableProfileFolder = join(root, 'unreadable-profile');
    writePiMcpConfig(nonObjectProfileFolder, '[]\n');
    writePiMcpConfig(malformedProfileFolder, '{invalid-json}\n');
    mkdirSync(join(unreadableProfileFolder, 'cli_specific', 'pi', '.mcp.json'), { recursive: true });

    expect(() =>
      createPiAdapter().createCompositeProfile(
        { id: 'engineering', inherits: [], controls: {} },
        {
          rootDirectory: join(root, 'non-object-composite'),
          profilePaths: [],
          profileFolders: [nonObjectProfileFolder],
        },
      ),
    ).toThrow(
      `Pi MCP config '${join(nonObjectProfileFolder, 'cli_specific', 'pi', '.mcp.json')}' must contain a JSON object.`,
    );
    expect(() =>
      createPiAdapter().createCompositeProfile(
        { id: 'engineering', inherits: [], controls: {} },
        {
          rootDirectory: join(root, 'malformed-composite'),
          profilePaths: [],
          profileFolders: [malformedProfileFolder],
        },
      ),
    ).toThrow(
      `Pi MCP config '${join(malformedProfileFolder, 'cli_specific', 'pi', '.mcp.json')}' must contain valid JSON.`,
    );
    expect(() =>
      createPiAdapter().createCompositeProfile(
        { id: 'engineering', inherits: [], controls: {} },
        {
          rootDirectory: join(root, 'unreadable-composite'),
          profilePaths: [],
          profileFolders: [unreadableProfileFolder],
        },
      ),
    ).toThrow(`Could not read Pi MCP config '${join(unreadableProfileFolder, 'cli_specific', 'pi', '.mcp.json')}`);
  });
});

const createTemporaryPiAdapterTestRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryPiAdapterTestRoots.push(root);
  return root;
};

const createPiSettingsTestHome = (): { readonly homeDirectory: string; readonly settingsPath: string } => {
  const homeDirectory = createTemporaryPiAdapterTestRoot('outfitter-pi-settings-');
  const settingsDirectory = join(homeDirectory, '.pi', 'agent');
  const settingsPath = join(settingsDirectory, 'settings.json');
  mkdirSync(settingsDirectory, { recursive: true });

  return { homeDirectory, settingsPath };
};
