// The sync-time compiler is the only writer of the project-scoped launch registry.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { compose } from '../composer/Composer.js';
import type { CompositionPlan } from '../composer/Composition.js';
import { resolveLinkScope } from '../links/HarnessLinkPlan.js';
import { isLinkHarness, resolveHarnessHome } from '../links/HarnessHome.js';
import { resolveOutfitterCacheDir } from '../paths/OutfitterCache.js';
import { compareSlugs } from '../resolver/Resource.js';
import { resolveEffectiveSet } from '../resolver/ResolverContext.js';
import type { ResolveResult } from '../resolver/ResolverContext.js';
import type { Harness, Settings } from '../settings/Settings.js';
import { formatSettingsIssue } from '../settings/SettingsLoader.js';
import { CompiledAssets, contentDigest, stableJson } from './CompiledAssets.js';
import { compileProfileProjections } from './CompiledProjections.js';
import type { CompiledProjections } from './CompiledProjections.js';

export { relocateCompiledProjection } from './CompiledProjections.js';
export type { CompiledProjection, CompiledProjections } from './CompiledProjections.js';

export interface CompiledProfile {
  readonly agent: string;
  readonly fingerprint: string;
  readonly plan: CompositionPlan;
  readonly projections?: CompiledProjections;
}

export interface CompiledRegistry {
  readonly version: 1;
  readonly profiles: readonly CompiledProfile[];
  readonly settings: Settings;
  /** Sync-selected native destinations, resolved before launch-time environment overrides. */
  readonly harnessHomes?: Readonly<Partial<Record<Harness, string>>>;
}

export interface CompiledRegistryInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly strict?: boolean;
  readonly harnesses?: readonly string[];
}

export interface CompileRegistryDependencies {
  readonly compose?: typeof compose;
  readonly resolve?: typeof resolveEffectiveSet;
}

export interface CompileRegistryResult {
  readonly registry: CompiledRegistry;
  readonly changed: boolean;
  readonly warnings: readonly string[];
}

export const compiledRegistryPath = (input: CompiledRegistryInput): string =>
  join(
    resolveOutfitterCacheDir(input.env ?? process.env, input.homeDirectory),
    'profiles',
    contentDigest(resolve(input.projectDirectory)),
    'registry.json',
  );

/** Never resolves catalogs or repairs caches. Missing compilation is distinct from an empty scope. */
export const readCompiledRegistry = (input: CompiledRegistryInput): CompiledRegistry | undefined => {
  const path = compiledRegistryPath(input);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<CompiledRegistry>;
  if (
    value === null ||
    value.version !== 1 ||
    !Array.isArray(value.profiles) ||
    value.settings === null ||
    typeof value.settings !== 'object' ||
    value.profiles.some(
      (profile: CompiledProfile) =>
        profile === null ||
        typeof profile.agent !== 'string' ||
        typeof profile.fingerprint !== 'string' ||
        profile.plan === null ||
        typeof profile.plan !== 'object' ||
        profile.plan.agent !== profile.agent,
    )
  )
    throw new Error("Invalid compiled profile registry. Run 'outfitter sync' to rebuild it.");
  return value as CompiledRegistry;
};

const compileProfiles = (
  input: CompiledRegistryInput,
  { set, settings }: ResolveResult,
  scope: readonly string[],
  assets: CompiledAssets,
  warnings: string[],
  composer: typeof compose,
): readonly CompiledProfile[] => {
  const profiles: CompiledProfile[] = [];
  const seen = new Set<string>();
  const queue = [...scope];
  while (queue.length > 0) {
    const agent = queue.shift()!;
    if (seen.has(agent)) continue;
    seen.add(agent);
    const composed = composer(set, agent, {
      projectDirectory: input.projectDirectory,
      agentDefaults: settings.agentDefaults,
    });
    if (composed.plan === undefined) throw new Error(composed.errors.join('; '));
    warnings.push(...composed.warnings, ...composed.plan.warnings);
    const plan = assets.freeze(composed.plan);
    profiles.push({
      agent,
      fingerprint: `sha256:${contentDigest(stableJson({ plan, harnessDefaults: settings.harnessDefaults }))}`,
      plan,
    });
    queue.push(...plan.loadout.subagents.map((subagent) => subagent.slug).sort(compareSlugs));
  }
  return profiles.sort((left, right) => compareSlugs(left.agent, right.agent));
};

const persistRegistry = (registry: CompiledRegistry, path: string): boolean => {
  const bytes = `${stableJson(registry)}\n`;
  const changed = !existsSync(path) || readFileSync(path, 'utf8') !== bytes;
  if (changed) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const pending = `${path}.${process.pid}.pending`;
    try {
      writeFileSync(pending, bytes, { flag: 'wx', mode: 0o600 });
      renameSync(pending, path);
    } finally {
      rmSync(pending, { force: true });
    }
  }
  return changed;
};

const selectedScope = ({ set, settings }: ResolveResult): readonly string[] => {
  const scope = resolveLinkScope(set, settings, { agents: [], workflows: [], all: false });
  const empty = settings.defaultAgent === undefined && settings.workflows!.length === 0;
  if (!empty && scope.errors.length > 0) throw new Error(scope.errors.join('; '));
  return scope.agents;
};

const harnessHomes = (input: CompiledRegistryInput, settings: Settings): Readonly<Partial<Record<Harness, string>>> => {
  const selected = input.harnesses?.length
    ? input.harnesses
    : [settings.defaultHarness ?? 'pi', ...Object.keys(settings.harnessDefaults ?? {})];
  return Object.fromEntries([...new Set(selected)].sort(compareSlugs).map((harness) => {
    if (!isLinkHarness(harness)) throw new Error(`Unknown harness '${harness}'. sync supports: pi, claude, codex.`);
    return [harness, resolveHarnessHome(harness, input.homeDirectory, input.env ?? process.env)];
  }));
};

export const compileProfileRegistry = (
  input: CompiledRegistryInput,
  dependencies: CompileRegistryDependencies = {},
): CompileRegistryResult => {
  const resolved = (dependencies.resolve ?? resolveEffectiveSet)(input);
  if (resolved.settingsIssues.length > 0)
    throw new Error(
      `Cannot compile with invalid settings: ${resolved.settingsIssues.map(formatSettingsIssue).join('; ')}`,
    );
  const path = compiledRegistryPath(input);
  const assets = new CompiledAssets(
    join(dirname(path), 'assets'),
    resolved.set.layers.map((layer) => layer.root),
  );
  const warnings = [...resolved.warnings];
  const profiles = compileProfiles(
    input,
    resolved,
    selectedScope(resolved),
    assets,
    warnings,
    dependencies.compose ?? compose,
  );
  const uniqueWarnings = [...new Set(warnings)];
  if (input.strict === true && uniqueWarnings.length > 0) throw new Error(uniqueWarnings.join('; '));
  assets.persist();
  const registry: CompiledRegistry = {
    version: 1,
    profiles: profiles.map((profile) => ({
      ...profile,
      projections: compileProfileProjections(profile, resolved.settings, dirname(path), input.homeDirectory),
    })),
    settings: resolved.settings,
    harnessHomes: harnessHomes(input, resolved.settings),
  };
  return { registry, changed: persistRegistry(registry, path), warnings: uniqueWarnings };
};
