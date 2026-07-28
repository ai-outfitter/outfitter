// Tests prompt source parsing, containment, optional repository behavior, and provenance.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isPromptSourceReference, promptSourceKey, resolvePromptSource } from '../../src/composer/PromptSource.js';
import type { Layer } from '../../src/resolver/Resource.js';

const roots: string[] = [];
const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-prompt-source-'));
  roots.push(root);
  return root;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const layer = (root: string): Layer => ({ root, origin: 'source', label: 'catalog' });
const resolve = (root: string, source: { readonly file?: string; readonly repo_file?: string }, project?: string) =>
  resolvePromptSource({
    source,
    declaringAgent: 'engineer',
    layer: layer(root),
    projectDirectory: project,
    optionalRepoFile: true,
    label: 'test',
  });

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('prompt sources', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts exactly one supported source key and creates stable keys', () => {
    expect(isPromptSourceReference({ file: 'prompt.md' })).toBe(true);
    expect(isPromptSourceReference({ repo_file: 'README.md' })).toBe(true);
    expect(isPromptSourceReference({ file: 'a', repo_file: 'b' })).toBe(false);
    expect(isPromptSourceReference({ file: 1 })).toBe(false);
    expect(isPromptSourceReference(null)).toBe(false);
    expect(isPromptSourceReference([])).toBe(false);
    expect(promptSourceKey({ file: 'prompt.md' })).toBe('file:prompt.md');
    expect(promptSourceKey({ repo_file: 'README.md' })).toBe('repo_file:README.md');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects missing files, directories, absolute paths, traversal, and symlink escapes', () => {
    const catalog = temporaryRoot();
    const outside = temporaryRoot();
    write(join(outside, 'secret.md'), 'secret');
    mkdirSync(join(catalog, 'directory'), { recursive: true });
    symlinkSync(join(outside, 'secret.md'), join(catalog, 'linked.md'));

    expect(resolve(catalog, { file: 'missing.md' }).error).toContain('missing file');
    expect(resolve(catalog, { file: 'directory' }).error).toContain('is not a file');
    expect(resolve(catalog, { file: '/absolute.md' }).error).toContain('contained relative path');
    expect(resolve(catalog, { file: '../secret.md' }).error).toContain('contained relative path');
    expect(resolve(catalog, { file: 'linked.md' }).error).toContain('resolves outside');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns for optional repository sources that lack a project root or file', () => {
    const catalog = temporaryRoot();
    const project = temporaryRoot();

    expect(resolve(catalog, { repo_file: 'README.md' }).warning).toContain('without a project root');
    expect(resolve(catalog, { repo_file: 'README.md' }, project).warning).toContain('was not found');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects unsafe repository paths, directories, and symlink escapes', () => {
    const catalog = temporaryRoot();
    const project = temporaryRoot();
    const outside = temporaryRoot();
    write(join(outside, 'secret.md'), 'secret');
    mkdirSync(join(project, 'directory'), { recursive: true });
    symlinkSync(join(outside, 'secret.md'), join(project, 'linked.md'));

    expect(resolve(catalog, { repo_file: '../secret.md' }, project).error).toContain('contained relative path');
    expect(resolve(catalog, { repo_file: 'directory' }, project).error).toContain('is not a file');
    expect(resolve(catalog, { repo_file: 'linked.md' }, project).error).toContain('resolves outside');
  });
});
