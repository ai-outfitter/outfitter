// Provides profile merge scaffolding for future inheritance resolution.
import { defu } from 'defu';

import type { Profile } from './Profile.js';

export type NonEmptyProfileStack = readonly [Profile, ...Profile[]];

export const mergeProfileStack = (profileStack: NonEmptyProfileStack): Profile => {
  const [baseProfile, ...higherPrecedenceProfiles] = profileStack;

  return higherPrecedenceProfiles.reduce<Profile>(
    (mergedProfile, profile) => defu({}, profile, mergedProfile),
    baseProfile,
  );
};
