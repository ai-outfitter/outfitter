// Discovers catalog skills across project, directory-profile, and configured-source roots.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { inferProfileIncludeSourceRoot } from '../profiles/PromptIncludes.js';
import { isValidSkillId } from './SkillDocument.js';

export interface SkillCatalogRoot {
  /** Directory scanned for `<skill-id>/SKILL.md` entries. */
  readonly skillsDirectory: string;
  /** Root that skill `file` references resolve from (the repository containing the skill). */
  readonly referenceRoot: string;
  /** Human-readable origin for shadowing diagnostics. */
  readonly origin: string;
}

export interface SkillCatalogEntry {
  readonly id: string;
  readonly directory: string;
  readonly skillPath: string;
  readonly referenceRoot: string;
  readonly origin: string;
}

export interface SkillCatalog {
  readonly entries: ReadonlyMap<string, SkillCatalogEntry>;
  readonly shadowed: readonly { readonly selected: SkillCatalogEntry; readonly shadowedDirectory: string }[];
}

export interface SkillCatalogInput {
  readonly projectDirectory?: string;
  /** Directory-profile resource roots contributing bundled `skills/` folders. */
  readonly profileLayers?: readonly { readonly sourceRootPath?: string; readonly resourceRootPath?: string }[];
  /** Materialized configured profile-source paths, in configured (precedence) order. */
  readonly sourcePaths?: readonly string[];
}

/**
 * Builds the skill ID catalog following layer precedence: project-local, project,
 * bundled directory-profile skills (highest-precedence layer first), then
 * configured sources (later entries outrank earlier ones, matching profile
 * precedence). The first root supplying an ID wins; later roots are reported as
 * shadowed.
 */
export const discoverSkillCatalog = (input: SkillCatalogInput): SkillCatalog => {
  const entries = new Map<string, SkillCatalogEntry>();
  const shadowed: { readonly selected: SkillCatalogEntry; readonly shadowedDirectory: string }[] = [];

  for (const root of createSkillCatalogRoots(input)) {
    for (const entry of readSkillCatalogRootEntries(root)) {
      const selected = entries.get(entry.id);

      if (selected === undefined) {
        entries.set(entry.id, entry);
      } else if (selected.directory !== entry.directory) {
        shadowed.push({ selected, shadowedDirectory: entry.directory });
      }
    }
  }

  return { entries, shadowed };
};

export const createSkillCatalogRoots = (input: SkillCatalogInput): readonly SkillCatalogRoot[] => {
  const roots: SkillCatalogRoot[] = [];

  if (input.projectDirectory !== undefined) {
    roots.push(
      {
        skillsDirectory: join(input.projectDirectory, '.outfitter', 'local', 'skills'),
        referenceRoot: input.projectDirectory,
        origin: 'project-local skills',
      },
      {
        skillsDirectory: join(input.projectDirectory, '.outfitter', 'skills'),
        referenceRoot: input.projectDirectory,
        origin: 'project skills',
      },
    );
  }

  // Profile layers arrive lowest-precedence first (see ProfileMerger); reverse so
  // the selected profile's bundled skill outranks an inherited base profile's.
  for (const layer of [...(input.profileLayers ?? [])].reverse()) {
    if (layer.resourceRootPath === undefined) {
      continue;
    }

    roots.push({
      skillsDirectory: join(layer.resourceRootPath, 'skills'),
      referenceRoot:
        inferProfileIncludeSourceRoot({
          sourceRootPath: layer.sourceRootPath,
          profilePath: join(layer.resourceRootPath, 'profile.yml'),
          /* v8 ignore next -- directory profiles always sit under a source root. */
        }) ?? layer.resourceRootPath,
      origin: `profile '${basename(layer.resourceRootPath)}' skills`,
    });
  }

  // Later configured sources outrank earlier ones for profiles; mirror that here.
  for (const sourcePath of [...(input.sourcePaths ?? [])].reverse()) {
    const catalogRoot = resolveCatalogRoot(sourcePath);
    roots.push({
      skillsDirectory: join(catalogRoot, 'skills'),
      referenceRoot: basename(catalogRoot) === '.outfitter' ? dirname(catalogRoot) : catalogRoot,
      origin: `source '${sourcePath}'`,
    });
  }

  return dedupeSkillCatalogRoots(roots);
};

/**
 * The catalog root is the directory containing `profiles/`. A source path that
 * points directly at the profiles directory resolves to its parent.
 */
const resolveCatalogRoot = (sourcePath: string): string =>
  basename(sourcePath) === 'profiles' ? dirname(sourcePath) : sourcePath;

const dedupeSkillCatalogRoots = (roots: readonly SkillCatalogRoot[]): readonly SkillCatalogRoot[] => {
  const seen = new Set<string>();

  return roots.filter((root) => {
    if (seen.has(root.skillsDirectory)) {
      return false;
    }

    seen.add(root.skillsDirectory);
    return true;
  });
};

const readSkillCatalogRootEntries = (root: SkillCatalogRoot): readonly SkillCatalogEntry[] =>
  readOptionalDirectoryNames(root.skillsDirectory)
    .filter((name) => isValidSkillId(name) && existsSync(join(root.skillsDirectory, name, 'SKILL.md')))
    .sort()
    .map((name) => ({
      id: name,
      directory: join(root.skillsDirectory, name),
      skillPath: join(root.skillsDirectory, name, 'SKILL.md'),
      referenceRoot: root.referenceRoot,
      origin: root.origin,
    }));

const readOptionalDirectoryNames = (directory: string): readonly string[] => {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() || isSymlinkedDirectory(join(directory, entry.name), entry.isSymbolicLink()),
      )
      .map((entry) => entry.name);
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw new Error(`Could not read skills directory '${directory}': ${String(error)}`, { cause: error });
  }
};

const isSymlinkedDirectory = (path: string, isSymbolicLink: boolean): boolean => {
  if (!isSymbolicLink) {
    return false;
  }

  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isMissingPathError = (error: unknown): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
