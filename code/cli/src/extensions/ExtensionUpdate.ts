// Updates the cached pi extensions behind `outfitter update extensions`: an explicit, entry-scoped
// mutation pass over the extension cache. Discovery runs through the read-only `buildExtensionReport`
// in offline mode (cache state only, zero lookups), then each entry is decided independently:
//   npm: an exact recorded range is a deliberate pin (npm caret-izes every other saved spec, so the
//        recorded range is a resolution record, not the user's declared contract) and is skipped;
//        every other entry reinstalls at the registry's `latest` dist-tag when strictly newer — the
//        same `npmLatest`/`isGreaterSemver` comparison the report uses — through the cache's own
//        install path as an exact version (`pi install npm:<name>@<latest>`), followed by peer
//        satisfaction via the existing PiExtensionPeers flow.
//   git: full-SHA pins and refs that resolve locally as tags are never moved; branch-pinned and
//        unpinned checkouts compare HEAD against the remote tip through the report's
//        `GitRemoteTipResolver` and fast-forward with `git fetch origin <ref>` +
//        `git merge --ff-only FETCH_HEAD`, after which the install marker's recorded HEAD is
//        refreshed through `recordInstalledGitRef` (a no-op without a pinned ref).
// Every entry is a transaction: lookups happen before any mutation, a failed lookup/install/fetch
// leaves that entry's cache state untouched and is reported per entry without blocking others, and
// loadout files and settings are never read or written. `--dry-run` (engine input `dryRun`) performs
// the read-only lookups and reports `would-update` targets without mutating; offline runs skip every
// lookup and report `offline` per entry.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runGit } from '../sources/GitRepository.js';
import { buildExtensionReport, isGreaterSemver } from './ExtensionReport.js';
import type { ExtensionReportEntry, GitRemoteTipResolver } from './ExtensionReport.js';
import {
  defaultNpmLatest,
  defaultPiInstallSpawner,
  exactSemverPattern,
  mapSpecifierToPiSource,
  recordInstalledGitRef,
} from './PiExtensionCache.js';
import type { NpmLatestResolver, PiInstallSpawner } from './PiExtensionCache.js';
import { ensurePeerDependencies } from './PiExtensionPeers.js';
import type { PiPeerSpawner } from './PiExtensionPeers.js';

export type ExtensionUpdateStatus = 'updated' | 'up-to-date' | 'would-update' | 'skipped' | 'failed' | 'offline';

export interface ExtensionUpdateEntry {
  /** Reconstructed loadout specifier, identical to the report's entry specifier. */
  readonly specifier: string;
  readonly source: string;
  readonly kind: 'npm' | 'git';
  /** The version (npm) or short checkout HEAD (git) before the update, when readable. */
  readonly from?: string;
  /** The version (npm) or short HEAD/tip (git) after the update, when known. */
  readonly to?: string;
  readonly status: ExtensionUpdateStatus;
  /** Detail for the status: the update target, the pin reason, or the failure reason. */
  readonly statusDetail?: string;
}

export interface ExtensionUpdateResult {
  /** One entry per cached extension, in the report's deterministic order. */
  readonly updates: readonly ExtensionUpdateEntry[];
  /** One message per non-fatal problem (failed peer installs after a successful reinstall). */
  readonly warnings: readonly string[];
}

export interface ExtensionUpdateInput {
  /** Absolute cache agent dir (the `pi-extensions` directory under Outfitter's XDG cache). */
  readonly cacheAgentDir: string;
  /** Perform the read-only lookups and report targets, but never mutate the cache. */
  readonly dryRun?: boolean;
  /** Skip every upstream lookup, mutate nothing, and report each entry `offline`. */
  readonly offline?: boolean;
  /** Answers the registry's current release for a package; injectable so tests avoid the network. */
  readonly npmLatest?: NpmLatestResolver;
  /** Answers the remote tip SHA of a ref (undefined ref = default branch); injectable in tests. */
  readonly gitRemoteTip?: GitRemoteTipResolver;
  /** Spawns `pi install <source>` against the cache agent dir; injectable so tests avoid the network. */
  readonly spawn?: PiInstallSpawner;
  /** Installs one unmet peer dependency of a reinstalled npm package; injectable in tests. */
  readonly peerSpawn?: PiPeerSpawner;
  /** Fast-forwards one git checkout to a ref's remote tip; injectable so tests use local repos. */
  readonly fastForward?: GitFastForwarder;
}

