// Harness-neutral composition types produced from the effective resource set for a selected agent.
import type { Loadout, ResolvedResource } from '../resolver/Resource.js';
import type { EffectiveModelRegistry } from './Models.js';
import type { PromptFragment } from './PromptSource.js';

export interface ComposeOptions {
  /** Active repository root for `repo_file` prompt references. */
  readonly projectDirectory?: string;
}

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

/** A loadout with its slug references resolved against the effective set. */
/** One extension declaration plus the `.agents` payload root that declared it. */
export interface ComposedExtensionSelection {
  readonly specifier: string;
  readonly declaringRoot: string;
}

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
  /** Provenance used to resolve relative local extension paths without leaking absolute paths into dumps. */
  readonly extensionSelections?: readonly ComposedExtensionSelection[];
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
  /** Non-fatal issues (e.g. unknown loadout slugs) surfaced during composition. */
  readonly warnings: readonly string[];
}
