// Installs an agent's pi `extensions` loadout into a durable Outfitter cache and returns the local
// install directories so the pi launch can load them with `--extension <dir>` (offline, no reinstall
// per run). pi's own layout under PI_CODING_AGENT_DIR dedups sources across agents:
//   git:  <cacheAgentDir>/git/<host>/<owner>/<repo>
//   npm:  <cacheAgentDir>/npm/node_modules/<pkg>
// Outfitter's `git:`/`npm:` specifiers are already pi's `install` source grammar, so the source is
// passed through unchanged; only the install directory is reconstructed to check the cache.
//
// A cached git checkout is only trusted when it still matches the specifier's `@ref` pin:
//   - full-SHA ref: `git -C <installDir> rev-parse HEAD` is compared against the pin (offline-safe,
//     no network); a mismatch or an unreadable HEAD reinstalls when online.
//   - branch/tag ref: the ref string is recorded in a `<installDir>.outfitter-ref.json` marker at
//     install time and only a *changed* ref string triggers a reinstall — a moved remote branch tip
//     is deliberately not chased, so pinned launches never hit the network.
//   - branch/tag ref with no marker (a pre-marker cache): served as-is when offline (no evidence it
//     is wrong), refreshed once when online, which writes the marker.
// Offline, a checkout that provably mismatches its pin is dropped with a warning — the same
// severity the offline path already applies to a missing extension (fatal only under `--strict`).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { createSpawnLauncher, launchThroughSpawn, spawnLauncher } from '../agents/AgentLaunch.js';
import { runGit } from '../sources/GitRepository.js';

/** Spawns `pi install <source>` against the cache agent dir; injectable so tests avoid the network. */
export type PiInstallSpawner = (input: {
  readonly source: string;
  readonly cacheAgentDir: string;
  readonly debug?: boolean;
}) => Promise<number>;

export interface PiExtensionReference {
  readonly specifier: string;
  /** Absolute `.agents` payload root of the declaring agent, for `./` and `../` paths. */
  readonly declaringRoot?: string;
}

export interface EnsurePiExtensionsInput {
  readonly cacheAgentDir: string;
  /** Home used to expand `~/`; injected rather than read globally so isolated runs stay isolated. */
  readonly homeDirectory?: string;
  /** When true, missing extensions are never installed — they warn and are dropped. */
  readonly offline: boolean;
  /** Show the underlying pi/git/npm installer output. Normal startup keeps it behind loading UI. */
  readonly debug?: boolean;
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
  /** Exact semver to verify against a cached npm install; undefined for ranges and tags. */
  readonly pinnedVersion?: string;
  /** The `@ref` of a git specifier, to verify against a cached checkout; undefined when unpinned. */
  readonly pinnedGitRef?: string;
}

const exactSemverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const fullShaPattern = /^[0-9a-f]{40}$/iu;

// Specifier text becomes filesystem path segments (and the stale-reinstall path runs `rm -rf` on
// the joined result), so a segment that traverses (`..`, `.`) or smuggles a separator (`\`, which
// `join` does not split but Windows resolves) must be rejected before any path is built.
const unsafePathSegment = (segment: string): boolean => segment === '.' || segment === '..' || segment.includes('\\');

const mapGitSpecifier = (specifier: string): PiExtensionSource | { readonly unsupported: string } => {
  const rest = specifier.slice('git:'.length);
  const pathPart = rest.includes('@') ? rest.slice(0, rest.lastIndexOf('@')) : rest;
  const ref = rest.includes('@') ? rest.slice(rest.lastIndexOf('@') + 1) : '';
  const segments = pathPart.split('/').filter((part) => part !== '');
  if (segments.length < 2) return { unsupported: `extension '${specifier}' is not a valid git source` };
  if (segments.some(unsafePathSegment)) {
    return { unsupported: `extension '${specifier}' contains an unsafe path segment` };
  }
  return {
    source: specifier,
    installSegments: ['git', ...segments],
    pinnedGitRef: ref === '' ? undefined : ref,
  };
};

