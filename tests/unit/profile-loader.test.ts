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
} from '../../src/profiles/ProfileLoader.js';
import { createLocalProfileSource, createUriProfileSource } from '../../src/profiles/ProfileSource.js';

const temporaryRoots: string[] = [];

const createProfileSourceRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-profile-source-'));
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
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.5).
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-003.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses profile.yml files from profile folders with fallback folder identity', () => {
    const root = createProfileSourceRoot();
    writeProfile(root, 'base', 'label: Base Profile\ninherits:\n  - shared\ncontrols:\n  environment:\n    MODE: test\n');
    writeFileSync(join(root, 'README.md'), 'not a profile folder');

    const result = loadLocalProfileSource(createLocalProfileSource(root));

    expect(result.issues).toEqual([]);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]?.folderPath).toBe(join(root, 'base'));
    expect(result.profiles[0]?.profilePath).toBe(join(root, 'base', 'profile.yml'));
    expect(result.profiles[0]?.profile).toEqual({
      id: 'base',
      label: 'Base Profile',
      inherits: ['shared'],
      controls: { environment: { MODE: 'test' } },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-003.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects profile IDs that are not safe for CLI references', () => {
    expect(isValidProfileId('engineering.default')).toBe(true);
    expect(isValidProfileId('Engineering Default')).toBe(false);
    expect(parseProfileDocument(['not', 'a', 'mapping'], 'fallback')).toEqual({
      path: '/',
      message: 'Profile document must be a mapping.',
    });
    const invalidIdResult = parseProfileYaml('id: Engineering Default\n', 'fallback');
    const invalidEnvironmentResult = parseProfileYaml('controls:\n  environment:\n    COUNT: 1\n', 'fallback');

    expect('message' in invalidIdResult && invalidIdResult.path).toBe('/id');
    expect('message' in invalidIdResult && invalidIdResult.message).toContain('must match pattern');
    expect(invalidEnvironmentResult).toEqual({
      path: '/controls/environment/COUNT',
      message: 'must be string',
    });
  });

  it('reports non-local, missing, and malformed profile sources as load issues', () => {
    const missingRoot = join(tmpdir(), 'bridl-missing-profile-source');
    const root = createProfileSourceRoot();
    writeProfile(root, 'broken', ': invalid: yaml:');

    expect(loadLocalProfileSource(createUriProfileSource('git+https://example.test/profiles.git')).issues).toEqual([
      { path: '<uri-source>', message: 'Only local profile sources can be loaded directly.' },
    ]);
    expect(loadLocalProfileSource(createLocalProfileSource(missingRoot)).issues).toEqual([
      { path: missingRoot, message: 'Profile source must be an existing directory.' },
    ]);
    expect(loadLocalProfileSource(createLocalProfileSource(root)).issues).toHaveLength(1);
  });
});
