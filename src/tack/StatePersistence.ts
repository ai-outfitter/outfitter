// Defines tack state persistence declarations, strategies, and write detection helpers.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { sep as posixSeparator } from 'node:path/posix';

export type StatePersistenceStrategy = 'symlink' | 'discard' | 'warn' | 'error' | 'prompt';

export interface StatePathDeclaration {
  readonly defaultStrategy?: StatePersistenceStrategy;
  readonly allowedStrategies: readonly StatePersistenceStrategy[];
}

export interface TackStatePath {
  readonly relativePath: string;
  readonly strategy: StatePersistenceStrategy;
  readonly sourcePath?: string;
  readonly directory: boolean;
}

export interface TackStateBaseline {
  readonly fingerprints: ReadonlyMap<string, string>;
}

export interface TackStateWriteIssue {
  readonly relativePath: string;
  readonly strategy: StatePersistenceStrategy;
  readonly unknown: boolean;
}

export const materializeTackStatePath = (rootDirectory: string, statePath: TackStatePath): void => {
  if (statePath.strategy === 'symlink') {
    if (statePath.sourcePath === undefined) {
      throw new Error(`State path '${statePath.relativePath}' uses symlink without a source path.`);
    }

    materializeSymlink(rootDirectory, statePath.relativePath, statePath.sourcePath, statePath.directory);
    return;
  }

  const outputPath = resolveTackStateOutputPath(rootDirectory, statePath.relativePath);

  if (statePath.directory) {
    mkdirSync(outputPath, { recursive: true });
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
  }
};

export const createTackStateBaseline = (
  rootDirectory: string,
  statePaths: readonly TackStatePath[] = [],
): TackStateBaseline => ({
  fingerprints: fingerprintTree(rootDirectory, createDiscardStatePathSet(statePaths)),
});

export const updateTackStateBaselinePaths = (
  rootDirectory: string,
  baseline: TackStateBaseline,
  outputPaths: readonly string[],
): TackStateBaseline => {
  const fingerprints = new Map(baseline.fingerprints);

  for (const outputPath of outputPaths) {
    const relativePath = normalizeTackRelativePath(rootDirectory, outputPath);
    deleteFingerprintSubtree(fingerprints, relativePath);
    addPathFingerprints(rootDirectory, relativePath, fingerprints, new Set());
  }

  return { fingerprints };
};

export const detectTackStateWrites = (
  rootDirectory: string,
  statePaths: readonly TackStatePath[],
  baseline: TackStateBaseline,
): readonly TackStateWriteIssue[] => {
  const current = fingerprintTree(rootDirectory, createDiscardStatePathSet(statePaths));
  const changedPaths = [...new Set([...current.keys(), ...baseline.fingerprints.keys()])].filter(
    (path) => current.get(path) !== baseline.fingerprints.get(path),
  );
  const issues = new Map<string, TackStateWriteIssue>();
  const declaredPaths = statePaths.filter((statePath) => statePath.relativePath !== 'unknown');
  const unknownStatePath = statePaths.find((statePath) => statePath.relativePath === 'unknown');

  for (const changedPath of changedPaths) {
    const statePath = declaredPaths.find((candidate) => isWithinStatePath(changedPath, candidate));

    if (statePath !== undefined) {
      if (shouldReportStatePathChange(changedPath, statePath)) {
        issues.set(statePath.relativePath, {
          relativePath: statePath.relativePath,
          strategy: statePath.strategy,
          unknown: false,
        });
      }
    } else if (
      unknownStatePath !== undefined &&
      unknownStatePath.strategy !== 'discard' &&
      isUserWritePath(changedPath)
    ) {
      issues.set(changedPath, { relativePath: changedPath, strategy: unknownStatePath.strategy, unknown: true });
    }
  }

  return [...issues.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

export const ensureStateSourcePath = (sourcePath: string, directory: boolean): string => {
  const sourceType = getExistingSourceType(sourcePath);

  if (sourceType === undefined) {
    if (directory) {
      mkdirSync(sourcePath, { recursive: true });
    } else {
      mkdirSync(dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, '');
    }

    return sourcePath;
  }

  if (directory && sourceType !== 'directory') {
    throw new Error(`State source path '${sourcePath}' must be a directory.`);
  }

  if (!directory && sourceType !== 'file') {
    throw new Error(`State source path '${sourcePath}' must be a file.`);
  }

  return sourcePath;
};

const getExistingSourceType = (sourcePath: string): 'file' | 'directory' | undefined => {
  try {
    const stat = statSync(sourcePath);
    return stat.isDirectory() ? 'directory' : 'file';
  } catch (error) {
    /* v8 ignore next -- non-ENOENT stat failures should surface as actionable filesystem errors. */
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }

    /* v8 ignore next -- non-ENOENT stat failures should surface as actionable filesystem errors. */
    throw error;
  }
};

const materializeSymlink = (
  rootDirectory: string,
  relativePath: string,
  sourcePath: string,
  directory: boolean,
): void => {
  const outputPath = resolveTackStateOutputPath(rootDirectory, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });

  if (pathLexicallyExists(outputPath)) {
    unlinkSync(outputPath);
  }

  ensureStateSourcePath(sourcePath, directory);
  symlinkSync(sourcePath, outputPath, directory ? 'dir' : 'file');
};

const pathLexicallyExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    /* v8 ignore next -- non-ENOENT lstat failures should surface as actionable filesystem errors. */
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    /* v8 ignore next -- non-ENOENT lstat failures should surface as actionable filesystem errors. */
    throw error;
  }
};

