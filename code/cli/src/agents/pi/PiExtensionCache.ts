// Caches remote Pi extension packages as local directories before launch.
//
// Refresh policy: caches for `#ref`-pinned sources are immutable once created. Caches for
// branch-tracking (ref-less) sources are refreshed by `outfitter sync` through
// refreshPiExtensionCaches, which fast-forwards the shallow clone and reinstalls dependencies
// when the tip moved. Launch-time materialization never refreshes an existing cache.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import spawn from 'cross-spawn';

export interface PiExtensionCacheOptions {
  readonly cacheDirectory?: string;
  readonly onProgress?: (message: string) => void;
}

interface GitExtensionSource {
  readonly cloneUrl: string;
  readonly ref?: string;
}

export const materializePiExtensionSources = (
  sources: readonly string[] | undefined,
  options: PiExtensionCacheOptions = {},
): readonly string[] | undefined => {
  if (sources === undefined || options.cacheDirectory === undefined) {
    return sources;
  }

  const { cacheDirectory } = options;
  return sources.map((source) => materializePiExtensionSource(source, cacheDirectory, options.onProgress));
};

const materializePiExtensionSource = (
  source: string,
  cacheDirectory: string,
  onProgress?: (message: string) => void,
): string => {
  const gitSource = parseGitExtensionSource(source);

  if (gitSource === undefined) {
    return source;
  }

  const cachePath = join(cacheDirectory, 'extensions', 'git', encodeCacheKey(source));

  if (!existsSync(cachePath)) {
    try {
      onProgress?.(`outfitter: caching extension ${source}…`);
      cloneGitExtension(gitSource, cachePath);
      installGitExtensionDependencies(cachePath, source, onProgress);
      writeCacheSourceMetadata(cachePath, source, gitSource.ref);
    } catch (error) {
      rmSync(cachePath, { recursive: true, force: true });
      rmSync(cacheSourceMetadataPath(cachePath), { force: true });
      throw error;
    }
  }

  return cachePath;
};

export interface PiExtensionCacheRefreshResult {
  readonly source: string;
  readonly cachePath: string;
  readonly status: 'refreshed' | 'unchanged' | 'pinned' | 'failed';
  readonly message: string;
}

// Refreshes branch-tracking git-extension caches under `<cacheDirectory>/extensions/git`.
// `#ref`-pinned entries are reported as pinned and left untouched. Entries without source
// metadata (created before metadata existed) are skipped silently.
export const refreshPiExtensionCaches = (
  cacheDirectory: string,
  options: Pick<PiExtensionCacheOptions, 'onProgress'> = {},
): readonly PiExtensionCacheRefreshResult[] => {
  const gitCacheRoot = join(cacheDirectory, 'extensions', 'git');

  if (!existsSync(gitCacheRoot)) {
    return [];
  }

  return readdirSync(gitCacheRoot)
    .filter((entryName) => entryName.endsWith(cacheSourceMetadataSuffix))
    .sort()
    .flatMap((entryName) => {
      const result = refreshPiExtensionCache(gitCacheRoot, entryName, options.onProgress);
      return result === undefined ? [] : [result];
    });
};

const refreshPiExtensionCache = (
  gitCacheRoot: string,
  metadataFileName: string,
  onProgress?: (message: string) => void,
): PiExtensionCacheRefreshResult | undefined => {
  const cachePath = join(gitCacheRoot, metadataFileName.slice(0, -cacheSourceMetadataSuffix.length));
  const metadata = readCacheSourceMetadata(join(gitCacheRoot, metadataFileName));

  if (metadata === undefined || !existsSync(cachePath)) {
    return undefined;
  }

  if (metadata.ref !== undefined) {
    return {
      source: metadata.source,
      cachePath,
      status: 'pinned',
      message: `pinned to #${metadata.ref}; cache left unchanged`,
    };
  }

  onProgress?.(`outfitter: refreshing extension ${metadata.source}…`);
  return pullBranchTrackingExtensionCache(metadata.source, cachePath, onProgress);
};

const pullBranchTrackingExtensionCache = (
  source: string,
  cachePath: string,
  onProgress?: (message: string) => void,
): PiExtensionCacheRefreshResult => {
  const headBeforePull = readCacheHead(cachePath);
  const pullResult = runCommand('git', ['pull', '--ff-only'], cachePath);

  if (pullResult.status !== 0) {
    return {
      source,
      cachePath,
      status: 'failed',
      message: commandError('git', ['pull', '--ff-only'], pullResult).message,
    };
  }

  const headAfterPull = readCacheHead(cachePath);

  if (headAfterPull === headBeforePull) {
    return { source, cachePath, status: 'unchanged', message: 'already up to date' };
  }

  try {
    installGitExtensionDependencies(cachePath, source, onProgress);
  } catch (error) {
    return { source, cachePath, status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }

  return { source, cachePath, status: 'refreshed', message: `updated to ${headAfterPull}` };
};

const cacheSourceMetadataSuffix = '.source.json';

const cacheSourceMetadataPath = (cachePath: string): string => `${cachePath}${cacheSourceMetadataSuffix}`;

const writeCacheSourceMetadata = (cachePath: string, source: string, ref: string | undefined): void => {
  writeFileSync(cacheSourceMetadataPath(cachePath), `${JSON.stringify({ source, ref }, null, 2)}\n`);
};

const readCacheSourceMetadata = (
  metadataPath: string,
): { readonly source: string; readonly ref?: string } | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(metadataPath, 'utf8'));

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as { readonly source?: unknown; readonly ref?: unknown };

    if (typeof record.source !== 'string') {
      return undefined;
    }

    return { source: record.source, ref: typeof record.ref === 'string' ? record.ref : undefined };
  } catch {
    return undefined;
  }
};

