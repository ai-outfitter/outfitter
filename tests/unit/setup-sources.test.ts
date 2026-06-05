// Tests setup source repository behavior.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeSetupCommand } from '../../src/cli/commands/SetupCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'applepi-setup-sources-'));
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
    ['-c', 'user.name=ApplePi Test', '-c', 'user.email=applepi@example.test', 'commit', '-m', 'profiles'],
    { cwd: repositoryPath, stdio: 'pipe' },
  );
  return repositoryPath;
};

const commitAll = (repositoryPath: string, message: string): void => {
  execFileSync('git', ['add', '.'], { cwd: repositoryPath, stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.name=ApplePi Test', '-c', 'user.email=applepi@example.test', 'commit', '-m', message],
    {
      cwd: repositoryPath,
      stdio: 'pipe',
    },
  );
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('setup sources', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fetches setup source repositories with the default git synchronizer', async () => {
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

    const firstResult = await executeSetupCommand({ homeDirectory, projectDirectory, setupSourceUri: repositoryPath });
    const secondResult = await executeSetupCommand({ homeDirectory, projectDirectory, setupSourceUri: repositoryPath });
    const emptySourceHomeDirectory = join(root, 'empty-source-home');
    const emptyRepositoryPath = createGitProfileRepository(root, 'empty-setup-source');
    const emptySourceResult = await executeSetupCommand(
      {
        homeDirectory: emptySourceHomeDirectory,
        projectDirectory,
        setupSourceUri: emptyRepositoryPath,
      },
      {
        synchronizer: {
          sync(_source, cachePath) {
            writeCachedProfile(join(cachePath, 'profiles'), 'engineer');
            return 'updated';
          },
        },
      },
    );
    const nestedHomeDirectory = join(root, 'nested-home');
    const nestedRepositoryPath = createGitProfileRepository(root, 'nested-setup-source');
    mkdirSync(join(nestedRepositoryPath, '.applepi', 'profiles', 'default'), { recursive: true });
    writeFileSync(join(nestedRepositoryPath, '.applepi', 'settings.yml'), 'profile_sources:\n  - path: ./profiles\n');
    writeFileSync(
      join(nestedRepositoryPath, '.applepi', 'profiles', 'default', 'profile.yml'),
      'id: default\ncontrols: {}\n',
    );
    symlinkSync(
      join(root, 'outside-profile.yml'),
      join(nestedRepositoryPath, '.applepi', 'profiles', 'default', 'linked.yml'),
    );
    commitAll(nestedRepositoryPath, 'nested-setup');
    const nestedSourceResult = await executeSetupCommand({
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
      join(emptySourceHomeDirectory, '.applepi', 'profiles', 'engineer', 'profile.yml'),
    );
    expect(nestedSourceResult.copiedStarterProfileFiles).toBe(1);
    expect(nestedSourceResult.defaultProfilePath).toBe(
      join(nestedHomeDirectory, '.applepi', 'profiles', 'engineer', 'profile.yml'),
    );
    expect(readFileSync(join(nestedHomeDirectory, '.applepi', 'settings.yml'), 'utf8')).toContain(
      'default_profile: engineer',
    );
    expect(existsSync(join(nestedHomeDirectory, '.applepi', 'profiles', 'default', 'linked.yml'))).toBe(false);
    await expect(
      executeSetupCommand({
        homeDirectory: join(root, 'missing-source-home'),
        projectDirectory,
        setupSourceUri: join(root, 'missing-source'),
      }),
    ).rejects.toThrow('does not exist');
    await expect(
      executeSetupCommand({
        homeDirectory: invalidHomeDirectory,
        projectDirectory,
        setupSourceUri: invalidRepositoryPath,
      }),
    ).rejects.toThrow('Cannot setup from invalid starter settings');
  });
});
