// Shared helpers for adapter-declared composite profile state paths.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Profile } from '../profiles/Profile.js';
import type {
  StatePathDeclaration,
  StatePersistenceStrategy,
  CompositeProfileStatePath,
} from '../compositeProfile/StatePersistence.js';

export interface DeclaredStatePathInput {
  readonly adapterId: string;
  readonly declarations: Readonly<Record<string, StatePathDeclaration>>;
  readonly profile: Profile;
  readonly resolveSourcePath: (relativePath: string, directory: boolean) => string;
}

export const createDeclaredStatePaths = (input: DeclaredStatePathInput): readonly CompositeProfileStatePath[] => {
  assertDeclaredStatePersistenceKeys(input.adapterId, input.declarations, input.profile);

  return Object.entries(input.declarations).map(([relativePath, declaration]) => {
    const strategy = resolveStateStrategy(input.profile, relativePath, declaration);
    const directory = relativePath.endsWith('/');

    return {
      relativePath,
      strategy,
      directory,
      sourcePath:
        strategy === 'symlink' && relativePath !== 'unknown'
          ? input.resolveSourcePath(relativePath, directory)
          : undefined,
    };
  });
};

export const assertDeclaredStatePersistenceKeys = (
  adapterId: string,
  declarations: Readonly<Record<string, StatePathDeclaration>>,
  profile: Profile,
): void => {
  for (const relativePath of Object.keys(profile.statePersistence ?? {})) {
    if (!Object.hasOwn(declarations, relativePath)) {
      throw new Error(`state_persistence path '${relativePath}' is not declared by the ${adapterId} adapter`);
    }
  }
};

export const resolveStateStrategy = (
  profile: Profile,
  relativePath: string,
  declaration: StatePathDeclaration,
): StatePersistenceStrategy => {
  const strategy = profile.statePersistence?.[relativePath] ?? declaration.defaultStrategy;

  /* v8 ignore next -- Adapter declarations define defaults; this guards future declaration regressions. */
  if (strategy === undefined) {
    throw new Error(`missing state_persistence strategy for "${relativePath}"`);
  }

  if (!declaration.allowedStrategies.includes(strategy)) {
    throw new Error(`state_persistence strategy '${strategy}' is not allowed for "${relativePath}"`);
  }

  return strategy;
};

export const findProfileStateSource = (
  profileFolders: readonly string[],
  adapterId: string,
  relativePath: string,
  directory: boolean,
): string | undefined => {
  const normalizedRelativePath = directory ? relativePath.slice(0, -1) : relativePath;

  return [...profileFolders]
    .reverse()
    .map((profileFolder) => join(profileFolder, 'cli_specific', adapterId, normalizedRelativePath))
    .find((candidate) => existsSync(candidate));
};
