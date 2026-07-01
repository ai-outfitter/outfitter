// Tests Pi-native first-run deferral behavior.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-first-run-welcome-'));
  temporaryRoots.push(root);
  return root;
};

const writeDefaultProfile = (
  profilesDirectory: string,
  profileId: string,
  extensions: readonly string[] = [],
): void => {
  const profileDirectory = join(profilesDirectory, profileId);
  mkdirSync(profileDirectory, { recursive: true });
  const extensionLines =
    extensions.length === 0
      ? ['    extensions: []']
      : ['    extensions:', ...extensions.map((extension) => `      - ${extension}`)];
  writeFileSync(
    join(profileDirectory, 'profile.yml'),
    [
      `id: ${profileId}`,
      `label: ${profileId}`,
      'controls:',
      '  pi:',
      ...extensionLines,
      '  append_system_prompt: |',
      `    Default ${profileId} prompt.`,
      '',
    ].join('\n'),
  );
  mkdirSync(join(profileDirectory, 'cli_specific', 'pi', 'deepwork', 'jobs', profileId), { recursive: true });
  writeFileSync(
    join(profileDirectory, 'cli_specific', 'pi', 'deepwork', 'jobs', profileId, 'job.yml'),
    `name: ${profileId}\nworkflows: {}\n`,
  );
  mkdirSync(join(profileDirectory, 'cli_specific', 'pi', 'skills', 'demos'), { recursive: true });
  writeFileSync(
    join(profileDirectory, 'cli_specific', 'pi', 'skills', 'demos', 'SKILL.md'),
    '---\nname: demos\ndescription: Demo runner\n---\n',
  );
};

const defaultProfileSynchronizer = {
  sync(_source: unknown, cachePath: string) {
    const profilesDirectory = join(cachePath, 'profiles');
    writeDefaultProfile(profilesDirectory, 'engineer', ['git:github.com/ai-outfitter/deepwork']);
    writeDefaultProfile(profilesDirectory, 'data_analyst', [
      'git:github.com/nhorton/pi-pr-alerts',
      'git:github.com/ai-outfitter/deepwork',
      'npm:pi-subagents',
    ]);
    writeDefaultProfile(profilesDirectory, 'analysis');
    return 'updated' as const;
  },
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('first-run runtime onboarding', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('starts Pi-native onboarding before launching pi', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const launches: unknown[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: () => undefined,
        selectDefaultProfile() {
          throw new Error('first-run runtime onboarding should not ask terminal setup questions');
        },
        launcher: {
          launch(plan) {
            launches.push(plan);
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('outfitter-bootstrap');
    expect(launches).toHaveLength(1);
    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('defers first-run role selection to native /outfitter before launching pi', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: () => undefined,
        selectDefaultProfile() {
          throw new Error('first-run runtime onboarding should not ask terminal setup questions');
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('outfitter-bootstrap');
    expect(result.launchPlan.args).not.toContain('--append-system-prompt');
    expect(existsSync(join(homeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1, OFTR-010.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('forces Pi-native onboarding for setup launches even when settings already exist', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://example.test/catalog.git';
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'default_profile: engineer\n');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, agentId: 'pi', forceRuntimeOnboarding: true, setupSourceUri },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: () => undefined,
        selectDefaultProfile() {
          throw new Error('setup runtime onboarding should not ask terminal setup questions');
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('outfitter-bootstrap');
    expect(result.launchPlan.args[0]).toBe('--extension');
    expect(readFileSync(result.launchPlan.args[1] ?? '', 'utf8')).toContain(JSON.stringify(setupSourceUri));
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe('default_profile: engineer\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('opens Pi login automatically during first-run bootstrap when Pi is not logged in', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];
    const providerApiKey = 'outfitter-test-provider-api-key';
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = providerApiKey;

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: (message) => messages.push(message),
        selectDefaultProfile() {
          throw new Error('first-run runtime onboarding should not ask terminal setup questions');
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    ).finally(() => {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
        return;
      }

      process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    });

    expect(result.launchPlan.args[0]).toBe('--extension');
    const loginExtensionContent = readFileSync(result.launchPlan.args[1] ?? '', 'utf8');
    expect(loginExtensionContent).toContain('"/login"');
    expect(loginExtensionContent).toContain('handleInput?.("\\r")');
    expect(loginExtensionContent).toContain('Credentials stay inside Pi');
    expect(messages).toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );
    expect(messages.join('\n')).not.toContain(providerApiKey);
    expect(loginExtensionContent).not.toContain(providerApiKey);
    expect(JSON.stringify(result.launchPlan)).not.toContain(providerApiKey);
    for (const fileName of ['auth.json', 'models.json', 'mcp.json']) {
      const piStatePath = join(homeDirectory, '.pi', 'agent', fileName);
      if (existsSync(piStatePath)) {
        expect(readFileSync(piStatePath, 'utf8')).not.toContain(providerApiKey);
      }
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('leaves non-interactive pi launches without onboarding, settings mutation, or login guidance', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, passThroughArgs: ['--print', 'hello'] },
        {
          interactive: true,
          input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
          output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
          synchronizer: defaultProfileSynchronizer,
          writeLine: (message) => messages.push(message),
          selectDefaultProfile() {
            throw new Error('non-interactive first runs must not ask terminal setup questions');
          },
          launcher: {
            launch() {
              throw new Error('non-interactive first runs must not launch without settings');
            },
          },
        },
      ),
    ).rejects.toThrow('Cannot run without a selected profile or default_profile');

    expect(messages).toEqual([]);
    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });
});
