// Harness-neutral composition types produced from the effective resource set for a selected agent.
import type { PromptSourceReference } from './PromptSource.js';
import type { Loadout, ResolvedResource } from '../resolver/Resource.js';
import type { EffectiveModelRegistry } from './Models.js';
import type { PromptFragment } from './PromptSource.js';

/** The composed identity: base prompt, shared context, prompt fragments, and agent bodies. */
export interface ComposedIdentity {
  /** Content of the effective system prompt, if any. Kept for compatibility with existing callers. */
  readonly systemPrompt?: string;
  /** Provenance-rich effective system prompt fragment. */
  readonly systemPromptFragment?: PromptFragment;
  /** Content of the winning `agents.md` shared operating context, if any. */
  readonly sharedContext?: string;
  readonly sharedContextFragment?: PromptFragment;
  /** Effective appended prompt fragments, inherited parent-first and de-duplicated. */
  readonly appendSystemPrompts?: readonly PromptFragment[];
  /** Effective agent body fragments, inherited parent-first and selected child last. */
  readonly agentBodies?: readonly PromptFragment[];
  /** Effective prompt template fragment, when declared. */
  readonly promptTemplate?: PromptFragment;
  /** The composed `agent.md` markdown body. Kept for compatibility with existing callers. */
  readonly agentBody: string;
  /** Human-readable profile name for interactive harness UI. */
  readonly label?: string;
  readonly description?: string;
}

/** Identity fields guaranteed for a delegate composed from the effective resource set. */
export interface ComposedSubagentIdentity extends ComposedIdentity {
  readonly appendSystemPrompts: readonly PromptFragment[];
  readonly agentBodies: readonly PromptFragment[];
}

/** Effective delegated-agent controls projected into a native subagent definition. */
export interface ComposedSubagent {
  readonly resource: ResolvedResource;
  readonly identity: ComposedSubagentIdentity;
  readonly skills: readonly ResolvedResource[];
  readonly extensions: readonly string[];
  readonly model?: string;
  readonly thinking?: string;
  readonly tools?: Loadout['tools'];
}

/**
 * Settings-layer (`settings.yml:agent_defaults`) entries composed into one agent, as declared.
 * Present on a plan only when the settings layer actually declares defaults, so catalogs without
 * `agent_defaults` compose byte-identical plans.
 */
export interface CompositionAgentDefaults {
  readonly extensions?: readonly string[];
  readonly skills?: readonly string[];
  readonly mcp?: readonly string[];
  readonly plugins?: readonly string[];
  readonly subagents?: readonly string[];
  readonly appendSystemPrompt?: readonly PromptSourceReference[];
}

/** A loadout with its slug references resolved against the effective set. */
export interface ComposedLoadout {
  readonly skills: readonly ResolvedResource[];
  /** Skills selected by delegates, materialized for them without loading them into the leader. */
  readonly delegateSkills: readonly ResolvedResource[];
  readonly subagents: readonly ResolvedResource[];
  /** Inheritance-aware definitions for each selected delegate. */
  readonly composedSubagents?: readonly ComposedSubagent[];
  readonly mcp: readonly string[];
  /** Selected MCP server definitions after layer and per-agent precedence are applied. */
  readonly mcpServers: Readonly<Record<string, unknown>>;
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
  /** Layered provider registry and normalized selected model target, when models.json exists. */
  readonly models?: EffectiveModelRegistry;
  readonly loadout: ComposedLoadout;
  /** Parent-first agent resources that contributed identity, loadout, or native overlays. */
  readonly contributingAgents?: readonly ResolvedResource[];
  /** Parent-first chain of agent slugs that contributed to this composition, selected child last. */
  readonly inheritanceChain?: readonly string[];
  /** Settings-layer defaults composed ahead of the inheritance chain, when declared. */
  readonly agentDefaults?: CompositionAgentDefaults;
  /** Non-fatal issues (e.g. unknown loadout slugs) surfaced during composition. */
  readonly warnings: readonly string[];
}
