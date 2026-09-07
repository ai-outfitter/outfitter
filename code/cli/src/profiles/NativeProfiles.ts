// Plans persistent native profiles; HarnessLinkApply alone owns filesystem reconciliation.
import { dirname, join } from 'node:path';
import { stringify as stringifyToml } from 'smol-toml';
import { stringify as stringifyYaml } from 'yaml';

import type { ComposedIdentity, CompositionPlan } from '../composer/Composition.js';
import { escapesRoots } from '../dump/Containment.js';
import type { HarnessLinkPlan, LinkEntry } from '../links/HarnessLinkPlan.js';
import { mcpAddArgs } from '../links/HarnessMcp.js';
import { effectiveToolAllowlist } from '../projection/Tools.js';
import { compareSlugs } from '../resolver/Resource.js';
import type { ResolvedResource } from '../resolver/Resource.js';
import type { Harness, HarnessDefaultSettings, SettingsValue } from '../settings/Settings.js';

export interface NativeProfile {
  readonly agent: string;
  readonly fingerprint: string;
  readonly plan: CompositionPlan;
}

export interface ProfileProjectionStatus {
  readonly status: 'ready' | 'partial';
  readonly unsupported: readonly string[];
}

const safeSlug = (slug: string): boolean => /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(slug);
/** Claude names use hyphens; double hyphens cannot occur in protocol slugs, making this injective. */
export const nativeProfileName = (slug: string, harness: Harness): string => {
  if (!safeSlug(slug)) throw new Error(`Unsafe profile slug '${slug}'.`);
  return harness === 'claude' ? slug.replaceAll('.', '--') : slug;
};
const reasoningLevels = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const identityBody = (identity: ComposedIdentity): string =>
  [
    identity.systemPrompt,
    identity.sharedContext,
    ...(identity.appendSystemPrompts ?? []).map((fragment) => fragment.content),
    ...(identity.agentBodies?.map((fragment) => fragment.content) ?? [identity.agentBody]),
  ]
    .filter((fragment): fragment is string => fragment !== undefined && fragment.length > 0)
    .join('\n\n');

const serverDefinition = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const mcpLimitations = (plan: CompositionPlan, harness: Harness): readonly string[] =>
  plan.loadout.mcp.flatMap((id) => {
    const server = serverDefinition(plan.loadout.mcpServers[id]);
    if (server === undefined) return [`mcp:${id}`];
    return mcpAddArgs(harness, id, server).warnings.map((warning) => `mcp:${id}: ${warning}`);
  });

const piMcpLimitations = (plan: CompositionPlan): readonly string[] =>
  plan.loadout.mcp.flatMap((id) => {
    const server = serverDefinition(plan.loadout.mcpServers[id]);
    if (server === undefined) return [`mcp:${id}`];
    const transport = server.type ?? (server.url === undefined ? 'stdio' : 'http');
    if (transport !== 'stdio') return [`mcp_transport:${id}`];
    const endpoint = server.command;
    if (typeof endpoint !== 'string' || endpoint.trim().length === 0) return [`mcp:${id}`];
    return [];
  });

