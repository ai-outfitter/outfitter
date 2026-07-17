// Tests settings.yml discovery, YAML parsing, schema validation, and merging.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRemoteRepositoryCachePath } from '../../src/profiles/ProfileCache.js';
import {
  createSettingsLoadPlan,
  discoverRemoteSettingsLoadPlan,
  discoverSettingsLoadPlan,
  loadSettings,
  loadSettingsFiles,
  loadSettingsWithCachedRemoteSettings,
} from '../../src/settings/SettingsLoader.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';
import { parseYamlDocument } from '../../src/validation/YamlDocument.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-settings-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('settings loading', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('discovers user, user-local, project, and project-local .agents settings locations', () => {
    const homeDirectory = '/home/example';
    const projectDirectory = '/work/project';

    const plan = discoverSettingsLoadPlan({ homeDirectory, projectDirectory });

    expect(plan.locations).toEqual([
      { scope: 'user', path: '/home/example/.agents/settings.yml' },
      { scope: 'user-local', path: '/home/example/.agents/settings.local.yml' },
      { scope: 'project', path: '/work/project/.agents/settings.yml' },
      { scope: 'project-local', path: '/work/project/.agents/settings.local.yml' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads discovered settings and merges them with project-local precedence', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.agents', 'settings.yml'),
      'default_agent: user-default\ndefault_harness: pi\ncache_directory: ./user-cache\nsources:\n  - path: ./agents\n',
    );
    writeSettings(
      join(projectDirectory, '.agents', 'settings.yml'),
      'default_agent: project-default\ndefault_harness: claude\ncache_directory: ./project-cache\n',
    );
    writeSettings(
      join(projectDirectory, '.agents', 'settings.local.yml'),
      'default_agent: local-default\ncache_directory: ./local-cache\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.files.map((file) => file.location.scope)).toEqual(['user', 'project', 'project-local']);
    expect(loaded.settings.defaultAgent).toBe('local-default');
    expect(loaded.settings.defaultHarness).toBe('claude');
    expect(loaded.settings.sources).toEqual([{ path: join(homeDirectory, '.agents', 'agents') }]);
    expect(loaded.settings.remoteSettings).toEqual([]);
    expect(loaded.settings.cacheDirectory).toBe(join(projectDirectory, '.agents', 'local-cache'));
  });

  it('applies user-local settings above user settings', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(join(homeDirectory, '.agents', 'settings.yml'), 'default_agent: user\ndefault_harness: pi\n');
    writeSettings(join(homeDirectory, '.agents', 'settings.local.yml'), 'default_agent: user-local\n');

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.files.map((file) => file.location.scope)).toEqual(['user', 'user-local']);
    expect(loaded.settings.defaultAgent).toBe('user-local');
    expect(loaded.settings.defaultHarness).toBe('pi');
  });

  it('loads and merges startup display and enterprise settings', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.agents', 'settings.yml'),
      'startup:\n  ascii_art: true\nenterprise:\n  private_catalogs: false\n',
    );
    writeSettings(
      join(projectDirectory, '.agents', 'settings.yml'),
      'startup:\n  ascii_art: false\nenterprise:\n  private_catalogs: true\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.startup).toEqual({ asciiArt: false });
    expect(loaded.settings.enterprise).toEqual({ privateCatalogs: true });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads and merges state_persistence maps with higher-precedence overrides', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.agents', 'settings.yml'),
      'state_persistence:\n  "settings.json": discard\n  "auth.json": symlink\n',
    );
    writeSettings(join(projectDirectory, '.agents', 'settings.yml'), 'state_persistence:\n  "settings.json": warn\n');

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.statePersistence).toEqual({ 'settings.json': 'warn', 'auth.json': 'symlink' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports YAML parse and schema validation diagnostics with file paths', () => {
    const root = createTemporaryRoot();
    const malformedPath = join(root, 'malformed.yml');
    const invalidPath = join(root, 'invalid.yml');
    writeSettings(malformedPath, ': invalid: yaml:');
    writeSettings(invalidPath, 'default_harness: bun\n');

    const result = loadSettingsFiles(
      createSettingsLoadPlan([
        { scope: 'user', path: malformedPath },
        { scope: 'project', path: invalidPath },
      ]),
    );

    expect(result.files).toEqual([]);
    expect(result.issues[0]?.filePath).toBe(malformedPath);
    expect(result.issues[0]?.path).toBe(malformedPath);
    expect(result.issues).toContainEqual({
      filePath: invalidPath,
      path: '/default_harness',
      message: 'must be equal to one of the allowed values',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.5, OFTR-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates local, URI, GitHub, and remote settings entries from settings files', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.agents', 'settings.yml');
    writeSettings(
      settingsPath,
      `sources:\n  - path: ./agents\n  - path: ${join(root, 'absolute-agents')}\n  - uri: git+https://example.test/agents.git\n    path: team/agents\n    ref: main\n  - github: example/.agent\n    path: agents\nremote_settings:\n  - github: example/outfitter-config\n    ref: main\n    path: settings.yml\n`,
    );

    const result = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

    expect(result.issues).toEqual([]);
    expect(result.files[0]?.settings.sources).toEqual([
      { path: join(root, '.agents', 'agents') },
      { path: join(root, 'absolute-agents') },
      { uri: 'git+https://example.test/agents.git', path: 'team/agents', ref: 'main' },
      { github: 'example/.agent', path: 'agents' },
    ]);
    expect(result.files[0]?.settings.remoteSettings).toEqual([
      { github: 'example/outfitter-config', ref: 'main', path: 'settings.yml' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads and deep-merges arbitrary custom settings with higher-precedence overrides', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.agents', 'settings.yml'),
      [
        'custom_settings:',
        '  build_commands:',
        '    lint: npm run lint',
        '    test: npm test',
        '  tools:',
        '    - eslint',
        '',
      ].join('\n'),
    );
    writeSettings(
      join(projectDirectory, '.agents', 'settings.yml'),
      ['custom_settings:', '  build_commands:', '    lint: npm run lint:ci', '  tools:', '    - prettier', ''].join(
        '\n',
      ),
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.customSettings).toEqual({
      build_commands: {
        lint: 'npm run lint:ci',
        test: 'npm test',
      },
      tools: ['prettier'],
    });
  });

  it('resolves configured cache directories relative to the containing settings file', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.agents', 'settings.yml');
    writeSettings(settingsPath, 'cache_directory: ./cache\n');

    const result = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

    expect(result.issues).toEqual([]);
    expect(result.files[0]?.settings.cacheDirectory).toBe(join(root, '.agents', 'cache'));
  });

  it('skips missing settings files and exposes generic YAML and schema helpers', () => {
    const root = createTemporaryRoot();
    const missingPath = join(root, 'missing.yml');

    expect(loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: missingPath }]))).toEqual({
      files: [],
      issues: [],
    });
    expect(parseYamlDocument('answer: 42\n', '/inline')).toEqual({ ok: true, document: { answer: 42 } });
    expect(validateSchema('settings', { default_agent: 'engineer' })).toEqual({ valid: true, issues: [] });
    expect(validateSchema('settings', null).issues[0]?.path).toBe('/');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads cached remote settings from repository subpaths with local settings precedence', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.agents', 'settings.yml'),
      'default_agent: local\nremote_settings:\n  - uri: git+https://github.com/example/outfitter-config.git\n    ref: main\n    path: settings.yml\n',
    );
    const remoteSettingsPath = join(
      createRemoteRepositoryCachePath(homeDirectory, {
        uri: 'git+https://github.com/example/outfitter-config.git',
        ref: 'main',
      }),
      'settings.yml',
    );
    writeSettings(
      remoteSettingsPath,
      'default_agent: remote\nsources:\n  - github: example/.agent\n    path: remote-agents\n',
    );

    const loaded = loadSettingsWithCachedRemoteSettings({ homeDirectory, projectDirectory });

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.defaultAgent).toBe('local');
    expect(loaded.settings.sources).toEqual([{ github: 'example/.agent', path: 'remote-agents' }]);

    writeSettings(
      join(homeDirectory, '.agents', 'settings.yml'),
      'default_agent: local\nsources:\n  - path: ./local-agents\nremote_settings:\n  - uri: git+https://github.com/example/outfitter-config.git\n    ref: main\n    path: settings.yml\n',
    );
    const localOverrideLoaded = loadSettingsWithCachedRemoteSettings({ homeDirectory, projectDirectory });
    expect(localOverrideLoaded.settings.sources).toEqual([{ path: join(homeDirectory, '.agents', 'local-agents') }]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports invalid cached remote settings subpaths as settings issues', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.agents', 'settings.yml'),
      'remote_settings:\n  - github: example/absolute\n    path: /tmp/settings.yml\n  - github: example/escape\n    path: ../settings.yml\n',
    );

    const loaded = loadSettingsWithCachedRemoteSettings({ homeDirectory, projectDirectory });
    const invalidPlan = discoverRemoteSettingsLoadPlan(homeDirectory, [
      { github: 'example/absolute', path: '/tmp/settings.yml' },
    ]);

    expect(invalidPlan.locations).toEqual([]);
    expect(loaded.files.map((file) => file.location.scope)).toEqual(['user']);
    expect(loaded.issues).toEqual([
      {
        filePath: 'remote_settings[0]',
        path: '/remote_settings/0/path',
        message: "Remote repository path '/tmp/settings.yml' must be relative.",
      },
      {
        filePath: 'remote_settings[1]',
        path: '/remote_settings/1/path',
        message: "Remote repository path '../settings.yml' must stay inside the repository.",
      },
    ]);
  });
});
