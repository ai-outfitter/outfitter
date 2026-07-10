// Tests profile-bundled Pi resources passed through launch args.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';

const temporaryRoots: string[] = [];
const builtInOutfitterSkill = (compositeProfileRoot: string): string =>
  join(compositeProfileRoot, 'outfitter', 'plugin', 'skills', 'outfitter');

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('pi adapter profile resources', () => {
  it('resolves profile-declared Pi skills from a shared profile source skills folder', () => {
    const root = createTemporaryRoot('outfitter-pi-shared-skills-');
    const profilesRoot = join(root, 'profiles');
    const profileFolder = join(profilesRoot, 'founder');
    const skillFolder = join(root, 'skills', 'pyramid-principle');
    mkdirSync(profileFolder, { recursive: true });
    mkdirSync(skillFolder, { recursive: true });
    writeFileSync(join(skillFolder, 'SKILL.md'), '---\nname: pyramid-principle\ndescription: Structure prose\n---\n');

    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'founder', inherits: [], controls: {} },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder] },
    );
    const launchPlan = adapter.createLaunchPlan(
      compositeProfilePlan.compositeProfile,
      { id: 'founder', inherits: [], controls: { pi: { skills: ['skills/pyramid-principle'] } } },
      [],
      {
        profileFolders: [profileFolder],
        profileLayers: [
          {
            profile: { id: 'founder', inherits: [], controls: { pi: { skills: ['skills/pyramid-principle'] } } },
            profilePath: join(profileFolder, 'profile.yml'),
            sourceRootPath: profilesRoot,
            resourceRootPath: profileFolder,
            layout: 'directory',
          },
        ],
      },
    );

    expect(launchPlan.args).toEqual([
      '--skill',
      builtInOutfitterSkill(join(root, 'composite')),
      '--skill',
      skillFolder,
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('adds profile-bundled Pi skills to the launch args', () => {
    const root = createTemporaryRoot('outfitter-pi-profile-skills-');
    const profileFolder = join(root, 'profiles', 'data_analyst');
    const skillFolder = join(profileFolder, 'skills', 'demos');
    const incompleteSkillFolder = join(profileFolder, 'skills', 'draft');
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

    expect(launchPlan.args).toEqual([
      '--skill',
      builtInOutfitterSkill(join(root, 'composite')),
      '--skill',
      'user-skill',
      '--skill',
      skillFolder,
    ]);
  });
});

const createTemporaryRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};
