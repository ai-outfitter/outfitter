// Reports the cached pi extension packages behind `outfitter list extensions` as read-only cache
// state: npm extensions come from the cache npm project root's manifest (`dependencies` records the
// requested range per package) with resolved versions read from each installed package manifest;
// git checkouts are discovered by walking the cache git root, with the `.outfitter-ref.json`
// install marker recording branch/tag pins. A markerless checkout whose HEAD is detached was
// installed from a full-SHA pin (frozen — the cache never chases exact pins), while an attached
// HEAD means an unpinned clone; `git symbolic-ref HEAD` discriminates the two locally. Upstream
// status compares the cache state against read-only registry/git lookups that only run when
// online, degrading to `unknown` with a warning on failure. The status computation and comparison
// helpers are exported so the future cache update command reuses the same semantics.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultNpmLatest, type NpmLatestResolver } from './PiExtensionCache.js';
import { runGit } from '../sources/GitRepository.js';

export type ExtensionStatus = 'up-to-date' | 'update-available' | 'pinned' | 'unknown';

export interface ExtensionReportEntry {
  /** Reconstructed loadout specifier: `npm:<name>[@<range>]` or `git:<path>[@<ref>]`. */
  readonly specifier: string;
  /** The package name (npm) or repo path (git) without scheme. */
  readonly source: string;
  readonly kind: 'npm' | 'git';
  /** Absolute install directory inside the cache. */
  readonly installPath: string;
  /** Installed version read from the package manifest (npm). */
  readonly resolvedVersion?: string;
  /** The dependency entry the cache npm manifest records (npm). */
  readonly requestedRange?: string;
  /** Branch/tag pin recovered from the install marker (git). */
  readonly pinnedRef?: string;
  /** The checkout's HEAD SHA (git). */
  readonly headSha?: string;
  readonly status: ExtensionStatus;
  /** Status detail: latest version/tip, `at <sha>` for pins, or the unknown reason. */
  readonly statusDetail?: string;
}

export interface ExtensionReport {
  readonly entries: readonly ExtensionReportEntry[];
  /** One message per degraded entry (unreadable state or failed online lookup). */
  readonly warnings: readonly string[];
}

export interface ExtensionReportInput {
  /** Absolute cache agent dir (the `pi-extensions` directory under Outfitter's XDG cache). */
  readonly cacheAgentDir: string;
  /** Skip every upstream lookup; entries report `unknown (offline)` deterministically. */
  readonly offline?: boolean;
  /** Answers the registry's current release for a package; injectable so tests avoid the network. */
  readonly npmLatest?: NpmLatestResolver;
  /** Answers the remote tip SHA of a ref (undefined ref = default branch); injectable in tests. */
  readonly gitRemoteTip?: GitRemoteTipResolver;
}

export type GitRemoteTipResolver = (originUrl: string, ref?: string) => string | undefined;

const shortSha = (sha: string): string => sha.slice(0, 7);

const sameSha = (left: string | undefined, right: string | undefined): boolean =>
  left !== undefined && right !== undefined && left.toLowerCase() === right.toLowerCase();

interface SemverParts {
  readonly numbers: readonly [number, number, number];
  readonly pre: readonly string[];
}

// Registry answers and manifest versions are `major.minor.patch[-pre]`; anything else fails the
// parse and the comparison treats the unparseable side as incomparable (no update claim).
const parseSemver = (version: string | undefined): SemverParts | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(version ?? '');
  if (match === null) return undefined;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
};

const comparePrereleaseIdentifiers = (left: string, right: string): number => {
  const leftNumber = /^\d+$/u.test(left);
  const rightNumber = /^\d+$/u.test(right);
  if (leftNumber && rightNumber) return Math.sign(Number(left) - Number(right));
  if (leftNumber) return -1;
  if (rightNumber) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
};

const comparePrerelease = (left: readonly string[], right: readonly string[]): number => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (index >= left.length) return -1;
    if (index >= right.length) return 1;
    const order = comparePrereleaseIdentifiers(left[index] ?? '', right[index] ?? '');
    if (order !== 0) return order;
  }
  return 0;
};

