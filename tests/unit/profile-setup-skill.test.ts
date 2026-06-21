// Tests profile setup skill discovery.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ResolvedLaunchProfile } from '../../src/cli/commands/ProfileLaunch.js';
import { findProfileSetupSkill } from '../../src/cli/commands/ProfileSetupSkill.js';
import type { LoadedProfile } from '../../src/profiles/ProfileLoader.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-profile-setup-skill-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('profile setup skill discovery', () => {
  it('returns undefined when a profile has no complete outfitter-profile-setup skill', () => {
    const root = createTemporaryRoot();
    const missingSetupProfileFolder = join(root, 'profiles', 'missing-setup');
    const incompleteSetupProfileFolder = join(root, 'profiles', 'project-lead');
    mkdirSync(join(incompleteSetupProfileFolder, 'setup', 'skills', 'outfitter-profile-setup'), { recursive: true });

    expect(
      findProfileSetupSkill(resolvedProfile([loadedProfile(missingSetupProfileFolder, 'missing-setup')])),
    ).toBeUndefined();
    expect(
      findProfileSetupSkill(resolvedProfile([loadedProfile(incompleteSetupProfileFolder, 'project-lead')])),
    ).toBeUndefined();
  });

  it('surfaces filesystem errors while inspecting profile setup skill folders', () => {
    const root = createTemporaryRoot();
    const profileFolder = join(root, 'profiles', 'project-lead');
    const setupSkillFolder = join(profileFolder, 'setup', 'skills', 'outfitter-profile-setup');
    mkdirSync(join(profileFolder, 'setup', 'skills'), { recursive: true });
    symlinkSync(setupSkillFolder, setupSkillFolder);

    expect(() => findProfileSetupSkill(resolvedProfile([loadedProfile(profileFolder, 'project-lead')]))).toThrow();
  });

  it('finds one complete outfitter-profile-setup skill', () => {
    const root = createTemporaryRoot();
    const profileFolder = join(root, 'profiles', 'project-lead');
    const setupSkillFolder = join(profileFolder, 'setup', 'skills', 'outfitter-profile-setup');
    mkdirSync(setupSkillFolder, { recursive: true });
    writeFileSync(join(setupSkillFolder, 'SKILL.md'), '---\nname: outfitter-profile-setup\n---\n');

    expect(findProfileSetupSkill(resolvedProfile([loadedProfile(profileFolder, 'project-lead')]))).toEqual({
      id: 'outfitter-profile-setup',
      path: setupSkillFolder,
      profileId: 'project-lead',
      profileFolder,
    });
  });
});

const loadedProfile = (folderPath: string, profileId: string): LoadedProfile => ({
  source: { path: join(folderPath, '..') },
  folderPath,
  profilePath: join(folderPath, 'profile.yml'),
  profile: { id: profileId, inherits: [], controls: {} },
});

const resolvedProfile = (profileLayers: readonly LoadedProfile[]): ResolvedLaunchProfile => ({
  profile: { id: 'project-lead', inherits: [], controls: {} },
  profilePaths: profileLayers.map((profile) => profile.profilePath),
  profileFolders: profileLayers.map((profile) => profile.folderPath),
  homeDirectory: '/tmp/home',
  cacheDirectory: '/tmp/home/.outfitter/cache',
  projectDirectory: '/tmp/project',
  settings: { profileSources: [] },
  settingsPaths: [],
  profileLayers,
});
