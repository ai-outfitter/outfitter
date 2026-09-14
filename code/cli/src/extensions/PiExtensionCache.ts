// Installs an agent's pi `extensions` loadout into a durable Outfitter cache and returns the local
// install directories so the pi launch can load them with `--extension <dir>` (offline, no reinstall
// per run), plus the npm manifest entry files the materialized settings.json must carry so fresh
// loaders (pi-subagents child sessions, SDK sessions) inherit the same extensions. pi's own layout
// under PI_CODING_AGENT_DIR dedups sources across agents:
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
//
// Two cache-integrity policies apply to npm extensions on top of the install/serve decision:
//   - Peer dependencies: pi deliberately installs extension packages without their peers, but fresh
//     loaders resolve the entry file's imports from the cache, so before an npm extension is served
//     its non-optional peers are checked for presence and missing ones install into the cache npm
//     root with npm (online only; see PiExtensionPeers). A satisfied cache hit does no network.
//   - Version freshness: a bare `npm:<name>` specifier resolves the registry's current release at
//     install time and installs that exact version, so a fresh install cannot inherit a range or
//     lockfile resolution saved by an earlier install (a `^0.0.x` caret is a hard pin that would
//     fossilize the package); a range-carrying specifier installs as declared but warns when the
//     registry's current release falls outside it. Serve decisions always map the original
//     specifier, so resolution never turns into a pin that fights the cache check.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';

import { createSpawnLauncher, launchThroughSpawn, spawnLauncher } from '../agents/AgentLaunch.js';
import { runGit } from '../sources/GitRepository.js';
import { ensurePeerDependencies } from './PiExtensionPeers.js';
import type { PiPeerSpawner } from './PiExtensionPeers.js';

/** Spawns `pi install <source>` against the cache agent dir; injectable so tests avoid the network. */
export type PiInstallSpawner = (input: {
  readonly source: string;
  readonly cacheAgentDir: string;
  readonly debug?: boolean;
}) => Promise<number>;

export interface EnsurePiExtensionsInput {
  readonly cacheAgentDir: string;
  /** When true, missing extensions are never installed — they warn and are dropped. */
  readonly offline: boolean;
  /** Show the underlying pi/git/npm installer output. Normal startup keeps it behind loading UI. */
  readonly debug?: boolean;
  readonly spawn?: PiInstallSpawner;
  /** Installs one unmet peer dependency of a cached npm package; injectable so tests avoid the network. */
  readonly peerSpawn?: PiPeerSpawner;
  /** Answers the registry's current release for a bare npm specifier; injectable so tests avoid the network. */
  readonly npmLatest?: NpmLatestResolver;
  /** Answers the versions satisfying a specifier range and the registry's current release; injectable in tests. */
  readonly npmRangeVersions?: NpmRangeVersionsResolver;
}

export type NpmLatestResolver = (name: string) => string | undefined;

export type NpmRangeVersionsResolver = (
  name: string,
  range: string,
) => { readonly satisfying?: readonly string[]; readonly latest?: string } | undefined;