/** Fast-forwards one checkout to the remote tip of `ref`; throwing fails that entry untouched. */
export type GitFastForwarder = (installDir: string, ref: string) => void;

const shortSha = (sha: string): string => sha.slice(0, 7);

const runGitQuiet = (arguments_: readonly string[]): string | undefined => {
  try {
    return runGit([...arguments_]);
  } catch {
    return undefined;
  }
};

const sameSha = (left: string | undefined, right: string | undefined): boolean =>
  left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();

/** Reads the installed npm version from a package manifest; unreadable means unknown. */
const readManifestVersion = (installDir: string): string | undefined => {
  try {
    const manifest = JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
};

const gitHead = (installDir: string): string | undefined => runGitQuiet(['-C', installDir, 'rev-parse', 'HEAD']);

const gitOriginUrl = (installDir: string): string | undefined =>
  runGitQuiet(['-C', installDir, 'remote', 'get-url', 'origin']);

const gitCurrentBranch = (installDir: string): string | undefined =>
  runGitQuiet(['-C', installDir, 'symbolic-ref', '--short', 'HEAD']);

/** True when the ref resolves locally as a tag (tags are deliberate pins and are never moved). */
const isLocalTag = (installDir: string, ref: string): boolean =>
  runGitQuiet(['-C', installDir, 'cat-file', '-t', `refs/tags/${ref}`]) !== undefined;

const updateEntry = (
  entry: ExtensionReportEntry,
  from: string | undefined,
  to: string | undefined,
  status: ExtensionUpdateStatus,
  statusDetail?: string,
): ExtensionUpdateEntry => ({
  specifier: entry.specifier,
  source: entry.source,
  kind: entry.kind,
  ...(from === undefined ? {} : { from }),
  ...(to === undefined ? {} : { to }),
  status,
  ...(statusDetail === undefined ? {} : { statusDetail }),
});

const failed = (entry: ExtensionReportEntry, from: string | undefined, reason: string): ExtensionUpdateEntry =>
  updateEntry(entry, from, undefined, 'failed', reason);

/* v8 ignore start -- real git fetch/merge and npm/pi subprocesses; updateExtensions is unit-tested
   with injected seams and local fixture repositories. */

/** The default tip resolver: the same read-only `git ls-remote` the report uses. */
const defaultGitRemoteTip: GitRemoteTipResolver = (originUrl, ref) => {
  const output = runGitQuiet(['ls-remote', originUrl, ref ?? 'HEAD']);
  if (output === undefined) return undefined;
  const sha = output.split('\n')[0].split('\t')[0].trim();
  return sha === '' ? undefined : sha;
};

/**
 * The default fast-forward: fetch the ref's remote tip first (the only step that can fail after the
 * tip lookup, leaving the checkout untouched), then merge with `--ff-only`, which refuses a diverged
 * checkout instead of resetting it.
 */
const defaultGitFastForward: GitFastForwarder = (installDir, ref) => {
  runGit(['-C', installDir, 'fetch', 'origin', ref]);
  try {
    runGit(['-C', installDir, 'merge', '--ff-only', 'FETCH_HEAD']);
  } catch {
    throw new Error('not fast-forwardable');
  }
};
/* v8 ignore stop */

const updateNpmEntry = async (
  entry: ExtensionReportEntry,
  input: ExtensionUpdateInput,
  npmLatest: NpmLatestResolver,
  spawn: PiInstallSpawner,
): Promise<{ readonly entry: ExtensionUpdateEntry; readonly warnings: readonly string[] }> => {
  const from = entry.resolvedVersion;
  if (from === undefined) return { entry: failed(entry, from, 'unreadable install'), warnings: [] };
  // An exact recorded range is a deliberate pin (upgrading it is the user's loadout re-specify);
  // every other recorded entry is npm's caret-of-resolved bookkeeping, not a contract.
  if (entry.requestedRange !== undefined && exactSemverPattern.test(entry.requestedRange)) {
    return { entry: updateEntry(entry, from, undefined, 'skipped', 'pinned'), warnings: [] };
  }
  if (input.offline === true) return { entry: updateEntry(entry, from, undefined, 'offline'), warnings: [] };
  const latest = npmLatest(entry.source);
  if (latest === undefined) return { entry: failed(entry, from, 'lookup failed'), warnings: [] };
  if (!isGreaterSemver(latest, from)) return { entry: updateEntry(entry, from, undefined, 'up-to-date'), warnings: [] };
  if (input.dryRun === true) {
    return { entry: updateEntry(entry, from, latest, 'would-update', `to ${latest}`), warnings: [] };
  }
  return reinstallNpmExtension(entry, from, latest, input, spawn);
};

/**
 * Runs the reinstall for one outdated npm entry: an exact-version install through the cache's own
 * spawner, the new version read back from the installed manifest, and peer satisfaction afterwards.
 */
const reinstallNpmExtension = async (
  entry: ExtensionReportEntry,
  from: string,
  latest: string,
  input: ExtensionUpdateInput,
  spawn: PiInstallSpawner,
): Promise<{ readonly entry: ExtensionUpdateEntry; readonly warnings: readonly string[] }> => {
  let exitCode: number;
  try {
    exitCode = await spawn({ source: `npm:${entry.source}@${latest}`, cacheAgentDir: input.cacheAgentDir });
  } catch (error) {
    return { entry: failed(entry, from, `install failed (${String(error)})`), warnings: [] };
  }
  if (exitCode !== 0 || !existsSync(entry.installPath)) {
    return { entry: failed(entry, from, `install failed (pi install exited ${exitCode})`), warnings: [] };
  }
  const to = readManifestVersion(entry.installPath);
  if (to === undefined) return { entry: failed(entry, from, 'unreadable install post-update'), warnings: [] };
  const peerWarnings = await ensurePeerDependencies({
    specifier: entry.specifier,
    installDir: entry.installPath,
    npmRoot: join(input.cacheAgentDir, 'npm'),
    offline: false,
    peerSpawn: input.peerSpawn,
  });
  return { entry: updateEntry(entry, from, to, 'updated'), warnings: peerWarnings };
};

const updateGitEntry = (
  entry: ExtensionReportEntry,
  input: ExtensionUpdateInput,
  gitRemoteTip: GitRemoteTipResolver,
  fastForward: GitFastForwarder,
): ExtensionUpdateEntry => {
  const frozen = gitFrozenDecision(entry, input);
  if (frozen !== undefined) return frozen;
  const from = shortSha(entry.headSha ?? '');
  return gitUpdateOutcome(entry, from, input, gitRemoteTip, fastForward);
};

/** Classifies the git entries that are decided without any upstream consult. */
const gitFrozenDecision = (
  entry: ExtensionReportEntry,
  input: ExtensionUpdateInput,
): ExtensionUpdateEntry | undefined => {
  const from = entry.headSha === undefined ? undefined : shortSha(entry.headSha);
  // A markerless checkout whose HEAD is detached is a full-SHA pin — frozen by the cache policy.
  if (entry.status === 'pinned') return updateEntry(entry, from, undefined, 'skipped', 'pinned');
  if (entry.headSha === undefined) return failed(entry, from, 'unreadable install');
  if (input.offline === true) return updateEntry(entry, from, undefined, 'offline');
  // A pinned ref that resolves locally as a tag is a deliberate pin, not a moving branch.
  if (entry.pinnedRef !== undefined && isLocalTag(entry.installPath, entry.pinnedRef)) {
    return updateEntry(entry, from, undefined, 'skipped', 'pinned');
  }
  return undefined;
};

/** Resolves the tip, then either reports the outcome or fast-forwards the checkout. */
const gitUpdateOutcome = (
  entry: ExtensionReportEntry,
  from: string,
  input: ExtensionUpdateInput,
  gitRemoteTip: GitRemoteTipResolver,
  fastForward: GitFastForwarder,
): ExtensionUpdateEntry => {
  const originUrl = gitOriginUrl(entry.installPath);
  if (originUrl === undefined) return failed(entry, from, 'no readable origin');
  const tip = gitRemoteTip(originUrl, entry.pinnedRef);
  if (tip === undefined) return failed(entry, from, 'lookup failed');
  if (sameSha(tip, entry.headSha)) return updateEntry(entry, from, undefined, 'up-to-date');
  if (input.dryRun === true) return updateEntry(entry, from, shortSha(tip), 'would-update', `to ${shortSha(tip)}`);
  const failure = fastForwardOrFailure(entry, gitCurrentBranch, fastForward);
  if (failure !== undefined) return failed(entry, from, failure);
  refreshGitMarker(entry);
  /* v8 ignore next -- defensive: a completed fast-forward implies a readable git HEAD; the tip
     fallback only exists so the reported target is never undefined. */
  return updateEntry(entry, from, shortSha(gitHead(entry.installPath) ?? tip), 'updated');
};

/** Runs one fast-forward and returns the failure reason, or undefined on success. */
const fastForwardOrFailure = (
  entry: ExtensionReportEntry,
  readBranch: (installDir: string) => string | undefined,
  fastForward: GitFastForwarder,
): string | undefined => {
  const ref = entry.pinnedRef ?? readBranch(entry.installPath);
  /* v8 ignore next -- defensive: an unpinned checkout reaches here only with an attached HEAD, so
     the branch probe cannot fail (a detached markerless checkout is classified as a pinned one). */
  if (ref === undefined) return 'unreadable install';
  try {
    fastForward(entry.installPath, ref);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
};

/** Refreshes the marker's recorded HEAD through the cache's own marker writer; a no-op without a
 * pinned ref, so unpinned checkouts stay unpinned. */
const refreshGitMarker = (entry: ExtensionReportEntry): void => {
  const mapped = mapSpecifierToPiSource(entry.specifier);
  if ('source' in mapped) recordInstalledGitRef(entry.installPath, mapped);
};

/** Updates each cached pi extension that is not deliberately pinned, one entry-scoped transaction at a time. */
export const updateExtensions = async (input: ExtensionUpdateInput): Promise<ExtensionUpdateResult> => {
  const report = buildExtensionReport({ cacheAgentDir: input.cacheAgentDir, offline: true });
  /* v8 ignore next -- the real npm resolver is the production default; tests inject fakes and must
     not touch the network, so the fallback itself is never exercised under coverage. */
  const npmLatest = input.npmLatest ?? defaultNpmLatest;
  const gitRemoteTip = input.gitRemoteTip ?? defaultGitRemoteTip;
  const fastForward = input.fastForward ?? defaultGitFastForward;
  const spawn = input.spawn ?? defaultPiInstallSpawner;
  const updates: ExtensionUpdateEntry[] = [];
  const warnings: string[] = [];
  for (const reportEntry of report.entries) {
    if (reportEntry.kind === 'npm') {
      const outcome = await updateNpmEntry(reportEntry, input, npmLatest, spawn);
      updates.push(outcome.entry);
      warnings.push(...outcome.warnings);
    } else {
      updates.push(updateGitEntry(reportEntry, input, gitRemoteTip, fastForward));
    }
  }
  return { updates, warnings };
};
