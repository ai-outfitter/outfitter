// Tests profile state persistence parsing and pi composite profile state materialization.
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';
import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import { writeCompositeProfile } from '../../src/compositeProfile/CompositeProfileAssembler.js';
import { createCompositeProfileFile } from '../../src/compositeProfile/CompositeProfileFile.js';
import {
  createCompositeProfileStateBaseline,
  detectCompositeProfileStateWrites,
  ensureStateSourcePath,
  materializeCompositeProfileStatePath,
  updateCompositeProfileStateBaselinePaths,
} from '../../src/compositeProfile/StatePersistence.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'applepi-state-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.applepi'), { recursive: true });
  writeFileSync(join(homeDirectory, '.applepi', 'settings.yml'), content);
};

const writeProfile = (root: string, id: string, content: string): string => {
  const profileDirectory = join(root, id);
  mkdirSync(profileDirectory, { recursive: true });
  const profilePath = join(profileDirectory, 'profile.yml');
  writeFileSync(profilePath, content);
  return profilePath;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('state persistence', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses state persistence overrides from profile YAML', () => {
    const profile = parseProfileYaml(
      ['id: stateful', 'state_persistence:', '  settings.json: warn', '  cache/: discard', '  unknown: error', ''].join(
        '\n',
      ),
      'fallback',
    );

    expect('message' in profile).toBe(false);
    if (!('message' in profile)) {
      expect(profile.statePersistence).toEqual({ 'settings.json': 'warn', 'cache/': 'discard', unknown: 'error' });
    }

    expect(parseProfileYaml('id: invalid\nstate_persistence:\n  settings.json: persist\n', 'fallback')).toEqual({
      path: '/state_persistence/settings.json',
      message: 'must be equal to one of the allowed values',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('materializes pi state paths as symlinks and reports non-persistent writes', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.applepi', 'profiles');
    const settingsPath = join(profilesDirectory, 'default', 'cli_specific', 'pi', 'settings.json');
    const nativeAuthPath = join(homeDirectory, '.pi', 'agent', 'auth.json');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      profilesDirectory,
      'default',
      [
        'id: default',
        'state_persistence:',
        '  cache/: warn',
        '  mcp.json: prompt',
        '  unknown: warn',
        'controls: {}',
        '',
      ].join('\n'),
    );
    mkdirSync(join(profilesDirectory, 'default', 'cli_specific', 'pi'), { recursive: true });
    mkdirSync(join(homeDirectory, '.pi', 'agent'), { recursive: true });
    writeFileSync(settingsPath, '{"theme":"dark"}\n');
    writeFileSync(nativeAuthPath, '{"openai-codex":{"type":"oauth"}}\n');
    const warnings: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeError: (message) => warnings.push(message),
        launcher: {
          launch(plan) {
            const compositeProfilePiDirectory = plan.env.PI_CODING_AGENT_DIR;
            expect(lstatSync(join(compositeProfilePiDirectory, 'settings.json')).isSymbolicLink()).toBe(true);
            expect(readlinkSync(join(compositeProfilePiDirectory, 'settings.json'))).toBe(settingsPath);
            expect(readlinkSync(join(compositeProfilePiDirectory, 'auth.json'))).toBe(nativeAuthPath);
            writeFileSync(join(compositeProfilePiDirectory, 'settings.json'), '{"theme":"light"}\n');
            writeFileSync(join(compositeProfilePiDirectory, 'cache', 'entry.txt'), 'discarded cache\n');
            writeFileSync(join(compositeProfilePiDirectory, 'mcp.json'), '{"servers":{}}\n');
            writeFileSync(join(compositeProfilePiDirectory, 'unexpected.txt'), 'unknown write\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(readFileSync(settingsPath, 'utf8')).toBe('{"theme":"light"}\n');
    expect(result.warnings).toContain("pi wrote 'cache/' with state_persistence 'warn' and it was not persisted.");
    expect(result.warnings).toContain("pi wrote 'mcp.json' with state_persistence 'prompt' and it was not persisted.");
    expect(result.warnings).toContain(
      "pi wrote undeclared composite profile state 'unexpected.txt' and it was not persisted.",
    );
    expect(warnings).toEqual(result.warnings);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('assembles pi fallback state source paths without mutating native state directories', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const compositeProfile = createPiAdapter().createCompositeProfile(
      { id: 'default', inherits: [], controls: {} },
      {
        rootDirectory: join(root, 'compositeProfile'),
        profilePaths: [join(root, 'profile.yml')],
        profileFolders: [],
        homeDirectory,
      },
    ).compositeProfile;

    expect(
      compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'settings.json')?.sourcePath,
    ).toBe(join(homeDirectory, '.pi', 'agent', 'settings.json'));
    expect(existsSync(join(homeDirectory, '.pi'))).toBe(false);

    writeCompositeProfile(compositeProfile);

    expect(existsSync(join(homeDirectory, '.pi', 'agent', 'settings.json'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists pi package install directories across temporary composite profile directories', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const compositeProfile = createPiAdapter().createCompositeProfile(
      { id: 'default', inherits: [], controls: {} },
      {
        rootDirectory: join(root, 'compositeProfile'),
        profilePaths: [],
        profileFolders: [],
        homeDirectory,
      },
    ).compositeProfile;

    expect(compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'npm/')?.sourcePath).toBe(
      join(homeDirectory, '.pi', 'agent', 'npm'),
    );
    expect(compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'git/')?.sourcePath).toBe(
      join(homeDirectory, '.pi', 'agent', 'git'),
    );

    writeCompositeProfile(compositeProfile);

    expect(readlinkSync(join(compositeProfile.rootDirectory, 'npm'))).toBe(join(homeDirectory, '.pi', 'agent', 'npm'));
    expect(readlinkSync(join(compositeProfile.rootDirectory, 'git'))).toBe(join(homeDirectory, '.pi', 'agent', 'git'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('detects changed temporary state paths and protects compositeProfile path boundaries', () => {
    const root = createTemporaryRoot();
    const sourceFile = ensureStateSourcePath(join(root, 'source', 'settings.json'), false);
    const sourceDirectory = ensureStateSourcePath(join(root, 'source', 'plugins'), true);
    writeFileSync(sourceFile, '{}\n');
    materializeCompositeProfileStatePath(root, {
      relativePath: 'settings.json',
      strategy: 'symlink',
      sourcePath: sourceFile,
      directory: false,
    });
    materializeCompositeProfileStatePath(root, {
      relativePath: 'plugins/',
      strategy: 'symlink',
      sourcePath: sourceDirectory,
      directory: true,
    });
    materializeCompositeProfileStatePath(root, { relativePath: 'cache/', strategy: 'prompt', directory: true });
    materializeCompositeProfileStatePath(root, { relativePath: 'logs/cache/', strategy: 'warn', directory: true });
    materializeCompositeProfileStatePath(root, { relativePath: 'notes.txt', strategy: 'warn', directory: false });
    expect(existsSync(join(root, 'source', 'plugins'))).toBe(true);
    expect(lstatSync(join(root, 'plugins')).isSymbolicLink()).toBe(true);
    const baseline = createCompositeProfileStateBaseline(root);

    writeFileSync(join(root, 'cache', 'entry.txt'), 'changed\n');
    writeFileSync(join(root, 'logs', 'cache', 'entry.txt'), 'changed\n');
    writeFileSync(join(root, 'notes.txt'), 'changed\n');
    mkdirSync(join(root, 'applepi'), { recursive: true });
    writeFileSync(join(root, 'applepi', 'profile.json'), '{}\n');

    expect(
      detectCompositeProfileStateWrites(
        root,
        [
          { relativePath: 'cache/', strategy: 'prompt', directory: true },
          { relativePath: 'logs/cache/', strategy: 'warn', directory: true },
          { relativePath: 'notes.txt', strategy: 'warn', directory: false },
          { relativePath: 'unknown', strategy: 'discard', directory: false },
        ],
        baseline,
      ),
    ).toEqual([
      { relativePath: 'cache/', strategy: 'prompt', unknown: false },
      { relativePath: 'logs/cache/', strategy: 'warn', unknown: false },
      { relativePath: 'notes.txt', strategy: 'warn', unknown: false },
    ]);
    expect(
      detectCompositeProfileStateWrites(
        root,
        [{ relativePath: 'notes.txt', strategy: 'discard', directory: false }],
        baseline,
      ),
    ).toEqual([]);
    materializeCompositeProfileStatePath(root, { relativePath: '..cache', strategy: 'warn', directory: false });
    expect(existsSync(join(root, '..cache'))).toBe(false);
    expect(() =>
      materializeCompositeProfileStatePath(root, {
        relativePath: '../outside.txt',
        strategy: 'warn',
        directory: false,
      }),
    ).toThrow('must stay under compositeProfile root');
    expect(() =>
      materializeCompositeProfileStatePath(root, { relativePath: 'bad.json', strategy: 'symlink', directory: false }),
    ).toThrow('uses symlink without a source path');
    symlinkSync(join(root, 'deleted-target.json'), join(root, 'broken.json'));
    materializeCompositeProfileStatePath(root, {
      relativePath: 'broken.json',
      strategy: 'symlink',
      sourcePath: sourceFile,
      directory: false,
    });
    expect(readlinkSync(join(root, 'broken.json'))).toBe(sourceFile);
    mkdirSync(join(root, 'source-directory.json'));
    expect(() => ensureStateSourcePath(join(root, 'source-directory.json'), false)).toThrow('must be a file');
    writeFileSync(join(root, 'source-file'), 'not a directory\n');
    expect(() => ensureStateSourcePath(join(root, 'source-file'), true)).toThrow('must be a directory');
    rmSync(join(root, 'notes.txt'));
    expect(updateCompositeProfileStateBaselinePaths(root, baseline, ['notes.txt']).fingerprints.has('notes.txt')).toBe(
      false,
    );
    expect(createCompositeProfileStateBaseline(join(root, 'missing')).fingerprints.size).toBe(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not create native fallback state paths while planning a pi compositeProfile', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');

    const compositeProfile = createPiAdapter().createCompositeProfile(
      { id: 'default', inherits: [], controls: {} },
      {
        rootDirectory: join(root, 'compositeProfile'),
        profilePaths: [],
        profileFolders: [],
        homeDirectory,
      },
    ).compositeProfile;

    expect(
      compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'settings.json')?.sourcePath,
    ).toBe(join(homeDirectory, '.pi', 'agent', 'settings.json'));
    expect(existsSync(join(homeDirectory, '.pi'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves state sources using profile stack order rather than loaded folder order', () => {
    const root = createTemporaryRoot();
    const baseFolder = join(root, 'zbase');
    const explicitFolder = join(root, 'alpha');
    const baseSettings = join(baseFolder, 'cli_specific', 'pi', 'settings.json');
    const explicitSettings = join(explicitFolder, 'cli_specific', 'pi', 'settings.json');
    mkdirSync(join(baseFolder, 'cli_specific', 'pi'), { recursive: true });
    mkdirSync(join(explicitFolder, 'cli_specific', 'pi'), { recursive: true });
    writeFileSync(baseSettings, '{"source":"base"}\n');
    writeFileSync(explicitSettings, '{"source":"explicit"}\n');

    const compositeProfile = createPiAdapter().createCompositeProfile(
      {
        id: 'alpha',
        inherits: ['zbase'],
        controls: {},
      },
      {
        rootDirectory: join(root, 'compositeProfile'),
        profilePaths: [join(baseFolder, 'profile.yml'), join(explicitFolder, 'profile.yml')],
        profileFolders: [baseFolder, explicitFolder],
        homeDirectory: join(root, 'home'),
      },
    ).compositeProfile;

    expect(
      compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'settings.json')?.sourcePath,
    ).toBe(explicitSettings);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports when an agent replaces a symlinked state path instead of writing through it', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(join(homeDirectory, '.applepi', 'profiles'), 'default', 'id: default\ncontrols: {}\n');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        launcher: {
          launch(plan) {
            rmSync(join(plan.env.PI_CODING_AGENT_DIR, 'settings.json'));
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'settings.json'), 'not persisted\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.warnings).toContain(
      "pi replaced symlinked state path 'settings.json' and the change was not persisted.",
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('can rewrite generated files without rematerializing state paths during live updates', () => {
    const root = createTemporaryRoot();
    const sourceFile = ensureStateSourcePath(join(root, 'source', 'settings.json'), false);
    const compositeProfileRoot = join(root, 'compositeProfile');
    const statePath = {
      relativePath: 'settings.json',
      strategy: 'symlink' as const,
      sourcePath: sourceFile,
      directory: false,
    };
    const initialCompositeProfile = createCompositeProfile(
      compositeProfileRoot,
      [createCompositeProfileFile({ relativePath: 'applepi/profile.json', content: '{"version":1}\n' })],
      [statePath],
    );
    writeCompositeProfile(initialCompositeProfile);
    rmSync(join(compositeProfileRoot, 'settings.json'));
    writeFileSync(join(compositeProfileRoot, 'settings.json'), 'agent replacement\n');

    writeCompositeProfile(
      createCompositeProfile(
        compositeProfileRoot,
        [createCompositeProfileFile({ relativePath: 'applepi/profile.json', content: '{"version":2}\n' })],
        [statePath],
      ),
      { materializeStatePaths: false },
    );

    expect(readFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), 'utf8')).toBe('{"version":2}\n');
    expect(lstatSync(join(compositeProfileRoot, 'settings.json')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(compositeProfileRoot, 'settings.json'), 'utf8')).toBe('agent replacement\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('formats state write diagnostics with the selected adapter id', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(join(homeDirectory, '.applepi', 'profiles'), 'default', 'id: default\ncontrols: {}\n');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        adapter: {
          id: 'mock-agent',
          supportedControls: [],
          createCompositeProfile(_profile, compositeProfileInput) {
            return {
              compositeProfile: createCompositeProfile(
                compositeProfileInput.rootDirectory,
                [],
                [{ relativePath: 'state.json', strategy: 'warn', directory: false }],
              ),
              warnings: [],
            };
          },
          createLaunchPlan(compositeProfile) {
            return { command: 'mock-agent', args: [], env: { MOCK_AGENT_DIR: compositeProfile.rootDirectory } };
          },
          getUnsupportedControls() {
            return [];
          },
        },
        launcher: {
          launch(plan) {
            writeFileSync(join(plan.env.MOCK_AGENT_DIR, 'state.json'), 'changed\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.warnings).toContain(
      "mock-agent wrote 'state.json' with state_persistence 'warn' and it was not persisted.",
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails after launch when an error-strategy state path changes', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.applepi', 'profiles'),
      'default',
      ['id: default', 'state_persistence:', '  settings.json: error', 'controls: {}', ''].join('\n'),
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory },
        {
          launcher: {
            launch(plan) {
              writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'settings.json'), 'changed\n');
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow("pi wrote 'settings.json' with state_persistence 'error' and it was not persisted.");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects state persistence strategies that are disallowed for a pi state path', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.applepi', 'profiles'),
      'default',
      ['id: default', 'state_persistence:', '  unknown: symlink', 'controls: {}', ''].join('\n'),
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow('state_persistence strategy \'symlink\' is not allowed for "unknown"');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects state persistence keys inherited from Object.prototype', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.applepi', 'profiles'),
      'default',
      ['id: default', 'state_persistence:', '  toString: warn', 'controls: {}', ''].join('\n'),
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow("state_persistence path 'toString' is not declared by the pi adapter");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects state persistence keys that are undeclared by the pi adapter', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.applepi', 'profiles'),
      'default',
      ['id: default', 'state_persistence:', '  setting.json: warn', 'controls: {}', ''].join('\n'),
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow("state_persistence path 'setting.json' is not declared by the pi adapter");
  });
});
