// Tests setup command behavior.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeSetupCommand } from '../../src/cli/commands/SetupCommand.js';
import { createProfileSourceCachePath } from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-setup-command-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  const settingsDirectory = join(homeDirectory, '.bridl');
  mkdirSync(settingsDirectory, { recursive: true });
  writeFileSync(join(settingsDirectory, 'settings.yml'), content);
};

const writeCachedProfile = (cachePath: string, profileId = 'remote'): void => {
  const profileDirectory = join(cachePath, profileId);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), `id: ${profileId}\ncontrols: {}\n`);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('setup command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.4, BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates initial user settings and a default user profile without overwriting existing files', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const firstResult = executeSetupCommand({ homeDirectory, projectDirectory });
    const settingsPath = join(homeDirectory, '.bridl', 'settings.yml');
    const defaultProfilePath = join(homeDirectory, '.bridl', 'profiles', 'default', 'profile.yml');

    expect(firstResult.createdSettings).toBe(true);
    expect(firstResult.createdDefaultProfile).toBe(true);
    expect(readFileSync(settingsPath, 'utf8')).toBe(
      'default_profile: default\nprofile_sources:\n  - path: ./profiles\n',
    );
    expect(readFileSync(defaultProfilePath, 'utf8')).toBe('id: default\nlabel: Default\ncontrols: {}\n');
    expect(firstResult.messages).toContain('No URI profile or remote settings sources configured; nothing to sync.');

    writeFileSync(defaultProfilePath, 'id: default\nlabel: Custom\n');
    const secondResult = executeSetupCommand({ homeDirectory, projectDirectory });

    expect(secondResult.createdSettings).toBe(false);
    expect(secondResult.createdDefaultProfile).toBe(false);
    expect(readFileSync(defaultProfilePath, 'utf8')).toBe('id: default\nlabel: Custom\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses a setup source repository as the initial user settings and profiles without overwriting files', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://user:secret@example.test/bridl-config';
    const sourceCachePath = join(root, 'starter-cache');
    mkdirSync(join(sourceCachePath, 'profiles', 'team'), { recursive: true });
    writeFileSync(
      join(sourceCachePath, 'settings.yml'),
      'default_profile: team\nprofile_sources:\n  - path: ./profiles\n',
    );
    writeFileSync(join(sourceCachePath, 'profiles', 'team', 'profile.yml'), 'id: team\nlabel: Team\ncontrols: {}\n');

    const result = executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri },
      {
        setupSourceSynchronizer: {
          sync(uri, cachePath) {
            expect(uri).toBe(setupSourceUri);
            mkdirSync(cachePath, { recursive: true });
            writeFileSync(join(cachePath, 'settings.yml'), readFileSync(join(sourceCachePath, 'settings.yml'), 'utf8'));
            mkdirSync(join(cachePath, 'profiles', 'team'), { recursive: true });
            writeFileSync(
              join(cachePath, 'profiles', 'team', 'profile.yml'),
              readFileSync(join(sourceCachePath, 'profiles', 'team', 'profile.yml'), 'utf8'),
            );
          },
        },
      },
    );

    expect(result.createdSettings).toBe(true);
    expect(result.copiedStarterProfileFiles).toBe(1);
    expect(result.messages.join('\n')).not.toContain('secret');
    expect(result.createdDefaultProfile).toBe(false);
    expect(readFileSync(join(homeDirectory, '.bridl', 'settings.yml'), 'utf8')).toBe(
      'default_profile: team\nprofile_sources:\n  - path: ./profiles\n',
    );
    expect(readFileSync(join(homeDirectory, '.bridl', 'profiles', 'team', 'profile.yml'), 'utf8')).toBe(
      'id: team\nlabel: Team\ncontrols: {}\n',
    );

    writeFileSync(join(homeDirectory, '.bridl', 'settings.yml'), 'default_profile: custom\n');
    writeFileSync(join(homeDirectory, '.bridl', 'profiles', 'team', 'profile.yml'), 'id: team\nlabel: Custom\n');
    const secondResult = executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri },
      {
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            mkdirSync(cachePath, { recursive: true });
            writeFileSync(join(cachePath, 'settings.yml'), 'default_profile: team\n');
            mkdirSync(join(cachePath, 'profiles', 'team'), { recursive: true });
            writeFileSync(join(cachePath, 'profiles', 'team', 'profile.yml'), 'id: team\nlabel: Starter\n');
          },
        },
      },
    );

    expect(secondResult.createdSettings).toBe(false);
    expect(secondResult.copiedStarterProfileFiles).toBe(0);
    expect(readFileSync(join(homeDirectory, '.bridl', 'settings.yml'), 'utf8')).toBe('default_profile: custom\n');
    expect(readFileSync(join(homeDirectory, '.bridl', 'profiles', 'team', 'profile.yml'), 'utf8')).toBe(
      'id: team\nlabel: Custom\n',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates discovered settings before setup and runs URI sync behavior', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const uri = 'ssh://git.example.test/team/profiles';
    writeSettings(homeDirectory, `default_profile: remote\nprofile_sources:\n  - uri: ${uri}\n`);

    const result = executeSetupCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(source, cachePath) {
            expect(source.uri).toBe(uri);
            writeCachedProfile(cachePath);
            return 'unchanged';
          },
        },
      },
    );

    expect(result.createdSettings).toBe(false);
    expect(result.createdDefaultProfile).toBe(true);
    expect(result.syncResult.sources).toEqual([
      {
        uri,
        cachePath: createProfileSourceCachePath(homeDirectory, uri),
        status: 'unchanged',
        message: '1 profile validated.',
      },
    ]);

    const fallbackHomeDirectory = join(root, 'fallback-home');
    writeSettings(fallbackHomeDirectory, 'profile_sources: []\n');
    const fallbackDefaultResult = executeSetupCommand({ homeDirectory: fallbackHomeDirectory, projectDirectory });
    expect(fallbackDefaultResult.defaultProfilePath).toBe(
      join(fallbackHomeDirectory, '.bridl', 'profiles', 'default', 'profile.yml'),
    );
    expect(readFileSync(join(fallbackHomeDirectory, '.bridl', 'settings.yml'), 'utf8')).toContain(
      'default_profile: default',
    );

    const projectDefaultHomeDirectory = join(root, 'project-default-home');
    const projectDefaultDirectory = join(root, 'project-default');
    mkdirSync(join(projectDefaultDirectory, '.bridl'), { recursive: true });
    writeFileSync(join(projectDefaultDirectory, '.bridl', 'settings.yml'), 'default_profile: remote\n');
    const projectDefaultResult = executeSetupCommand({
      homeDirectory: projectDefaultHomeDirectory,
      projectDirectory: projectDefaultDirectory,
    });
    expect(readFileSync(projectDefaultResult.settingsPath, 'utf8')).toContain('default_profile: default');
    expect(projectDefaultResult.defaultProfilePath).toBe(
      join(projectDefaultHomeDirectory, '.bridl', 'profiles', 'default', 'profile.yml'),
    );

    const unsafeDefaultHomeDirectory = join(root, 'unsafe-default-home');
    writeSettings(unsafeDefaultHomeDirectory, 'default_profile: ../../outside\n');
    expect(() => executeSetupCommand({ homeDirectory: unsafeDefaultHomeDirectory, projectDirectory })).toThrow(
      'filesystem-safe',
    );
    expect(existsSync(join(root, 'outside', 'profile.yml'))).toBe(false);

    writeSettings(homeDirectory, 'profile_sources:\n  - only: [remote]\n');
    expect(() => executeSetupCommand({ homeDirectory, projectDirectory })).toThrow(
      'Cannot setup with invalid settings',
    );

    const invalidProjectHomeDirectory = join(root, 'invalid-project-home');
    const invalidProjectDirectory = join(root, 'invalid-project');
    mkdirSync(join(invalidProjectDirectory, '.bridl'), { recursive: true });
    writeFileSync(join(invalidProjectDirectory, '.bridl', 'settings.yml'), 'profile_sources:\n  - only: [remote]\n');
    expect(() =>
      executeSetupCommand({ homeDirectory: invalidProjectHomeDirectory, projectDirectory: invalidProjectDirectory }),
    ).toThrow('Cannot setup with invalid settings');
    expect(existsSync(join(invalidProjectHomeDirectory, '.bridl', 'settings.yml'))).toBe(false);
  });
});
