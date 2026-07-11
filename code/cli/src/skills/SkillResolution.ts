// Resolves selected skill IDs, validates references, and materializes generated skills.
import {
  copyFileSync,
  cpSync,
  existsSync,
  globSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';

import type { SkillControlEntry, SkillReference, SkillSelection } from '../profiles/Profile.js';
import type { SkillCatalog, SkillCatalogEntry } from './SkillCatalog.js';
import {
  isSkillDocumentIssue,
  isValidSkillId,
  readSkillDocument,
  skillMaterializationSections,
  type SkillDocument,
  type SkillMaterializationSection,
} from './SkillDocument.js';

export interface SkillResolutionDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly path: string;
  readonly message: string;
}

export interface SkillEntryInput {
  readonly entry: SkillControlEntry;
  /** Root for `file` references appended by the declaring profile. */
  readonly profileReferenceRoot?: string;
}

/**
 * Shared across control scopes so one skill ID materializes once; a second
 * selection reuses the generated directory, and differing reference sets error.
 */
export type SkillMaterializationCache = Map<
  string,
  { readonly referencesKey: string; readonly generatedDirectory?: string }
>;

export interface SkillResolutionInput {
  readonly entries: readonly SkillEntryInput[];
  readonly catalog: SkillCatalog;
  readonly projectDirectory?: string;
  /** When set, resolved skills are copied here as `<id>/` with materialized references. */
  readonly outputDirectory?: string;
  readonly materializationCache?: SkillMaterializationCache;
}

export interface SkillResolutionResult {
  /** Skill sources in entry order: generated directories for resolved IDs, original strings otherwise. */
  readonly sources: readonly string[];
  readonly diagnostics: readonly SkillResolutionDiagnostic[];
}

export const resolveSkillEntries = (input: SkillResolutionInput): SkillResolutionResult => {
  const sources: string[] = [];
  const diagnostics: SkillResolutionDiagnostic[] = [];

  for (const entryInput of input.entries) {
    const outcome = resolveSkillEntry(input, entryInput);
    sources.push(...outcome.sources);
    diagnostics.push(...outcome.diagnostics);
  }

  return { sources, diagnostics };
};

const resolveSkillEntry = (input: SkillResolutionInput, entryInput: SkillEntryInput): SkillResolutionResult => {
  const { entry, profileReferenceRoot } = entryInput;
  const selection: SkillSelection = typeof entry === 'string' ? { id: entry } : entry;
  const catalogEntry = input.catalog.entries.get(selection.id);

  if (catalogEntry === undefined) {
    return resolveUncataloguedEntry(entry, selection.id);
  }

  const references = selection.references ?? [];
  const referencesKey = JSON.stringify(references);
  const cached = input.materializationCache?.get(selection.id);

  if (cached !== undefined) {
    return resolveCachedEntry(cached, referencesKey, selection.id);
  }

  const resolved = resolveCatalogSkill({
    catalogEntry,
    references,
    profileReferenceRoot,
    projectDirectory: input.projectDirectory,
    outputDirectory: input.outputDirectory,
  });
  input.materializationCache?.set(selection.id, {
    referencesKey,
    generatedDirectory: resolved.generatedDirectory,
  });

  return { sources: toEntrySources(resolved.generatedDirectory), diagnostics: resolved.diagnostics };
};

const resolveCachedEntry = (
  cached: { readonly referencesKey: string; readonly generatedDirectory?: string },
  referencesKey: string,
  id: string,
): SkillResolutionResult => {
  if (cached.referencesKey !== referencesKey) {
    return {
      sources: [],
      diagnostics: [
        {
          severity: 'error',
          path: `controls.skills/${id}`,
          message: `Skill '${id}' is selected with conflicting reference sets across control scopes.`,
        },
      ],
    };
  }

  return { sources: toEntrySources(cached.generatedDirectory), diagnostics: [] };
};

