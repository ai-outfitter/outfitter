// Tests run command cache directory forwarding into pi persistent state paths.
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-cache-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
  writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), content);
};

const writeProfile = (profilesRoot: string, id: string, content: string): void => {
  const profileDirectory = join(profilesRoot, id);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('run command cache persistence', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses the default cache directory for pi utilities state paths during run command execution', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(join(homeDirectory, '.outfitter', 'profiles'), 'default', 'id: default\ncontrols: {}\n');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      { launcher: { launch: () => Promise.resolve(0) }, writeLine: () => undefined },
    );

    expect(readlinkSync(join(result.compositeProfileDirectory, 'utilities'))).toBe(
      join(homeDirectory, '.outfitter', 'cache', 'utilities'),
    );
    expect(readlinkSync(join(result.compositeProfileDirectory, 'bin'))).toBe(
      join(homeDirectory, '.outfitter', 'cache', 'utilities'),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses configured cache directories for pi utilities state paths during run command execution', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const cacheDirectory = join(homeDirectory, '.outfitter', 'custom-cache');
    writeSettings(
      homeDirectory,
      'default_profile: default\ncache_directory: ./custom-cache\nprofile_sources:\n  - path: ./profiles\n',
    );
    writeProfile(join(homeDirectory, '.outfitter', 'profiles'), 'default', 'id: default\ncontrols: {}\n');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      { launcher: { launch: () => Promise.resolve(0) }, writeLine: () => undefined },
    );

    expect(readlinkSync(join(result.compositeProfileDirectory, 'utilities'))).toBe(join(cacheDirectory, 'utilities'));
    expect(readlinkSync(join(result.compositeProfileDirectory, 'bin'))).toBe(join(cacheDirectory, 'utilities'));
  });
});
