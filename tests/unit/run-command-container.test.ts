// Tests run command integration with container launch backends.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-command-container-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
  writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), content);
};

const writeProfile = (root: string, id: string, content: string): void => {
  const profileDirectory = join(root, id);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('run command container backend integration', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('wraps the adapter launch plan with a selected container launch backend', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.outfitter', 'profiles');
    mkdirSync(projectDirectory, { recursive: true });
    writeSettings(
      homeDirectory,
      [
        'default_profile: default',
        'default_launch_backend: docker',
        'container_policy:',
        '  env_passthrough:',
        '    - ANTHROPIC_API_KEY',
        'profile_sources:',
        '  - path: ./profiles',
        '',
      ].join('\n'),
    );
    writeProfile(
      profilesDirectory,
      'default',
      [
        'id: default',
        'controls:',
        '  container:',
        '    image: ghcr.io/ai-outfitter/outfitter-pi:0.6.1',
        '    env_passthrough: [ANTHROPIC_API_KEY]',
        '  model: test-model',
        '',
      ].join('\n'),
    );

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, passThroughArgs: ['hello'] },
      {
        writeLine: () => undefined,
        launchBackendResolver: { commandExists: (command) => command === 'docker' },
        stdoutIsTty: false,
        launcher: { launch: () => Promise.resolve(0) },
      },
    );

    expect(result.launchBackendId).toBe('docker');
    expect(result.launchPlan.command).toBe('docker');
    expect(result.innerLaunchPlan?.command).toBe('pi');
    const imageIndex = result.launchPlan.args.indexOf('ghcr.io/ai-outfitter/outfitter-pi:0.6.1');
    expect(imageIndex).toBeGreaterThan(-1);
    expect(result.launchPlan.args.slice(imageIndex, imageIndex + 2)).toEqual([
      'ghcr.io/ai-outfitter/outfitter-pi:0.6.1',
      'pi',
    ]);
    expect(result.launchPlan.args).toContain('--model');
    expect(result.launchPlan.args).toContain('test-model');
    expect(result.launchPlan.args).toContain('hello');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes mutable image warnings fatal in strict mode', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.outfitter', 'profiles');
    mkdirSync(projectDirectory, { recursive: true });
    writeSettings(
      homeDirectory,
      ['default_profile: default', 'profile_sources:', '  - path: ./profiles', ''].join('\n'),
    );
    writeProfile(
      profilesDirectory,
      'default',
      ['id: default', 'controls:', '  container:', '    image: ghcr.io/ai-outfitter/outfitter-pi:latest', ''].join(
        '\n',
      ),
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, strict: true },
        {
          writeLine: () => undefined,
          launchBackendResolver: { commandExists: (command) => command === 'docker' },
          launcher: { launch: () => Promise.resolve(0) },
        },
      ),
    ).rejects.toThrow('mutable');
  });
});
