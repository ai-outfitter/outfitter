// Tests tack assembly, pi adapter translation, and run command launch behavior.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { executeRunCommand, resolveChildExitCode } from '../../src/cli/commands/RunCommand.js';
import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';
import { createTack } from '../../src/tack/Tack.js';
import { assembleTack, writeTack } from '../../src/tack/TackAssembler.js';
import { createTackFile } from '../../src/tack/TackFile.js';
import { createProfileWatchPaths, tackFileOutputPath, watchTackInputs } from '../../src/tack/TackWatcher.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-phase56-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.bridl'), { recursive: true });
  writeFileSync(join(homeDirectory, '.bridl', 'settings.yml'), content);
};

const writeProfile = (root: string, id: string, content: string): string => {
  const profileDirectory = join(root, id);
  mkdirSync(profileDirectory, { recursive: true });
  const profilePath = join(profileDirectory, 'profile.yml');
  writeFileSync(profilePath, content);
  return profilePath;
};

const waitForFileContent = async (path: string, content: string): Promise<void> => {
  await waitForFileMatching(path, (actual) => actual === content);
  expect(readFileSync(path, 'utf8')).toBe(content);
};

const waitForFileContaining = async (path: string, content: string): Promise<void> => {
  await waitForFileMatching(path, (actual) => actual.includes(content));
  expect(readFileSync(path, 'utf8')).toContain(content);
};