const toEntrySources = (generatedDirectory: string | undefined): readonly string[] =>
  generatedDirectory === undefined ? [] : [generatedDirectory];

const resolveUncataloguedEntry = (entry: SkillControlEntry, id: string): SkillResolutionResult => {
  if (typeof entry !== 'string') {
    return {
      sources: [],
      diagnostics: [
        {
          severity: 'error',
          path: `controls.skills/${id}`,
          message: `Skill ID '${id}' does not resolve in any skills directory.`,
        },
      ],
    };
  }

  if (isValidSkillId(entry)) {
    return {
      sources: [entry],
      diagnostics: [
        {
          severity: 'warning',
          path: `controls.skills/${entry}`,
          message: `Skill '${entry}' does not resolve in any skills directory; passing it through as a path source.`,
        },
      ],
    };
  }

  return { sources: [entry], diagnostics: [] };
};

interface CatalogSkillResolutionInput {
  readonly catalogEntry: SkillCatalogEntry;
  /** Profile-added references appended to the skill's own declared references. */
  readonly references: readonly SkillReference[];
  readonly profileReferenceRoot?: string;
  readonly projectDirectory?: string;
  readonly outputDirectory?: string;
}

const resolveCatalogSkill = (
  input: CatalogSkillResolutionInput,
): { readonly generatedDirectory?: string; readonly diagnostics: readonly SkillResolutionDiagnostic[] } => {
  const { catalogEntry } = input;
  const diagnostics: SkillResolutionDiagnostic[] = [];
  const document = readSkillDocument(catalogEntry.skillPath);

  if (isSkillDocumentIssue(document)) {
    return { diagnostics: [{ severity: 'error', path: document.path, message: document.message }] };
  }

  if (document.name !== catalogEntry.id) {
    return {
      diagnostics: [
        {
          severity: 'error',
          path: catalogEntry.skillPath,
          message: `SKILL.md 'name' ('${document.name}') must match its directory name ('${catalogEntry.id}').`,
        },
      ],
    };
  }

  const materializations = planSkillMaterializations(input, document, diagnostics);

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error') || input.outputDirectory === undefined) {
    return { diagnostics };
  }

  const generatedDirectory = join(input.outputDirectory, catalogEntry.id);
  cpSync(catalogEntry.directory, generatedDirectory, { recursive: true });

  for (const materialization of materializations) {
    const sectionDirectory = join(generatedDirectory, materialization.section);
    mkdirSync(sectionDirectory, { recursive: true });
    const destinationPath = join(sectionDirectory, materialization.destinationName);

    // Both copies preserve the source mode, so materialized scripts stay
    // executable. Directory targets dereference symlinks that the contained
    // scan already validated, so the generated skill is self-contained.
    if (materialization.kind === 'directory') {
      copyDirectoryDereferenced(materialization.sourcePath, destinationPath);
    } else {
      copyFileSync(materialization.sourcePath, destinationPath);
    }
  }

  return { generatedDirectory, diagnostics };
};

interface SkillMaterialization {
  readonly section: SkillMaterializationSection;
  readonly sourcePath: string;
  readonly destinationName: string;
  readonly kind: 'file' | 'directory';
}

const planSkillMaterializations = (
  input: CatalogSkillResolutionInput,
  document: SkillDocument,
  diagnostics: SkillResolutionDiagnostic[],
): readonly SkillMaterialization[] => {
  const materializations: SkillMaterialization[] = [];

  for (const section of skillMaterializationSections) {
    const entries = [
      ...document[section].map((reference) => ({ reference, fileRoot: input.catalogEntry.referenceRoot })),
      // Profile-added references resolve `file` from the declaring profile's repository.
      ...(section === 'references'
        ? input.references.map((reference) => ({
            reference,
            fileRoot: input.profileReferenceRoot ?? input.projectDirectory ?? input.catalogEntry.referenceRoot,
          }))
        : []),
    ];
    materializations.push(...planSectionMaterializations(input, section, entries, diagnostics));
  }

  return materializations;
};