/** Minimal semver greater-than for registry-answered versions; unparseable input is never greater. */
export const isGreaterSemver = (candidate: string | undefined, current: string | undefined): boolean => {
  const candidateParts = parseSemver(candidate);
  const currentParts = parseSemver(current);
  if (candidateParts === undefined || currentParts === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    const order = candidateParts.numbers[index] - currentParts.numbers[index];
    if (order !== 0) return order > 0;
  }
  if (candidateParts.pre.length === 0) return currentParts.pre.length > 0;
  if (currentParts.pre.length === 0) return false;
  return comparePrerelease(candidateParts.pre, currentParts.pre) > 0;
};

const readJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

const npmDependencies = (cacheAgentDir: string): Record<string, string> => {
  const manifest = readJsonFile(join(cacheAgentDir, 'npm', 'package.json')) as
    { dependencies?: Record<string, string> } | undefined;
  return manifest !== undefined && typeof manifest === 'object' && manifest.dependencies !== undefined
    ? manifest.dependencies
    : {};
};

interface StatusAnswer {
  readonly status: ExtensionStatus;
  readonly statusDetail?: string;
  readonly warning?: string;
}

const npmStatus = (
  specifier: string,
  name: string,
  resolvedVersion: string | undefined,
  offline: boolean,
  npmLatest: NpmLatestResolver,
): StatusAnswer => {
  if (offline) return { status: 'unknown', statusDetail: 'offline' };
  if (resolvedVersion === undefined) {
    return {
      status: 'unknown',
      statusDetail: 'unreadable install',
      warning: `extension '${specifier}' has an unreadable installed package manifest.`,
    };
  }
  const latest = npmLatest(name);
  if (latest === undefined) {
    return {
      status: 'unknown',
      statusDetail: 'lookup failed',
      warning: `extension '${specifier}' could not be checked against the registry.`,
    };
  }
  return isGreaterSemver(latest, resolvedVersion)
    ? { status: 'update-available', statusDetail: latest }
    : { status: 'up-to-date' };
};

const npmEntries = (
  cacheAgentDir: string,
  input: ExtensionReportInput,
  npmLatest: NpmLatestResolver,
): { readonly entries: readonly ExtensionReportEntry[]; readonly warnings: readonly string[] } => {
  const warnings: string[] = [];
  const dependencies = npmDependencies(cacheAgentDir);
  const entries = Object.keys(dependencies)
    .sort()
    .flatMap((name): ExtensionReportEntry[] => {
      const installPath = join(cacheAgentDir, 'npm', 'node_modules', ...name.split('/'));
      const requestedRange = dependencies[name];
      const specifier = `npm:${name}@${requestedRange}`;
      const manifest = readJsonFile(join(installPath, 'package.json')) as { version?: string } | undefined;
      const resolvedVersion = typeof manifest?.version === 'string' ? manifest.version : undefined;
      const answer = npmStatus(specifier, name, resolvedVersion, input.offline === true, npmLatest);
      if (answer.warning !== undefined) warnings.push(answer.warning);
      return [
        {
          specifier,
          source: name,
          kind: 'npm',
          installPath,
          resolvedVersion,
          requestedRange,
          status: answer.status,
          statusDetail: answer.statusDetail,
        },
      ];
    });
  return { entries, warnings };
};

const gitCheckoutDirs = (root: string): string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let directoryEntries: string[];
    try {
      directoryEntries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of directoryEntries) {
      const path = join(dir, entry);
      if (isDirectory(path)) {
        if (existsSync(join(path, '.git'))) found.push(path);
        else walk(path);
      }
    }
  };
  walk(root);
  return found;
};

const isDirectory = (path: string): boolean => {
  try {
    return readdirSync(path) !== undefined;
  } catch {
    return false;
  }
};

const runGitQuiet = (arguments_: readonly string[]): string | undefined => {
  try {
    return runGit([...arguments_]);
  } catch {
    return undefined;
  }
};

const gitSpecifier = (checkoutDir: string, gitRoot: string, pinnedRef: string | undefined): string =>
  `git:${checkoutDir.slice(gitRoot.length + 1)}${pinnedRef === undefined ? '' : `@${pinnedRef}`}`;

