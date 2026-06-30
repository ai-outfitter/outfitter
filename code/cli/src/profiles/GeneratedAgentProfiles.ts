// Resolves profile definitions that should be exposed as generated native subagents.
import { findContributingProfilePaths } from './ProfileContributors.js';
import { resolveProfile } from './ProfileMerger.js';
import type { LoadedProfile } from './ProfileLoader.js';

export interface GeneratedAgentProfileResolutionOptions {
  readonly strict?: boolean;
  readonly warn?: (message: string) => void;
}

export const findGeneratedAgentProfiles = (
  loadedProfiles: readonly LoadedProfile[],
  options: GeneratedAgentProfileResolutionOptions = {},
): readonly LoadedProfile[] => {
  const generatedProfiles: LoadedProfile[] = [];
  const profileIds = [...new Set(loadedProfiles.map((loadedProfile) => loadedProfile.profile.id))].filter((profileId) =>
    mayResolveAgentGeneration(profileId, loadedProfiles),
  );

  for (const profileId of profileIds) {
    const resolution = resolveProfile({ profiles: loadedProfiles, profileId });

    if (resolution.profile === undefined || resolution.issues.length > 0) {
      const warning = `Cannot resolve generated agent profile '${profileId}': ${resolution.issues.map(formatIssue).join('; ')}`;

      if (options.strict === true) {
        throw new Error(warning);
      }

      options.warn?.(warning);
      continue;
    }

    if (resolution.profile.agentGeneration !== true || resolution.profile.template === true) {
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

  return generatedProfiles;
};

const mayResolveAgentGeneration = (
  profileId: string,
  loadedProfiles: readonly LoadedProfile[],
  visitedProfileIds: ReadonlySet<string> = new Set(),
): boolean => {
  if (visitedProfileIds.has(profileId)) {
    return false;
  }

  const profileLayers = loadedProfiles.filter((loadedProfile) => loadedProfile.profile.id === profileId);

  if (profileLayers.some((loadedProfile) => loadedProfile.profile.agentGeneration === true)) {
    return true;
  }

  const nextVisitedProfileIds = new Set([...visitedProfileIds, profileId]);
  return profileLayers.some((loadedProfile) =>
    loadedProfile.profile.inherits.some((inheritedProfileId) =>
      mayResolveAgentGeneration(inheritedProfileId, loadedProfiles, nextVisitedProfileIds),
    ),
  );
};

const formatIssue = (issue: { readonly path: string; readonly message: string }): string =>
  `${issue.path}: ${issue.message}`;
