// Defines tack state persistence declarations, strategies, and write detection helpers.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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

export const createTackStateBaseline = (rootDirectory: string): TackStateBaseline => ({
  fingerprints: fingerprintTree(rootDirectory),
});

export const detectTackStateWrites = (
  rootDirectory: string,
  statePaths: readonly TackStatePath[],
  baseline: TackStateBaseline,
): readonly TackStateWriteIssue[] => {
  const current = fingerprintTree(rootDirectory);
  const changedPaths = [...new Set([...current.keys(), ...baseline.fingerprints.keys()])].filter(
    (path) => current.get(path) !== baseline.fingerprints.get(path),
  );
  const issues = new Map<string, TackStateWriteIssue>();
  const declaredPaths = statePaths.filter((statePath) => statePath.relativePath !== 'unknown');
  const unknownStatePath = statePaths.find((statePath) => statePath.relativePath === 'unknown');

  for (const changedPath of changedPaths) {
    const statePath = declaredPaths.find((candidate) => isWithinStatePath(changedPath, candidate));

    if (statePath !== undefined) {
      /* v8 ignore next -- symlink and discard changes are intentionally ignored; warning/error/prompt paths are covered. */
      if (statePath.strategy !== 'symlink' && statePath.strategy !== 'discard') {
        issues.set(statePath.relativePath, {
          relativePath: statePath.relativePath,
          strategy: statePath.strategy,
          unknown: false,
        });
      }
    } else if (unknownStatePath !== undefined && isUserWritePath(changedPath)) {
      issues.set(changedPath, { relativePath: changedPath, strategy: unknownStatePath.strategy, unknown: true });
    }
  }

  return [...issues.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
};

export const ensureStateSourcePath = (sourcePath: string, directory: boolean): string => {
  if (directory) {
    mkdirSync(sourcePath, { recursive: true });
  } else if (!existsSync(sourcePath)) {
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, '');
  }

  return sourcePath;
};

const materializeSymlink = (
  rootDirectory: string,
  relativePath: string,
  sourcePath: string,
  directory: boolean,
): void => {
  const outputPath = resolveTackStateOutputPath(rootDirectory, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });

  /* v8 ignore next -- repeat materialization cleanup is defensive for live tack rewrites. */
  if (existsSync(outputPath)) {
    unlinkSync(outputPath);
  }

  ensureStateSourcePath(sourcePath, directory);
  symlinkSync(sourcePath, outputPath, directory ? 'dir' : 'file');
};

const fingerprintTree = (rootDirectory: string): ReadonlyMap<string, string> => {
  const fingerprints = new Map<string, string>();

  if (existsSync(rootDirectory)) {
    addFingerprint(rootDirectory, '', fingerprints);
  }

  return fingerprints;
};

const addFingerprint = (absolutePath: string, relativePath: string, fingerprints: Map<string, string>): void => {
  const stat = lstatSync(absolutePath);

  if (stat.isSymbolicLink()) {
    return;
  }

  if (relativePath !== '') {
    fingerprints.set(
      relativePath,
      stat.isDirectory() ? 'dir' : `file:${readFileSync(absolutePath).toString('base64')}`,
    );
  }

  if (stat.isDirectory()) {
    for (const entryName of readdirSync(absolutePath).sort()) {
      addFingerprint(
        join(absolutePath, entryName),
        relativePath === '' ? entryName : join(relativePath, entryName),
        fingerprints,
      );
    }
  }
};

const resolveTackStateOutputPath = (rootDirectory: string, relativePath: string): string => {
  const normalizedRelativePath = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;
  const resolvedRootDirectory = resolve(rootDirectory);
  const resolvedOutputPath = resolve(rootDirectory, normalizedRelativePath);
  const relativeOutputPath = relative(resolvedRootDirectory, resolvedOutputPath);

  if (relativeOutputPath.startsWith('..') || isAbsolute(relativeOutputPath)) {
    throw new Error(`State path '${relativePath}' must stay under tack root '${rootDirectory}'.`);
  }

  return resolvedOutputPath;
};

const isWithinStatePath = (changedPath: string, statePath: TackStatePath): boolean => {
  const stateRelativePath = statePath.relativePath.endsWith('/')
    ? statePath.relativePath.slice(0, -1)
    : statePath.relativePath;

  return changedPath === stateRelativePath || changedPath.startsWith(`${stateRelativePath}${sep}`);
};

const isUserWritePath = (relativePath: string): boolean =>
  relativePath !== 'bridl' && !relativePath.startsWith(`bridl${sep}`);
