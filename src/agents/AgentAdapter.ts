// Defines the adapter contract for translating Bridl profiles to agent CLI launches.
import type { Profile } from '../profiles/Profile.js';
import type { Tack } from '../tack/Tack.js';

export interface AgentLaunchPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface AgentTackPlan {
  readonly tack: Tack;
  readonly warnings: readonly string[];
}

export interface AgentAdapter {
  readonly id: string;
  readonly supportedControls: readonly string[];
  createTack(
    profile: Profile,
    input: { readonly rootDirectory: string; readonly profilePaths: readonly string[] },
  ): AgentTackPlan;
  createLaunchPlan(tack: Tack, profile?: Profile, passThroughArgs?: readonly string[]): AgentLaunchPlan;
  getUnsupportedControls(profile: Profile): readonly string[];
}
