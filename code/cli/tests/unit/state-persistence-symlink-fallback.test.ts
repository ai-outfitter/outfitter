// Tests the symlink fallback behavior for platforms/filesystems that deny symlink creation
// (e.g. Windows without Developer Mode): directories fall back to junctions and files fall
// back to a copy with a warning.
import { lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureStateSourcePath,
  materializeCompositeProfileStatePath,
} from '../../src/compositeProfile/StatePersistence.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-symlink-fallback-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('state persistence symlink fallback', () => {
  it('falls back to junctions for directories and copies for files when symlink creation is denied', () => {
    const root = createTemporaryRoot();
    const sourceFile = ensureStateSourcePath(join(root, 'source', 'settings.json'), false);
    const sourceDirectory = ensureStateSourcePath(join(root, 'source', 'plugins'), true);
    writeFileSync(sourceFile, '{"kept":true}\n');
    const symlinkTypes: (string | undefined)[] = [];
    const denyingSymlink = ((target: string, path: string, type?: string) => {
      symlinkTypes.push(type);

      if (type === 'dir') {
        throw Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' });
      }

      if (type === 'file') {
        throw Object.assign(new Error('EACCES: permission denied, symlink'), { code: 'EACCES' });
      }

      symlinkSync(target, path);
    }) as typeof symlinkSync;
    const warnings: string[] = [];
    const dependencies = { symlink: denyingSymlink, warn: (message: string) => warnings.push(message) };

    materializeCompositeProfileStatePath(
      root,
      { relativePath: 'plugins/', strategy: 'symlink', sourcePath: sourceDirectory, directory: true },
      dependencies,
    );
    materializeCompositeProfileStatePath(
      root,
      { relativePath: 'settings.json', strategy: 'symlink', sourcePath: sourceFile, directory: false },
      dependencies,
    );

    expect(symlinkTypes).toEqual(['dir', 'junction', 'file']);
    expect(lstatSync(join(root, 'plugins')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, 'plugins'))).toBe(resolve(sourceDirectory));
    expect(lstatSync(join(root, 'settings.json')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('{"kept":true}\n');
    expect(warnings).toEqual([
      `State path 'settings.json' could not be symlinked (symlinks are unavailable on this platform); ` +
        `copied '${sourceFile}' instead, so writes to it will not persist back.`,
    ]);
  });

  it('rethrows symlink failures that are not permission errors', () => {
    const root = createTemporaryRoot();
    const sourceFile = ensureStateSourcePath(join(root, 'source', 'settings.json'), false);
    const brokenSymlink = (() => {
      throw Object.assign(new Error('EEXIST: file already exists, symlink'), { code: 'EEXIST' });
    }) as unknown as typeof symlinkSync;

    expect(() =>
      materializeCompositeProfileStatePath(
        root,
        { relativePath: 'settings.json', strategy: 'symlink', sourcePath: sourceFile, directory: false },
        { symlink: brokenSymlink },
      ),
    ).toThrow('EEXIST: file already exists, symlink');
  });
});
