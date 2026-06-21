// Discovers the profile-scoped setup skill that is only exposed during setup.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ResolvedLaunchProfile } from './ProfileLaunch.js';

export const profileSetupSkillId = 'outfitter-profile-setup';

export interface ProfileSetupSkill {
  readonly id: typeof profileSetupSkillId;
  readonly path: string;
  readonly profileId: string;
  readonly profileFolder: string;
}

export const findProfileSetupSkill = (resolvedProfile: ResolvedLaunchProfile): ProfileSetupSkill | undefined => {
  const setupSkills = resolvedProfile.profileLayers.flatMap(profileSetupSkillForLayer);

  if (setupSkills.length > 1) {
    throw new Error(
      `Multiple contributing profile folders expose '${profileSetupSkillId}': ${setupSkills
        .map((setupSkill) => `${setupSkill.profileId} at ${setupSkill.path}`)
        .join('; ')}`,
    );
  }

  return setupSkills[0];
};

const profileSetupSkillForLayer = (
  layer: ResolvedLaunchProfile['profileLayers'][number],
): readonly ProfileSetupSkill[] => {
  const skillPath = join(layer.folderPath, 'setup', 'skills', profileSetupSkillId);

  if (!isDirectory(skillPath) || !isFile(join(skillPath, 'SKILL.md'))) {
    return [];
  }

  return [
    {
      id: profileSetupSkillId,
      path: skillPath,
      profileId: layer.profile.id,
      profileFolder: layer.folderPath,
    },
  ];
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    /* v8 ignore next -- non-ENOENT stat failures should surface as actionable filesystem errors. */
    throw error;
  }
};

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();

/* v8 ignore next -- defensive guard for filesystem errors from statSync. */
const isMissingPathError = (error: unknown): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
