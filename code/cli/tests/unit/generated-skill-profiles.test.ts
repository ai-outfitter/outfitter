// Tests resolving profile definitions exposed as generated Pi skills.
import { describe, expect, it } from 'vitest';

import { findGeneratedSkillProfiles } from '../../src/profiles/GeneratedSkillProfiles.js';
import type { LoadedProfile } from '../../src/profiles/ProfileLoader.js';
import type { Profile } from '../../src/profiles/Profile.js';

describe('generated skill profiles', () => {
  it('resolves marked profiles with inherited controls and contributing source inputs', () => {
    const profiles = [
      loadedProfile('base', { skillGeneration: true, controls: { thinking: 'high' } }),
      loadedProfile('reviewer', { inherits: ['base'], controls: { model: 'pi/reviewer' } }),
    ];

    const result = findGeneratedSkillProfiles(profiles);

    expect(result.warnings).toEqual([]);
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.map((profile) => profile.profile.id)).toEqual(['base', 'reviewer']);
    expect(result.profiles[1]?.profile.controls).toEqual({ thinking: 'high', model: 'pi/reviewer' });
    expect(result.profiles[1]?.sourceInputs).toEqual(['/profiles/base/profile.yml', '/profiles/reviewer/profile.yml']);
  });

  it('skips templates and warns about unresolved marked profiles', () => {
    const result = findGeneratedSkillProfiles([
      loadedProfile('template', { skillGeneration: true, template: true }),
      loadedProfile('broken', { skillGeneration: true, inherits: ['missing'] }),
      loadedProfile('cycle-a', { skillGeneration: true, inherits: ['cycle-b'] }),
      loadedProfile('cycle-b', { inherits: ['cycle-a'] }),
    ]);

    expect(result.profiles).toEqual([]);
    expect(result.warnings).toEqual([
      "Cannot resolve generated skill profile 'broken': /profiles/missing: Profile 'missing' was not found.",
      "Cannot resolve generated skill profile 'cycle-a': /profiles/cycle-a/inherits: Profile inheritance cycle detected: cycle-a -> cycle-b -> cycle-a",
      "Cannot resolve generated skill profile 'cycle-b': /profiles/cycle-b/inherits: Profile inheritance cycle detected: cycle-b -> cycle-a -> cycle-b",
    ]);
  });
});

const loadedProfile = (id: string, profile: Partial<Profile> = {}): LoadedProfile => ({
  source: { path: '/profiles' },
  folderPath: `/profiles/${id}`,
  profilePath: `/profiles/${id}/profile.yml`,
  sourceRootPath: '/profiles',
  resourceRootPath: `/profiles/${id}`,
  layout: 'directory',
  profile: {
    id,
    inherits: [],
    controls: {},
    ...profile,
  },
});
