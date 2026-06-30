// Tests profile source loading and profile.yml parsing behavior.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isProfileIncludedBySource,
  isValidProfileId,
  loadLocalProfileSource,
  parseProfileDocument,
  parseProfileYaml,
  readErrorMessage,
} from '../../src/profiles/ProfileLoader.js';
import { createLocalProfileSource, createUriProfileSource } from '../../src/profiles/ProfileSource.js';

const temporaryRoots: string[] = [];

const createProfileSourceRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-profile-source-'));
  temporaryRoots.push(root);
  return root;
};

const writeProfile = (root: string, id: string, content: string): void => {
  const folderPath = join(root, id);
  mkdirSync(folderPath);
  writeFileSync(join(folderPath, 'profile.yml'), content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('profile loading', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('applies profile source only and except filters to local profile loading', () => {
    const root = createProfileSourceRoot();
    writeProfile(root, 'base', 'label: Base\n');
    writeProfile(root, 'engineering', 'id: engineering\ncontrols:\n  model: pi/default\n');
    writeProfile(root, 'research', 'id: research\n');

    const result = loadLocalProfileSource({ path: root, only: ['base', 'engineering'], except: ['base'] });

    expect(result.issues).toEqual([]);
    expect(result.profiles.map((loadedProfile) => loadedProfile.profile.id)).toEqual(['engineering']);
    expect(result.profiles.at(0)?.profile.controls.model).toBe('pi/default');
    expect(isProfileIncludedBySource('research', createLocalProfileSource(root))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses profile.yml files from profile folders with fallback folder identity', () => {
    const root = createProfileSourceRoot();
    writeProfile(
      root,
      'base',
      'label: Base Profile\ndescription: Shared defaults for engineering work.\ninherits:\n  - shared\ncontrols:\n  environment:\n    MODE: test\n',
    );
    writeFileSync(join(root, 'README.md'), 'not a profile folder');

    const result = loadLocalProfileSource(createLocalProfileSource(root));

    expect(result.issues).toEqual([]);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.folderPath).toBe(join(root, 'base'));
    expect(result.profiles[0]?.profilePath).toBe(join(root, 'base', 'profile.yml'));
    expect(result.profiles[0]?.resourceRootPath).toBe(join(root, 'base'));
    expect(result.profiles[0]?.sourceRootPath).toBe(root);
    expect(result.profiles[0]?.layout).toBe('directory');
    expect(result.profiles[0]?.profile).toEqual({
      id: 'base',
      label: 'Base Profile',
      description: 'Shared defaults for engineering work.',
      inherits: ['shared'],
      controls: { environment: { MODE: 'test' } },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses flat profile YAML files with fallback filename identities and no resource root', () => {
    const root = createProfileSourceRoot();
    writeFileSync(join(root, 'engineer.yml'), 'label: Engineer\ncontrols: {}\n');
    writeFileSync(join(root, 'founder.yaml'), 'label: Founder\ncontrols: {}\n');
    writeFileSync(join(root, 'profile.yml'), 'label: ignored root profile\n');
    writeFileSync(join(root, 'README.md'), 'not a profile');

    const result = loadLocalProfileSource(createLocalProfileSource(root));

    expect(result.issues).toEqual([]);
    expect(result.profiles.map((loadedProfile) => loadedProfile.profile.id)).toEqual(['engineer', 'founder']);
    expect(result.profiles.map((loadedProfile) => loadedProfile.profilePath)).toEqual([
      join(root, 'engineer.yml'),
      join(root, 'founder.yaml'),
    ]);
    expect(result.profiles.map((loadedProfile) => loadedProfile.resourceRootPath)).toEqual([undefined, undefined]);
    expect(result.profiles.map((loadedProfile) => loadedProfile.sourceRootPath)).toEqual([root, root]);
    expect(result.profiles.map((loadedProfile) => loadedProfile.layout)).toEqual(['flat-file', 'flat-file']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports invalid discovered profile slugs before loading flat files or profile folders', () => {
    const root = createProfileSourceRoot();
    mkdirSync(join(root, 'Bad Folder'));
    writeFileSync(join(root, 'Bad Folder', 'profile.yml'), 'id: valid-folder\ncontrols: {}\n');
    writeFileSync(join(root, 'Bad File.yml'), 'id: valid-file\ncontrols: {}\n');

    const result = loadLocalProfileSource(createLocalProfileSource(root));

    expect(result.profiles).toEqual([]);
    expect(result.issues).toEqual([
      {
        path: join(root, 'Bad File.yml'),
        message: "Profile slug 'Bad File' is not a filesystem-safe Outfitter profile id.",
      },
      {
        path: join(root, 'Bad Folder', 'profile.yml'),
        message: "Profile slug 'Bad Folder' is not a filesystem-safe Outfitter profile id.",
      },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects profile IDs that are not safe for CLI references', () => {
    expect(isValidProfileId('engineering.default')).toBe(true);
    expect(isValidProfileId('Engineering Default')).toBe(false);
    expect(parseProfileDocument(['not', 'a', 'mapping'], 'fallback')).toEqual({
      path: '/',
      message: 'Profile document must be a mapping.',
    });
    const invalidIdResult = parseProfileYaml('id: Engineering Default\n', 'fallback');
    const nonStringIdResult = parseProfileYaml('id: 123\ncontrols: {}\n', 'fallback');

    expect('message' in invalidIdResult && invalidIdResult.path).toBe('/id');
    expect('message' in invalidIdResult && invalidIdResult.message).toContain('must match pattern');
    expect(nonStringIdResult).toEqual({ path: '/id', message: 'must be string' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses template profile markers and validates their type', () => {
    expect(parseProfileYaml('id: shared\ntemplate: true\ncontrols: {}\n', 'fallback')).toEqual({
      id: 'shared',
      template: true,
      inherits: [],
      controls: {},
    });
    expect(parseProfileYaml('id: runnable\ntemplate: false\ncontrols: {}\n', 'fallback')).toEqual({
      id: 'runnable',
      template: false,
      inherits: [],
      controls: {},
    });
    expect(parseProfileYaml('id: invalid\ntemplate: yes\ncontrols: {}\n', 'fallback')).toEqual({
      path: '/template',
      message: 'must be boolean',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses agent generation profile markers and validates their type', () => {
    expect(parseProfileYaml('id: engineer\nagent_generation: true\ncontrols: {}\n', 'fallback')).toEqual({
      id: 'engineer',
      agentGeneration: true,
      inherits: [],
      controls: {},
    });
    expect(parseProfileYaml('id: reviewer\nagent_generation: false\ncontrols: {}\n', 'fallback')).toEqual({
      id: 'reviewer',
      agentGeneration: false,
      inherits: [],
      controls: {},
    });
    expect(parseProfileYaml('id: default\ncontrols: {}\n', 'fallback')).toEqual({
      id: 'default',
      inherits: [],
      controls: {},
    });
    expect(parseProfileYaml('id: invalid\nagent_generation: yes\ncontrols: {}\n', 'fallback')).toEqual({
      path: '/agent_generation',
      message: 'must be boolean',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses profile export markers and validates their type', () => {
    expect(parseProfileYaml('id: exported\nprofile_export: false\ncontrols: {}\n', 'fallback')).toEqual({
      id: 'exported',
      profileExport: false,
      inherits: [],
      controls: {},
    });
    expect(parseProfileYaml('id: invalid\nprofile_export: yes\ncontrols: {}\n', 'fallback')).toEqual({
      path: '/profile_export',
      message: 'must be boolean',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports profile.yml schema validation diagnostics with field pointers', () => {
    const root = createProfileSourceRoot();
    writeProfile(root, 'invalid-field', 'controls:\n  environment:\n    COUNT: 1\n');
    const invalidEnvironmentResult = parseProfileYaml('controls:\n  environment:\n    COUNT: 1\n', 'fallback');

    expect(invalidEnvironmentResult).toEqual({
      path: '/controls/environment/COUNT',
      message: 'must be string',
    });
    expect(loadLocalProfileSource(createLocalProfileSource(root)).issues).toEqual([
      {
        path: `${join(root, 'invalid-field', 'profile.yml')}#/controls/environment/COUNT`,
        message: 'must be string',
      },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.5, OFTR-003.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports non-local, missing, and malformed profile sources as load issues', () => {
    const missingRoot = join(createProfileSourceRoot(), 'missing-profile-source');
    const root = createProfileSourceRoot();
    writeProfile(root, 'broken', ': invalid: yaml:');

    expect(loadLocalProfileSource(createUriProfileSource('git+https://example.test/profiles.git')).issues).toEqual([
      { path: '<uri-source>', message: 'Only local profile sources can be loaded directly.' },
    ]);
    expect(loadLocalProfileSource(createLocalProfileSource(missingRoot)).issues).toEqual([
      { path: missingRoot, message: 'Profile source must be an existing directory.' },
    ]);
    expect(loadLocalProfileSource(createLocalProfileSource(root)).issues).toEqual([
      {
        path: `${join(root, 'broken', 'profile.yml')}#/profile.yml`,
        message: expect.any(String) as string,
      },
    ]);
    expect(readErrorMessage(new Error('clean parser message'))).toBe('clean parser message');
    expect(readErrorMessage('fallback parser message')).toBe('fallback parser message');
  });
});