const readCacheHead = (cachePath: string): string => {
  const result = runCommand('git', ['rev-parse', 'HEAD'], cachePath);
  return result.status === 0 ? String(result.stdout).trim() : '';
};

const parseGitExtensionSource = (source: string): GitExtensionSource | undefined => {
  const trimmed = source.trim();

  if (isNonGitExtensionSource(trimmed)) {
    return undefined;
  }

  const { sourceWithoutRef, ref } = splitGitRef(trimmed);
  const cloneUrl = resolveGitCloneUrl(sourceWithoutRef);

  return cloneUrl === undefined ? undefined : { cloneUrl, ref };
};

const isNonGitExtensionSource = (source: string): boolean =>
  source.startsWith('npm:') || source.startsWith('.') || source.startsWith('/') || source.startsWith('file:');

const resolveGitCloneUrl = (sourceWithoutRef: string): string | undefined => {
  if (sourceWithoutRef.startsWith('github:')) {
    return ensureGitSuffix(`https://github.com/${sourceWithoutRef.slice('github:'.length)}`);
  }

  if (sourceWithoutRef.startsWith('git+')) {
    return sourceWithoutRef.slice('git+'.length);
  }

  if (sourceWithoutRef.startsWith('git:')) {
    return resolveGitPrefixCloneUrl(sourceWithoutRef.slice('git:'.length));
  }

  return isExplicitGitCloneUrl(sourceWithoutRef) ? sourceWithoutRef : undefined;
};

const resolveGitPrefixCloneUrl = (source: string): string =>
  source.startsWith('github.com/') ? ensureGitSuffix(`https://${source}`) : source;

const isExplicitGitCloneUrl = (source: string): boolean =>
  source.startsWith('https://') ||
  source.startsWith('http://') ||
  source.startsWith('ssh://') ||
  source.startsWith('git@');

const splitGitRef = (source: string): { readonly sourceWithoutRef: string; readonly ref?: string } => {
  const hashIndex = source.lastIndexOf('#');

  if (hashIndex !== -1) {
    return { sourceWithoutRef: source.slice(0, hashIndex), ref: source.slice(hashIndex + 1) };
  }

  return { sourceWithoutRef: source };
};

const ensureGitSuffix = (source: string): string => (source.endsWith('.git') ? source : `${source}.git`);

const cloneGitExtension = (source: GitExtensionSource, cachePath: string): void => {
  mkdirSync(dirname(cachePath), { recursive: true });

  const cloneArgs =
    source.ref === undefined
      ? ['clone', '--depth', '1', '--', source.cloneUrl, cachePath]
      : ['clone', '--depth', '1', '--branch', source.ref, '--', source.cloneUrl, cachePath];
  const cloneResult = runCommand('git', cloneArgs);

  if (cloneResult.status === 0) {
    return;
  }

  if (source.ref === undefined) {
    throw commandError('git', cloneArgs, cloneResult);
  }

  const fallbackCloneArgs = ['clone', '--', source.cloneUrl, cachePath];
  const fallbackCloneResult = runCommand('git', fallbackCloneArgs);

  if (fallbackCloneResult.status !== 0) {
    throw commandError('git', cloneArgs, cloneResult);
  }

  const checkoutArgs = ['-C', cachePath, 'checkout', source.ref];
  const checkoutResult = runCommand('git', checkoutArgs);

  if (checkoutResult.status !== 0) {
    throw commandError('git', checkoutArgs, checkoutResult);
  }
};

const installGitExtensionDependencies = (
  cachePath: string,
  source: string,
  onProgress?: (message: string) => void,
): void => {
  if (!existsSync(join(cachePath, 'package.json'))) {
    return;
  }

  onProgress?.(`outfitter: installing dependencies for extension ${source}…`);
  const npmArgs = existsSync(join(cachePath, 'package-lock.json')) ? ['ci', '--omit=dev'] : ['install', '--omit=dev'];
  const result = runCommand('npm', npmArgs, cachePath);

  if (result.status !== 0) {
    throw commandError('npm', npmArgs, result);
  }
};

const runCommand = (command: string, args: readonly string[], cwd?: string): ReturnType<typeof spawn.sync> =>
  spawn.sync(command, args, { cwd, stdio: 'pipe', encoding: 'utf8' });

const commandError = (command: string, args: readonly string[], result: ReturnType<typeof spawn.sync>): Error => {
  const output = result.stderr || result.stdout || `${command} ${args.join(' ')} failed`;
  return new Error(String(output).trim());
};

const encodeCacheKey = (source: string): string => createHash('sha256').update(source).digest('hex').slice(0, 16);
