// Caches remote Pi extension packages as local directories before launch.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import spawn from 'cross-spawn';

export interface PiExtensionCacheOptions {
  readonly cacheDirectory?: string;
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
  return sources.map((source) => materializePiExtensionSource(source, cacheDirectory));
};

const materializePiExtensionSource = (source: string, cacheDirectory: string): string => {
  const gitSource = parseGitExtensionSource(source);

  if (gitSource === undefined) {
    return source;
  }

  const cachePath = join(cacheDirectory, 'extensions', 'git', encodeCacheKey(source));

  if (!existsSync(cachePath)) {
    try {
      cloneGitExtension(gitSource, cachePath);
      installGitExtensionDependencies(cachePath);
    } catch (error) {
      rmSync(cachePath, { recursive: true, force: true });
      throw error;
    }
  }

  return cachePath;
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

const installGitExtensionDependencies = (cachePath: string): void => {
  if (!existsSync(join(cachePath, 'package.json'))) {
    return;
  }

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
