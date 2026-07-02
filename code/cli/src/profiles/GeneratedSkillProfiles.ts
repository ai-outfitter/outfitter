// Resolves profile definitions that should be exposed as generated native Pi skills.
import { findContributingProfilePaths } from './ProfileContributors.js';
import type { LoadedProfile } from './ProfileLoader.js';
import { resolveProfile } from './ProfileMerger.js';

export interface GeneratedSkillProfileResolutionResult {
  readonly profiles: readonly LoadedProfile[];
  readonly warnings: readonly string[];
}

export const findGeneratedSkillProfiles = (
  loadedProfiles: readonly LoadedProfile[],
): GeneratedSkillProfileResolutionResult => {
  const generatedProfiles: LoadedProfile[] = [];
  const warnings: string[] = [];
  const profileIds = [...new Set(loadedProfiles.map((loadedProfile) => loadedProfile.profile.id))].filter((profileId) =>
    mayResolveSkillGeneration(profileId, loadedProfiles),
  );

  for (const profileId of profileIds) {
    const resolution = resolveProfile({ profiles: loadedProfiles, profileId });

    if (resolution.profile === undefined || resolution.issues.length > 0) {
      warnings.push(
        `Cannot resolve generated skill profile '${profileId}': ${resolution.issues.map(formatIssue).join('; ')}`,
      );
      continue;
    }

    if (resolution.profile.skillGeneration !== true || resolution.profile.template === true) {
      continue;
    }

    const sourceProfile = loadedProfiles.findLast((loadedProfile) => loadedProfile.profile.id === profileId);

    /* v8 ignore next -- profile IDs are derived from loadedProfiles, so this guard is defensive. */
    if (sourceProfile !== undefined) {
      generatedProfiles.push({
        ...sourceProfile,
        profile: resolution.profile,
        sourceInputs: findContributingProfilePaths(resolution.profileStack, loadedProfiles),
      });
    }
  }

  return { profiles: generatedProfiles, warnings };
};

const mayResolveSkillGeneration = (
  profileId: string,
  loadedProfiles: readonly LoadedProfile[],
  visitedProfileIds: ReadonlySet<string> = new Set(),
): boolean => {
  if (visitedProfileIds.has(profileId)) {
    return false;
  }

  const profileLayers = loadedProfiles.filter((loadedProfile) => loadedProfile.profile.id === profileId);

  if (profileLayers.some((loadedProfile) => loadedProfile.profile.skillGeneration === true)) {
    return true;
  }

  const nextVisitedProfileIds = new Set([...visitedProfileIds, profileId]);
  return profileLayers.some((loadedProfile) =>
    loadedProfile.profile.inherits.some((inheritedProfileId) =>
      mayResolveSkillGeneration(inheritedProfileId, loadedProfiles, nextVisitedProfileIds),
    ),
  );
};

const formatIssue = (issue: { readonly path: string; readonly message: string }): string =>
  `${issue.path}: ${issue.message}`;