export interface EnsurePiExtensionsResult {
  /** Absolute install directories to pass as `--extension`, in specifier order, de-duplicated. */
  readonly loadDirs: readonly string[];
  /**
   * Pi entry-file paths each cached npm extension exposes for the materialized `settings.json`
   * `extensions:` array (the surface fresh loaders such as pi-subagents child sessions read),
   * keyed by load dir and in specifier order. npm extensions only — git checkouts are not keyed.
   */
  readonly settingsEntries: Readonly<Record<string, readonly string[]>>;
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

/* v8 ignore start -- real `pi install` subprocess and registry queries; ensurePiExtensions is
   unit-tested with fake spawners and injected resolvers. */
const quietSpawnLauncher = createSpawnLauncher('ignore');
const defaultSpawner: PiInstallSpawner = ({ source, cacheAgentDir, debug }) =>
  launchThroughSpawn(debug === true ? spawnLauncher : quietSpawnLauncher, {
    command: 'pi',
    args: ['install', source],
    env: { PI_CODING_AGENT_DIR: cacheAgentDir, GIT_TERMINAL_PROMPT: '0' },
  });

const npmView = (arguments_: readonly string[]): string | undefined => {
  const result = spawnSync('npm', [...arguments_], { encoding: 'utf8' });
  return result.status === 0 && typeof result.stdout === 'string' ? result.stdout.trim() : undefined;
};

export const defaultNpmLatest: NpmLatestResolver = (name) => {
  const version = npmView(['view', name, 'version']);
  return version !== undefined && exactSemverPattern.test(version) ? version : undefined;
};

export const defaultNpmRangeVersions: NpmRangeVersionsResolver = (name, range) => {
  const satisfyingRaw = npmView(['view', `${name}@${range}`, 'version', '--json']);
  const latest = npmView(['view', name, 'version']);
  if (satisfyingRaw === undefined || latest === undefined || !exactSemverPattern.test(latest)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(satisfyingRaw);
  } catch {
    return undefined;
  }
  const satisfying = Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === 'string')
    : typeof parsed === 'string'
      ? [parsed]
      : [];
  return satisfying.length === 0 ? undefined : { satisfying, latest };
};
/* v8 ignore stop */

type SpecifierOutcome =
  | {
      readonly loadDir: string;
      /** Resolved npm entry files; undefined for git checkouts, which gain no settings entries. */
      readonly settingsEntries?: readonly string[];
      readonly warnings: readonly string[];
    }
  | { readonly warning: string };

/** Reads a cached package's `pi` manifest section; unreadable manifests behave like no manifest. */
const readPiManifest = (installDir: string): { extensions?: unknown } | undefined => {
  try {
    const parsed = JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')) as {
      pi?: { extensions?: unknown };
    };
    return parsed.pi;
  } catch {
    return undefined;
  }
};

/** Collects the manifest-declared entry files that exist on disk, dropping escaping ones with a warning. */
const collectDeclaredEntries = (
  specifier: string,
  installDir: string,
  declared: readonly unknown[],
  warnings: string[],
): readonly string[] => {
  const entries: string[] = [];
  const installRoot = resolve(installDir);
  for (const entry of declared) {
    if (typeof entry !== 'string') continue;
    const resolved = resolve(installDir, entry);
    if (!resolved.startsWith(installRoot + sep)) {
      warnings.push(
        `extension '${specifier}' declares an entry resolving outside the install directory; it will not be inherited by fresh loaders.`,
      );
      continue;
    }
    if (existsSync(resolved)) entries.push(resolved);
  }
  return entries;
};

/**
 * Resolves the pi entry files a cached npm package exposes, mirroring pi's own directory contract
 * (`resolveExtensionEntries`): the manifest's `pi.extensions` files that exist on disk in manifest
 * order, else the directory's `index.ts`/`index.js`. Reading only the manifest already written in
 * the cache keeps this offline. Entries resolving outside the install directory are dropped with a
 * warning — a hostile manifest must not steer generated settings outside the cache — and a package
 * exposing nothing resolvable warns because fresh loaders would inherit no tools at all.
 */
const resolveNpmSettingsEntries = (
  specifier: string,
  installDir: string,
): { readonly entries: readonly string[]; readonly warnings: readonly string[] } => {
  const warnings: string[] = [];
  let entries: readonly string[] = [];
  const declared = readPiManifest(installDir)?.extensions;
  if (Array.isArray(declared)) entries = collectDeclaredEntries(specifier, installDir, declared, warnings);
  if (entries.length === 0) {
    const indexEntries: string[] = [];
    for (const indexEntry of ['index.ts', 'index.js']) {
      const resolved = join(installDir, indexEntry);
      if (existsSync(resolved)) {
        indexEntries.push(resolved);
        break;
      }
    }
    entries = indexEntries;
  }
  if (entries.length === 0) {
    warnings.push(
      `extension '${specifier}' exposes no resolvable entry files; fresh loaders (child sessions) will not inherit it.`,
    );
  }
  return { entries, warnings };
};

