// Defines the adapter contract for translating Bridl profiles to agent CLI launches.
import type { Tack } from '../tack/Tack.js';

export interface AgentLaunchPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface AgentAdapter {
  readonly id: string;
  createLaunchPlan(tack: Tack): AgentLaunchPlan;
}
