// Tests profile precedence, inheritance resolution, default inclusion, and cycle diagnostics.
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { LoadedProfile } from '../../src/profiles/ProfileLoader.js';
import { loadLocalProfileSource } from '../../src/profiles/ProfileLoader.js';
import { resolveProfile } from '../../src/profiles/ProfileMerger.js';
import { createLocalProfileSource, createUriProfileSource } from '../../src/profiles/ProfileSource.js';

const scenarioPath = (name: string, childPath = ''): string =>
  fileURLToPath(new URL(`../fixtures/scenarios/${name}/${childPath}`, import.meta.url));

const createLoadedProfile = (loadedProfile: Omit<LoadedProfile, 'folderPath' | 'profilePath'>): LoadedProfile => ({
  ...loadedProfile,
  folderPath: '<fixture>',
  profilePath: '<fixture>/profile.yml',
});

describe('profile resolution', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3, OFTR-003.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges same-id profile definitions with project-local precedence over project and user definitions', () => {
    const userProfiles = loadLocalProfileSource(
      createLocalProfileSource(scenarioPath('profile-precedence', 'user-profiles')),
    );
    const projectProfiles = loadLocalProfileSource(
      createLocalProfileSource(scenarioPath('profile-precedence', 'project-profiles')),
    );
    const projectLocalProfiles = loadLocalProfileSource(
      createLocalProfileSource(scenarioPath('profile-precedence', 'project-local-profiles')),
    );

    expect([...userProfiles.issues, ...projectProfiles.issues, ...projectLocalProfiles.issues]).toEqual([]);

    const result = resolveProfile({
      profileId: 'engineering',
      profiles: [...userProfiles.profiles, ...projectProfiles.profiles, ...projectLocalProfiles.profiles],
    });

    expect(result.issues).toEqual([]);
    expect(result.profileStack).toHaveLength(1);
    expect(result.profile).toEqual({
      id: 'engineering',
      label: 'Project Engineering',
      inherits: [],
      controls: {
        model: 'local-model',
        environment: {
          SHARED: 'local',
          USER_ONLY: 'yes',
          PROJECT_ONLY: 'yes',
          LOCAL_ONLY: 'yes',
        },
      },
    });

    const firstUriSource = createUriProfileSource('git+https://example.test/first.git');
    const secondUriSource = createUriProfileSource('git+https://example.test/second.git');
    const userSource = createLocalProfileSource('<user-profiles>');
    const firstUriProfile = createLoadedProfile({
      source: firstUriSource,
      profile: { id: 'uri-backed', inherits: [], controls: { model: 'first-uri' } },
    });
    const secondUriProfile = createLoadedProfile({
      source: secondUriSource,
      profile: { id: 'uri-backed', inherits: [], controls: { model: 'second-uri' } },
    });
    const userProfile = createLoadedProfile({
      source: userSource,
      profile: { id: 'uri-backed', inherits: [], controls: { model: 'user' } },
    });

    expect(
      resolveProfile({ profileId: 'uri-backed', profiles: [firstUriProfile, secondUriProfile] }).profile?.controls
        .model,
    ).toBe('second-uri');
    expect(
      resolveProfile({ profileId: 'uri-backed', profiles: [firstUriProfile, secondUriProfile, userProfile] }).profile
        ?.controls.model,
    ).toBe('user');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses path-specific array merge policies and deduplicates profile launch resources by identity', () => {
    const result = resolveProfile({
      profileId: 'selected',
      defaultProfileId: 'default',
      profiles: [
        createLoadedProfile({
          source: createLocalProfileSource('<user-profiles>'),
          profile: {
            id: 'default',
            inherits: [],
            controls: {
              args: ['--default'],
              appendSystemPrompt: 'default prompt',
              append_system_prompt: 'default prompt',
              extensions: ['npm:pi-subagents@1', 'git:github.com/ai-outfitter/deepwork#main'],
              skills: ['./skills/review'],
              pi: { appendSystemPrompt: 'default pi prompt' },
              custom_list: ['default'],
            },
          },
        }),
        createLoadedProfile({
          source: createLocalProfileSource('<project-profiles>'),
          profile: {
            id: 'base',
            inherits: [],
            controls: {
              args: ['--base'],
              appendSystemPrompt: 'base prompt',
              append_system_prompt: 'base prompt',
              extensions: ['npm:base-only', 'npm:pi-subagents@2'],
              skills: ['./skills/base'],
              pi: { appendSystemPrompt: 'base pi prompt' },
            },
          },
        }),
        createLoadedProfile({
          source: createLocalProfileSource('<project-profiles>'),
          profile: {
            id: 'selected',
            inherits: ['base'],
            controls: {
              args: ['--selected'],
              appendSystemPrompt: 'selected prompt',
              append_system_prompt: 'selected prompt',
              extensions: ['npm:pi-subagents@3'],
              skills: ['./skills/review'],
              pi: { appendSystemPrompt: 'selected pi prompt' },
              custom_list: ['selected'],
            },
          },
        }),
      ],
    });

    expect(result.issues).toEqual([]);
    expect(result.profile?.controls.args).toEqual(['--selected', '--base', '--default']);
    expect(result.profile?.controls.appendSystemPrompt).toEqual(['selected prompt', 'base prompt', 'default prompt']);
    expect(result.profile?.controls.append_system_prompt).toEqual(['selected prompt', 'base prompt', 'default prompt']);
    expect(result.profile?.controls.pi?.appendSystemPrompt).toEqual([
      'selected pi prompt',
      'base pi prompt',
      'default pi prompt',
    ]);
    expect(result.profile?.controls.extensions).toEqual([
      'npm:pi-subagents@3',
      'npm:base-only',
      'git:github.com/ai-outfitter/deepwork#main',
    ]);
    expect(result.profile?.controls.skills).toEqual(['./skills/review', './skills/base']);
    expect(result.profile?.controls.custom_list).toEqual(['selected']);
  });

  it('keeps template profiles inheritable without marking runnable descendants as templates', () => {
    const inheritedTemplate = createLoadedProfile({
      source: createLocalProfileSource('<project-profiles>'),
      profile: {
        id: 'shared-prose',
        template: true,
        inherits: [],
        controls: { appendSystemPrompt: 'shared prompt' },
      },
    });
    const selectedRunnable = createLoadedProfile({
      source: createLocalProfileSource('<project-profiles>'),
      profile: {
        id: 'project-lead',
        inherits: ['shared-prose'],
        controls: { appendSystemPrompt: 'role prompt' },
      },
    });

    const runnableResult = resolveProfile({
      profileId: 'project-lead',
      profiles: [inheritedTemplate, selectedRunnable],
    });
    const templateResult = resolveProfile({ profileId: 'shared-prose', profiles: [inheritedTemplate] });

    expect(runnableResult.issues).toEqual([]);
    expect(runnableResult.profile?.template).toBeUndefined();
    expect(runnableResult.profile?.controls.appendSystemPrompt).toEqual(['role prompt', 'shared prompt']);
    expect(templateResult.issues).toEqual([]);
    expect(templateResult.profile?.template).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.4, OFTR-003.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves inherited profiles below explicit profiles and includes the implicit user default without duplicates', () => {
    const loaded = loadLocalProfileSource(
      createLocalProfileSource(scenarioPath('profile-inheritance-chain', 'profiles')),
    );
    const multipleInheritanceProfiles = loadLocalProfileSource(
      createLocalProfileSource(scenarioPath('profile-multiple-inheritance', 'profiles')),
    );

    expect([...loaded.issues, ...multipleInheritanceProfiles.issues]).toEqual([]);

    const result = resolveProfile({
      profileId: 'engineering',
      defaultProfileId: 'default',
      profiles: loaded.profiles,
    });
    const multipleInheritanceResult = resolveProfile({
      profileId: 'composite',
      profiles: multipleInheritanceProfiles.profiles,
    });

    expect(result.issues).toEqual([]);
    expect(result.profileStack.map((profile) => profile.id)).toEqual(['base', 'default', 'engineering']);
    expect(result.profile?.controls).toEqual({
      model: 'engineering-model',
      environment: {
        BASE: 'enabled',
        DEFAULT: 'enabled',
        ENGINEERING: 'enabled',
        SHARED: 'engineering',
      },
    });
    expect(multipleInheritanceResult.issues).toEqual([]);
    expect(multipleInheritanceResult.profileStack.map((profile) => profile.id)).toEqual([
      'first',
      'second',
      'composite',
    ]);
    expect(multipleInheritanceResult.profile?.controls.environment?.SHARED).toBe('composite');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports missing inherited profiles and inheritance cycles as resolution issues', () => {
    const cycleProfiles = loadLocalProfileSource(createLocalProfileSource(scenarioPath('profile-cycle', 'profiles')));
    const missingInheritanceProfiles = loadLocalProfileSource(
      createLocalProfileSource(scenarioPath('profile-missing-inheritance', 'profiles')),
    );
    const cycleResult = resolveProfile({ profileId: 'a', profiles: cycleProfiles.profiles });
    const missingResult = resolveProfile({ profileId: 'missing', profiles: cycleProfiles.profiles });
    const missingInheritanceResult = resolveProfile({
      profileId: 'engineering',
      profiles: missingInheritanceProfiles.profiles,
    });

    expect([...cycleProfiles.issues, ...missingInheritanceProfiles.issues]).toEqual([]);
    expect(cycleResult.profile).toBeUndefined();
    expect(cycleResult.issues).toEqual([
      {
        path: '/profiles/a/inherits',
        message: 'Profile inheritance cycle detected: a -> b -> a',
      },
    ]);
    expect(missingResult).toEqual({
      profile: undefined,
      profileStack: [],
      issues: [{ path: '/profiles/missing', message: "Profile 'missing' was not found." }],
    });
    expect(missingInheritanceResult.profile).toBeUndefined();
    expect(missingInheritanceResult.issues).toEqual([
      { path: '/profiles/missing-base', message: "Profile 'missing-base' was not found." },
    ]);
  });
});
