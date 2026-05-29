// Tests setup source repository behavior.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeSetupCommand } from '../../src/cli/commands/SetupCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-setup-sources-'));
  temporaryRoots.push(root);
  return root;
};

const writeCachedProfile = (cachePath: string, profileId = 'remote'): void => {
  const profileDirectory = join(cachePath, profileId);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), `id: ${profileId}\ncontrols: {}\n`);
};

const createGitProfileRepository = (root: string, repositoryName: string): string => {
  const repositoryPath = join(root, repositoryName);
  writeCachedProfile(repositoryPath, 'remote');
  execFileSync('git', ['init', '--initial-branch', 'main'], { cwd: repositoryPath, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: repositoryPath, stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.name=Bridl Test', '-c', 'user.email=bridl@example.test', 'commit', '-m', 'profiles'],
    { cwd: repositoryPath, stdio: 'pipe' },
  );
  return repositoryPath;
};

const commitAll = (repositoryPath: string, message: string): void => {
  execFileSync('git', ['add', '.'], { cwd: repositoryPath, stdio: 'pipe' });
  execFileSync('git', ['-c', 'user.name=Bridl Test', '-c', 'user.email=bridl@example.test', 'commit', '-m', message], {
    cwd: repositoryPath,
    stdio: 'pipe',
  });
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('setup sources', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fetches setup source repositories with the default git synchronizer', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const repositoryPath = createGitProfileRepository(root, 'setup-source');
    writeFileSync(
      join(repositoryPath, 'settings.yml'),
      'default_profile: remote\nprofile_sources:\n  - path: ./profiles\n',
    );
    mkdirSync(join(repositoryPath, 'profiles', 'remote'), { recursive: true });
    writeFileSync(
      join(repositoryPath, 'profiles', 'remote', 'profile.yml'),
      'id: remote\nlabel: Remote\ncontrols: {}\n',
    );
    commitAll(repositoryPath, 'setup');

    const firstResult = executeSetupCommand({ homeDirectory, projectDirectory, setupSourceUri: repositoryPath });
    const secondResult = executeSetupCommand({ homeDirectory, projectDirectory, setupSourceUri: repositoryPath });
    const emptySourceHomeDirectory = join(root, 'empty-source-home');
    const emptyRepositoryPath = createGitProfileRepository(root, 'empty-setup-source');
    const emptySourceResult = executeSetupCommand({
      homeDirectory: emptySourceHomeDirectory,
      projectDirectory,
      setupSourceUri: emptyRepositoryPath,
    });
    const nestedHomeDirectory = join(root, 'nested-home');
    const nestedRepositoryPath = createGitProfileRepository(root, 'nested-setup-source');
    mkdirSync(join(nestedRepositoryPath, '.bridl', 'profiles', 'default'), { recursive: true });
    writeFileSync(join(nestedRepositoryPath, '.bridl', 'settings.yml'), 'profile_sources:\n  - path: ./profiles\n');
    writeFileSync(
      join(nestedRepositoryPath, '.bridl', 'profiles', 'default', 'profile.yml'),
      'id: default\ncontrols: {}\n',
    );
    symlinkSync(
      join(root, 'outside-profile.yml'),
      join(nestedRepositoryPath, '.bridl', 'profiles', 'default', 'linked.yml'),
    );
    commitAll(nestedRepositoryPath, 'nested-setup');
    const nestedSourceResult = executeSetupCommand({
      homeDirectory: nestedHomeDirectory,
      projectDirectory,
      setupSourceUri: nestedRepositoryPath,
    });
    const invalidHomeDirectory = join(root, 'invalid-home');
    const invalidRepositoryPath = createGitProfileRepository(root, 'invalid-setup-source');
    writeFileSync(join(invalidRepositoryPath, 'settings.yml'), 'profile_sources:\n  - only: [missing]\n');
    commitAll(invalidRepositoryPath, 'invalid-setup');

    expect(firstResult.createdSettings).toBe(true);
    expect(firstResult.createdDefaultProfile).toBe(false);
    expect(secondResult.createdSettings).toBe(false);
    expect(emptySourceResult.defaultProfilePath).toBe(
      join(emptySourceHomeDirectory, '.bridl', 'profiles', 'default', 'profile.yml'),
    );
    expect(nestedSourceResult.copiedStarterProfileFiles).toBe(1);
    expect(readFileSync(join(nestedHomeDirectory, '.bridl', 'settings.yml'), 'utf8')).toContain(
      'default_profile: default',
    );
    expect(existsSync(join(nestedHomeDirectory, '.bridl', 'profiles', 'default', 'linked.yml'))).toBe(false);
    expect(() =>
      executeSetupCommand({
        homeDirectory: join(root, 'missing-source-home'),
        projectDirectory,
        setupSourceUri: join(root, 'missing-source'),
      }),
    ).toThrow('does not exist');
    expect(() =>
      executeSetupCommand({
        homeDirectory: invalidHomeDirectory,
        projectDirectory,
        setupSourceUri: invalidRepositoryPath,
      }),
    ).toThrow('Cannot setup from invalid starter settings');
  });
});
