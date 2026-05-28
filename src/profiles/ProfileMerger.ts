// Provides profile merge scaffolding for future inheritance resolution.
import { defu } from 'defu';

import type { Profile } from './Profile.js';

export const mergeProfileStack = (profileStack: readonly Profile[]): Profile =>
  profileStack.reduce<Profile>((mergedProfile, profile) => defu({}, profile, mergedProfile));
