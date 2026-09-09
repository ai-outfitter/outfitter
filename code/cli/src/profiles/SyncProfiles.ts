// The compile-and-project phase `outfitter sync` runs after fetching sources: compose the enabled
// agent set once into a profile registry (issue #387), then project it into every detected harness
// home so native selection (`/outfitter profile`, `claude --agent`, `codex --profile`) consumes
// precompiled compositions instead of recomposing at launch.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveLinkScope } from '../links/HarnessLinkPlan.js';
import { detectInstalledHarnesses, linkHarnesses, resolveHarnessHome } from '../links/HarnessHome.js';
import type { EffectiveResourceSet } from '../resolver/Resource.js';
import type { Settings } from '../settings/Settings.js';
import { compileProfiles, serializeProfileRegistry } from './ProfileCompiler.js';
import type { ComposeFunction, ProfileRegistry } from './ProfileCompiler.js';
import { applyProfileProjection, planProfileProjection, unsupportedProfileElements } from './ProfileProjection.js';
import type { ProfileAction } from './ProfileProjection.js';

export interface SyncProfilesInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly set: EffectiveResourceSet;
  readonly settings: Settings;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Strict projection: selected loadout elements a harness profile cannot express fail the sync. */
  readonly strict?: boolean;
  readonly compose?: ComposeFunction;
}

export interface SyncProfilesResult {
  readonly messages: readonly string[];
  /** True when compilation or a projection conflict failed the sync. */
  readonly failed: boolean;
  readonly actions: readonly ProfileAction[];
}

const neutralRegistryPath = (homeDirectory: string): string =>
  join(homeDirectory, '.outfitter', 'profiles', 'registry.json');

const formatAction = (action: ProfileAction): string => {
  const detail = action.detail === undefined ? '' : ` (${action.detail})`;
  return `${action.harness}: ${action.status} ${action.path}${detail}`;
};

/** Writes the harness-neutral registry when its content changed; returns the status message. */
const writeNeutralRegistry = (
  homeDirectory: string,
  registry: ProfileRegistry,
): { readonly message: string; readonly failed: boolean } => {
  const registryPath = neutralRegistryPath(homeDirectory);
  const registryContent = serializeProfileRegistry(registry);
  try {
    if (existsSync(registryPath) && readFileSync(registryPath, 'utf8') === registryContent) {
      return { message: `compiled profiles unchanged -> ${registryPath}`, failed: false };
    }
    mkdirSync(dirname(registryPath), { recursive: true });
    writeFileSync(registryPath, registryContent);
    return { message: `compiled ${registry.profiles.length} agent profile(s) -> ${registryPath}`, failed: false };
  } catch (error) {
    /* v8 ignore next 3 -- node fs throws Error instances; String(error) guards exotic throwables. */
    return {
      message: `error: cannot write the compiled profile registry at ${registryPath}: ${error instanceof Error ? error.message : String(error)}`,
      failed: true,
    };
  }
};

/** Projects the compiled registry into every detected harness home. */
const projectRegistry = (
  input: SyncProfilesInput,
  registry: ProfileRegistry,
  messages: string[],
): { readonly actions: readonly ProfileAction[]; readonly conflicts: number } => {
  const actions: ProfileAction[] = [];
  let conflicts = 0;
  const harnesses = detectInstalledHarnesses(input.homeDirectory, input.env);
  if (harnesses.length === 0) {
    messages.push('No harness home detected; compiled profiles are available to launches via the registry.');
    return { actions, conflicts };
  }
  for (const harness of harnesses) {
    const home = resolveHarnessHome(harness, input.homeDirectory, input.env);
    const plan = planProfileProjection(registry, harness, home);
    messages.push(...plan.warnings.map((warning) => `warning: ${warning}`));
    const applied = applyProfileProjection(plan, home);
    actions.push(...applied);
    conflicts += applied.filter((action) => action.status === 'conflict').length;
    messages.push(...applied.map(formatAction));
  }
  return { actions, conflicts };
};

/**
 * Compiles the enabled agents and projects the registry. A sync without enabled agents (no
 * `default_agent`, no enabled workflows) compiles nothing and stays quiet about it; a composition
 * error or an unmanaged-path conflict fails the sync, while per-harness projection warnings are
 * advisory.
 */
export const syncProfiles = (input: SyncProfilesInput): SyncProfilesResult => {
  const scope = resolveLinkScope(input.set, input.settings, {
    agents: [],
    workflows: [],
    all: false,
    allowEmpty: true,
  });
  if (scope.errors.length > 0) {
    return { messages: scope.errors.map((error) => `error: ${error}`), failed: true, actions: [] };
  }
  if (scope.agents.length === 0) return { messages: [], failed: false, actions: [] };

  const compiled = compileProfiles({
    set: input.set,
    agents: scope.agents,
    projectDirectory: input.projectDirectory,
    agentDefaults: input.settings.agentDefaults,
    compose: input.compose,
  });
  if (compiled.registry === undefined || compiled.errors.length > 0) {
    return {
      messages: [
        ...compiled.warnings.map((warning) => `warning: ${warning}`),
        ...compiled.errors.map((error) => `error: ${error}`),
      ],
      failed: true,
      actions: [],
    };
  }
  const registry = compiled.registry;
  const messages = compiled.warnings.map((warning) => `warning: ${warning}`);

  // The harness-neutral registry is the compiled artifact `outfitter profiles` reads; harness homes
  // receive their own projection of it. Writing only on content change keeps a second sync with
  // unchanged inputs mutation-free.
  const written = writeNeutralRegistry(input.homeDirectory, registry);
  messages.push(written.message);
  if (written.failed) {
    return { messages, failed: true, actions: [] };
  }

  const { actions, conflicts } = projectRegistry(input, registry, messages);
  // Unsupported elements are always visible; `--strict` makes them fatal (strict projection).
  const unsupportedSummaries = linkHarnesses.flatMap((harness) =>
    registry.profiles.map((profile) => ({
      harness,
      agent: profile.agent,
      missing: unsupportedProfileElements(harness, profile),
    })),
  );
  for (const summary of unsupportedSummaries.filter((summary) => summary.missing.length > 0)) {
    messages.push(
      `warning: harness '${summary.harness}' cannot project element(s) ${summary.missing.join(', ')} of agent '${summary.agent}' in its native profile.`,
    );
  }
  if (conflicts > 0) {
    messages.push(`error: ${conflicts} unmanaged harness file(s) conflict with compiled profile projections.`);
    return { messages, failed: true, actions };
  }
  const strictUnsupported = input.strict === true && unsupportedSummaries.some((summary) => summary.missing.length > 0);
  if (strictUnsupported) {
    messages.push('error: strict projection treats unsupported profile elements as fatal.');
    return { messages, failed: true, actions };
  }
  return { messages, failed: false, actions };
};
