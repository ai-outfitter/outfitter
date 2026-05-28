// Tests settings.yml discovery, YAML parsing, schema validation, and merging.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createSettingsLoadPlan,
  discoverSettingsLoadPlan,
  loadSettings,
  loadSettingsFiles,
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
      'default_profile: user-default\nprofile_sources:\n  - path: ./profiles\n',
    );
    writeSettings(join(projectDirectory, '.bridl', 'settings.yml'), 'default_profile: project-default\n');
    writeSettings(join(projectDirectory, '.bridl', 'local', 'settings.yml'), 'default_profile: local-default\n');

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.files.map((file) => file.location.scope)).toEqual(['user', 'project', 'project-local']);
    expect(loaded.settings.defaultProfile).toBe('local-default');
    expect(loaded.settings.profileSources).toEqual([{ path: join(homeDirectory, '.bridl', 'profiles') }]);
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates profile source entries and resolves relative paths from the settings file', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.bridl', 'settings.yml');
    writeSettings(
      settingsPath,
      `profile_sources:\n  - path: ./profiles\n    only: [engineering]\n  - path: ${join(root, 'absolute-profiles')}\n  - uri: git+https://example.test/profiles.git\n    except: [sandbox]\n`,
    );

    const result = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

    expect(result.issues).toEqual([]);
    expect(result.files[0]?.settings.profileSources).toEqual([
      { path: join(root, '.bridl', 'profiles'), only: ['engineering'] },
      { path: join(root, 'absolute-profiles') },
      { uri: 'git+https://example.test/profiles.git', except: ['sandbox'] },
    ]);
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
});
