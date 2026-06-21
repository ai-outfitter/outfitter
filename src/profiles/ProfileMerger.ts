// Provides deterministic profile precedence, inheritance resolution, and merging.
import type { ArrayMergePolicy } from '../merge/ArrayMergePolicy.js';
import type { MergePath } from '../merge/SettingsValueMerger.js';
import { mergeObjectsWithPolicy } from '../merge/SettingsValueMerger.js';
import { normalizeExtensionResourceIdentity, normalizeLaunchResourceIdentity } from '../agents/ResourceIdentity.js';
import type { Profile } from './Profile.js';
import type { LoadedProfile } from './ProfileLoader.js';

export type NonEmptyProfileStack = readonly [Profile, ...Profile[]];

export interface ProfileResolutionInput {
  /** Profiles ordered from lowest precedence to highest precedence. */
  readonly profiles: readonly LoadedProfile[];
  readonly profileId: string;
  readonly defaultProfileId?: string;
}

export interface ProfileResolutionIssue {
  readonly path: string;
  readonly message: string;
}

export interface ProfileResolutionResult {
  readonly profile?: Profile;
  readonly profileStack: readonly Profile[];
  readonly issues: readonly ProfileResolutionIssue[];
}

export const mergeProfileStack = (profileStack: NonEmptyProfileStack): Profile => {
  const [baseProfile, ...higherPrecedenceProfiles] = profileStack;
  const mergedProfile = higherPrecedenceProfiles.reduce<Profile>(
    (mergedProfile, profile) =>
      mergeObjectsWithPolicy(mergedProfile, profile, { arrayPolicyForPath: profileArrayPolicy }),
    baseProfile,
  );

  return withProfileTemplateFromTopProfile(mergedProfile, profileStack[profileStack.length - 1]);
};

const withProfileTemplateFromTopProfile = (profile: Profile, topProfile: Profile): Profile => {
  if (topProfile.template === true) {
    return { ...profile, template: true };
  }

  return Object.fromEntries(Object.entries(profile).filter(([key]) => key !== 'template')) as Profile;
};

const profileArrayPolicy = (path: MergePath): ArrayMergePolicy | undefined => {
  const pathKey = path.join('.');

  if (pathKey === 'inherits') {
    return 'replace';
  }

  if (['controls.args', 'controls.pi.args', 'controls.claude.args'].includes(pathKey)) {
    return 'prepend';
  }

  if (isAppendSystemPromptPath(pathKey)) {
    return 'prependList';
  }

  if (['controls.extensions', 'controls.pi.extensions', 'controls.claude.extensions'].includes(pathKey)) {
    return {
      mode: 'uniqueBy',
      order: 'prepend',
      winner: 'first',
      key: (source: unknown) => normalizeExtensionResourceIdentity(String(source)),
    };
  }

  if (['controls.skills', 'controls.pi.skills', 'controls.claude.skills'].includes(pathKey)) {
    return {
      mode: 'uniqueBy',
      order: 'prepend',
      winner: 'first',
      key: (source: unknown) => normalizeLaunchResourceIdentity(String(source)),
    };
  }

  return undefined;
};

const isAppendSystemPromptPath = (pathKey: string): boolean =>
  [
    'controls.appendSystemPrompt',
    'controls.append_system_prompt',
    'controls.pi.appendSystemPrompt',
    'controls.pi.append_system_prompt',
    'controls.claude.appendSystemPrompt',
    'controls.claude.append_system_prompt',
  ].includes(pathKey);

export const resolveProfile = (input: ProfileResolutionInput): ProfileResolutionResult => {
  const definitions = createProfileDefinitions(input.profiles);
  const issues: ProfileResolutionIssue[] = [];
  const explicitStack = resolveProfileStack(input.profileId, definitions, [], issues);
  const defaultStack =
    input.defaultProfileId === undefined || input.defaultProfileId === input.profileId
      ? []
      : resolveProfileStack(input.defaultProfileId, definitions, [], issues);
  const profileStack = uniqueProfileStack([
    ...defaultStack.filter((profile) => profile.id !== input.profileId),
    ...explicitStack,
  ]);

  return {
    profile:
      issues.length === 0 && profileStack.length > 0
        ? mergeProfileStack(profileStack as NonEmptyProfileStack)
        : undefined,
    profileStack,
    issues,
  };
};

const createProfileDefinitions = (profiles: readonly LoadedProfile[]): ReadonlyMap<string, Profile> => {
  const groupedProfiles = new Map<string, NonEmptyProfileStack>();

  for (const loadedProfile of profiles) {
    const profileStack = groupedProfiles.get(loadedProfile.profile.id);
    groupedProfiles.set(
      loadedProfile.profile.id,
      profileStack === undefined ? [loadedProfile.profile] : [...profileStack, loadedProfile.profile],
    );
  }

  return new Map(
    [...groupedProfiles.entries()].map(([profileId, profileStack]) => [
      profileId,
      mergeSameIdProfileDefinitions(profileStack),
    ]),
  );
};

const mergeSameIdProfileDefinitions = (profileStack: NonEmptyProfileStack): Profile => {
  const highestPrecedenceProfile = profileStack[profileStack.length - 1];

  return {
    ...mergeProfileStack(profileStack),
    inherits: highestPrecedenceProfile.inherits,
  };
};

const resolveProfileStack = (
  profileId: string,
  definitions: ReadonlyMap<string, Profile>,
  ancestry: readonly string[],
  issues: ProfileResolutionIssue[],
): readonly Profile[] => {
  if (ancestry.includes(profileId)) {
    issues.push({
      path: `/profiles/${profileId}/inherits`,
      message: `Profile inheritance cycle detected: ${[...ancestry, profileId].join(' -> ')}`,
    });
    return [];
  }

  const profile = definitions.get(profileId);

  if (profile === undefined) {
    issues.push({ path: `/profiles/${profileId}`, message: `Profile '${profileId}' was not found.` });
    return [];
  }

  const inheritedProfiles = profile.inherits.flatMap((inheritedProfileId) =>
    resolveProfileStack(inheritedProfileId, definitions, [...ancestry, profileId], issues),
  );

  return uniqueProfileStack([...inheritedProfiles, profile]);
};

const uniqueProfileStack = (profileStack: readonly Profile[]): readonly Profile[] => {
  const profilesById = new Set<string>();
  const uniqueProfiles: Profile[] = [];

  for (const profile of profileStack) {
    if (!profilesById.has(profile.id)) {
      profilesById.add(profile.id);
      uniqueProfiles.push(profile);
    }
  }

  return uniqueProfiles;
};
