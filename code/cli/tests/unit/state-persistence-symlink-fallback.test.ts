// Tests the Windows-only symlink fallback behavior for environments that deny symlink creation
// (e.g. Windows without Developer Mode): directories fall back to junctions and files fall
// back to a copy with a warning, while POSIX permission errors keep failing loudly.
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureStateSourcePath,
  materializeCompositeProfileStatePath,
} from '../../src/compositeProfile/StatePersistence.js';
import { createSafeSymlink } from '../../src/fs/SafeSymlink.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-symlink-fallback-'));
  temporaryRoots.push(root);
  return root;
};

const createDenyingSymlink = (deniedTypes: readonly (string | undefined)[], symlinkTypes: (string | undefined)[]) =>
  ((target: string, path: string, type?: string) => {
    symlinkTypes.push(type);

    if (deniedTypes.includes(type)) {
      throw Object.assign(new Error(`EPERM: operation not permitted, symlink '${target}' -> '${path}'`), {
        code: 'EPERM',
      });
    }

    symlinkSync(target, path);
  }) as typeof symlinkSync;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('state persistence symlink fallback', () => {
  it('falls back to junctions for directories and copies for files when Windows denies symlink creation', () => {
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
    const dependencies = {
      symlink: denyingSymlink,
      warn: (message: string) => warnings.push(message),
      platform: 'win32' as const,
    };

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

  it('copies directories with a warning when Windows also denies junction creation', () => {
    const root = createTemporaryRoot();
    const sourceDirectory = ensureStateSourcePath(join(root, 'source', 'plugins'), true);
    writeFileSync(join(sourceDirectory, 'plugin.json'), '{"copied":true}\n');
    const symlinkTypes: (string | undefined)[] = [];
    const warnings: string[] = [];

    materializeCompositeProfileStatePath(
      root,
      { relativePath: 'plugins/', strategy: 'symlink', sourcePath: sourceDirectory, directory: true },
      {
        symlink: createDenyingSymlink(['dir', 'junction'], symlinkTypes),
        warn: (message: string) => warnings.push(message),
        platform: 'win32',
      },
    );

    expect(symlinkTypes).toEqual(['dir', 'junction']);
    expect(lstatSync(join(root, 'plugins')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(root, 'plugins', 'plugin.json'), 'utf8')).toBe('{"copied":true}\n');
    expect(warnings).toEqual([
      `State path 'plugins/' could not be symlinked (symlinks are unavailable on this platform); ` +
        `copied '${sourceDirectory}' instead, so writes to it will not persist back.`,
    ]);
  });

  it('rethrows Windows junction failures that are not permission errors', () => {
    const root = createTemporaryRoot();
    const sourceDirectory = ensureStateSourcePath(join(root, 'source', 'plugins'), true);
    const symlinkTypes: (string | undefined)[] = [];
    const brokenJunctionSymlink = ((target: string, path: string, type?: string) => {
      symlinkTypes.push(type);

      if (type === 'dir') {
        throw Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' });
      }

      throw Object.assign(new Error(`EEXIST: file already exists, symlink '${target}' -> '${path}'`), {
        code: 'EEXIST',
      });
    }) as typeof symlinkSync;

    expect(() =>
      materializeCompositeProfileStatePath(
        root,
        { relativePath: 'plugins/', strategy: 'symlink', sourcePath: sourceDirectory, directory: true },
        { symlink: brokenJunctionSymlink, platform: 'win32' },
      ),
    ).toThrow('EEXIST: file already exists, symlink');
    expect(symlinkTypes).toEqual(['dir', 'junction']);
  });

  it('rethrows permission errors on POSIX platforms instead of copying', () => {
    const root = createTemporaryRoot();
    const sourceFile = ensureStateSourcePath(join(root, 'source', 'settings.json'), false);
    const warnings: string[] = [];

    expect(() =>
      materializeCompositeProfileStatePath(
        root,
        { relativePath: 'settings.json', strategy: 'symlink', sourcePath: sourceFile, directory: false },
        {
          symlink: createDenyingSymlink(['file'], []),
          warn: (message: string) => warnings.push(message),
          platform: 'linux',
        },
      ),
    ).toThrow('EPERM: operation not permitted, symlink');
    expect(existsSync(join(root, 'settings.json'))).toBe(false);
    expect(warnings).toEqual([]);
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
        { symlink: brokenSymlink, platform: 'win32' },
      ),
    ).toThrow('EEXIST: file already exists, symlink');
  });

  it('creates real symlinks directly through the shared safe symlink helper', () => {
    const root = createTemporaryRoot();
    const sourceFile = ensureStateSourcePath(join(root, 'source', 'settings.json'), false);

    createSafeSymlink({
      sourcePath: sourceFile,
      outputPath: join(root, 'settings.json'),
      directory: false,
      label: `State path 'settings.json'`,
    });

    expect(readlinkSync(join(root, 'settings.json'))).toBe(sourceFile);
  });
});