const gitStatus = (
  specifier: string,
  checkoutDir: string,
  pinnedRef: string | undefined,
  headSha: string | undefined,
  originUrl: string | undefined,
  offline: boolean,
  gitRemoteTip: GitRemoteTipResolver,
): StatusAnswer => {
  if (headSha === undefined) {
    return {
      status: 'unknown',
      statusDetail: 'unreadable install',
      warning: `extension '${specifier}' has an unreadable git HEAD.`,
    };
  }
  // Markerless + detached HEAD: a full-SHA pin, frozen by the cache policy — never chased. A
  // markerless checkout with an attached HEAD is an unpinned clone, checked against the default
  // branch; a marker records a branch/tag pin, checked against that ref's remote tip.
  const detached = runGitQuiet(['-C', checkoutDir, 'symbolic-ref', '-q', 'HEAD']) === undefined;
  if (pinnedRef === undefined && detached) {
    return { status: 'pinned', statusDetail: `at ${shortSha(headSha)}` };
  }
  if (offline) return { status: 'unknown', statusDetail: 'offline' };
  if (originUrl === undefined) {
    return {
      status: 'unknown',
      statusDetail: 'no readable origin',
      warning: `extension '${specifier}' has no readable git origin to check upstream.`,
    };
  }
  const tip = gitRemoteTip(originUrl, pinnedRef);
  if (tip === undefined) {
    return {
      status: 'unknown',
      statusDetail: 'lookup failed',
      warning: `extension '${specifier}' could not be checked against its git remote.`,
    };
  }
  return sameSha(tip, headSha) ? { status: 'up-to-date' } : { status: 'update-available', statusDetail: shortSha(tip) };
};

const gitEntries = (
  cacheAgentDir: string,
  input: ExtensionReportInput,
  gitRemoteTip: GitRemoteTipResolver,
): { readonly entries: readonly ExtensionReportEntry[]; readonly warnings: readonly string[] } => {
  const warnings: string[] = [];
  const gitRoot = join(cacheAgentDir, 'git');
  if (!existsSync(gitRoot)) return { entries: [], warnings };
  const entries = gitCheckoutDirs(gitRoot)
    .sort()
    .flatMap((checkoutDir): ExtensionReportEntry[] => {
      const marker = readJsonFile(`${checkoutDir}.outfitter-ref.json`) as { ref?: unknown } | undefined;
      const pinnedRef = typeof marker?.ref === 'string' ? marker.ref : undefined;
      const specifier = gitSpecifier(checkoutDir, gitRoot, pinnedRef);
      const headSha = runGitQuiet(['-C', checkoutDir, 'rev-parse', 'HEAD']);
      const originUrl = runGitQuiet(['-C', checkoutDir, 'remote', 'get-url', 'origin']);
      const answer = gitStatus(
        specifier,
        checkoutDir,
        pinnedRef,
        headSha,
        originUrl,
        input.offline === true,
        gitRemoteTip,
      );
      if (answer.warning !== undefined) warnings.push(answer.warning);
      return [
        {
          specifier,
          source: checkoutDir.slice(gitRoot.length + 1),
          kind: 'git',
          installPath: checkoutDir,
          pinnedRef,
          headSha,
          status: answer.status,
          statusDetail: answer.statusDetail,
        },
      ];
    });
  return { entries, warnings };
};

/** The real `git ls-remote` tip resolver; exported so tests can exercise it against local repos. */
export const defaultGitRemoteTip: GitRemoteTipResolver = (originUrl, ref) => {
  const output = runGitQuiet(['ls-remote', originUrl, ref ?? 'HEAD']);
  if (output === undefined) return undefined;
  const sha = output.split('\n')[0].split('\t')[0].trim();
  return sha === '' ? undefined : sha;
};

/** Builds the read-only `outfitter list extensions` report from the cache state on disk. */
export const buildExtensionReport = (input: ExtensionReportInput): ExtensionReport => {
  const npmLatest = input.npmLatest ?? defaultNpmLatest;
  const gitRemoteTip = input.gitRemoteTip ?? defaultGitRemoteTip;
  const npm = npmEntries(input.cacheAgentDir, input, npmLatest);
  const git = gitEntries(input.cacheAgentDir, input, gitRemoteTip);
  return {
    entries: [...npm.entries, ...git.entries],
    warnings: [...npm.warnings, ...git.warnings],
  };
};
