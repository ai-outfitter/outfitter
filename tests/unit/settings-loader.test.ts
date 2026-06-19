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
  it('discovers user, project, and project-local settings.yml locations', () => {
    const homeDirectory = '/home/example';
    const projectDirectory = '/work/project';

    const plan = discoverSettingsLoadPlan({ homeDirectory, projectDirectory });

    expect(plan.locations).toEqual([
      { scope: 'user', path: '/home/example/.outfitter/settings.yml' },
      { scope: 'project', path: '/work/project/.outfitter/settings.yml' },
      { scope: 'project-local', path: '/work/project/.outfitter/local/settings.yml' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads discovered settings and merges them with project-local precedence', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.outfitter', 'settings.yml'),
      'default_profile: user-default\ndefault_agent: pi\ncache_directory: ./user-cache\nprofile_sources:\n  - path: ./profiles\n',
    );
    writeSettings(
      join(projectDirectory, '.outfitter', 'settings.yml'),
      'default_profile: project-default\ndefault_agent: claude\ncache_directory: ./project-cache\n',
    );
    writeSettings(
      join(projectDirectory, '.outfitter', 'local', 'settings.yml'),
      'default_profile: local-default\ncache_directory: ./local-cache\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.files.map((file) => file.location.scope)).toEqual(['user', 'project', 'project-local']);
    expect(loaded.settings.defaultProfile).toBe('local-default');
    expect(loaded.settings.defaultAgent).toBe('claude');
    expect(loaded.settings.profileSources).toEqual([{ path: join(homeDirectory, '.outfitter', 'profiles') }]);
    expect(loaded.settings.remoteSettings).toEqual([]);
    expect(loaded.settings.cacheDirectory).toBe(join(projectDirectory, '.outfitter', 'local', 'local-cache'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports YAML parse and schema validation diagnostics with file paths', () => {
    const root = createTemporaryRoot();
    const malformedPath = join(root, 'malformed.yml');
    const invalidPath = join(root, 'invalid.yml');
    writeSettings(malformedPath, ': invalid: yaml:');
    writeSettings(invalidPath, 'profile_sources:\n  - only:\n      - engineering\n');

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
      path: '/profile_sources/0',
      message: "must have required property 'path'",
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.5, OFTR-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates local, URI, GitHub, and remote settings entries from settings files', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.outfitter', 'settings.yml');
    writeSettings(
      settingsPath,
      `profile_sources:\n  - path: ./profiles\n    only: [engineering]\n  - path: ${join(root, 'absolute-profiles')}\n  - uri: git+https://example.test/profiles.git\n    path: team/profiles\n    ref: main\n    except: [sandbox]\n  - github: example/outfitter-config\n    path: profiles\nremote_settings:\n  - github: example/outfitter-config\n    ref: main\n    path: settings.yml\n`,
    );

    const result = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

    expect(result.issues).toEqual([]);
    expect(result.files[0]?.settings.profileSources).toEqual([
      { path: join(root, '.outfitter', 'profiles'), only: ['engineering'] },
      { path: join(root, 'absolute-profiles') },
      { uri: 'git+https://example.test/profiles.git', path: 'team/profiles', ref: 'main', except: ['sandbox'] },
      { github: 'example/outfitter-config', path: 'profiles' },
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
      join(homeDirectory, '.outfitter', 'settings.yml'),
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
      join(projectDirectory, '.outfitter', 'settings.yml'),
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
    const settingsPath = join(root, '.outfitter', 'settings.yml');
    writeSettings(settingsPath, 'cache_directory: ./cache\n');

    const result = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

    expect(result.issues).toEqual([]);
    expect(result.files[0]?.settings.cacheDirectory).toBe(join(root, '.outfitter', 'cache'));
  });

  it('skips missing settings files and exposes generic YAML and schema helpers', () => {
    const root = createTemporaryRoot();
    const missingPath = join(root, 'missing.yml');

    expect(loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: missingPath }]))).toEqual({
      files: [],
      issues: [],
    });
    expect(parseYamlDocument('answer: 42\n', '/inline')).toEqual({ ok: true, document: { answer: 42 } });
    expect(validateSchema('profile-source', { path: './profiles' })).toEqual({ valid: true, issues: [] });
    expect(validateSchema('settings', null).issues[0]?.path).toBe('/');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads cached remote settings from repository subpaths with local settings precedence', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.outfitter', 'settings.yml'),
      'default_profile: local\nremote_settings:\n  - uri: git+https://github.com/example/outfitter-config.git\n    ref: main\n    path: settings.yml\n',
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
      'default_profile: remote\nprofile_sources:\n  - github: example/outfitter-config\n    path: remote-profiles\n',
    );

    const loaded = loadSettingsWithCachedRemoteSettings({ homeDirectory, projectDirectory });

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.defaultProfile).toBe('local');
    expect(loaded.settings.profileSources).toEqual([{ github: 'example/outfitter-config', path: 'remote-profiles' }]);

    writeSettings(
      join(homeDirectory, '.outfitter', 'settings.yml'),
      'default_profile: local\nprofile_sources:\n  - path: ./local-profiles\nremote_settings:\n  - uri: git+https://github.com/example/outfitter-config.git\n    ref: main\n    path: settings.yml\n',
    );
    const localOverrideLoaded = loadSettingsWithCachedRemoteSettings({ homeDirectory, projectDirectory });
    expect(localOverrideLoaded.settings.profileSources).toEqual([
      { path: join(homeDirectory, '.outfitter', 'local-profiles') },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports invalid cached remote settings subpaths as settings issues', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.outfitter', 'settings.yml'),
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
