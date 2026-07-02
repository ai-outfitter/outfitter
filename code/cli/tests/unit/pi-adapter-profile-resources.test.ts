// Tests profile-bundled Pi resources passed through launch args.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';

const temporaryRoots: string[] = [];
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const builtInOutfitterSkill = join(repositoryRoot, 'skills', 'outfitter');

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('pi adapter profile resources', () => {
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
      builtInOutfitterSkill,
      '--skill',
      'user-skill',
      '--skill',
      skillFolder,
    ]);
  });

  it('generates Pi skills from skill-generation profiles and enables them for launch', () => {
    const root = createTemporaryRoot('outfitter-pi-generated-skills-');
    const compositeRoot = join(root, 'composite');
    const profilePath = join(root, 'profiles', 'founder', 'profile.yml');
    const profile = {
      id: 'founder',
      label: 'Founder',
      description: 'Founder operator review profile',
      inherits: [],
      controls: {
        provider: 'openai-codex',
        model: 'gpt-5.5',
        thinking: 'high',
        systemPrompt: 'prompts/system.md',
        promptTemplate: 'prompts/template.md',
        appendSystemPrompt: ['inline guidance', { file: 'prompts/founder.md' }, { repo_file: 'docs/mission.md' }],
      },
      skillGeneration: true,
    } as const;

    const adapter = createPiAdapter();
    const generatedSkillProfiles = [
      { profile, profilePath, sourceInputs: [profilePath] },
      {
        profile: { id: 'minimal', inherits: [], controls: {}, skillGeneration: true },
        profilePath: join(root, 'profiles', 'minimal', 'profile.yml'),
      },
    ];
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'default', inherits: [], controls: {} },
      { rootDirectory: compositeRoot, profilePaths: [], generatedSkillProfiles },
    );
    const launchPlan = adapter.createLaunchPlan(
      compositeProfilePlan.compositeProfile,
      { id: 'default', inherits: [], controls: {} },
      [],
      { generatedSkillProfiles },
    );

    const generatedSkillFile = compositeProfilePlan.compositeProfile.files.find(
      (file) => file.relativePath === 'skills/founder/SKILL.md',
    );

    expect(generatedSkillFile?.sourceInputs).toEqual([profilePath]);
    expect(generatedSkillFile?.content).toContain('Adopt the Founder profile');
    expect(generatedSkillFile?.content).toContain('- Provider: openai-codex');
    expect(generatedSkillFile?.content).toContain('- inline guidance');
    expect(generatedSkillFile?.content).toContain('- prompts/founder.md');
    expect(generatedSkillFile?.content).toContain('- docs/mission.md');
    expect(launchPlan.args).toEqual([
      '--skill',
      builtInOutfitterSkill,
      '--skill',
      join(compositeRoot, 'skills', 'founder'),
      '--skill',
      join(compositeRoot, 'skills', 'minimal'),
    ]);
  });
});

const createTemporaryRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};