const waitForFileMatching = async (path: string, predicate: (content: string) => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (existsSync(path) && predicate(readFileSync(path, 'utf8'))) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('phase 5 tack assembly and phase 6 pi run support', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.2, BRIDL-REQ-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('represents tack files with source inputs, output paths, and transform strategy', () => {
    const tackFile = createTackFile({
      rootDirectory: '/tmp/bridl-default-pi-abc',
      relativePath: 'bridl/profile.json',
      content: '{}\n',
      sourceInputs: ['/profiles/default/profile.yml'],
      strategy: 'transform',
    });

    expect(tackFile).toEqual({
      relativePath: 'bridl/profile.json',
      content: '{}\n',
      sourceInputs: ['/profiles/default/profile.yml'],
      outputPath: '/tmp/bridl-default-pi-abc/bridl/profile.json',
      strategy: 'transform',
    });
    expect(createTackFile('EMPTY.md')).toMatchObject({ content: '', outputPath: 'EMPTY.md' });
    expect(createTackFile({ relativePath: 'generated.txt', content: 'hello' })).toMatchObject({
      sourceInputs: [],
      strategy: 'generate',
    });
    expect(assembleTack({ files: [] }).rootDirectory).toContain('bridl-profile-agent-');

    const root = createTemporaryRoot();
    expect(() =>
      writeTack(
        createTack(join(root, 'tack'), [
          createTackFile({ rootDirectory: join(root, 'other'), relativePath: 'outside.txt', content: 'nope' }),
        ]),
      ),
    ).toThrow('must stay under tack root');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.3, BRIDL-REQ-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses generic and pi array controls from profile YAML', () => {
    const profile = parseProfileYaml(
      [
        'id: arrays',
        'controls:',
        '  args: [--generic]',
        '  extensions: [ext-a]',
        '  skills: [skill-a]',
        '  pi:',
        '    args: [--pi]',
        '    extensions: [ext-pi]',
        '    skills: [skill-pi]',
        '',
      ].join('\n'),
      'fallback',
    );

    expect('message' in profile).toBe(false);
    if (!('message' in profile)) {
      expect(profile.controls.args).toEqual(['--generic']);
      expect(profile.controls.extensions).toEqual(['ext-a']);
      expect(profile.controls.skills).toEqual(['skill-a']);
      expect(profile.controls.pi?.args).toEqual(['--pi']);
      expect(profile.controls.pi?.extensions).toEqual(['ext-pi']);
      expect(profile.controls.pi?.skills).toEqual(['skill-pi']);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('watches tack inputs, rewrites safe generated files, and warns when an input cannot be watched', async () => {
    const warnings: string[] = [];
    const tack = createTack('/tmp/bridl-watch-test', [
      createTackFile({
        relativePath: 'bridl/profile.json',
        content: '{}\n',
        sourceInputs: ['/path/that/does/not/exist/profile.yml'],
      }),
    ]);
    const handle = watchTackInputs({ tack, warn: (message) => warnings.push(message) });

    handle.close();

    expect(warnings[0]).toContain('Could not watch tack input /path/that/does/not/exist/profile.yml');
    expect(createProfileWatchPaths(['/profiles/default/profile.yml', '/profiles/default/other.yml'])).toEqual([
      '/profiles/default',
    ]);
    expect(tackFileOutputPath(tack, 'bridl/profile.json')).toBe('/tmp/bridl-watch-test/bridl/profile.json');

    const root = createTemporaryRoot();
    const watchedDirectory = join(root, 'watched');
    const watchedInput = join(watchedDirectory, 'profile.yml');
    const outputRoot = join(root, 'tack');
    mkdirSync(watchedDirectory, { recursive: true });
    writeFileSync(watchedInput, 'initial\n');
    const watchedTack = createTack(outputRoot, [
      createTackFile({ relativePath: 'generated.txt', content: 'stale\n', sourceInputs: [watchedInput] }),
    ]);
    const watchedHandle = watchTackInputs({
      tack: watchedTack,
      refreshTack: () =>
        createTack(outputRoot, [
          createTackFile({ relativePath: 'generated.txt', content: 'updated\n', sourceInputs: [watchedInput] }),
        ]),
      warn: (message) => warnings.push(message),
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      writeFileSync(watchedInput, 'changed\n');
      await waitForFileContent(join(outputRoot, 'generated.txt'), 'updated\n');
    } finally {
      watchedHandle.close();
    }

    const staticInput = join(watchedDirectory, 'static-profile.yml');
    const staticOutputRoot = join(root, 'static-tack');
    writeFileSync(staticInput, 'initial\n');
    const staticTack = createTack(staticOutputRoot, [
      createTackFile({ relativePath: 'generated.txt', content: 'static\n', sourceInputs: [staticInput] }),
    ]);
    const staticHandle = watchTackInputs({ tack: staticTack, warn: (message) => warnings.push(message) });

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      writeFileSync(staticInput, 'changed\n');
      await waitForFileContent(join(staticOutputRoot, 'generated.txt'), 'static\n');
    } finally {
      staticHandle.close();
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-006.1, BRIDL-REQ-006.2, BRIDL-REQ-006.3, BRIDL-REQ-006.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('translates generic and pi-specific profile controls into pi env and argv', () => {
    const adapter = createPiAdapter();
    const tackPlan = adapter.createTack(
      {
        id: 'engineering',
        inherits: [],
        controls: {
          model: 'generic-model',
          provider: 'anthropic',
          environment: { GENERIC: '1' },
          extensions: ['ext-a'],
          skills: ['skill-a'],
          promptTemplate: 'template-a',
          systemPrompt: 'base prompt',
          appendSystemPrompt: 'extra prompt',
          pi: {
            model: 'pi-model',
            sessionDirectory: '/tmp/pi-sessions',
            args: ['--share'],
            environment: { PI_ONLY: '1' },
          },
        },
      },
      { rootDirectory: '/tmp/bridl-engineering-pi-123', profilePaths: ['/profiles/engineering/profile.yml'] },
    );
    const launchPlan = adapter.createLaunchPlan(tackPlan.tack, {
      id: 'engineering',
      inherits: [],
      controls: {
        model: 'generic-model',
        provider: 'anthropic',
        environment: { GENERIC: '1' },
        extensions: ['ext-a'],
        skills: ['skill-a'],
        promptTemplate: 'template-a',
        systemPrompt: 'base prompt',
        appendSystemPrompt: 'extra prompt',
        pi: {
          model: 'pi-model',
          sessionDirectory: '/tmp/pi-sessions',
          args: ['--share'],
          environment: { PI_ONLY: '1' },
        },
      },
    });

    expect(adapter.id).toBe('pi');
    expect(adapter.supportedControls).toContain('model');
    expect(adapter.supportedControls).toContain('promptTemplate');
    expect(
      adapter.getUnsupportedControls({
        id: 'engineering',
        inherits: [],
        controls: { pi: { unsupportedPiControl: true } },
      }),
    ).toEqual(['pi.unsupportedPiControl']);
    expect(tackPlan.tack.rootDirectory).toBe('/tmp/bridl-engineering-pi-123');
    expect(tackPlan.tack.files[0]?.sourceInputs).toEqual(['/profiles/engineering/profile.yml']);
    expect(launchPlan.command).toBe('pi');
    expect(launchPlan.env).toEqual({
      GENERIC: '1',
      PI_ONLY: '1',
      PI_CODING_AGENT_DIR: '/tmp/bridl-engineering-pi-123',
    });
    expect(launchPlan.args).toEqual([
      '--model',
      'pi-model',
      '--provider',
      'anthropic',
      '--session-dir',
      '/tmp/pi-sessions',
      '--prompt-template',
      'template-a',
      '--system-prompt',
      'base prompt',
      '--append-system-prompt',
      'extra prompt',
      '--extension',
      'ext-a',
      '--skill',
      'skill-a',
      '--share',
    ]);

    const genericFallbackProfile = parseProfileYaml(
      'id: fallback\ncontrols:\n  model: generic-model\n  pi: {}\n',
      'fallback',
    );
    expect('message' in genericFallbackProfile).toBe(false);
    if (!('message' in genericFallbackProfile)) {
      expect(adapter.createLaunchPlan(tackPlan.tack, genericFallbackProfile).args).toEqual([
        '--model',
        'generic-model',
      ]);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.1, BRIDL-REQ-005.2, BRIDL-REQ-005.3, BRIDL-REQ-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves the default profile, writes and refreshes a temp tack, warns, and passes through args', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.bridl', 'profiles');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    const baseProfilePath = writeProfile(
      profilesDirectory,
      'base',
      ['id: base', 'controls:', '  model: base-model', '  environment:', '    BASE_ENV: inherited', ''].join('\n'),
    );
    const profilePath = writeProfile(
      profilesDirectory,
      'default',
      [
        'id: default',
        'inherits: [base]',
        'controls:',
        '  model: test-model',
        '  environment:',
        '    TEST_ENV: yes',
        '  unsupported_feature: true',
        '',
      ].join('\n'),
    );
    const unrelatedProfilePath = writeProfile(
      profilesDirectory,
      'unrelated',
      'id: unrelated\ncontrols:\n  model: unrelated-model\n',
    );
    const warnings: string[] = [];
    const launches: unknown[] = [];

    const result = await executeRunCommand(
      {
        homeDirectory,
        projectDirectory,
        passThroughArgs: ['--debug', 'prompt text'],
      },
      {
        writeError: (message) => warnings.push(message),
        launcher: {
          launch(plan) {
            launches.push(plan);
            return new Promise((resolve) => {
              setTimeout(() => {
                writeFileSync(
                  profilePath,
                  [
                    'id: default',
                    'inherits: [base]',
                    'controls:',
                    '  model: test-model',
                    '  environment:',
                    '    TEST_ENV: yes',
                    '    LIVE_ENV: refreshed',
                    '  unsupported_feature: true',
                    '',
                  ].join('\n'),
                );
                resolve(
                  waitForFileContaining(join(plan.env.PI_CODING_AGENT_DIR, 'bridl', 'profile.json'), 'LIVE_ENV').then(
                    () => 0,
                  ),
                );
              }, 25);
            });
          },
        },
      },
    );

    expect(result.profileId).toBe('default');
    expect(result.tackDirectory).toContain('bridl-default-pi-');
    expect(existsSync(join(result.tackDirectory, 'bridl', 'profile.json'))).toBe(true);
    const profileMetadata = readFileSync(join(result.tackDirectory, 'bridl', 'profile.json'), 'utf8');
    expect(profileMetadata).toContain('test-model');
    expect(profileMetadata).toContain('BASE_ENV');
    expect(profileMetadata).toContain('LIVE_ENV');
    expect(profileMetadata).not.toContain('unrelated-model');
    expect(result.launchPlan.args).toEqual(['--model', 'test-model', '--debug', 'prompt text']);
    expect(result.launchPlan.env.TEST_ENV).toBe('yes');
    expect(result.launchPlan.env.PI_CODING_AGENT_DIR).toBe(result.tackDirectory);
    expect(result.warnings).toEqual(["pi adapter cannot translate requested control 'unsupported_feature'."]);
    expect(warnings).toEqual(result.warnings);
    expect(launches).toHaveLength(1);
    expect(profilePath).toContain('profile.yml');
    expect(baseProfilePath).toContain('profile.yml');
    expect(unrelatedProfilePath).toContain('profile.yml');

    await executeRunCommand(
      { homeDirectory, projectDirectory, profileId: 'default' },
      {
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs setup automatically before the default run when user setup has not run', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(messages).toEqual(['`bridl setup` has not been run yet - running now']);
    expect(result.profileId).toBe('default');
    expect(existsSync(join(homeDirectory, '.bridl', 'settings.yml'))).toBe(true);
    expect(existsSync(join(homeDirectory, '.bridl', 'profiles', 'default', 'profile.yml'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.1, BRIDL-REQ-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports invalid settings, invalid profile sources, missing profiles, URI caches, and child exit codes', async () => {
    const root = createTemporaryRoot();
    const badSettingsHome = join(root, 'bad-settings-home');
    const projectDirectory = join(root, 'project');
    writeSettings(badSettingsHome, 'profile_sources:\n  - only: [default]\n');
    await expect(executeRunCommand({ homeDirectory: badSettingsHome, projectDirectory })).rejects.toThrow(
      'Cannot run with invalid settings',
    );

    const badProfileHome = join(root, 'bad-profile-home');
    writeSettings(badProfileHome, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(badProfileHome, '.bridl', 'profiles'),
      'default',
      'id: default\ncontrols:\n  environment:\n    COUNT: 1\n',
    );
    await expect(executeRunCommand({ homeDirectory: badProfileHome, projectDirectory })).rejects.toThrow(
      'Cannot run with invalid profiles',
    );

    const missingProfileHome = join(root, 'missing-profile-home');
    writeSettings(missingProfileHome, 'default_profile: missing\nprofile_sources:\n  - path: ./profiles\n');
    mkdirSync(join(missingProfileHome, '.bridl', 'profiles'), { recursive: true });
    await expect(executeRunCommand({ homeDirectory: missingProfileHome, projectDirectory })).rejects.toThrow(
      "Cannot resolve profile 'missing'",
    );

    const uriHome = join(root, 'uri-home');
    const uri = 'https://example.test/team/profiles.git';
    writeSettings(uriHome, `default_profile: cached\nprofile_sources:\n  - uri: ${uri}\n`);
    writeProfile(
      join(uriHome, '.bridl', 'cache', 'profiles', Buffer.from(uri).toString('base64url')),
      'cached',
      'id: cached\ncontrols: {}\n',
    );
    const result = await executeRunCommand(
      { homeDirectory: uriHome, projectDirectory, profileId: 'cached' },
      {
        launcher: {
          launch() {
            return Promise.resolve(7);
          },
        },
      },
    );
    expect(result.exitCode).toBe(7);

    const fallbackHome = join(root, 'fallback-home');
    writeSettings(fallbackHome, 'profile_sources:\n  - path: ./profiles\n');
    writeProfile(join(fallbackHome, '.bridl', 'profiles'), 'default', 'id: default\ncontrols: {}\n');
    await expect(
      executeRunCommand(
        { homeDirectory: fallbackHome, projectDirectory },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow('Cannot run without a selected profile or default_profile');

    const spawnedHome = join(root, 'spawned-home');
    writeSettings(spawnedHome, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(join(spawnedHome, '.bridl', 'profiles'), 'default', 'id: default\ncontrols: {}\n');
    const spawnedResult = await executeRunCommand(
      { homeDirectory: spawnedHome, projectDirectory },
      {
        adapter: {
          id: 'node',
          supportedControls: [],
          createTack(_profile, tackInput) {
            return { tack: createTack(tackInput.rootDirectory, []), warnings: [] };
          },
          createLaunchPlan(tack) {
            return { command: process.execPath, args: ['-e', 'process.exit(0)'], env: { TACK: tack.rootDirectory } };
          },
          getUnsupportedControls() {
            return [];
          },
        },
      },
    );
    expect(spawnedResult.exitCode).toBe(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('maps child process exits and signals to command exit codes', () => {
    expect(resolveChildExitCode(7, null)).toBe(7);
    expect(resolveChildExitCode(null, 'SIGINT')).toBe(130);
    expect(resolveChildExitCode(null, 'SIGTERM')).toBe(143);
    expect(resolveChildExitCode(null, 'SIGHUP')).toBe(129);
    expect(resolveChildExitCode(null, null)).toBe(1);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes unsupported control warnings fatal when hard tack is enabled', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.bridl', 'profiles'),
      'default',
      'id: default\ncontrols:\n  unsupported_feature: true\n',
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, hardTack: true },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow("Hard-tack failed for pi: pi adapter cannot translate requested control 'unsupported_feature'.");
  });
});