const planSectionMaterializations = (
  input: CatalogSkillResolutionInput,
  section: SkillMaterializationSection,
  entries: readonly { readonly reference: SkillReference; readonly fileRoot: string }[],
  diagnostics: SkillResolutionDiagnostic[],
): readonly SkillMaterialization[] => {
  const materializations: SkillMaterialization[] = [];
  const destinationSources = new Map<string, string>();

  for (const { reference, fileRoot } of entries) {
    const outcomes = resolveReferenceMaterializations({
      reference,
      section,
      fileRoot,
      projectDirectory: input.projectDirectory,
      skillPath: input.catalogEntry.skillPath,
    });

    for (const resolved of outcomes) {
      if ('message' in resolved) {
        diagnostics.push(resolved);
        continue;
      }

      const collision = describeDestinationCollision(input, section, resolved, destinationSources);

      if (collision !== undefined) {
        diagnostics.push({ severity: 'error', path: input.catalogEntry.skillPath, message: collision });
        continue;
      }

      destinationSources.set(resolved.destinationName, resolved.sourcePath);
      materializations.push(resolved);
    }
  }

  return materializations;
};

/** Reports a destination claimed twice or already shipped inside the skill directory. */
const describeDestinationCollision = (
  input: CatalogSkillResolutionInput,
  section: SkillMaterializationSection,
  resolved: SkillMaterialization,
  destinationSources: ReadonlyMap<string, string>,
): string | undefined => {
  const previousSource = destinationSources.get(resolved.destinationName);

  if (previousSource !== undefined) {
    return (
      `Destination '${section}/${resolved.destinationName}' is declared more than once ` +
      `(by '${previousSource}' and '${resolved.sourcePath}').`
    );
  }

  // Checked against the source skill directory during planning so lint reports
  // shipped-file collisions without materializing anything.
  if (existsSync(join(input.catalogEntry.directory, section, resolved.destinationName))) {
    return (
      `Destination '${section}/${resolved.destinationName}' collides with a file ` +
      `already shipped by skill '${input.catalogEntry.id}'.`
    );
  }

  return undefined;
};

interface DescribedReference {
  readonly declaredPath: string;
  readonly root: string | undefined;
  readonly kind: 'file' | 'repo_file';
  readonly rootLabel: 'catalog' | 'project';
}

const describeReference = (
  reference: SkillReference,
  fileRoot: string,
  projectDirectory: string | undefined,
): DescribedReference =>
  'repo_file' in reference
    ? { declaredPath: reference.repo_file, root: projectDirectory, kind: 'repo_file', rootLabel: 'project' }
    : { declaredPath: reference.file, root: fileRoot, kind: 'file', rootLabel: 'catalog' };

/** One reference's resolved root and labels, shared by every target it names. */
interface ReferenceTargetContext {
  readonly root: string;
  readonly kind: 'file' | 'repo_file';
  readonly rootLabel: 'catalog' | 'project';
  readonly section: SkillMaterializationSection;
  readonly skillPath: string;
}

const targetError = (skillPath: string, message: string): SkillResolutionDiagnostic => ({
  severity: 'error',
  path: skillPath,
  message,
});

/**
 * Resolves one reference entry to its materializations: one for a literal
 * target, one per match for a glob target, and none for an omitted missing
 * `repo_file` target.
 */
