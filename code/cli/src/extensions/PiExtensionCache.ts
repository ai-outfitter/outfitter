// Installs an agent's pi `extensions` loadout into a durable Outfitter cache and returns the local
// install directories so the pi launch can load them with `--extension <dir>` (offline, no reinstall
// per run). pi's own layout under PI_CODING_AGENT_DIR dedups sources across agents:
//   git:  <cacheAgentDir>/git/<host>/<owner>/<repo>
//   npm:  <cacheAgentDir>/npm/node_modules/<pkg>
// Outfitter's `git:`/`npm:` specifiers are already pi's `install` source grammar, so the source is
// passed through unchanged; only the install directory is reconstructed to check the cache.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { launchThroughSpawn, spawnLauncher } from '../agents/AgentLaunch.js';

/** Spawns `pi install <source>` against the cache agent dir; injectable so tests avoid the network. */
export type PiInstallSpawner = (input: { readonly source: string; readonly cacheAgentDir: string }) => Promise<number>;

export interface EnsurePiExtensionsInput {
  readonly cacheAgentDir: string;
  /** When true, missing extensions are never installed — they warn and are dropped. */
  readonly offline: boolean;
  readonly spawn?: PiInstallSpawner;
}

export interface EnsurePiExtensionsResult {
  /** Absolute install directories to pass as `--extension`, in specifier order, de-duplicated. */
  readonly loadDirs: readonly string[];
  /** One message per specifier that could not be loaded (unsupported, offline-missing, or failed). */
  readonly warnings: readonly string[];
}

interface PiExtensionSource {
  readonly source: string;
  readonly installSegments: readonly string[];
  /** Exact semver to verify against a cached install; undefined for ranges/tags/git refs. */
  readonly pinnedVersion?: string;
}

const exactSemverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/** Translates an Outfitter extension specifier to a pi `install` source + its cache install path. */
export const mapSpecifierToPiSource = (specifier: string): PiExtensionSource | { readonly unsupported: string } => {
  if (specifier.startsWith('npm:')) {
    const rest = specifier.slice('npm:'.length);
    const name = rest.replace(/@[^@/]+$/u, ''); // strip a trailing @version, keep a scope's leading @
    if (name === '') return { unsupported: `extension '${specifier}' has no package name` };
    const version = rest.length > name.length ? rest.slice(name.length + 1) : undefined;
    return {
      source: specifier,
      installSegments: ['npm', 'node_modules', name],
      pinnedVersion: version !== undefined && exactSemverPattern.test(version) ? version : undefined,
    };
  }

  if (specifier.startsWith('git:')) {
    const rest = specifier.slice('git:'.length);
    const pathPart = rest.includes('@') ? rest.slice(0, rest.lastIndexOf('@')) : rest;
    const segments = pathPart.split('/').filter((part) => part !== '');
    if (segments.length < 2) return { unsupported: `extension '${specifier}' is not a valid git source` };
    return { source: specifier, installSegments: ['git', ...segments] };
  }

  return { unsupported: `extension '${specifier}' uses an unsupported source (only git: and npm: project to pi)` };
};

const installedVersion = (installDir: string): string | undefined => {
  try {
    const manifest = JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')) as {
      readonly version?: string;
    };
    return manifest.version;
  } catch {
    return undefined;
  }
};

/* v8 ignore start -- real `pi install` subprocess; ensurePiExtensions is unit-tested with a fake spawner. */
const defaultSpawner: PiInstallSpawner = ({ source, cacheAgentDir }) =>
  launchThroughSpawn(spawnLauncher, {
    command: 'pi',
    args: ['install', source],
    env: { PI_CODING_AGENT_DIR: cacheAgentDir, GIT_TERMINAL_PROMPT: '0' },
  });
/* v8 ignore stop */

type SpecifierOutcome = { readonly loadDir: string } | { readonly warning: string };

/** Resolves one specifier to a cached load directory, installing it when online and missing. */
const ensureOneExtension = async (
  specifier: string,
  input: EnsurePiExtensionsInput,
  spawn: PiInstallSpawner,
): Promise<SpecifierOutcome> => {
  const mapped = mapSpecifierToPiSource(specifier);
  if ('unsupported' in mapped) return { warning: mapped.unsupported };

  const installDir = join(input.cacheAgentDir, ...mapped.installSegments);
  const cached =
    existsSync(installDir) &&
    (mapped.pinnedVersion === undefined || installedVersion(installDir) === mapped.pinnedVersion);
  if (cached) return { loadDir: installDir };

  if (input.offline) return { warning: `extension '${specifier}' is not cached and cannot be installed offline.` };

  mkdirSync(input.cacheAgentDir, { recursive: true });
  try {
    const exitCode = await spawn({ source: mapped.source, cacheAgentDir: input.cacheAgentDir });
    if (exitCode !== 0 || !existsSync(installDir)) {
      return { warning: `extension '${specifier}' failed to install (pi install exited ${exitCode}).` };
    }
  } catch (error) {
    return { warning: `extension '${specifier}' failed to install (${String(error)}).` };
  }

  return { loadDir: installDir };
};

/** Ensures each pi extension is cached (installing when online) and returns its load directory. */
export const ensurePiExtensions = async (
  specifiers: readonly string[],
  input: EnsurePiExtensionsInput,
): Promise<EnsurePiExtensionsResult> => {
  const spawn = input.spawn ?? defaultSpawner;
  const loadDirs: string[] = [];
  const warnings: string[] = [];

  for (const specifier of specifiers) {
    const outcome = await ensureOneExtension(specifier, input, spawn);
    if ('loadDir' in outcome) {
      if (!loadDirs.includes(outcome.loadDir)) loadDirs.push(outcome.loadDir);
    } else {
      warnings.push(outcome.warning);
    }
  }

  return { loadDirs, warnings };
};
