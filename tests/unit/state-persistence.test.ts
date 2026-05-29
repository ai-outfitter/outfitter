// Tests profile state persistence parsing and pi tack state materialization.
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';
import {
  createTackStateBaseline,
  detectTackStateWrites,
  ensureStateSourcePath,
  materializeTackStatePath,
} from '../../src/tack/StatePersistence.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-state-'));
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

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('state persistence', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.2, BRIDL-REQ-005.3).
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
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.2, BRIDL-REQ-005.3, BRIDL-REQ-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('materializes pi state paths as symlinks and reports non-persistent writes', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.bridl', 'profiles');
    const settingsPath = join(profilesDirectory, 'default', 'cli_specific', 'pi', 'settings.json');
    const nativeAuthPath = join(homeDirectory, '.pi', 'agent', 'auth.json');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      profilesDirectory,
      'default',
      ['id: default', 'state_persistence:', '  cache/: warn', '  unknown: warn', 'controls: {}', ''].join('\n'),
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
            const tackPiDirectory = plan.env.PI_CODING_AGENT_DIR;
            expect(lstatSync(join(tackPiDirectory, 'settings.json')).isSymbolicLink()).toBe(true);
            expect(readlinkSync(join(tackPiDirectory, 'settings.json'))).toBe(settingsPath);
            expect(readlinkSync(join(tackPiDirectory, 'auth.json'))).toBe(nativeAuthPath);
            writeFileSync(join(tackPiDirectory, 'settings.json'), '{"theme":"light"}\n');
            writeFileSync(join(tackPiDirectory, 'cache', 'entry.txt'), 'discarded cache\n');
            writeFileSync(join(tackPiDirectory, 'unexpected.txt'), 'unknown write\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(readFileSync(settingsPath, 'utf8')).toBe('{"theme":"light"}\n');
    expect(result.warnings).toContain("pi wrote 'cache/' with state_persistence 'warn' and it was not persisted.");
    expect(result.warnings).toContain("pi wrote undeclared tack state 'unexpected.txt' and it was not persisted.");
    expect(warnings).toEqual(result.warnings);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.2, BRIDL-REQ-005.3, BRIDL-REQ-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('detects changed temporary state paths and protects tack path boundaries', () => {
    const root = createTemporaryRoot();
    const sourceFile = ensureStateSourcePath(join(root, 'source', 'settings.json'), false);
    const sourceDirectory = ensureStateSourcePath(join(root, 'source', 'plugins'), true);
    writeFileSync(sourceFile, '{}\n');
    materializeTackStatePath(root, {
      relativePath: 'settings.json',
      strategy: 'symlink',
      sourcePath: sourceFile,
      directory: false,
    });
    materializeTackStatePath(root, {
      relativePath: 'plugins/',
      strategy: 'symlink',
      sourcePath: sourceDirectory,
      directory: true,
    });
    materializeTackStatePath(root, { relativePath: 'cache/', strategy: 'prompt', directory: true });
    materializeTackStatePath(root, { relativePath: 'notes.txt', strategy: 'warn', directory: false });
    expect(existsSync(join(root, 'source', 'plugins'))).toBe(true);
    expect(lstatSync(join(root, 'plugins')).isSymbolicLink()).toBe(true);
    const baseline = createTackStateBaseline(root);

    writeFileSync(join(root, 'cache', 'entry.txt'), 'changed\n');
    writeFileSync(join(root, 'notes.txt'), 'changed\n');
    mkdirSync(join(root, 'bridl'), { recursive: true });
    writeFileSync(join(root, 'bridl', 'profile.json'), '{}\n');

    expect(
      detectTackStateWrites(
        root,
        [
          { relativePath: 'cache/', strategy: 'prompt', directory: true },
          { relativePath: 'notes.txt', strategy: 'warn', directory: false },
          { relativePath: 'unknown', strategy: 'warn', directory: false },
        ],
        baseline,
      ),
    ).toEqual([
      { relativePath: 'cache/', strategy: 'prompt', unknown: false },
      { relativePath: 'notes.txt', strategy: 'warn', unknown: false },
    ]);
    expect(() =>
      materializeTackStatePath(root, { relativePath: '../outside.txt', strategy: 'warn', directory: false }),
    ).toThrow('must stay under tack root');
    expect(() =>
      materializeTackStatePath(root, { relativePath: 'bad.json', strategy: 'symlink', directory: false }),
    ).toThrow('uses symlink without a source path');
    expect(createTackStateBaseline(join(root, 'missing')).fingerprints.size).toBe(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.2, BRIDL-REQ-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails after launch when an error-strategy state path changes', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.bridl', 'profiles'),
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.2, BRIDL-REQ-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects state persistence strategies that are disallowed for a pi state path', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.bridl', 'profiles'),
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
});
