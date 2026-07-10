// Materializes Outfitter's own self-documentation skill into composite profiles.
//
// The skill is authored as a regular project skill at <repo>/.outfitter/skills/outfitter
// (see docs/documentation/skills.md) so Outfitter dogfoods the documented skill layout.
// Outfitter resolves the skill from the repository or packaged npm layout, materializes
// its declared `file:` references under the generated skill's references/ directory, and
// publishes the generated skill through each adapter's native skill mechanism. This
// replaces the earlier append-system-prompt documentation pointer, which only pi
// launches could read.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import type { CompositeProfileFile } from '../compositeProfile/CompositeProfileFile.js';
import { createCompositeProfileFile } from '../compositeProfile/CompositeProfileFile.js';

const packageRootDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const skillRelativePath = join('.outfitter', 'skills', 'outfitter');

export interface OutfitterSkillSource {
  /** Directory containing the authored SKILL.md. */
  readonly skillDirectory: string;
  /** Root that `file:` reference entries resolve from (the repository containing the skill). */
  readonly referenceRootDirectory: string;
}

// The skill lives at <repo>/.outfitter/skills/outfitter in the repository layout; the
// packaged npm layout stages the same relative path (with docs/documentation beside it)
// via scripts/sync-package-assets.mjs.
export const resolveOutfitterSkillSource = (): OutfitterSkillSource | undefined => {
  const repositoryRoot = join(packageRootDirectory, '..', '..');

  /* v8 ignore else -- packaged npm layout is exercised after pack, not unit tests. */
  if (existsSync(join(repositoryRoot, skillRelativePath, 'SKILL.md'))) {
    return { skillDirectory: join(repositoryRoot, skillRelativePath), referenceRootDirectory: repositoryRoot };
  }

  /* v8 ignore next 6 -- packaged npm layout is exercised after pack, not unit tests. */
  if (existsSync(join(packageRootDirectory, skillRelativePath, 'SKILL.md'))) {
    return {
      skillDirectory: join(packageRootDirectory, skillRelativePath),
      referenceRootDirectory: packageRootDirectory,
    };
  }

  /* v8 ignore next -- defensive fallback for installs that exclude the bundled skill. */
  return undefined;
};

const createOutfitterSkillCompositeFiles = (
  rootDirectory: string,
  skillCompositeRelativePath: string,
  source: OutfitterSkillSource | undefined,
): readonly CompositeProfileFile[] => {
  /* v8 ignore next 3 -- defensive fallback for installs that exclude the bundled skill. */
  if (source === undefined) {
    return [];
  }

  const skillPath = join(source.skillDirectory, 'SKILL.md');
  const skillMarkdown = readFileSync(skillPath, 'utf8');

  return [
    createCompositeProfileFile({
      rootDirectory,
      relativePath: `${skillCompositeRelativePath}/SKILL.md`,
      content: skillMarkdown,
      sourceInputs: [skillPath],
      strategy: 'transform',
    }),
    ...createReferenceFiles(rootDirectory, skillCompositeRelativePath, source, skillMarkdown, skillPath),
  ];
};

// The generated skill lives inside a Claude-plugin-shaped bundle under the composite
// profile's outfitter/ namespace, so agent writes there are never mistaken for user
// state and profile-selected skills generated under outfitter/skills/ cannot collide
// with it. Claude launches load the bundle with --plugin-dir (the skills/ state path
// stays reserved for user skills); pi launches pass the inner skill directory with
// --skill.
export const outfitterPluginCompositeRelativePath = 'outfitter/plugin';
export const outfitterPluginSkillCompositeRelativePath = `${outfitterPluginCompositeRelativePath}/skills/outfitter`;

export const createOutfitterPluginCompositeFiles = (
  rootDirectory: string,
  source: OutfitterSkillSource | undefined = resolveOutfitterSkillSource(),
): readonly CompositeProfileFile[] => {
  /* v8 ignore next 3 -- defensive fallback for installs that exclude the bundled skill. */
  if (source === undefined) {
    return [];
  }

  return [
    createCompositeProfileFile({
      rootDirectory,
      relativePath: `${outfitterPluginCompositeRelativePath}/.claude-plugin/plugin.json`,
      content: `${JSON.stringify(
        {
          name: 'outfitter',
          description: 'Outfitter self-documentation skill for Outfitter-managed launches.',
        },
        null,
        2,
      )}\n`,
      sourceInputs: [join(source.skillDirectory, 'SKILL.md')],
      strategy: 'transform',
    }),
    ...createOutfitterSkillCompositeFiles(rootDirectory, outfitterPluginSkillCompositeRelativePath, source),
  ];
};

const createReferenceFiles = (
  rootDirectory: string,
  skillCompositeRelativePath: string,
  source: OutfitterSkillSource,
  skillMarkdown: string,
  skillPath: string,
): readonly CompositeProfileFile[] => {
  const seenBasenames = new Set<string>();

  return parseSkillFileReferences(skillMarkdown, skillPath).map((referencePath) => {
    const sourcePath = join(source.referenceRootDirectory, referencePath);
    const destinationName = basename(referencePath);

    if (seenBasenames.has(destinationName)) {
      throw new Error(`Outfitter skill references collide on basename '${destinationName}' in '${skillPath}'.`);
    }

    seenBasenames.add(destinationName);

    if (!existsSync(sourcePath)) {
      throw new Error(`Outfitter skill reference '${referencePath}' is missing at '${sourcePath}'.`);
    }

    return createCompositeProfileFile({
      rootDirectory,
      relativePath: `${skillCompositeRelativePath}/references/${destinationName}`,
      content: readFileSync(sourcePath, 'utf8'),
      sourceInputs: [sourcePath],
      strategy: 'transform',
    });
  });
};

const parseSkillFileReferences = (skillMarkdown: string, skillPath: string): readonly string[] => {
  const frontmatter = extractFrontmatter(skillMarkdown);

  if (frontmatter === undefined) {
    return [];
  }

  const parsed: unknown = parse(frontmatter);
  const references =
    parsed !== null && typeof parsed === 'object' && 'references' in parsed ? parsed.references : undefined;

  if (references === undefined) {
    return [];
  }

  if (!Array.isArray(references)) {
    throw new Error(`Outfitter skill frontmatter 'references' must be a list in '${skillPath}'.`);
  }

  const entries: readonly unknown[] = references;

  return entries.map((entry) => {
    const file = entry !== null && typeof entry === 'object' ? (entry as { readonly file?: unknown }).file : undefined;

    if (typeof file !== 'string') {
      throw new Error(`Outfitter skill references must be { file: <path> } entries in '${skillPath}'.`);
    }

    return file;
  });
};

const extractFrontmatter = (skillMarkdown: string): string | undefined => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skillMarkdown);

  return match?.[1];
};