/** Builds the served outcome for one specifier; npm installs additionally resolve their entry files. */
const servedOutcome = async (
  specifier: string,
  mapped: PiExtensionSource,
  installDir: string,
  input: EnsurePiExtensionsInput,
): Promise<SpecifierOutcome> => {
  if (mapped.installSegments[0] !== 'npm') return { loadDir: installDir, warnings: [] };
  const peerWarnings = await ensurePeerDependencies({
    specifier,
    installDir,
    npmRoot: join(input.cacheAgentDir, 'npm'),
    offline: input.offline,
    debug: input.debug,
    peerSpawn: input.peerSpawn,
  });
  const { entries, warnings } = resolveNpmSettingsEntries(specifier, installDir);
  return {
    loadDir: installDir,
    settingsEntries: entries,
    warnings: [...peerWarnings, ...warnings],
  };
};

/** Extracts the specifier's version part (exact, range, or dist-tag); undefined for a bare specifier. */
const npmSpecifierVersion = (specifier: string, name: string): string | undefined => {
  const rest = specifier.slice('npm:'.length);
  if (rest.length <= name.length) return undefined;
  const version = rest.slice(name.length + 1);
  return version === '' ? undefined : version;
};

/**
 * Decides which source the install spawn receives for an npm specifier. A bare specifier resolves the
 * registry's current release and installs that exact version, so a fresh install cannot inherit a
 * range or lockfile resolution recorded in the cache (the `^0.0.x` fossilization mechanism) — serve
 * decisions keep mapping the original specifier, so the exact version never becomes a pin that
 * fights the cache check. Range-carrying specifiers install unchanged but first run a best-effort
 * fossilization check: a current release outside the range warns (the range can only ever resolve
 * older versions); any failed or ambiguous registry answer skips silently and never blocks installing.
 */
const resolveBareSpecifierSource = (
  specifier: string,
  name: string,
  input: EnsurePiExtensionsInput,
): { readonly source: string } => {
  const latest = (input.npmLatest ?? defaultNpmLatest)(name);
  return latest !== undefined && exactSemverPattern.test(latest)
    ? { source: `npm:${name}@${latest}` }
    : { source: specifier };
};

/**
 * Best-effort fossilization check for a range-carrying specifier: when the registry's current
 * release falls outside the range, the range can only ever resolve older versions. Any failed or
 * ambiguous registry answer stays silent so the check never blocks the install.
 */
const fossilizedRangeWarning = (
  specifier: string,
  name: string,
  range: string,
  input: EnsurePiExtensionsInput,
): string | undefined => {
  const answer = (input.npmRangeVersions ?? defaultNpmRangeVersions)(name, range);
  const { latest, satisfying } = answer ?? {};
  const listed = Array.isArray(satisfying) ? satisfying : undefined;
  if (latest === undefined || listed === undefined || listed.length === 0 || listed.includes(latest)) {
    return undefined;
  }
  return (
    `extension '${specifier}' is pinned to a range that no longer contains the registry's current release ` +
    `(${latest}); installs will keep resolving an older version until the declared range is updated.`
  );
};

const resolveNpmInstallSource = (
  specifier: string,
  mapped: PiExtensionSource,
  input: EnsurePiExtensionsInput,
): { readonly source: string; readonly fossilWarning?: string } => {
  const name = mapped.installSegments.slice(2).join('/');
  const version = npmSpecifierVersion(specifier, name);
  if (version === undefined) return resolveBareSpecifierSource(specifier, name, input);
  if (exactSemverPattern.test(version)) return { source: specifier };
  const fossilWarning = fossilizedRangeWarning(specifier, name, version, input);
  return fossilWarning === undefined ? { source: specifier } : { source: specifier, fossilWarning };
};
/** Spawns `pi install` for one source and returns the install-failure warning, or undefined on success. */
const spawnInstallOrWarning = async (
  specifier: string,
  installDir: string,
  source: string,
  input: EnsurePiExtensionsInput,
  spawn: PiInstallSpawner,
): Promise<string | undefined> => {
  try {
    const exitCode = await spawn({ source, cacheAgentDir: input.cacheAgentDir, debug: input.debug });
    if (exitCode !== 0 || !existsSync(installDir)) {
      return `extension '${specifier}' failed to install (pi install exited ${exitCode}).`;
    }
    return undefined;
  } catch (error) {
    return `extension '${specifier}' failed to install (${String(error)}).`;
  }
};