// Pi loads the compiled models.document and selects the normalized provider/model at activation.
const piLimitations = (plan: CompositionPlan): readonly string[] => [
  ...(plan.loadout.plugins.length > 0 ? ['plugins'] : []),
  ...(plan.identity.promptTemplate === undefined ? [] : ['prompt_template']),
  ...(plan.loadout.extensions.length > 0 ? ['extensions_live_activation'] : []),
  ...(plan.loadout.thinking !== undefined &&
  !['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(plan.loadout.thinking)
    ? ['thinking']
    : []),
  ...piMcpLimitations(plan),
];

const status = (unsupported: readonly string[]): ProfileProjectionStatus => ({
  status: unsupported.length > 0 ? 'partial' : 'ready',
  unsupported,
});

const nonPiLimitations = (plan: CompositionPlan, harness: Harness): string[] => {
  const { loadout } = plan;
  return [
    ...(!safeSlug(plan.agent) ? ['native_slug'] : []),
    ...(loadout.extensions.length > 0 ? ['extensions'] : []),
    ...(loadout.plugins.length > 0 ? ['plugins'] : []),
    ...(harness === 'claude' && loadout.subagents.length > 0 ? ['subagents'] : []),
    ...(plan.identity.promptTemplate === undefined ? [] : ['prompt_template']),
    ...(plan.models?.target === undefined ? [] : ['model_provider']),
  ];
};

const codexLimitations = ({ loadout }: CompositionPlan): string[] => [
  ...(loadout.subagents.length > 0 ? ['subagents_scope'] : []),
  ...(loadout.tools === undefined ? [] : ['tools']),
  ...(loadout.skills.length > 0 || loadout.delegateSkills.length > 0 ? ['skills_scope'] : []),
  ...(loadout.mcp.length > 0 ? ['mcp_scope'] : []),
];

const selectedSkills = (plan: CompositionPlan): readonly ResolvedResource[] => [
  ...plan.loadout.skills,
  ...plan.loadout.delegateSkills,
];

const skillLimitations = (plan: CompositionPlan, profiles: readonly NativeProfile[]): readonly string[] => {
  const peers = [plan, ...profiles.map(({ plan }) => plan)].flatMap(selectedSkills);
  const conflicts = selectedSkills(plan).filter((skill) =>
    peers.some((peer) => peer.slug === skill.slug && dirname(peer.winner.path) !== dirname(skill.winner.path)),
  );
  return [...new Set(conflicts.map(({ slug }) => `skills_conflict:${slug}`))].sort(compareSlugs);
};

/**
 * Reports capability gaps, not reconciliation conflicts. Codex's native ConfigProfile supports
 * model, reasoning, instructions and sandbox, but not agents, skills or mcp_servers:
 * https://github.com/openai/codex/blob/main/codex-rs/config/src/profile_toml.rs
 */
export const profileProjectionStatus = (
  profile: CompositionPlan | { readonly plan: CompositionPlan },
  harness: Harness,
  profiles: readonly NativeProfile[] = [],
): ProfileProjectionStatus => {
  const plan = 'plan' in profile ? profile.plan : profile;
  if (harness === 'pi') return status(piLimitations(plan));
  const unsupported = nonPiLimitations(plan, harness);
  const { loadout } = plan;
  if (loadout.thinking !== undefined && (harness === 'claude' || !reasoningLevels.includes(loadout.thinking)))
    unsupported.push('thinking');
  if (harness === 'codex') unsupported.push(...codexLimitations(plan));
  unsupported.push(...mcpLimitations(plan, harness), ...skillLimitations(plan, profiles));
  return status(unsupported);
};

const file = (path: string, content: string, resource: string): LinkEntry => ({
  kind: 'file',
  path,
  content,
  resource,
});

const setting = (keys: readonly string[], value: SettingsValue, resource: string): LinkEntry => ({
  kind: 'setting',
  path: `setting:config.toml:${keys.map(encodeURIComponent).join('/')}`,
  setting: { file: 'config.toml', keys, value },
  resource,
});

const nativeModel = (plan: CompositionPlan): string | undefined =>
  plan.models?.target === undefined ? plan.loadout.model : undefined;

// Claude's native agent shape: https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields
// Unlike the legacy link serializer, unsupported `thinking` and `extensions` are never emitted.
const claudeDocument = ({ agent, fingerprint, plan }: NativeProfile): string => {
  const { loadout, identity } = plan;
  const frontmatter: Record<string, unknown> = {
    name: nativeProfileName(agent, 'claude'),
    description: identity.description ?? identity.label ?? `Outfitter profile ${agent}.`,
  };
  const model = nativeModel(plan);
  if (model !== undefined) frontmatter.model = model;
  const allow = effectiveToolAllowlist(loadout.tools);
  if (allow !== undefined) frontmatter.tools = allow;
  if (loadout.tools?.deny !== undefined) frontmatter.disallowedTools = loadout.tools.deny;
  if (loadout.skills.length > 0) frontmatter.skills = loadout.skills.map((skill) => skill.slug);
  if (loadout.mcp.length > 0) frontmatter.mcpServers = loadout.mcp;
  return `---\n${stringifyYaml(frontmatter)}---\n\n<!-- outfitter sync: ${fingerprint} -->\n\n${identityBody(identity)}\n`;
};

const codexDefaults = (defaults: HarnessDefaultSettings, warnings: string[]): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(defaults)) {
    const allowed: Readonly<Record<string, readonly string[]>> = {
      sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
      approval_policy: ['untrusted', 'on-request', 'never'],
    };
    if (typeof value === 'string' && allowed[key]?.includes(value)) values[key] = value;
    else warnings.push(`codex native profile default '${key}' is unsupported.`);
  }
  return values;
};

const codexEntries = (
  { agent, fingerprint, plan }: NativeProfile,
  home: string,
  defaults: Record<string, string>,
): readonly LinkEntry[] => {
  const resource = `agent:${agent}`;
  const instructions = `${agent}.instructions.md`;
  const values: Record<string, string> = { ...defaults, model_instructions_file: join(home, instructions) };
  const model = nativeModel(plan);
  if (model !== undefined) values.model = model;
  if (plan.loadout.thinking !== undefined && reasoningLevels.includes(plan.loadout.thinking))
    values.model_reasoning_effort = plan.loadout.thinking;
  return [
    file(instructions, `${identityBody(plan.identity)}\n`, resource),
    // This artifact is inspectable/exportable; --profile reads config.toml, not this sidecar.
    file(`${agent}.config.toml`, `# outfitter sync: ${fingerprint}\n${stringifyToml(values)}`, resource),
    ...Object.entries(values).map(([key, value]) => setting(['profiles', agent, key], value, resource)),
  ];
};