const resolveReferenceMaterializations = (input: {
  readonly reference: SkillReference;
  readonly section: SkillMaterializationSection;
  readonly fileRoot: string;
  readonly projectDirectory?: string;
  readonly skillPath: string;
}): readonly (SkillMaterialization | SkillResolutionDiagnostic)[] => {
  const { declaredPath, root, kind, rootLabel } = describeReference(
    input.reference,
    input.fileRoot,
    input.projectDirectory,
  );

  if (root === undefined) {
    return [
      targetError(input.skillPath, `Reference ${kind} '${declaredPath}' has no ${rootLabel} root to resolve from.`),
    ];
  }

  const context: ReferenceTargetContext = { root, kind, rootLabel, section: input.section, skillPath: input.skillPath };

  if (isGlobPattern(declaredPath)) {
    return expandGlobMaterializations(declaredPath, context);
  }

  const resolved = resolveTargetMaterialization(declaredPath, context);

  return resolved === undefined ? [] : [resolved];
};

/**
 * Matches when a target uses glob syntax instead of naming one literal path.
 * Only the gitignore-style metacharacters count; braces are literal path
 * characters, so a braced filename resolves as a literal target.
 */
const isGlobPattern = (declaredPath: string): boolean => /[*?[]/u.test(declaredPath);

/**
 * Expands a glob target against its root. Each match then follows the same
 * rules as a literal target, so a matched directory materializes recursively
 * while an escaping or special match fails validation individually.
 */
const expandGlobMaterializations = (
  pattern: string,
  context: ReferenceTargetContext,
): readonly (SkillMaterialization | SkillResolutionDiagnostic)[] => {
  // Braces are literal path characters in this contract, but globSync
  // brace-expands them textually and offers no escape, so mixing them with
  // glob syntax fails validation rather than silently matching other paths.
  if (/[{}]/u.test(pattern)) {
    return [
      targetError(
        context.skillPath,
        `Reference ${context.kind} glob '${pattern}' must not contain braces; ` +
          `braces are literal path characters, not glob syntax.`,
      ),
    ];
  }

  // Sorted so diagnostics and collisions are deterministic across platforms.
  const matches = globSync(pattern, { cwd: context.root }).sort();

  if (matches.length === 0) {
    // A consuming project may not contain repo_file matches; the reference is omitted.
    return context.kind === 'repo_file'
      ? []
      : [targetError(context.skillPath, `Reference file glob '${pattern}' matched no files under '${context.root}'.`)];
  }

  const resolved: (SkillMaterialization | SkillResolutionDiagnostic)[] = [];

  for (const match of matches) {
    const outcome = resolveTargetMaterialization(match, context);

    if (outcome !== undefined) {
      resolved.push(outcome);
    }
  }

  return resolved;
};

/** Validates one concrete target path — a literal target or a single glob match. */
const resolveTargetMaterialization = (
  targetPath: string,
  context: ReferenceTargetContext,
): SkillMaterialization | SkillResolutionDiagnostic | undefined => {
  const { root, kind, rootLabel, skillPath } = context;
  const error = (message: string): SkillResolutionDiagnostic => targetError(skillPath, message);
  const sourcePath = isAbsolute(targetPath) ? targetPath : join(root, targetPath);

  if (!existsSync(sourcePath)) {
    // A consuming project may not contain a repo_file target; the reference is omitted.
    return kind === 'repo_file' ? undefined : error(`Reference file '${targetPath}' was not found under '${root}'.`);
  }

  const stats = statSync(sourcePath);

  if (!stats.isFile() && !stats.isDirectory()) {
    return error(`Reference ${kind} '${targetPath}' must be a regular file or directory.`);
  }

  if (escapesRoot(sourcePath, root)) {
    return error(`Reference ${kind} '${targetPath}' resolves outside its ${rootLabel} root '${root}'.`);
  }

  const directoryIssue = describeDirectoryTargetIssue(stats, sourcePath, targetPath, context);

  if (directoryIssue !== undefined) {
    return error(directoryIssue);
  }

  return {
    section: context.section,
    sourcePath,
    destinationName: basename(targetPath),
    kind: stats.isDirectory() ? 'directory' : 'file',
  };
};

/** Describes the first escaping, cyclic, or special path inside a directory target, if any. */
const describeDirectoryTargetIssue = (
  stats: Stats,
  sourcePath: string,
  targetPath: string,
  context: ReferenceTargetContext,
): string | undefined => {
  if (!stats.isDirectory()) {
    return undefined;
  }

  const issue = scanDirectoryTarget(sourcePath, context.root, [realpathSync(sourcePath)], new Set());

  if (issue === undefined) {
    return undefined;
  }

  const containedPath = relative(sourcePath, issue.path);
  const problemDescriptions: Record<ContainedPathIssue['problem'], string> = {
    escaping: `which resolves outside its ${context.rootLabel} root '${context.root}'`,
    cyclic: 'which creates a symlink cycle',
    special: 'which is not a regular file or directory',
  };

  return (
    `Reference ${context.kind} '${targetPath}' contains ` + `'${containedPath}', ${problemDescriptions[issue.problem]}.`
  );
};

interface ContainedPathIssue {
  readonly path: string;
  readonly problem: 'escaping' | 'cyclic' | 'special';
}

/**
 * Finds the first path inside a directory target whose realpath escapes the
 * reference root, a symlink that cycles back into an ancestor directory, or an
 * entry that is neither a regular file nor a directory. Directory
 * materialization dereferences symlinks recursively, so an escaping link would
 * smuggle outside content into the generated skill, a cyclic link would never
 * finish copying, and a special file such as a FIFO could block the copy.
 */
const scanDirectoryTarget = (
  directory: string,
  root: string,
  /** Realpaths of the directories on the current descent, for cycle detection. */
  ancestry: readonly string[],
  /** Realpaths of fully scanned directories, so shared subtrees scan once. */
  scanned: Set<string>,
): ContainedPathIssue | undefined => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);

    if (escapesRoot(entryPath, root)) {
      return { path: entryPath, problem: 'escaping' };
    }

    // statSync follows symlinks, so in-root symlinked subdirectories are
    // scanned too and a link to a special file is rejected like the file itself.
    const entryStats = statSync(entryPath);

    if (!entryStats.isFile() && !entryStats.isDirectory()) {
      return { path: entryPath, problem: 'special' };
    }

    if (!entryStats.isDirectory()) {
      continue;
    }

    const resolvedEntryPath = realpathSync(entryPath);

    if (ancestry.includes(resolvedEntryPath)) {
      return { path: entryPath, problem: 'cyclic' };
    }

    if (!scanned.has(resolvedEntryPath)) {
      scanned.add(resolvedEntryPath);
      const issue = scanDirectoryTarget(entryPath, root, [...ancestry, resolvedEntryPath], scanned);

      if (issue !== undefined) {
        return issue;
      }
    }
  }

  return undefined;
};

/**
 * Copies a directory target while dereferencing symlinks, so the generated
 * skill has no links back into catalog or project checkouts. cpSync's
 * dereference option only follows the top-level source path, so nested entries
 * are walked explicitly; copyFileSync preserves each file's mode.
 */
const copyDirectoryDereferenced = (source: string, destination: string): void => {
  mkdirSync(destination, { recursive: true });

  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);

    // statSync follows symlinks; scanDirectoryTarget already rejected cycles.
    if (statSync(sourcePath).isDirectory()) {
      copyDirectoryDereferenced(sourcePath, destinationPath);
    } else {
      copyFileSync(sourcePath, destinationPath);
    }
  }
};

/** Targets must remain within their root after following symlinks. */
const escapesRoot = (sourcePath: string, root: string): boolean => {
  let resolvedSource: string;
  let resolvedRoot: string;

  try {
    resolvedSource = realpathSync(sourcePath);
    resolvedRoot = realpathSync(root);
  } catch {
    /* v8 ignore next 2 -- existsSync guards the source; a vanished root is a race we treat as escaping. */
    return true;
  }

  const relativePath = relative(resolvedRoot, resolvedSource);

  // A bare '..' or a '../' prefix escapes; a sibling name like '..config' does not.
  return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
};
