// Builds credential-free launch templates once; runs copy these trees instead of projecting again.
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { projectComposition } from '../projection/ProjectHarness.js';
import { projectModel } from '../projection/ModelProjection.js';
import type { AgentProjectionPlan, ProjectionInput } from '../projection/Projection.js';
import type { Harness, Isolation, Settings } from '../settings/Settings.js';
import { stableJson } from './CompiledAssets.js';
import type { CompiledProfile } from './CompiledRegistry.js';

const launchComposition = (profile: CompiledProfile, harness: Harness) =>
  harness === 'pi'
    ? {
        ...profile.plan,
        models: profile.plan.models === undefined ? undefined : { ...profile.plan.models, target: undefined },
        // The controller activates the initial profile too; CLI selectors would poison native
        // defaults and impose a process-wide tool ceiling on later profile switches.
        loadout: { ...profile.plan.loadout, model: undefined, thinking: undefined, tools: undefined },
      }
    : profile.plan;

export interface CompiledProjection extends AgentProjectionPlan {
  /** Replace these with projectModel(frozenPlan, runtimeInput).warnings when resolving credentials. */
  readonly modelWarnings: readonly string[];
}

export type CompiledProjections = Partial<
  Record<Harness, { readonly isolated: CompiledProjection; readonly inherit?: CompiledProjection }>
>;

/** Relocates only generated paths; it performs no filesystem reads or composition. */
export const relocateCompiledProjection = (
  projection: CompiledProjection,
  rootDirectory: string,
): CompiledProjection => {
  const relocate = (value: string): string => value.split(projection.rootDirectory).join(rootDirectory);
  return {
    ...projection,
    rootDirectory,
    launch: {
      ...projection.launch,
      args: projection.launch.args.map(relocate),
      env: Object.fromEntries(Object.entries(projection.launch.env).map(([key, value]) => [key, relocate(value)])),
    },
  };
};

const secureTree = (path: string): void => {
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) secureTree(join(path, name));
  } else {
    chmodSync(path, (stat.mode & 0o111) === 0 ? 0o600 : 0o700);
  }
};

const compileProjection = (
  profile: CompiledProfile,
  settings: Settings,
  directory: string,
  homeDirectory: string,
  harness: 'pi' | 'claude',
  isolation: Isolation,
): CompiledProjection => {
  const rootDirectory = join(directory, 'launch-v1', profile.fingerprint.replace(/^sha256:/u, ''), `${harness}-${isolation}`);
  const metadata = '.outfitter-projection.json';
  if (existsSync(join(rootDirectory, metadata)))
    return JSON.parse(readFileSync(join(rootDirectory, metadata), 'utf8')) as CompiledProjection;
  const pending = `${rootDirectory}.${randomUUID()}.pending`;
  mkdirSync(pending, { recursive: true, mode: 0o700 });
  try {
    const input: ProjectionInput = {
      harness,
      isolation,
      rootDirectory: pending,
      homeDirectory,
      profileSlug: profile.agent,
      processEnvironment: {},
      harnessDefaults: settings.harnessDefaults?.[harness],
      configurationOverlayDirectories: [...(profile.plan.contributingAgents ?? [])]
        .reverse()
        .flatMap((resource) => resource.piConfigDirectories ?? []),
    };
    const composition = launchComposition(profile, harness);
    const projection = relocateCompiledProjection(
      {
        ...projectComposition(composition, input),
        modelWarnings: projectModel(composition, input).warnings,
      },
      rootDirectory,
    );
    writeFileSync(join(pending, metadata), `${stableJson(projection)}\n`, { mode: 0o600, flag: 'wx' });
    secureTree(pending);
    renameSync(pending, rootDirectory);
    return projection;
  } finally {
    rmSync(pending, { recursive: true, force: true });
  }
};

export const compileProfileProjections = (
  profile: CompiledProfile,
  settings: Settings,
  directory: string,
  homeDirectory: string,
): CompiledProjections => ({
  pi: { isolated: compileProjection(profile, settings, directory, homeDirectory, 'pi', 'isolated') },
  claude: {
    isolated: compileProjection(profile, settings, directory, homeDirectory, 'claude', 'isolated'),
    inherit: compileProjection(profile, settings, directory, homeDirectory, 'claude', 'inherit'),
  },
});