/** Translates an Outfitter extension specifier to a pi `install` source + its cache install path. */
export const mapSpecifierToPiSource = (specifier: string): PiExtensionSource | { readonly unsupported: string } => {
  if (specifier.startsWith('npm:')) {
    const rest = specifier.slice('npm:'.length);
    const name = rest.replace(/@[^@/]+$/u, ''); // strip a trailing @version, keep a scope's leading @
    if (name === '') return { unsupported: `extension '${specifier}' has no package name` };
    if (name.split('/').some(unsafePathSegment)) {
      return { unsupported: `extension '${specifier}' contains an unsafe path segment` };
    }
    const version = rest.length > name.length ? rest.slice(name.length + 1) : undefined;
    return {
      source: specifier,
      installSegments: ['npm', 'node_modules', name],
      pinnedVersion: version !== undefined && exactSemverPattern.test(version) ? version : undefined,
    };
  }

  if (specifier.startsWith('git:')) return mapGitSpecifier(specifier);

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

/**
 * Defense in depth behind segment validation: refuses an install dir that resolves outside the
 * cache root before any filesystem access (the stale-git path runs `rm -rf` on the install dir).
 * Strict containment also keeps the `<installDir>.outfitter-ref.json` marker sibling inside the
 * cache, since a contained install dir is at least one level below the root. Exported for tests;
 * segment validation in mapSpecifierToPiSource should make this unreachable.
 */
export const assertInstallDirInsideCache = (installDir: string, cacheAgentDir: string, specifier: string): void => {
  const root = resolve(cacheAgentDir);
  if (!resolve(installDir).startsWith(root + sep)) {
    throw new Error(`extension '${specifier}' resolves outside the extension cache; refusing to touch it.`);
  }
};

/** Marker recording which git ref an install satisfied, kept beside (never inside) the checkout. */
const refMarkerPath = (installDir: string): string => `${installDir}.outfitter-ref.json`;

const cachedGitHead = (installDir: string): string | undefined => {
  try {
    return runGit(['-C', installDir, 'rev-parse', 'HEAD']);
  } catch {
    return undefined;
  }
};

const recordedInstallRef = (installDir: string): string | undefined => {
  try {
    const marker = JSON.parse(readFileSync(refMarkerPath(installDir), 'utf8')) as { readonly ref?: string };
    return marker.ref;
  } catch {
    return undefined;
  }
};

/** After installing a branch/tag-pinned git extension, records the ref (and resolved SHA). */
const recordInstalledGitRef = (installDir: string, mapped: PiExtensionSource): void => {
  if (mapped.pinnedGitRef === undefined || fullShaPattern.test(mapped.pinnedGitRef)) return;
  const marker = { ref: mapped.pinnedGitRef, headSha: cachedGitHead(installDir) };
  writeFileSync(refMarkerPath(installDir), JSON.stringify(marker));
};

// Remove-then-install for a stale git pin: `pi install` owns the directory layout, so
// GitRepository's atomic fetch-and-swap cannot apply here. A failure between the remove and the
// install leaves neither a directory nor a marker, which the next run detects as plain missing.
// The npm path keeps its original behavior: `pi install` is spawned over the existing dir.
const removeStaleGitInstall = (installDir: string, mapped: PiExtensionSource): void => {
  if (mapped.pinnedGitRef === undefined) return;
  rmSync(installDir, { recursive: true, force: true });
  rmSync(refMarkerPath(installDir), { force: true });
};

interface GitCacheStatus {
  readonly state: 'fresh' | 'stale' | 'unverified';
  /** What the cache actually holds, for the stale warning: the HEAD SHA or the recorded ref. */
  readonly found: string;
}

/** Compares a cached checkout against its `@ref` pin per the policy in the file header. */
const gitCacheStatus = (installDir: string, ref: string): GitCacheStatus => {
  if (fullShaPattern.test(ref)) {
    const head = cachedGitHead(installDir);
    return {
      state: head?.toLowerCase() === ref.toLowerCase() ? 'fresh' : 'stale',
      found: head ?? 'no readable git HEAD',
    };
  }
  const recorded = recordedInstallRef(installDir);
  if (recorded === undefined) return { state: 'unverified', found: 'no recorded install ref' };
  return { state: recorded === ref ? 'fresh' : 'stale', found: recorded };
};

type CacheDecision = { readonly serve: true } | { readonly serve: false; readonly staleWarning?: string };

/** Decides whether an existing install satisfies the specifier's pin (git ref or exact semver). */
const evaluateCachedInstall = (installDir: string, mapped: PiExtensionSource, offline: boolean): CacheDecision => {
  if (!existsSync(installDir)) return { serve: false };
  if (mapped.pinnedGitRef === undefined) {
    return { serve: mapped.pinnedVersion === undefined || installedVersion(installDir) === mapped.pinnedVersion };
  }
  const status = gitCacheStatus(installDir, mapped.pinnedGitRef);
  if (status.state === 'fresh' || (status.state === 'unverified' && offline)) return { serve: true };
  if (offline) {
    return {
      serve: false,
      staleWarning:
        `extension '${mapped.source}' is cached at the wrong revision ` +
        `(pinned ${mapped.pinnedGitRef}, found ${status.found}) and cannot be reinstalled offline.`,
    };
  }
  return { serve: false };
};

/* v8 ignore start -- real `pi install` subprocess; ensurePiExtensions is unit-tested with a fake spawner. */
const quietSpawnLauncher = createSpawnLauncher('ignore');
const defaultSpawner: PiInstallSpawner = ({ source, cacheAgentDir, debug }) =>
  launchThroughSpawn(debug === true ? spawnLauncher : quietSpawnLauncher, {
    command: 'pi',
    args: ['install', source],
    env: { PI_CODING_AGENT_DIR: cacheAgentDir, GIT_TERMINAL_PROMPT: '0' },
  });
/* v8 ignore stop */

type SpecifierOutcome = { readonly loadDir: string } | { readonly warning: string };

const isRelativeLocalPath = (specifier: string): boolean => specifier.startsWith('./') || specifier.startsWith('../');

const resolveLocalExtension = (
  reference: PiExtensionReference,
  input: EnsurePiExtensionsInput,
): SpecifierOutcome | undefined => {
  const { specifier } = reference;
  let localPath: string | undefined;
  if (isAbsolute(specifier)) {
    localPath = resolve(specifier);
  } else if (specifier.startsWith('~/')) {
    if (input.homeDirectory === undefined) {
      return { warning: `extension '${specifier}' cannot expand '~/' without a home directory.` };
    }
    localPath = resolve(input.homeDirectory, specifier.slice(2));
  } else if (isRelativeLocalPath(specifier)) {
    if (reference.declaringRoot === undefined) {
      return { warning: `extension '${specifier}' has no declaring .agents directory.` };
    }
    localPath = resolve(reference.declaringRoot, specifier);
  }

  if (localPath === undefined) return undefined;
  return existsSync(localPath)
    ? { loadDir: localPath }
    : { warning: `extension '${specifier}' resolves to missing local path '${localPath}'.` };
};

/** Resolves one specifier to a local or cached load directory, installing remote sources as needed. */
const ensureOneExtension = async (
  reference: PiExtensionReference,
  input: EnsurePiExtensionsInput,
  spawn: PiInstallSpawner,
): Promise<SpecifierOutcome> => {
  const local = resolveLocalExtension(reference, input);
  if (local !== undefined) return local;

  const { specifier } = reference;
  const mapped = mapSpecifierToPiSource(specifier);
  if ('unsupported' in mapped) return { warning: mapped.unsupported };

  const installDir = join(input.cacheAgentDir, ...mapped.installSegments);
  assertInstallDirInsideCache(installDir, input.cacheAgentDir, specifier);
  const decision = evaluateCachedInstall(installDir, mapped, input.offline);
  if (decision.serve) return { loadDir: installDir };
  if (decision.staleWarning !== undefined) return { warning: decision.staleWarning };

  if (input.offline) return { warning: `extension '${specifier}' is not cached and cannot be installed offline.` };

  removeStaleGitInstall(installDir, mapped);
  mkdirSync(input.cacheAgentDir, { recursive: true });
  try {
    const exitCode = await spawn({ source: mapped.source, cacheAgentDir: input.cacheAgentDir, debug: input.debug });
    if (exitCode !== 0 || !existsSync(installDir)) {
      return { warning: `extension '${specifier}' failed to install (pi install exited ${exitCode}).` };
    }
  } catch (error) {
    return { warning: `extension '${specifier}' failed to install (${String(error)}).` };
  }

  recordInstalledGitRef(installDir, mapped);
  return { loadDir: installDir };
};

/** Ensures each pi extension is cached (installing when online) and returns its load directory. */
export const ensurePiExtensions = async (
  specifiers: readonly (string | PiExtensionReference)[],
  input: EnsurePiExtensionsInput,
): Promise<EnsurePiExtensionsResult> => {
  const spawn = input.spawn ?? defaultSpawner;
  const loadDirs: string[] = [];
  const warnings: string[] = [];

  for (const item of specifiers) {
    const reference = typeof item === 'string' ? { specifier: item } : item;
    const outcome = await ensureOneExtension(reference, input, spawn);
    if ('loadDir' in outcome) {
      if (!loadDirs.includes(outcome.loadDir)) loadDirs.push(outcome.loadDir);
    } else {
      warnings.push(outcome.warning);
    }
  }

  return { loadDirs, warnings };
};
