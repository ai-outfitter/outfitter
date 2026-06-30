// Finds loaded profile source files that contribute to a resolved profile stack.
import type { Profile } from './Profile.js';
import type { LoadedProfile } from './ProfileLoader.js';

export const findContributingLoadedProfiles = (
  profileStack: readonly Pick<Profile, 'id'>[],
  loadedProfiles: readonly LoadedProfile[],
): readonly LoadedProfile[] =>
  profileStack.flatMap((profile) => loadedProfiles.filter((loadedProfile) => loadedProfile.profile.id === profile.id));

export const findContributingProfilePaths = (
  profileStack: readonly Pick<Profile, 'id'>[],
  loadedProfiles: readonly LoadedProfile[],
): readonly string[] =>
  findContributingLoadedProfiles(profileStack, loadedProfiles).map((loadedProfile) => loadedProfile.profilePath);
