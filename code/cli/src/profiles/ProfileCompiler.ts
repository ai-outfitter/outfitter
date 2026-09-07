// Compiles enabled agents into a harness-neutral profile registry. This is the compilation boundary
// of issue #387: `outfitter sync` composes every enabled agent exactly once, fingerprints the
// composition, and every harness projection embeds that same fingerprint, so runtime selection and
// native harness selection all consume one precompiled composition instead of recomposing it.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { compose } from '../composer/Composer.js';
import type { CompositionPlan } from '../composer/Composition.js';
import { effectiveToolAllowlist } from '../projection/Tools.js';
import { compareSlugs } from '../resolver/Resource.js';
import type { EffectiveResourceSet, ResolvedResource } from '../resolver/Resource.js';
import { parseSkillDocument } from '../skills/SkillDocument.js';
import type { AgentDefaults } from '../settings/Settings.js';

/** The same composer `run`, `dump`, and `link` use; injectable so tests can spy on composition. */
export type ComposeFunction = typeof compose;

/** Human-facing summary of one selected skill, exposed to Pi for per-profile skill presentation. */
export interface CompiledSkillSummary {
  readonly slug: string;
  readonly name?: string;
  readonly description?: string;
}

/** The resolved canonical model target, present when an effective models.json registry resolved. */
export interface CompiledModelTarget {
  readonly providerId: string;
  readonly modelId: string;
}

/** One compiled agent composition: everything a harness needs to become the agent's native profile. */
export interface CompiledProfile {
  readonly agent: string;
  /** `sha256:<hex>` over the canonical harness-neutral composition. Shared by every projection. */
  readonly fingerprint: string;
  readonly label?: string;
  readonly description?: string;
  /** The complete composed identity, serialized in composition order. Replaces a harness prompt. */
  readonly systemPrompt: string;
  readonly skills: readonly CompiledSkillSummary[];
  readonly subagents: readonly string[];
  /** Declared model selection in loadout form (e.g. `provider/model` or a native model name). */
  readonly model?: string;
  /** Resolved canonical target when a models.json registry was in effect. */
  readonly modelTarget?: CompiledModelTarget;
  readonly thinking?: string;
  /** Effective tool allowlist (deny applied), undefined when the loadout declares no allowlist. */
  readonly toolAllowlist?: readonly string[];
  readonly toolDenylist: readonly string[];
  /** Selected MCP server definitions, slug-keyed, after layer and per-agent precedence. */
  readonly mcpServers: Readonly<Record<string, unknown>>;
}

/** The compiled output of one sync: deterministic, sortable, and free of timestamps. */
export interface ProfileRegistry {
  readonly version: 1;
  readonly profiles: readonly CompiledProfile[];
}

export interface CompileProfilesResult {
  readonly registry?: ProfileRegistry;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export interface CompileProfilesInput {
  readonly set: EffectiveResourceSet;
  /** Root agents to compile, sorted; delegates they name do not become separate profiles. */
  readonly agents: readonly string[];
  readonly projectDirectory?: string;
  readonly agentDefaults?: AgentDefaults;
  readonly compose?: ComposeFunction;
}

/** Stable JSON: object keys sorted recursively, arrays in order, no whitespace. Exported for tests. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const compositionFingerprint = (plan: CompositionPlan): string => {
  const digest = canonicalJson({
    agent: plan.agent,
    chain: plan.inheritanceChain,
    identity: {
      systemPrompt: plan.identity.systemPrompt,
      sharedContext: plan.identity.sharedContext,
      appendSystemPrompts: plan.identity.appendSystemPrompts,
      agentBodies: plan.identity.agentBodies,
      promptTemplate: plan.identity.promptTemplate,
      label: plan.identity.label,
      description: plan.identity.description,
    },
    loadout: {
      skills: plan.loadout.skills.map((skill) => skill.slug),
      delegateSkills: plan.loadout.delegateSkills.map((skill) => skill.slug),
      subagents: plan.loadout.subagents.map((subagent) => subagent.slug),
      mcp: plan.loadout.mcp,
      mcpServers: plan.loadout.mcpServers,
      model: plan.loadout.model,
      thinking: plan.loadout.thinking,
      tools: plan.loadout.tools,
    },
    modelTarget: plan.models?.target === undefined ? undefined : { ...plan.models.target },
  });
  return `sha256:${createHash('sha256').update(digest).digest('hex')}`;
};

/** Reads one selected skill's SKILL.md frontmatter into a summary; unreadable skills summarize bare. */
const summarizeSkill = (skill: ResolvedResource): CompiledSkillSummary => {
  try {
    const document = parseSkillDocument(readFileSync(skill.winner.path, 'utf8'), skill.winner.path);
    if (!('message' in document)) {
      return { slug: skill.slug, name: document.name, description: document.description };
    }
  } catch {
    // A skill whose document cannot be read still keeps its slug in the summary list.
  }
  return { slug: skill.slug };
};

const compiledSystemPrompt = (plan: CompositionPlan): string =>
  [
    plan.identity.systemPrompt,
    plan.identity.sharedContext,
    // Composition normalizes absent fragment lists to empty arrays, so the fallback never runs.
    /* v8 ignore next 2 */
    ...(plan.identity.appendSystemPrompts ?? []).map((fragment) => fragment.content),
    ...(plan.identity.agentBodies ?? []).map((fragment) => fragment.content),
  ]
    /* v8 ignore next -- the elements are always strings; only the empty-content branch is live. */
    .filter((fragment): fragment is string => fragment !== undefined && fragment.length > 0)
    .join('\n\n');

const compileProfile = (plan: CompositionPlan): CompiledProfile => ({
  agent: plan.agent,
  fingerprint: compositionFingerprint(plan),
  label: plan.identity.label,
  description: plan.identity.description,
  systemPrompt: compiledSystemPrompt(plan),
  skills: plan.loadout.skills.map(summarizeSkill),
  subagents: plan.loadout.subagents.map((subagent) => subagent.slug),
  model: plan.loadout.model,
  modelTarget:
    plan.models?.target === undefined
      ? undefined
      : { providerId: plan.models.target.providerId, modelId: plan.models.target.modelId },
  thinking: plan.loadout.thinking,
  toolAllowlist: effectiveToolAllowlist(plan.loadout.tools),
  toolDenylist: plan.loadout.tools?.deny ?? [],
  mcpServers: plan.loadout.mcpServers,
});

/**
 * Composes every scoped agent exactly once and compiles the results. A composition failure is
 * collected as an error (the caller decides fatality) instead of aborting the whole registry, so
 * one broken agent does not hide the state of the others.
 */
export const compileProfiles = (input: CompileProfilesInput): CompileProfilesResult => {
  const composeFn = input.compose ?? compose;
  const warnings: string[] = [];
  const errors: string[] = [];
  const profiles: CompiledProfile[] = [];

  for (const slug of input.agents) {
    const composed = composeFn(input.set, slug, {
      projectDirectory: input.projectDirectory,
      agentDefaults: input.agentDefaults,
    });
    warnings.push(...composed.warnings);
    if (composed.plan === undefined) {
      errors.push(...composed.errors);
      continue;
    }
    warnings.push(...composed.plan.warnings);
    profiles.push(compileProfile(composed.plan));
  }

  profiles.sort((left, right) => compareSlugs(left.agent, right.agent));
  return { registry: { version: 1, profiles }, warnings: [...new Set(warnings)], errors };
};

/** Serializes the registry deterministically; identical inputs produce byte-identical output. */
export const serializeProfileRegistry = (registry: ProfileRegistry): string => `${JSON.stringify(registry, null, 2)}\n`;
