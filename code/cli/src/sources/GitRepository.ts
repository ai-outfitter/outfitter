// Atomically fetches Git repositories while preserving the last known-good cache on failure.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { normalizeGitUri, normalizeRemoteSourceUri, redactEmbeddedSourceCredentials } from './SourceCache.js';
import type { RemoteSourceReference } from './SourceCache.js';

export interface AtomicRepositorySyncInput {
  readonly cachePath: string;
  /** Optional fetch refspec used when verification needs a local ref (for example an immutable tag). */
  readonly fetchRef?: string;
  readonly source: RemoteSourceReference;
  /**
   * Inspects the fetched checkout before it is swapped in; throwing rejects the fetch. Returns the
   * number of non-fatal warnings the checkout produced.
   */
  readonly validate?: (repositoryPath: string, commit: string) => number;
}

export interface AtomicRepositorySyncResult {
  readonly commit: string;
  readonly status: 'updated' | 'unchanged';
  readonly warnings: number;
}

// Repository-context variables must never leak in: with GIT_DIR/GIT_WORK_TREE exported (a git hook,
// `rebase --exec`, `bisect run`), `git -C <temporaryRoot> …` would operate on the *outer*
// repository, adding remotes to it and detaching its HEAD. Transport variables are left alone so a
// user's custom GIT_SSH_COMMAND still applies.
const repositoryContextVariables = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES',
]);

const gitEnvironment = (): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!repositoryContextVariables.has(key)) environment[key] = value;
  }

  // Git reads interactive credential prompts from /dev/tty, so piping stdio does not suppress them:
  // an auth-required or unknown-host remote would hang the CLI forever without these.
  environment.GIT_TERMINAL_PROMPT = '0';
  environment.GIT_SSH_COMMAND = process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes';
  return environment;
};

/** Guards against a `ref` that git would parse as an option (`--upload-pack=…` is code execution). */
export const assertFetchableRef = (ref: string): void => {
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/u.test(ref) || ref.includes('..')) {
    throw new Error(`Source ref '${ref}' is not a valid git ref.`);
  }
};

/** Runs one git invocation, raising captured stderr as a credential-redacted Error. */
export const runGit = (arguments_: readonly string[]): string => {
  const result = spawnSync('git', [...arguments_], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: gitEnvironment(),
    timeout: 300_000,
  });

  if (result.error === undefined && result.status === 0) {
    return result.stdout.trim();
  }

  const detail = [result.error?.message, result.stderr, result.stdout]
    .filter((value): value is string => value !== undefined && value.trim() !== '')
    .join('\n');
  const command = `git ${arguments_.join(' ')}`;
  let suffix = `: ${detail.trim()}`;
  /* v8 ignore else -- spawn failures always provide an Error or captured process output. */
  if (detail === '') suffix = '';
  throw new Error(redactEmbeddedSourceCredentials(`${command} failed${suffix}`));
};

/** Reads the HEAD commit of a checkout, or undefined when it is missing, dirty, or unreadable. */
export const tryReadCleanHead = (root: string): string | undefined => {
  if (!existsSync(join(root, '.git'))) return undefined;

  try {
    if (runGit(['-C', root, 'status', '--porcelain']) !== '') return undefined;
    return runGit(['-C', root, 'rev-parse', 'HEAD']);
  } catch {
    return undefined;
  }
};

const fetchSource = (temporaryRoot: string, source: RemoteSourceReference, fetchRef?: string): string => {
  const remote = normalizeGitUri(normalizeRemoteSourceUri(source));
  const ref = fetchRef ?? source.ref;
  // Both the remote and the ref are positional arguments to `git fetch`; either one starting with
  // `-` is parsed as an option, and `--upload-pack=<cmd>` is arbitrary command execution.
  if (remote.startsWith('-')) throw new Error(`Source URI '${remote}' must not begin with '-'.`);
  // A refspec (`refs/tags/x:refs/tags/x`) is two refs; validate each side.
  if (ref !== undefined) for (const part of ref.split(':')) assertFetchableRef(part);

  runGit(['init', '--quiet', temporaryRoot]);
  // Fetch by URL rather than `remote add origin <url>`: a credential-bearing URL written into
  // .git/config would be renamed into the long-lived cache and persist there in plaintext.
  // An omitted ref must resolve the remote's default branch — with no refspec at all, FETCH_HEAD
  // holds every branch tip and `rev-parse FETCH_HEAD` would take whichever sorts first.
  runGit(['-C', temporaryRoot, 'fetch', '--quiet', '--depth=1', remote, ref ?? 'HEAD']);
  runGit(['-C', temporaryRoot, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  return runGit(['-C', temporaryRoot, 'rev-parse', 'HEAD']);
};

/**
 * Fetches into a temporary sibling and swaps only a validated checkout into place. A failed fetch,
 * checkout, validation, or rename leaves an existing cache intact.
 */
export const syncRemoteRepositoryAtomically = (input: AtomicRepositorySyncInput): AtomicRepositorySyncResult => {
  mkdirSync(dirname(input.cachePath), { recursive: true });
  const nonce = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  const temporaryRoot = `${input.cachePath}.outfitter-${nonce}.tmp`;
  const staleRoot = `${input.cachePath}.outfitter-${nonce}.stale`;
  let movedStaleCache = false;

  try {
    const commit = fetchSource(temporaryRoot, input.source, input.fetchRef);
    const warnings = input.validate?.(temporaryRoot, commit) ?? 0;

    if (tryReadCleanHead(input.cachePath) === commit) {
      return { commit, status: 'unchanged', warnings };
    }

    if (existsSync(input.cachePath)) {
      renameSync(input.cachePath, staleRoot);
      movedStaleCache = true;
    }
    renameSync(temporaryRoot, input.cachePath);
    if (movedStaleCache) rmSync(staleRoot, { recursive: true, force: true });
    return { commit, status: 'updated', warnings };
  } catch (error) {
    /* v8 ignore next -- only an OS-level failure during the atomic rename needs restoration. */
    if (movedStaleCache && !existsSync(input.cachePath) && existsSync(staleRoot)) {
      renameSync(staleRoot, input.cachePath);
    }
    throw error;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    rmSync(staleRoot, { recursive: true, force: true });
  }
};
