// Points launched agents at the bundled user-facing Outfitter documentation.
//
// This mirrors pi's own self-documentation mechanism: pi's default system prompt
// lists absolute paths to the docs shipped inside the pi package with guidance to
// read them only when the user asks about pi itself. Outfitter appends the same
// kind of section for its own documentation so an Outfitter-managed agent can
// explain Outfitter features and iterate on its own profiles.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRootDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The docs live at <repo>/docs/documentation in the repository layout and are
// staged to <package>/doc/documentation by scripts/sync-package-assets.mjs for
// the published npm package.
export const resolveOutfitterDocsDirectory = (): string | undefined => {
  const repositoryDocsPath = join(packageRootDirectory, '..', '..', 'docs', 'documentation');
  const packageDocsPath = join(packageRootDirectory, 'doc', 'documentation');

  /* v8 ignore else -- packaged npm layout is exercised after pack, not unit tests. */
  if (existsSync(repositoryDocsPath)) {
    return repositoryDocsPath;
  }

  /* v8 ignore next 3 -- packaged npm layout is exercised after pack, not unit tests. */
  if (existsSync(packageDocsPath)) {
    return packageDocsPath;
  }

  /* v8 ignore next -- defensive fallback for installs that exclude documentation assets. */
  return undefined;
};

export const createOutfitterDocsSystemPrompt = (docsDirectory: string): string => {
  return [
    'Outfitter documentation (read only when the user asks about Outfitter itself — profiles, settings, profile catalogs, setup sources, state persistence, or how to inspect or change this launch configuration):',
    `- Documentation index: ${join(docsDirectory, 'README.md')}`,
    `- Additional docs: ${docsDirectory}`,
    '- When asked about: getting started (getting-started.md), profiles and profile layouts (profiles.md), shared profile repositories and catalogs (profile-repository.md), state persistence (state.md), switching from another agent CLI (switching-to-outfitter.md), first-time CLI agent users (first-time-cli-agent-users.md), iterating on a local or worktree profile — including improving your own active profile (iterating-on-profiles.md)',
    '- When reading Outfitter docs, resolve relative links against the documentation directory, read the referenced .md files completely, and follow cross-references before answering or editing profiles.',
  ].join('\n');
};
