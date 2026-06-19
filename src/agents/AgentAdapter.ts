// Defines the adapter contract for translating Outfitter profiles to agent CLI launches.
import type { Profile } from '../profiles/Profile.js';
import type { Settings } from '../settings/Settings.js';
import type { StatePathDeclaration } from '../compositeProfile/StatePersistence.js';
import type { CompositeProfile } from '../compositeProfile/CompositeProfile.js';

export interface AgentLaunchPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface AgentLaunchContext {
  readonly profileFolders?: readonly string[];
}

export interface AgentCompositeProfilePlan {
  readonly compositeProfile: CompositeProfile;
  readonly warnings: readonly string[];
}

export interface AgentAdapter {
  readonly id: string;
  readonly supportedControls: readonly string[];
  readonly statePaths?: Readonly<Record<string, StatePathDeclaration>>;
  createCompositeProfile(
    profile: Profile,
    input: {
      readonly rootDirectory: string;
      readonly profilePaths: readonly string[];
      readonly profileFolders?: readonly string[];
      readonly homeDirectory?: string;
      readonly cacheDirectory?: string;
      readonly settings?: Settings;
      readonly projectDirectory?: string;
    },
  ): AgentCompositeProfilePlan;
  createLaunchPlan(
    compositeProfile: CompositeProfile,
    profile?: Profile,
    passThroughArgs?: readonly string[],
    context?: AgentLaunchContext,
  ): AgentLaunchPlan;
  getUnsupportedControls(profile: Profile): readonly string[];
}
