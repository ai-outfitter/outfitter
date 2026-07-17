// Harness-neutral composition types produced from the effective resource set for a selected agent.
import type { Loadout, ResolvedResource } from '../resolver/Resource.js';

/** The composed identity: base prompt, shared context, and the selected agent's body. */
export interface ComposedIdentity {
  /** Content of the winning `system-prompt.md`, if any. */
  readonly systemPrompt?: string;
  /** Content of the winning `agents.md` shared operating context, if any. */
  readonly sharedContext?: string;
  /** The selected agent's `agent.md` markdown body. */
  readonly agentBody: string;
  readonly description?: string;
}

/** A loadout with its slug references resolved against the effective set. */
export interface ComposedLoadout {
  readonly skills: readonly ResolvedResource[];
  readonly subagents: readonly ResolvedResource[];
  readonly mcp: readonly string[];
  readonly extensions: readonly string[];
  readonly plugins: readonly string[];
  readonly model?: string;
  readonly thinking?: string;
  readonly tools?: Loadout['tools'];
}

/**
 * A deterministic, harness-neutral plan for one run. Adapters project this to native configuration;
 * `dump` serializes it. Identical inputs produce an identical composition.
 */
export interface CompositionPlan {
  readonly agent: string;
  readonly identity: ComposedIdentity;
  readonly loadout: ComposedLoadout;
  /** Non-fatal issues (e.g. unknown loadout slugs) surfaced during composition. */
  readonly warnings: readonly string[];
}
