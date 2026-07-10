// Resolves selected skill IDs, validates references, and materializes generated skills.
import { copyFileSync, cpSync, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';

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

export interface SkillResolutionInput {
  readonly entries: readonly SkillEntryInput[];
  readonly catalog: SkillCatalog;
  readonly projectDirectory?: string;
  /** When set, resolved skills are copied here as `<id>/` with materialized references. */
  readonly outputDirectory?: string;
}

export interface SkillResolutionResult {
  /** Skill sources in entry order: generated directories for resolved IDs, original strings otherwise. */
  readonly sources: readonly string[];
  readonly diagnostics: readonly SkillResolutionDiagnostic[];
}

export const resolveSkillEntries = (input: SkillResolutionInput): SkillResolutionResult => {
  const sources: string[] = [];
  const diagnostics: SkillResolutionDiagnostic[] = [];

  for (const { entry, profileReferenceRoot } of input.entries) {
    const selection: SkillSelection = typeof entry === 'string' ? { id: entry } : entry;
    const catalogEntry = input.catalog.entries.get(selection.id);

    if (catalogEntry === undefined) {
      if (typeof entry !== 'string') {
        diagnostics.push({
          severity: 'error',
          path: `controls.skills/${selection.id}`,
          message: `Skill ID '${selection.id}' does not resolve in any skills directory.`,
        });
      } else if (isValidSkillId(entry)) {
        diagnostics.push({
          severity: 'warning',
          path: `controls.skills/${entry}`,
          message: `Skill '${entry}' does not resolve in any skills directory; passing it through as a path source.`,
        });
        sources.push(entry);
      } else {
        sources.push(entry);
      }

      continue;
    }

    const resolved = resolveCatalogSkill({
      catalogEntry,
      references: selection.references ?? [],
      profileReferenceRoot,
      projectDirectory: input.projectDirectory,
      outputDirectory: input.outputDirectory,
    });
    diagnostics.push(...resolved.diagnostics);

    if (resolved.generatedDirectory !== undefined) {
      sources.push(resolved.generatedDirectory);
    }
  }

  return { sources, diagnostics };
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
    const destination = join(sectionDirectory, materialization.destinationName);

    if (existsSync(destination)) {
      diagnostics.push({
        severity: 'error',
        path: catalogEntry.skillPath,
        message:
          `Destination '${materialization.section}/${materialization.destinationName}' collides with a file ` +
          `already shipped by skill '${catalogEntry.id}'.`,
      });
      continue;
    }

    mkdirSync(sectionDirectory, { recursive: true });
    // copyFileSync preserves the source mode, so materialized scripts stay executable.
    copyFileSync(materialization.sourcePath, destination);
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? { diagnostics }
    : { generatedDirectory, diagnostics };
};

interface SkillMaterialization {
  readonly section: SkillMaterializationSection;
  readonly sourcePath: string;
  readonly destinationName: string;
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
  const destinationNames = new Set<string>();

  for (const { reference, fileRoot } of entries) {
    const resolved = resolveReferenceMaterialization({
      reference,
      section,
      fileRoot,
      projectDirectory: input.projectDirectory,
      skillPath: input.catalogEntry.skillPath,
    });

    if (resolved === undefined) {
      continue;
    }

    if ('message' in resolved) {
      diagnostics.push(resolved);
      continue;
    }

    if (destinationNames.has(resolved.destinationName)) {
      diagnostics.push({
        severity: 'error',
        path: input.catalogEntry.skillPath,
        message: `Destination '${section}/${resolved.destinationName}' is declared more than once.`,
      });
      continue;
    }

    destinationNames.add(resolved.destinationName);
    materializations.push(resolved);
  }

  return materializations;
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

const resolveReferenceMaterialization = (input: {
  readonly reference: SkillReference;
  readonly section: SkillMaterializationSection;
  readonly fileRoot: string;
  readonly projectDirectory?: string;
  readonly skillPath: string;
}): SkillMaterialization | SkillResolutionDiagnostic | undefined => {
  const { declaredPath, root, kind, rootLabel } = describeReference(
    input.reference,
    input.fileRoot,
    input.projectDirectory,
  );
  const error = (message: string): SkillResolutionDiagnostic => ({
    severity: 'error',
    path: input.skillPath,
    message,
  });

  if (root === undefined) {
    return error(`Reference ${kind} '${declaredPath}' has no ${rootLabel} root to resolve from.`);
  }

  const sourcePath = isAbsolute(declaredPath) ? declaredPath : join(root, declaredPath);

  if (!existsSync(sourcePath)) {
    // A consuming project may not contain a repo_file target; the reference is omitted.
    return kind === 'repo_file' ? undefined : error(`Reference file '${declaredPath}' was not found under '${root}'.`);
  }

  if (!statSync(sourcePath).isFile()) {
    return error(`Reference ${kind} '${declaredPath}' must be a regular file.`);
  }

  if (escapesRoot(sourcePath, root)) {
    return error(`Reference ${kind} '${declaredPath}' resolves outside its ${rootLabel} root '${root}'.`);
  }

  return { section: input.section, sourcePath, destinationName: basename(declaredPath) };
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

  return relativePath.startsWith('..') || isAbsolute(relativePath);
};
