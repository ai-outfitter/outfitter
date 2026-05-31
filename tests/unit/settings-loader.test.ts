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
  const root = mkdtempSync(join(tmpdir(), 'bridl-settings-'));
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
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('discovers user, project, and project-local settings.yml locations', () => {
    const homeDirectory = '/home/example';
    const projectDirectory = '/work/project';

    const plan = discoverSettingsLoadPlan({ homeDirectory, projectDirectory });

    expect(plan.locations).toEqual([
      { scope: 'user', path: '/home/example/.bridl/settings.yml' },
      { scope: 'project', path: '/work/project/.bridl/settings.yml' },
      { scope: 'project-local', path: '/work/project/.bridl/local/settings.yml' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads discovered settings and merges them with project-local precedence', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.bridl', 'settings.yml'),
      'default_profile: user-default\ncache_directory: ./user-cache\nprofile_sources:\n  - path: ./profiles\n',
    );
    writeSettings(
      join(projectDirectory, '.bridl', 'settings.yml'),
      'default_profile: project-default\ncache_directory: ./project-cache\n',
    );
    writeSettings(
      join(projectDirectory, '.bridl', 'local', 'settings.yml'),
      'default_profile: local-default\ncache_directory: ./local-cache\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.files.map((file) => file.location.scope)).toEqual(['user', 'project', 'project-local']);
    expect(loaded.settings.defaultProfile).toBe('local-default');
    expect(loaded.settings.profileSources).toEqual([{ path: join(homeDirectory, '.bridl', 'profiles') }]);
    expect(loaded.settings.remoteSettings).toEqual([]);
    expect(loaded.settings.cacheDirectory).toBe(join(projectDirectory, '.bridl', 'local', 'local-cache'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.3).
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.5, BRIDL-REQ-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates local, URI, GitHub, and remote settings entries from settings files', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.bridl', 'settings.yml');
    writeSettings(
      settingsPath,
      `profile_sources:\n  - path: ./profiles\n    only: [engineering]\n  - path: ${join(root, 'absolute-profiles')}\n  - uri: git+https://example.test/profiles.git\n    path: team/profiles\n    ref: main\n    except: [sandbox]\n  - github: example/bridl-config\n    path: profiles\nremote_settings:\n  - github: example/bridl-config\n    ref: main\n    path: settings.yml\n`,
    );

    const result = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

    expect(result.issues).toEqual([]);
    expect(result.files[0]?.settings.profileSources).toEqual([
      { path: join(root, '.bridl', 'profiles'), only: ['engineering'] },
      { path: join(root, 'absolute-profiles') },
      { uri: 'git+https://example.test/profiles.git', path: 'team/profiles', ref: 'main', except: ['sandbox'] },
      { github: 'example/bridl-config', path: 'profiles' },
    ]);
    expect(result.files[0]?.settings.remoteSettings).toEqual([
      { github: 'example/bridl-config', ref: 'main', path: 'settings.yml' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves configured cache directories relative to the containing settings file', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.bridl', 'settings.yml');
    writeSettings(settingsPath, 'cache_directory: ./cache\n');

    const result = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

    expect(result.issues).toEqual([]);
    expect(result.files[0]?.settings.cacheDirectory).toBe(join(root, '.bridl', 'cache'));
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads cached remote settings from repository subpaths with local settings precedence', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.bridl', 'settings.yml'),
      'default_profile: local\nremote_settings:\n  - uri: git+https://github.com/example/bridl-config.git\n    ref: main\n    path: settings.yml\n',
    );
    const remoteSettingsPath = join(
      createRemoteRepositoryCachePath(homeDirectory, {
        uri: 'git+https://github.com/example/bridl-config.git',
        ref: 'main',
      }),
      'settings.yml',
    );
    writeSettings(
      remoteSettingsPath,
      'default_profile: remote\nprofile_sources:\n  - github: example/bridl-config\n    path: remote-profiles\n',
    );

    const loaded = loadSettingsWithCachedRemoteSettings({ homeDirectory, projectDirectory });

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.defaultProfile).toBe('local');
    expect(loaded.settings.profileSources).toEqual([{ github: 'example/bridl-config', path: 'remote-profiles' }]);

    writeSettings(
      join(homeDirectory, '.bridl', 'settings.yml'),
      'default_profile: local\nprofile_sources:\n  - path: ./local-profiles\nremote_settings:\n  - uri: git+https://github.com/example/bridl-config.git\n    ref: main\n    path: settings.yml\n',
    );
    const localOverrideLoaded = loadSettingsWithCachedRemoteSettings({ homeDirectory, projectDirectory });
    expect(localOverrideLoaded.settings.profileSources).toEqual([
      { path: join(homeDirectory, '.bridl', 'local-profiles') },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports invalid cached remote settings subpaths as settings issues', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.bridl', 'settings.yml'),
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
