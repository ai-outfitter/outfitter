// Parses and validates SKILL.md frontmatter for catalog skill resolution.
import { readFileSync } from 'node:fs';

import { parseYamlDocument } from '../validation/YamlDocument.js';
import type { SkillReference } from '../profiles/Profile.js';

export const isSkillReference = (value: unknown): value is SkillReference =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  (typeof (value as { readonly file?: unknown }).file === 'string' ||
    typeof (value as { readonly repo_file?: unknown }).repo_file === 'string');

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const skillNameMaxLength = 64;

/** Frontmatter keys that materialize external files into a generated skill directory. */
export const skillMaterializationSections = ['references', 'scripts', 'assets'] as const;
export type SkillMaterializationSection = (typeof skillMaterializationSections)[number];

export interface SkillDocument {
  readonly name: string;
  readonly description?: string;
  readonly references: readonly SkillReference[];
  readonly scripts: readonly SkillReference[];
  readonly assets: readonly SkillReference[];
}

export interface SkillDocumentIssue {
  readonly path: string;
  readonly message: string;
}

/** Skill IDs and directory names: lowercase alphanumerics and single hyphens, at most 64 characters. */
export const isValidSkillId = (value: string): boolean =>
  value.length <= skillNameMaxLength && skillNamePattern.test(value);

export const parseSkillDocument = (content: string, skillPath: string): SkillDocument | SkillDocumentIssue => {
  const frontmatter = parseSkillFrontmatter(content, skillPath);

  if ('message' in frontmatter) {
    return frontmatter;
  }

  const { name, description } = frontmatter.record as {
    readonly name?: unknown;
    readonly description?: unknown;
  };

  if (typeof name !== 'string' || !isValidSkillId(name)) {
    return {
      path: skillPath,
      message:
        `SKILL.md 'name' must use lowercase letters, numbers, and single hyphens ` +
        `(max ${skillNameMaxLength} characters).`,
    };
  }

  const sections: Partial<Record<SkillMaterializationSection, readonly SkillReference[]>> = {};

  for (const section of skillMaterializationSections) {
    const entries = frontmatter.record[section];

    if (entries !== undefined && (!Array.isArray(entries) || !entries.every(isSkillReference))) {
      return {
        path: skillPath,
        message: `SKILL.md '${section}' entries must each contain exactly one 'file' or 'repo_file' source.`,
      };
    }

    sections[section] = entries ?? [];
  }

  return {
    name,
    description: typeof description === 'string' ? description : undefined,
    references: sections.references!,
    scripts: sections.scripts!,
    assets: sections.assets!,
  };
};

const parseSkillFrontmatter = (
  content: string,
  skillPath: string,
): { readonly record: Readonly<Record<string, unknown>> } | SkillDocumentIssue => {
  const frontmatter = extractFrontmatter(content);

  if (frontmatter === undefined) {
    return { path: skillPath, message: 'SKILL.md must start with a `---` YAML frontmatter block.' };
  }

  const parsed = parseYamlDocument(frontmatter, skillPath);

  if (!parsed.ok) {
    return { path: skillPath, message: `SKILL.md frontmatter is not valid YAML: ${parsed.issue.message}` };
  }

  const record = parsed.document;

  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { path: skillPath, message: 'SKILL.md frontmatter must be a YAML mapping.' };
  }

  return { record: record as Readonly<Record<string, unknown>> };
};

export const readSkillDocument = (skillPath: string): SkillDocument | SkillDocumentIssue => {
  let content: string;

  try {
    content = readFileSync(skillPath, 'utf8');
  } catch (error) {
    return { path: skillPath, message: `Could not read SKILL.md: ${String(error)}` };
  }

  return parseSkillDocument(content, skillPath);
};

export const isSkillDocumentIssue = (value: SkillDocument | SkillDocumentIssue): value is SkillDocumentIssue =>
  'message' in value;

const extractFrontmatter = (content: string): string | undefined => {
  const lines = content.split('\n');

  if (lines[0]?.trimEnd() !== '---') {
    return undefined;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');

  if (closingIndex === -1) {
    return undefined;
  }

  return lines.slice(1, closingIndex).join('\n');
};