const addSharedSkill = (entries: Map<string, LinkEntry>, skill: ResolvedResource, warnings: string[]): void => {
  if (!safeSlug(skill.slug) || escapesRoots(dirname(skill.winner.path), [skill.winner.layer.root])) {
    warnings.push(`skill '${skill.slug}' resolves outside its layer or has an unsafe slug and is not linked.`);
    return;
  }
  const path = `skills/${skill.slug}`;
  const target = dirname(skill.winner.path);
  const previous = entries.get(path);
  if (previous !== undefined && previous.target !== target) {
    warnings.push(`skill '${skill.slug}' has conflicting profile definitions; the first definition is linked.`);
    return;
  }
  entries.set(path, { kind: 'symlink', path, target, resource: `skill:${skill.slug}` });
};

const addSharedMcp = (entries: Map<string, LinkEntry>, profile: NativeProfile, warnings: string[]): void => {
  for (const id of profile.plan.loadout.mcp) {
    const server = serverDefinition(profile.plan.loadout.mcpServers[id]);
    if (server === undefined) continue;
    const path = `mcp:${id}`;
    const previous = entries.get(path);
    if (previous !== undefined && JSON.stringify(previous.mcp!.server) !== JSON.stringify(server)) {
      warnings.push(`MCP server '${id}' has conflicting profile definitions; the first definition is linked.`);
      continue;
    }
    entries.set(path, { kind: 'mcp', path, mcp: { id, server }, resource: path });
  }
};

// Native Codex roles are global, not ConfigProfile fields. Role config_file layers accept the
// same instruction/model settings as the sidecar (codex-rs/agent-roles/src/agent_role_config.rs).
const codexSubagentEntries = (
  profiles: readonly NativeProfile[],
  harness: Harness,
  home: string,
  warnings: string[],
): readonly LinkEntry[] => {
  if (harness !== 'codex') return [];
  const selected = new Set(profiles.flatMap((profile) => profile.plan.loadout.subagents.map(({ slug }) => slug)));
  return [...selected].sort(compareSlugs).flatMap((slug) => {
    const profile = profiles.find(({ agent }) => agent === slug);
    if (profile === undefined || !safeSlug(slug)) {
      warnings.push(`codex subagent '${slug}' has no compiled native profile and is not registered.`);
      return [];
    }
    const { identity } = profile.plan;
    return [
      setting(['agents', slug, 'config_file'], join(home, `${slug}.config.toml`), `agent:${slug}`),
      setting(
        ['agents', slug, 'description'],
        identity.description ?? identity.label ?? `Outfitter profile ${slug}.`,
        `agent:${slug}`,
      ),
    ];
  });
};

/**
 * Returns ownership-aware entries only: callers must apply them through applyHarnessLinks.
 * Pi's extension consumes the registry separately and owns activation; no Pi identity is replaced.
 * Codex settings are individual managed leaves, never a replacement for the user's config.toml.
 */
export const planNativeProfiles = (
  profiles: readonly NativeProfile[],
  harness: Harness,
  harnessHome: string,
  defaults: HarnessDefaultSettings = {},
): HarnessLinkPlan => {
  const entries = new Map<string, LinkEntry>();
  const warnings: string[] = [];
  const sorted = [...profiles].sort((left, right) => compareSlugs(left.agent, right.agent));
  const codex = harness === 'codex' ? codexDefaults(defaults, warnings) : {};
  if (harness === 'pi') {
    return {
      harness,
      entries: [
        file(
          '.outfitter/profiles.json',
          `${JSON.stringify({ version: 1, profiles: sorted.map(({ agent, fingerprint }) => ({ agent, fingerprint })) }, null, 2)}\n`,
          'profiles:registry',
        ),
      ],
      warnings: sorted.flatMap((profile) =>
        profileProjectionStatus(profile, harness).unsupported.map(
          (control) => `${harness} profile '${profile.agent}' does not support ${control}.`,
        ),
      ),
    };
  }
  for (const profile of sorted) {
    if (!safeSlug(profile.agent)) {
      warnings.push(`profile '${profile.agent}' has an unsupported native slug and is not projected.`);
      continue;
    }
    warnings.push(
      ...profile.plan.warnings,
      ...profileProjectionStatus(profile, harness, sorted).unsupported.map(
        (control) => `${harness} profile '${profile.agent}' does not support ${control}.`,
      ),
    );
    const native =
      harness === 'claude'
        ? [file(`agents/${profile.agent}.md`, claudeDocument(profile), `agent:${profile.agent}`)]
        : codexEntries(profile, harnessHome, codex);
    for (const entry of native) entries.set(entry.path, entry);
    for (const skill of [...profile.plan.loadout.skills, ...profile.plan.loadout.delegateSkills])
      addSharedSkill(entries, skill, warnings);
    addSharedMcp(entries, profile, warnings);
  }
  for (const entry of codexSubagentEntries(sorted, harness, harnessHome, warnings)) entries.set(entry.path, entry);
  return { harness, entries: [...entries.values()], warnings: [...new Set(warnings)] };
};
