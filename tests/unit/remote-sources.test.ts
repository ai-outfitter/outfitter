// Tests remote settings and repository subpath source behavior.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { createRemoteRepositoryCachePath } from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-remote-sources-'));
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

describe('remote source settings', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.5, BRIDL-REQ-002.6, BRIDL-REQ-004.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('syncs remote settings and profile sources from repository subpaths', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      homeDirectory,
      `remote_settings:\n  - github: example/bridl-config\n    ref: main\n    path: settings.yml\n`,
    );

    const syncedSources: string[] = [];
    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(source, cachePath) {
            syncedSources.push(source.github ?? source.uri);
            if (source.github === 'example/bridl-config' && source.path === 'settings.yml') {
              mkdirSync(cachePath, { recursive: true });
              writeFileSync(
                join(cachePath, 'settings.yml'),
                `default_profile: remote\nprofile_sources:\n  - github: example/bridl-config\n    ref: main\n    path: profiles/team\n`,
              );
            } else {
              writeCachedProfile(join(cachePath, source.path ?? ''), 'remote');
            }
            return 'updated';
          },
        },
      },
    );

    expect(syncedSources).toEqual(['example/bridl-config', 'example/bridl-config']);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]?.message).toContain('Remote settings file available');
    expect(result.sources[1]?.message).toBe('1 profile validated.');

    writeSettings(homeDirectory, `remote_settings:\n  - github: example/missing\n    path: missing.yml\n`);
    const missingFileResult = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(_source, cachePath) {
            mkdirSync(cachePath, { recursive: true });
            return 'updated';
          },
        },
      },
    );
    expect(missingFileResult.sources[0]?.status).toBe('failed');
    expect(missingFileResult.sources[0]?.message).toContain('Remote settings file not found');

    writeSettings(homeDirectory, `remote_settings:\n  - github: example/fail\n    path: settings.yml\n`);
    const thrownResult = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync() {
            throw new Error('network unavailable');
          },
        },
      },
    );
    expect(thrownResult.sources[0]?.status).toBe('failed');
    expect(thrownResult.sources[0]?.message).toBe('network unavailable');

    const unsafeSyncCalls: string[] = [];
    writeSettings(homeDirectory, `remote_settings:\n  - github: example/absolute\n    path: /tmp/settings.yml\n`);
    expect(() =>
      executeSyncCommand(
        { homeDirectory, projectDirectory },
        {
          synchronizer: {
            sync(source, cachePath) {
              unsafeSyncCalls.push(source.github ?? source.uri);
              mkdirSync(cachePath, { recursive: true });
              return 'updated';
            },
          },
        },
      ),
    ).toThrow('must be relative');

    writeSettings(homeDirectory, `remote_settings:\n  - github: example/escape\n    path: ../settings.yml\n`);
    expect(() =>
      executeSyncCommand(
        { homeDirectory, projectDirectory },
        {
          synchronizer: {
            sync(source, cachePath) {
              unsafeSyncCalls.push(source.github ?? source.uri);
              mkdirSync(cachePath, { recursive: true });
              return 'updated';
            },
          },
        },
      ),
    ).toThrow('must stay inside the repository');
    expect(unsafeSyncCalls).toEqual([]);

    writeSettings(homeDirectory, `remote_settings:\n  - github: example/invalid\n    path: settings.yml\n`);
    expect(() =>
      executeSyncCommand(
        { homeDirectory, projectDirectory },
        {
          synchronizer: {
            sync(_source, cachePath) {
              mkdirSync(cachePath, { recursive: true });
              writeFileSync(join(cachePath, 'settings.yml'), 'profile_sources:\n  - only: [missing]\n');
              return 'updated';
            },
          },
        },
      ),
    ).toThrow('Cannot sync with invalid settings');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.5, BRIDL-REQ-004.2, BRIDL-REQ-005.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs profiles loaded from GitHub shorthand repository subpaths', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      homeDirectory,
      `default_profile: remote\nprofile_sources:\n  - github: example/bridl-config\n    ref: main\n    path: profiles/team\n`,
    );
    writeCachedProfile(
      join(
        createRemoteRepositoryCachePath(homeDirectory, { github: 'example/bridl-config', ref: 'main' }),
        'profiles',
        'team',
      ),
      'remote',
    );

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      { launcher: { launch: () => Promise.resolve(0) } },
    );

    expect(result.profileId).toBe('remote');

    const rootProfileHomeDirectory = join(root, 'root-profile-home');
    writeSettings(
      rootProfileHomeDirectory,
      `default_profile: remote\nprofile_sources:\n  - github: example/root-profiles\n`,
    );
    writeCachedProfile(
      createRemoteRepositoryCachePath(rootProfileHomeDirectory, { github: 'example/root-profiles' }),
      'remote',
    );
    const rootProfileResult = await executeRunCommand(
      { homeDirectory: rootProfileHomeDirectory, projectDirectory },
      { launcher: { launch: () => Promise.resolve(0) } },
    );
    expect(rootProfileResult.profileId).toBe('remote');

    const escapedProfileHomeDirectory = join(root, 'escaped-profile-home');
    writeSettings(
      escapedProfileHomeDirectory,
      `default_profile: remote\nprofile_sources:\n  - github: example/bridl-config\n    path: ../profiles\n`,
    );
    await expect(
      executeRunCommand(
        { homeDirectory: escapedProfileHomeDirectory, projectDirectory },
        { launcher: { launch: () => Promise.resolve(0) } },
      ),
    ).rejects.toThrow('must stay inside the repository');

    const escapedProfileSyncHomeDirectory = join(root, 'escaped-profile-sync-home');
    writeSettings(
      escapedProfileSyncHomeDirectory,
      `profile_sources:\n  - github: example/escape\n    path: ../profiles\n`,
    );
    const unsafeProfileSyncCalls: string[] = [];
    const escapedProfileSyncResult = executeSyncCommand(
      { homeDirectory: escapedProfileSyncHomeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(source, cachePath) {
            unsafeProfileSyncCalls.push(source.github ?? source.uri);
            mkdirSync(cachePath, { recursive: true });
            return 'updated';
          },
        },
      },
    );
    expect(escapedProfileSyncResult.sources[0]?.status).toBe('failed');
    expect(escapedProfileSyncResult.sources[0]?.message).toContain('must stay inside the repository');
    expect(unsafeProfileSyncCalls).toEqual([]);
  });
});
