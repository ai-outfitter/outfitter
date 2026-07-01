// Tests the interactive `prompt` state-persistence strategy: persist/discard/always choices,
// non-interactive fallback, and undeclared-write handling.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import {
  persistCompositeProfileStateWrite,
  recordProfileStatePersistenceOverride,
} from '../../src/compositeProfile/StatePersistence.js';
import type { CompositeProfileStateWritePromptRequest } from '../../src/compositeProfile/StatePersistence.js';
import { createProfileSourceCachePath } from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-state-prompt-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
  writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), content);
};

const writeProfile = (profilesRoot: string, id: string, content: string): string => {
  const profileDirectory = join(profilesRoot, id);
  mkdirSync(profileDirectory, { recursive: true });
  const profilePath = join(profileDirectory, 'profile.yml');
  writeFileSync(profilePath, content);
  return profilePath;
};

const createPromptRunRoot = (
  profileContent: string,
): { root: string; homeDirectory: string; projectDirectory: string; profilePath: string } => {
  const root = createTemporaryRoot();
  const homeDirectory = join(root, 'home');
  const projectDirectory = join(root, 'project');
  writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
  const profilePath = writeProfile(join(homeDirectory, '.outfitter', 'profiles'), 'default', profileContent);
  return { root, homeDirectory, projectDirectory, profilePath };
};

