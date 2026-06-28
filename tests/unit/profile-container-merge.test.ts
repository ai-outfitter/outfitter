// Tests profile container control merge behavior.
import { describe, expect, it } from 'vitest';

import { resolveProfile } from '../../src/profiles/ProfileMerger.js';
import { createLocalProfileSource } from '../../src/profiles/ProfileSource.js';
import type { LoadedProfile } from '../../src/profiles/ProfileLoader.js';

const loadedProfile = (profile: LoadedProfile['profile']): LoadedProfile => ({
  source: createLocalProfileSource('<profiles>'),
  folderPath: '<profiles>/profile',
  profilePath: '<profiles>/profile/profile.yml',
  profile,
});

describe('profile container control merging', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('deep-merges container controls and replaces env/run argument arrays', () => {
    const result = resolveProfile({
      profileId: 'selected',
      profiles: [
        loadedProfile({
          id: 'base',
          inherits: [],
          controls: {
            container: { image: 'example/base:1', envPassthrough: ['BASE_ENV'], runArgs: ['--base-run'] },
            pi: { container: { runArgs: ['--base-pi-run'] } },
          },
        }),
        loadedProfile({
          id: 'selected',
          inherits: ['base'],
          controls: {
            container: { backend: 'docker', envPassthrough: ['SELECTED_ENV'], runArgs: ['--selected-run'] },
            pi: { container: { runArgs: ['--selected-pi-run'] } },
          },
        }),
      ],
    });

    expect(result.issues).toEqual([]);
    expect(result.profile?.controls.container).toEqual({
      image: 'example/base:1',
      backend: 'docker',
      envPassthrough: ['SELECTED_ENV'],
      runArgs: ['--selected-run'],
    });
    expect(result.profile?.controls.pi?.container).toEqual({ runArgs: ['--selected-pi-run'] });
  });
});