const fingerprintTree = (
  rootDirectory: string,
  skippedRelativePaths: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, string> => {
  const fingerprints = new Map<string, string>();

  addPathFingerprints(rootDirectory, '', fingerprints, skippedRelativePaths);

  return fingerprints;
};

const addPathFingerprints = (
  rootDirectory: string,
  relativePath: string,
  fingerprints: Map<string, string>,
  skippedRelativePaths: ReadonlySet<string>,
): void => {
  const absolutePath =
    relativePath === '' ? rootDirectory : resolveTackRelativePath(rootDirectory, relativePath, 'Tack path');

  if (existsSync(absolutePath)) {
    addFingerprint(absolutePath, relativePath, fingerprints, skippedRelativePaths);
  }
};

const addFingerprint = (
  absolutePath: string,
  relativePath: string,
  fingerprints: Map<string, string>,
  skippedRelativePaths: ReadonlySet<string>,
): void => {
  if (shouldSkipFingerprint(relativePath, skippedRelativePaths)) {
    return;
  }

  const stat = lstatSync(absolutePath);

  if (stat.isSymbolicLink()) {
    fingerprints.set(relativePath, `symlink:${readlinkSync(absolutePath)}`);
    return;
  }

  if (relativePath !== '') {
    fingerprints.set(relativePath, createEntryFingerprint(absolutePath, stat));
  }

  if (stat.isDirectory()) {
    for (const entryName of readdirSync(absolutePath).sort()) {
      addFingerprint(
        join(absolutePath, entryName),
        relativePath === '' ? entryName : `${relativePath}${posixSeparator}${entryName}`,
        fingerprints,
        skippedRelativePaths,
      );
    }
  }
};

const createEntryFingerprint = (absolutePath: string, stat: NonNullable<ReturnType<typeof lstatSync>>): string => {
  if (stat.isDirectory()) {
    return 'dir';
  }

  if (stat.isFile()) {
    return `file:${readFileSync(absolutePath).toString('base64')}`;
  }

  return `special:${stat.mode}:${stat.rdev}`;
};

const shouldSkipFingerprint = (relativePath: string, skippedRelativePaths: ReadonlySet<string>): boolean =>
  relativePath !== '' &&
  [...skippedRelativePaths].some(
    (skippedRelativePath) =>
      relativePath === skippedRelativePath || relativePath.startsWith(`${skippedRelativePath}${posixSeparator}`),
  );

const createDiscardStatePathSet = (statePaths: readonly TackStatePath[]): ReadonlySet<string> =>
  new Set(
    statePaths
      .filter((statePath) => statePath.strategy === 'discard' && statePath.relativePath !== 'unknown')
      .map((statePath) => normalizeStateRelativePath(statePath.relativePath)),
  );

const deleteFingerprintSubtree = (fingerprints: Map<string, string>, relativePath: string): void => {
  for (const fingerprintPath of [...fingerprints.keys()]) {
    if (fingerprintPath === relativePath || fingerprintPath.startsWith(`${relativePath}${posixSeparator}`)) {
      fingerprints.delete(fingerprintPath);
    }
  }
};

const resolveTackStateOutputPath = (rootDirectory: string, relativePath: string): string => {
  const normalizedRelativePath = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;

  return resolveTackRelativePath(rootDirectory, normalizedRelativePath, `State path '${relativePath}'`);
};

const normalizeTackRelativePath = (rootDirectory: string, outputPath: string): string => {
  const resolvedOutputPath = isAbsolute(outputPath) ? resolve(outputPath) : resolve(rootDirectory, outputPath);
  const relativeOutputPath = relative(resolve(rootDirectory), resolvedOutputPath);

  assertTackRelativePath(rootDirectory, relativeOutputPath, `Tack file output path '${outputPath}'`);

  return relativeOutputPath.split(sep).join(posixSeparator);
};

const resolveTackRelativePath = (rootDirectory: string, relativePath: string, label: string): string => {
  const resolvedRootDirectory = resolve(rootDirectory);
  const resolvedOutputPath = resolve(rootDirectory, relativePath);
  const relativeOutputPath = relative(resolvedRootDirectory, resolvedOutputPath);

  assertTackRelativePath(rootDirectory, relativeOutputPath, label);

  return resolvedOutputPath;
};

const assertTackRelativePath = (rootDirectory: string, relativePath: string, label: string): void => {
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay under tack root '${rootDirectory}'.`);
  }
};

const shouldReportStatePathChange = (changedPath: string, statePath: TackStatePath): boolean => {
  if (statePath.strategy === 'discard') {
    return false;
  }

  if (statePath.strategy === 'symlink') {
    return changedPath === normalizeStateRelativePath(statePath.relativePath);
  }

  return true;
};

const isWithinStatePath = (changedPath: string, statePath: TackStatePath): boolean => {
  const stateRelativePath = normalizeStateRelativePath(statePath.relativePath);

  return changedPath === stateRelativePath || changedPath.startsWith(`${stateRelativePath}${posixSeparator}`);
};

const normalizeStateRelativePath = (relativePath: string): string =>
  relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;

const isUserWritePath = (relativePath: string): boolean =>
  relativePath !== 'bridl' && !relativePath.startsWith(`bridl${posixSeparator}`);

const isNodeError = (error: unknown): error is NodeJS.ErrnoException => error instanceof Error && 'code' in error;
