// Tests the bundled built-in fallback profiles used by degraded offline onboarding.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  builtinStarterProfileId,
  createBuiltinProfilesCachePath,
  materializeBuiltinProfiles,
} from '../../src/profiles/BuiltinProfiles.js';
import { loadLocalProfileSource } from '../../src/profiles/ProfileLoader.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-builtin-profiles-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('built-in profiles', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('materializes a valid starter profile without overwriting existing files', () => {
    const targetDirectory = join(createTemporaryRoot(), 'builtin-profiles');

    expect(materializeBuiltinProfiles(targetDirectory)).toBe(1);

    const loaded = loadLocalProfileSource({ path: targetDirectory });

    expect(loaded.issues).toEqual([]);
    expect(loaded.profiles.map((profile) => profile.profile.id)).toEqual([builtinStarterProfileId]);
    expect(loaded.profiles[0]?.profile.template).not.toBe(true);
    expect(loaded.profiles[0]?.profile.controls).toEqual({});

    const starterProfilePath = join(targetDirectory, builtinStarterProfileId, 'profile.yml');
    writeFileSync(starterProfilePath, 'id: starter\nlabel: Customized\ncontrols: {}\n');

    expect(materializeBuiltinProfiles(targetDirectory)).toBe(0);
    expect(readFileSync(starterProfilePath, 'utf8')).toContain('label: Customized');
  });

  it('derives the built-in profiles cache path from the home directory', () => {
    expect(createBuiltinProfilesCachePath('/home/user')).toBe(
      join('/home/user', '.outfitter', 'cache', 'builtin-profiles'),
    );
  });
});
