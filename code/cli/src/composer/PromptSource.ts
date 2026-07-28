// Resolves prompt source references declared in agent frontmatter with containment provenance.
import { existsSync, realpathSync, statSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { escapesRoots } from '../dump/Containment.js';
import type { Layer } from '../resolver/Resource.js';

export type PromptSourceKind = 'root' | 'file' | 'repo_file' | 'agent_body';

export interface PromptSourceReference {
  readonly file?: string;
  readonly repo_file?: string;
}

export interface PromptFragment {
  readonly kind: PromptSourceKind;
  readonly content: string;
  readonly path?: string;
  readonly reference?: string;
  readonly declaringAgent?: string;
  readonly layer?: Layer;
  /** Human-readable label used for deterministic generated filenames and dump metadata. */
  readonly label: string;
  /** Repository prompt content is untrusted active-project content, not catalog policy. */
  readonly trust: 'catalog' | 'repository' | 'generated';
}

export interface PromptResolution {
  readonly fragment?: PromptFragment;
  readonly warning?: string;
  readonly error?: string;
}

export const isPromptSourceReference = (value: unknown): value is PromptSourceReference =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  ((typeof (value as { file?: unknown }).file === 'string' &&
    (value as { repo_file?: unknown }).repo_file === undefined) ||
    (typeof (value as { repo_file?: unknown }).repo_file === 'string' &&
      (value as { file?: unknown }).file === undefined));

const safeRelative = (value: string): boolean =>
  value.length > 0 && !value.startsWith('/') && !value.split(/[\\/]+/).includes('..');

const containedFile = (path: string, root: string): true | string => {
  if (!existsSync(path)) return `missing file '${path}'.`;

  let real: string;
  try {
    real = realpathSync(path);
    /* v8 ignore next 2 -- existsSync succeeded; this only covers a concurrent filesystem race. */
  } catch (error) {
    return `cannot resolve '${path}': ${String(error)}`;
  }

  if (escapesRoots(real, [root])) return `'${path}' resolves outside '${root}'.`;

  try {
    if (!statSync(real).isFile()) return `'${path}' is not a file.`;
    /* v8 ignore next 2 -- realpathSync succeeded; this only covers a concurrent filesystem race. */
  } catch (error) {
    return `cannot stat '${path}': ${String(error)}`;
  }

  return true;
};

export const promptSourceKey = (source: PromptSourceReference): string =>
  source.file !== undefined ? `file:${source.file}` : `repo_file:${source.repo_file!}`;

export const resolvePromptSource = (input: {
  readonly source: PromptSourceReference;
  readonly declaringAgent: string;
  readonly layer: Layer;
  readonly projectDirectory?: string;
  readonly optionalRepoFile?: boolean;
  readonly label: string;
}): PromptResolution => {
  const { source, declaringAgent, layer, label } = input;

  if (source.file !== undefined) {
    if (!safeRelative(source.file)) {
      return {
        error: `agent '${declaringAgent}' prompt source file '${source.file}' must be a contained relative path.`,
      };
    }
    const path = join(layer.root, source.file);
    const contained = containedFile(path, layer.root);
    if (contained !== true) return { error: `agent '${declaringAgent}' prompt source file ${contained}` };
    return {
      fragment: {
        kind: 'file',
        content: readFileSync(path, 'utf8'),
        path,
        reference: source.file,
        declaringAgent,
        layer,
        label,
        trust: 'catalog',
      },
    };
  }

  const repoFile = source.repo_file!;
  if (!safeRelative(repoFile)) {
    return {
      error: `agent '${declaringAgent}' repo_file prompt source '${repoFile}' must be a contained relative path.`,
    };
  }

  const projectDirectory = input.projectDirectory;
  if (projectDirectory === undefined) {
    return {
      warning: `agent '${declaringAgent}' repo_file prompt source '${repoFile}' cannot be resolved without a project root.`,
    };
  }

  const path = join(projectDirectory, repoFile);
  if (!existsSync(path) && input.optionalRepoFile === true) {
    return { warning: `agent '${declaringAgent}' optional repo_file prompt source '${repoFile}' was not found.` };
  }
  const contained = containedFile(path, projectDirectory);
  if (contained !== true) return { error: `agent '${declaringAgent}' repo_file prompt source ${contained}` };

  return {
    fragment: {
      kind: 'repo_file',
      content: readFileSync(path, 'utf8'),
      path,
      reference: repoFile,
      declaringAgent,
      layer,
      label,
      trust: 'repository',
    },
  };
};

export const rootPromptFragment = (input: {
  readonly fileName: string;
  readonly layer: Layer;
  readonly content: string;
}): PromptFragment => ({
  kind: 'root',
  content: input.content,
  path: join(input.layer.root, input.fileName),
  reference: input.fileName,
  layer: input.layer,
  label: input.fileName.replace(/\.md$/, ''),
  trust: 'catalog',
});

export const agentBodyFragment = (input: {
  readonly agent: string;
  readonly layer: Layer;
  readonly path: string;
  readonly content: string;
}): PromptFragment => ({
  kind: 'agent_body',
  content: input.content,
  path: input.path,
  reference: relative(dirname(input.path), input.path),
  declaringAgent: input.agent,
  layer: input.layer,
  label: `agent-${input.agent}`,
  trust: 'catalog',
});