const promptProfileContent = [
  'id: default',
  '# durable policy comment',
  'state_persistence:',
  '  mcp.json: prompt',
  'controls: {}',
  '',
].join('\n');

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('prompt state persistence strategy', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists a prompt-strategy write to its durable source when the user chooses persist', async () => {
    const { homeDirectory, projectDirectory } = createPromptRunRoot(promptProfileContent);
    const requests: CompositeProfileStateWritePromptRequest[] = [];
    const messages: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: (message) => messages.push(message),
        promptStateWritePersistence: (request) => {
          requests.push(request);
          return Promise.resolve('persist');
        },
        launcher: {
          launch(plan) {
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'mcp.json'), '{"servers":{"kept":true}}\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    const nativeMcpPath = join(homeDirectory, '.pi', 'agent', 'mcp.json');
    expect(requests).toEqual([{ agentId: 'pi', relativePath: 'mcp.json', sourcePath: nativeMcpPath }]);
    expect(readFileSync(nativeMcpPath, 'utf8')).toBe('{"servers":{"kept":true}}\n');
    expect(result.warnings).toEqual([]);
    expect(messages).toContain(`Persisted pi state write 'mcp.json' to ${nativeMcpPath}.`);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('discards a prompt-strategy write when the user chooses discard', async () => {
    const { homeDirectory, projectDirectory } = createPromptRunRoot(promptProfileContent);
    const messages: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: (message) => messages.push(message),
        promptStateWritePersistence: () => Promise.resolve('discard'),
        launcher: {
          launch(plan) {
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'mcp.json'), '{"servers":{"dropped":true}}\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(existsSync(join(homeDirectory, '.pi', 'agent', 'mcp.json'))).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(messages).toContain(`Discarded pi state write to 'mcp.json'.`);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('records an always-persist choice as a symlink override in the selected local profile', async () => {
    const { homeDirectory, projectDirectory, profilePath } = createPromptRunRoot(promptProfileContent);

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: () => undefined,
        promptStateWritePersistence: () => Promise.resolve('always'),
        launcher: {
          launch(plan) {
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'mcp.json'), '{"servers":{"always":true}}\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(readFileSync(join(homeDirectory, '.pi', 'agent', 'mcp.json'), 'utf8')).toBe('{"servers":{"always":true}}\n');
    expect(result.warnings).toEqual([]);
    const updatedProfile = readFileSync(profilePath, 'utf8');
    expect(updatedProfile).toContain('mcp.json: symlink');
    expect(updatedProfile).not.toContain('mcp.json: prompt');
    expect(updatedProfile).toContain('# durable policy comment');

    // The recorded override materializes as a symlink on the next run.
    const secondRun = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: () => undefined,
        launcher: {
          launch(plan) {
            expect(readFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'mcp.json'), 'utf8')).toBe(
              '{"servers":{"always":true}}\n',
            );
            return Promise.resolve(0);
          },
        },
      },
    );
    expect(secondRun.warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists once and warns when the always choice cannot be recorded for a remote profile', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const sourceUri = 'https://example.com/team-profiles.git';
    writeSettings(homeDirectory, `default_profile: default\nprofile_sources:\n  - uri: ${sourceUri}\n`);
    const cachePath = createProfileSourceCachePath(homeDirectory, sourceUri);
    writeProfile(cachePath, 'default', promptProfileContent);

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: () => undefined,
        promptStateWritePersistence: () => Promise.resolve('always'),
        launcher: {
          launch(plan) {
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'mcp.json'), '{"servers":{"remote":true}}\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(readFileSync(join(homeDirectory, '.pi', 'agent', 'mcp.json'), 'utf8')).toBe('{"servers":{"remote":true}}\n');
    expect(result.warnings).toEqual([
      "Cannot record the always-persist choice for 'mcp.json' because profile 'default' is not a local profile file; " +
        'the write was persisted once.',
    ]);
    expect(readFileSync(join(cachePath, 'default', 'profile.yml'), 'utf8')).toBe(promptProfileContent);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to a warning with an explicit notice when the session is not interactive', async () => {
    const { homeDirectory, projectDirectory } = createPromptRunRoot(promptProfileContent);
    let prompted = false;

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: false,
        writeError: () => undefined,
        writeLine: () => undefined,
        promptStateWritePersistence: () => {
          prompted = true;
          return Promise.resolve('persist');
        },
        launcher: {
          launch(plan) {
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'mcp.json'), '{"servers":{}}\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(prompted).toBe(false);
    expect(existsSync(join(homeDirectory, '.pi', 'agent', 'mcp.json'))).toBe(false);
    expect(result.warnings).toEqual([
      "pi wrote 'mcp.json' with state_persistence 'prompt' and it was not persisted.",
      "state_persistence prompt for 'mcp.json' skipped: non-interactive session.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports undeclared writes under an unknown prompt strategy instead of prompting', async () => {
    const { homeDirectory, projectDirectory } = createPromptRunRoot(
      ['id: default', 'state_persistence:', '  unknown: prompt', 'controls: {}', ''].join('\n'),
    );
    let prompted = false;

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: () => undefined,
        promptStateWritePersistence: () => {
          prompted = true;
          return Promise.resolve('persist');
        },
        launcher: {
          launch(plan) {
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'surprise.txt'), 'unexpected\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(prompted).toBe(false);
    expect(result.warnings).toEqual([
      "pi wrote undeclared composite profile state 'surprise.txt' and it was not persisted.",
      "state_persistence 'prompt' cannot persist undeclared writes; 'surprise.txt' was reported instead.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists prompt-strategy directories recursively when the user chooses persist', async () => {
    const { homeDirectory, projectDirectory } = createPromptRunRoot(
      ['id: default', 'state_persistence:', '  plugins/: prompt', 'controls: {}', ''].join('\n'),
    );

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: () => undefined,
        promptStateWritePersistence: () => Promise.resolve('persist'),
        launcher: {
          launch(plan) {
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'plugins', 'installed.json'), '{"plugin":true}\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(readFileSync(join(homeDirectory, '.pi', 'agent', 'plugins', 'installed.json'), 'utf8')).toBe(
      '{"plugin":true}\n',
    );
    expect(result.warnings).toEqual([]);
  });

  it('warns when a persist choice cannot be applied because the composite path disappeared', async () => {
    const { homeDirectory, projectDirectory } = createPromptRunRoot(
      ['id: default', 'state_persistence:', '  plugins/: prompt', 'controls: {}', ''].join('\n'),
    );

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: () => undefined,
        promptStateWritePersistence: () => Promise.resolve('persist'),
        launcher: {
          launch(plan) {
            rmSync(join(plan.env.PI_CODING_AGENT_DIR, 'plugins'), { recursive: true, force: true });
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.warnings).toEqual([
      "Could not persist state path 'plugins/': Error: State path 'plugins/' no longer exists in the composite " +
        'profile, so it cannot be persisted.',
    ]);
  });

  it('warns when an adapter does not allow the symlink strategy for an always choice', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(join(homeDirectory, '.outfitter', 'profiles'), 'default', 'id: default\ncontrols: {}\n');
    const durablePath = join(root, 'durable', 'state.json');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeError: () => undefined,
        writeLine: () => undefined,
        promptStateWritePersistence: () => Promise.resolve('always'),
        adapter: {
          id: 'mock-agent',
          supportedControls: [],
          createCompositeProfile(_profile, compositeProfileInput) {
            return {
              compositeProfile: createCompositeProfile(
                compositeProfileInput.rootDirectory,
                [],
                [{ relativePath: 'state.json', strategy: 'prompt', directory: false, sourcePath: durablePath }],
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
            writeFileSync(join(plan.env.MOCK_AGENT_DIR, 'state.json'), '{"mock":true}\n');
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(readFileSync(durablePath, 'utf8')).toBe('{"mock":true}\n');
    expect(result.warnings).toEqual([
      "Cannot always-persist 'state.json': the mock-agent adapter does not allow 'symlink' for it; " +
        'the write was persisted once.',
    ]);
  });

  it('rejects persisting state paths that have no durable source path', () => {
    const root = createTemporaryRoot();

    expect(() =>
      persistCompositeProfileStateWrite(root, { relativePath: 'state.json', strategy: 'prompt', directory: false }),
    ).toThrow("State path 'state.json' cannot be persisted without a durable source path.");
  });

  it('creates a state_persistence block when recording an override in a profile without one', () => {
    const root = createTemporaryRoot();
    const profilePath = join(root, 'profile.yml');
    writeFileSync(profilePath, 'id: default\n# retained comment\ncontrols: {}\n');

    recordProfileStatePersistenceOverride(profilePath, 'mcp.json', 'symlink');

    const content = readFileSync(profilePath, 'utf8');
    expect(content).toContain('# retained comment');
    expect(content).toContain('state_persistence:');
    expect(content).toContain('mcp.json: symlink');
  });
});
