// Tests profile-bundled Pi resources and generated Pi subagent definitions.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { findGeneratedAgentProfiles } from '../../src/profiles/GeneratedAgentProfiles.js';
import type { LoadedProfile } from '../../src/profiles/ProfileLoader.js';
import type { Profile } from '../../src/profiles/Profile.js';

const temporaryRoots: string[] = [];
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const builtInOutfitterSkill = join(repositoryRoot, 'skills', 'outfitter');

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('pi adapter profile resources', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('generates Pi subagent definitions for profiles marked agent_generation', () => {
    const root = createTemporaryRoot('outfitter-pi-generated-agent-');
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'leader', inherits: [], controls: {} },
      {
        rootDirectory: join(root, 'composite'),
        profilePaths: ['/profiles/leader/profile.yml'],
        generatedAgentProfiles: [
          {
            profilePath: '/profiles/engineer/profile.yml',
            sourceInputs: ['/profiles/shared/profile.yml', '/profiles/engineer/profile.yml'],
            profile: {
              id: 'engineer',
              label: 'Engineer',
              description: 'Focused implementation work.',
              agentGeneration: true,
              inherits: [],
              controls: {
                pi: {
                  model: 'claude-sonnet-4-5',
                  appendSystemPrompt: ['.outfitter/prompts/profiles/engineer.md'],
                  promptTemplate: '.outfitter/prompts/templates/engineer.md',
                },
              },
            },
          },
        ],
      },
    );

    const generatedAgent = compositeProfilePlan.compositeProfile.files.find(
      (file) => file.relativePath === 'agents/engineer.md',
    );

    expect(generatedAgent?.sourceInputs).toEqual(['/profiles/shared/profile.yml', '/profiles/engineer/profile.yml']);
    expect(generatedAgent?.content).toContain('name: "engineer"');
    expect(generatedAgent?.content).toContain('description: "Focused implementation work."');
    expect(generatedAgent?.content).toContain('model: "claude-sonnet-4-5"');
    expect(generatedAgent?.content).toContain('- .outfitter/prompts/profiles/engineer.md');
    expect(generatedAgent?.content).toContain('- .outfitter/prompts/templates/engineer.md');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('discovers runnable generated agents with resolved profile inputs and excludes templates', () => {
    const loadedProfiles = [
      createLoadedProfile('/profiles/shared/profile.yml', {
        id: 'shared',
        template: true,
        agentGeneration: true,
        inherits: [],
        controls: { pi: { appendSystemPrompt: ['shared.md'] } },
      }),
      createLoadedProfile('/profiles/user-engineer.yml', {
        id: 'engineer',
        inherits: [],
        controls: { pi: { model: 'old-model' } },
      }),
      createLoadedProfile('/profiles/project-engineer.yml', {
        id: 'engineer',
        agentGeneration: true,
        inherits: ['shared'],
        controls: { pi: { model: 'new-model' } },
      }),
      createLoadedProfile('/profiles/reviewer.yml', {
        id: 'reviewer',
        agentGeneration: true,
        inherits: [],
        controls: {},
      }),
      createLoadedProfile('/profiles/project-reviewer.yml', {
        id: 'reviewer',
        agentGeneration: false,
        inherits: [],
        controls: {},
      }),
      createLoadedProfile('/profiles/broken.yml', {
        id: 'broken',
        inherits: ['missing'],
        controls: {},
      }),
    ];

    const generatedProfiles = findGeneratedAgentProfiles(loadedProfiles);

    expect(generatedProfiles).toHaveLength(1);
    expect(generatedProfiles[0]?.profile.id).toBe('engineer');
    expect(generatedProfiles[0]?.profile.template).toBeUndefined();
    expect(generatedProfiles[0]?.profile.controls.pi?.model).toBe('new-model');
    expect(generatedProfiles[0]?.profile.controls.pi?.appendSystemPrompt).toEqual(['shared.md']);
    expect(generatedProfiles[0]?.profilePath).toBe('/profiles/project-engineer.yml');
    expect(generatedProfiles[0]?.sourceInputs).toEqual([
      '/profiles/shared/profile.yml',
      '/profiles/user-engineer.yml',
      '/profiles/project-engineer.yml',
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns and skips invalid generated agent profiles unless strict mode is enabled and ignores cycles', () => {
    const warnings: string[] = [];
    const brokenProfiles = [
      createLoadedProfile('/profiles/broken.yml', {
        id: 'broken',
        agentGeneration: true,
        inherits: ['missing'],
        controls: {},
      }),
    ];

    expect(findGeneratedAgentProfiles(brokenProfiles, { warn: (warning) => warnings.push(warning) })).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining("Cannot resolve generated agent profile 'broken'")]);
    expect(() => findGeneratedAgentProfiles(brokenProfiles, { strict: true })).toThrow(
      "Cannot resolve generated agent profile 'broken'",
    );

    expect(
      findGeneratedAgentProfiles([
        createLoadedProfile('/profiles/a.yml', { id: 'a', inherits: ['b'], controls: {} }),
        createLoadedProfile('/profiles/b.yml', { id: 'b', inherits: ['a'], controls: {} }),
      ]),
    ).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('generates minimal Pi subagent definitions with fallback source inputs', () => {
    const root = createTemporaryRoot('outfitter-pi-minimal-generated-agent-');
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'leader', inherits: [], controls: {} },
      {
        rootDirectory: join(root, 'composite'),
        profilePaths: [],
        generatedAgentProfiles: [
          {
            profilePath: '/profiles/reviewer.yml',
            profile: {
              id: 'reviewer',
              agentGeneration: true,
              inherits: [],
              controls: { pi: { appendSystemPrompt: '.outfitter/prompts/reviewer.md' } },
            },
          },
          {
            profilePath: '/profiles/auditor.yml',
            profile: {
              id: 'auditor',
              agentGeneration: true,
              inherits: [],
              controls: {},
            },
          },
        ],
      },
    );

    const generatedAgent = compositeProfilePlan.compositeProfile.files.find(
      (file) => file.relativePath === 'agents/reviewer.md',
    );

    expect(generatedAgent?.sourceInputs).toEqual(['/profiles/reviewer.yml']);
    expect(generatedAgent?.content).toContain('You are the reviewer Outfitter profile');
    expect(generatedAgent?.content).toContain('- .outfitter/prompts/reviewer.md');
    expect(generatedAgent?.content).not.toContain('description:');
    expect(generatedAgent?.content).not.toContain('model:');

    const auditorAgent = compositeProfilePlan.compositeProfile.files.find(
      (file) => file.relativePath === 'agents/auditor.md',
    );
    expect(auditorAgent?.content).not.toContain('Before starting substantive work');
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
      builtInOutfitterSkill,
      '--skill',
      'user-skill',
      '--skill',
      skillFolder,
    ]);
  });
});

const createLoadedProfile = (profilePath: string, profile: Profile): LoadedProfile => ({
  source: { path: '/profiles' },
  folderPath: '/profiles',
  profilePath,
  profile,
});

const createTemporaryRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};