/**
 * Installs a missing (or stale-pinned) extension via the pi spawner and returns its served outcome,
 * or a warning. The npm install source may be rewritten to the resolved exact version (bare
 * specifiers) and carry a fossilization warning; peers and entry files resolve after the install.
 */
const installExtension = async (
  specifier: string,
  mapped: PiExtensionSource,
  installDir: string,
  input: EnsurePiExtensionsInput,
  spawn: PiInstallSpawner,
): Promise<SpecifierOutcome> => {
  if (input.offline) return { warning: `extension '${specifier}' is not cached and cannot be installed offline.` };

  removeStaleGitInstall(installDir, mapped);
  mkdirSync(input.cacheAgentDir, { recursive: true });
  const installSource =
    mapped.installSegments[0] === 'npm' ? resolveNpmInstallSource(specifier, mapped, input) : undefined;
  const failure = await spawnInstallOrWarning(
    specifier,
    installDir,
    installSource?.source ?? mapped.source,
    input,
    spawn,
  );
  if (failure !== undefined) return { warning: failure };

  recordInstalledGitRef(installDir, mapped);
  const served = await servedOutcome(specifier, mapped, installDir, input);
  const fossilWarning = installSource?.fossilWarning;
  if (fossilWarning === undefined || !('loadDir' in served)) return served;
  return {
    loadDir: served.loadDir,
    settingsEntries: served.settingsEntries,
    warnings: [fossilWarning, ...served.warnings],
  };
};

/** Resolves one specifier to a cached load directory, installing it when online and missing. */
const ensureOneExtension = async (
  specifier: string,
  input: EnsurePiExtensionsInput,
  spawn: PiInstallSpawner,
): Promise<SpecifierOutcome> => {
  const mapped = mapSpecifierToPiSource(specifier);
  if ('unsupported' in mapped) return { warning: mapped.unsupported };

  const installDir = join(input.cacheAgentDir, ...mapped.installSegments);
  assertInstallDirInsideCache(installDir, input.cacheAgentDir, specifier);

  const decision = evaluateCachedInstall(installDir, mapped, input.offline);
  if (decision.serve) return servedOutcome(specifier, mapped, installDir, input);
  if (decision.staleWarning !== undefined) return { warning: decision.staleWarning };
  return installExtension(specifier, mapped, installDir, input, spawn);
};

/** Ensures each pi extension is cached (installing when online) and returns its load directory. */
export const ensurePiExtensions = async (
  specifiers: readonly string[],
  input: EnsurePiExtensionsInput,
): Promise<EnsurePiExtensionsResult> => {
  const spawn = input.spawn ?? defaultSpawner;
  const loadDirs: string[] = [];
  const settingsEntries: Record<string, readonly string[]> = {};
  const warnings: string[] = [];

  for (const specifier of specifiers) {
    const outcome = await ensureOneExtension(specifier, input, spawn);
    if ('loadDir' in outcome) {
      // A repeated install dir (e.g. a pinned and an unpinned specifier for one package) resolves
      // identically, so its entries and warnings are recorded once, with the first occurrence.
      if (!loadDirs.includes(outcome.loadDir)) {
        loadDirs.push(outcome.loadDir);
        if (outcome.settingsEntries !== undefined) settingsEntries[outcome.loadDir] = outcome.settingsEntries;
        warnings.push(...outcome.warnings);
      }
    } else {
      warnings.push(outcome.warning);
    }
  }

  return { loadDirs, settingsEntries, warnings };
};
