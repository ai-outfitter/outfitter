// Tests setup-only pi launch context behavior.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-pi-setup-skill-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('pi adapter setup skill launch context', () => {
  it('injects setup-only Pi skills and prompt only from launch context', () => {
    const root = createTemporaryRoot();
    const profileFolder = join(root, 'profiles', 'project-lead');
    const setupSkillFolder = join(profileFolder, 'setup', 'skills', 'outfitter-profile-setup');
    mkdirSync(setupSkillFolder, { recursive: true });
    writeFileSync(join(setupSkillFolder, 'SKILL.md'), '---\nname: outfitter-profile-setup\n---\n');

    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'project-lead', inherits: [], controls: {} },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder] },
    );
    const profile = {
      id: 'project-lead',
      inherits: [],
      controls: { pi: { appendSystemPrompt: ['profile prompt'], skills: ['profile-skill'] } },
    };

    const normalLaunchPlan = adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, profile, [], {
      profileFolders: [profileFolder],
    });
    const setupLaunchPlan = adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, profile, [], {
      profileFolders: [profileFolder],
      extraSkills: [setupSkillFolder],
      appendSystemPrompt: 'setup prompt',
    });

    expect(normalLaunchPlan.args).toEqual(['--append-system-prompt', 'profile prompt', '--skill', 'profile-skill']);
    expect(setupLaunchPlan.args).toEqual([
      '--append-system-prompt',
      'profile prompt',
      '--append-system-prompt',
      'setup prompt',
      '--skill',
      'profile-skill',
      '--skill',
      setupSkillFolder,
    ]);
  });
});
