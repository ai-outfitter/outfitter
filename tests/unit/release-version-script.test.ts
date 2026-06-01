// Tests the release metadata synchronization script used by the npm publish workflow.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const scriptPath = resolve('scripts/sync-release-version.mjs');

const createTemporaryPackageRoot = (packageName = 'bridl', lockfilePackageName = packageName): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-release-version-'));
  temporaryRoots.push(root);
  writeJson(join(root, 'package.json'), { name: packageName, version: '0.1.0' });
  writeJson(join(root, 'package-lock.json'), {
    name: lockfilePackageName,
    version: '0.1.0',
    lockfileVersion: 3,
    packages: {
      '': { name: lockfilePackageName, version: '0.1.0' },
    },
  });
  return root;
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

const runScript = (root: string, version?: string, env: NodeJS.ProcessEnv = {}): string =>
  execFileSync(process.execPath, [scriptPath, ...(version === undefined ? [] : [version]), `--root=${root}`], {
    encoding: 'utf8',
    env: { ...process.env, BRIDL_RELEASE_VERSION: undefined, GITHUB_REF_NAME: undefined, ...env },
  });

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('release version synchronization script', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-009.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('normalizes release tags and updates package metadata consistently', () => {
    const root = createTemporaryPackageRoot();

    expect(runScript(root, 'v1.2.3-alpha.1+build.5')).toContain(
      'Synchronized Bridl release metadata to 1.2.3-alpha.1+build.5.',
    );

    expect(readJson(join(root, 'package.json')).version).toBe('1.2.3-alpha.1+build.5');
    const lockfile = readJson(join(root, 'package-lock.json'));
    expect(lockfile.version).toBe('1.2.3-alpha.1+build.5');
    expect((lockfile.packages as Record<string, Record<string, unknown>>)['']?.version).toBe('1.2.3-alpha.1+build.5');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-009.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses release version sources in precedence order', () => {
    const explicitRoot = createTemporaryPackageRoot();
    const bridlEnvRoot = createTemporaryPackageRoot();
    const githubEnvRoot = createTemporaryPackageRoot();

    runScript(explicitRoot, '1.0.0', { BRIDL_RELEASE_VERSION: '2.0.0', GITHUB_REF_NAME: 'v3.0.0' });
    runScript(bridlEnvRoot, undefined, { BRIDL_RELEASE_VERSION: '2.0.0', GITHUB_REF_NAME: 'v3.0.0' });
    runScript(githubEnvRoot, undefined, { GITHUB_REF_NAME: 'v3.0.0' });

    expect(readJson(join(explicitRoot, 'package.json')).version).toBe('1.0.0');
    expect(readJson(join(bridlEnvRoot, 'package.json')).version).toBe('2.0.0');
    expect(readJson(join(githubEnvRoot, 'package.json')).version).toBe('3.0.0');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-009.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects invalid versions and package metadata mismatches', () => {
    const invalidVersionRoot = createTemporaryPackageRoot();
    const packageMismatchRoot = createTemporaryPackageRoot('not-bridl');
    const lockfileMismatchRoot = createTemporaryPackageRoot('bridl', 'not-bridl');
    const missingLockfileRootPackageRoot = createTemporaryPackageRoot();
    const missingRootPackageLockfile = readJson(join(missingLockfileRootPackageRoot, 'package-lock.json'));
    delete (missingRootPackageLockfile.packages as Record<string, unknown>)[''];
    writeJson(join(missingLockfileRootPackageRoot, 'package-lock.json'), missingRootPackageLockfile);

    const originalInvalidVersionPackageJson = readFileSync(join(invalidVersionRoot, 'package.json'), 'utf8');
    const originalInvalidVersionPackageLockJson = readFileSync(join(invalidVersionRoot, 'package-lock.json'), 'utf8');
    const originalLockfileMismatchPackageJson = readFileSync(join(lockfileMismatchRoot, 'package.json'), 'utf8');
    const originalLockfileMismatchPackageLockJson = readFileSync(
      join(lockfileMismatchRoot, 'package-lock.json'),
      'utf8',
    );

    expect(() => runScript(invalidVersionRoot, '01.2.3')).toThrow('Invalid Bridl release version: 01.2.3');
    expect(readFileSync(join(invalidVersionRoot, 'package.json'), 'utf8')).toBe(originalInvalidVersionPackageJson);
    expect(readFileSync(join(invalidVersionRoot, 'package-lock.json'), 'utf8')).toBe(
      originalInvalidVersionPackageLockJson,
    );
    expect(() => runScript(invalidVersionRoot, '1.2.3-a..b')).toThrow('Invalid Bridl release version: 1.2.3-a..b');
    expect(() => runScript(packageMismatchRoot, '1.2.3')).toThrow("Expected package name 'bridl'");
    expect(() => runScript(lockfileMismatchRoot, '1.2.3')).toThrow("Expected package name 'bridl'");
    expect(readFileSync(join(lockfileMismatchRoot, 'package.json'), 'utf8')).toBe(originalLockfileMismatchPackageJson);
    expect(readFileSync(join(lockfileMismatchRoot, 'package-lock.json'), 'utf8')).toBe(
      originalLockfileMismatchPackageLockJson,
    );
    expect(() => runScript(missingLockfileRootPackageRoot, '1.2.3')).toThrow(
      "Expected package-lock.json to include packages[''] root package metadata.",
    );
  });
});
