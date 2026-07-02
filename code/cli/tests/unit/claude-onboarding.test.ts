// Tests the claude first-run terminal onboarding: install guidance, the terminal-side
// profile picker with degraded-offline fallback, and the /login hint boundary.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentLaunchPlan } from '../../src/agents/AgentAdapter.js';
import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import type { RunCommandDependencies } from '../../src/cli/commands/RunCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-claude-onboarding-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const claudeLoginHint =
  'Claude Code manages its own credentials; if it reports that you are not logged in, run `/login` inside ' +
  'Claude Code. Outfitter never reads or stores Claude credentials.';

const createCatalogSynchronizer = (
  syncedSources: unknown[] = [],
): NonNullable<RunCommandDependencies['synchronizer']> => ({
  sync(source, cachePath) {
    syncedSources.push(source);
    for (const profileId of ['founder', 'engineer', 'data_analyst']) {
      mkdirSync(join(cachePath, 'profiles', profileId), { recursive: true });
      writeFileSync(
        join(cachePath, 'profiles', profileId, 'profile.yml'),
        `id: ${profileId}\nlabel: ${profileId}\ncontrols: {}\n`,
      );
    }
    return 'updated';
  },
});

const writeExistingClaudeSettings = (homeDirectory: string): void => {
  mkdirSync(join(homeDirectory, '.outfitter', 'profiles', 'engineer'), { recursive: true });
  writeFileSync(
    join(homeDirectory, '.outfitter', 'settings.yml'),
    'default_agent: claude\ndefault_profile: engineer\nprofile_sources:\n  - path: ./profiles\n',
  );
  writeFileSync(
    join(homeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml'),
    'id: engineer\ncontrols: {}\n',
  );
};

describe('claude first-run onboarding', () => {
  it('syncs the default catalog, picks a profile in the terminal, writes settings, and launches claude', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];
    const syncedSources: unknown[] = [];
    const offeredChoices: string[][] = [];
    const offeredDefaults: string[] = [];
    const launches: AgentLaunchPlan[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, agentId: 'claude' },
      {
        interactive: true,
        writeLine: (message) => messages.push(message),
        writeError: () => undefined,
        synchronizer: createCatalogSynchronizer(syncedSources),
        selectDefaultProfile: (profiles, currentDefault) => {
          offeredChoices.push(profiles.map((profile) => profile.id));
          offeredDefaults.push(currentDefault);
          return Promise.resolve('engineer');
        },
        launcher: {
          launch(plan) {
            launches.push(plan);
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(syncedSources).toEqual([{ github: 'ai-outfitter/default-profiles', path: 'profiles' }]);
    expect(offeredChoices).toEqual([['data_analyst', 'engineer', 'founder']]);
    expect(offeredDefaults).toEqual(['founder']);
    const settingsContent = readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8');
    expect(settingsContent).toContain('default_agent: claude');
    expect(settingsContent).toContain('default_profile: engineer');
    expect(settingsContent).toContain('github: ai-outfitter/default-profiles');
    expect(result.profileId).toBe('engineer');
    expect(result.agentId).toBe('claude');
    expect(launches).toHaveLength(1);
    expect(launches[0]?.command).toBe('claude');
    expect(launches[0]?.env.CLAUDE_CONFIG_DIR).toBe(result.compositeProfileDirectory);
    expect(messages).toContain(
      "Saved ~/.outfitter/settings.yml with default profile 'engineer' and default agent 'claude'.",
    );
    // No claude login state exists in the fixture home, so the /login hint is shown.
    expect(messages).toContain(claudeLoginHint);
  });

  it('prompts through the terminal readline picker when no picker dependency is injected', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    let outputText = '';
    output.on('data', (chunk: Buffer | string) => {
      outputText += chunk.toString();
    });

    const resultPromise = executeRunCommand(
      { homeDirectory, projectDirectory, agentId: 'claude' },
      {
        input,
        output,
        writeLine: () => undefined,
        writeError: () => undefined,
        synchronizer: createCatalogSynchronizer(),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
    setImmediate(() => input.end('\n'));
    const result = await resultPromise;

    expect(outputText).toContain("You're setting up Outfitter for Claude Code.");
    expect(outputText).toContain('Choose the default profile for your sessions:');
    expect(outputText).toContain('founder');
    // Enter accepts the recommended founder default.
    expect(result.profileId).toBe('founder');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: founder',
    );
  });

  it('falls back to the built-in starter profile when the default catalog cannot sync', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const warnings: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, agentId: 'claude' },
      {
        interactive: true,
        writeLine: () => undefined,
        writeError: (message) => warnings.push(message),
        synchronizer: {
          sync() {
            throw new Error('network blocked');
          },
        },
        selectDefaultProfile: (profiles, currentDefault) => {
          expect(profiles.map((profile) => profile.id)).toEqual(['starter']);
          return Promise.resolve(currentDefault);
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('starter');
    expect(result.agentId).toBe('claude');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'profiles', 'starter', 'profile.yml'), 'utf8')).toContain(
      'id: starter',
    );
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: starter',
    );
    expect(
      warnings.some(
        (message) =>
          message.includes('github:ai-outfitter/default-profiles') &&
          message.includes('network blocked') &&
          message.includes('`outfitter sync`'),
      ),
    ).toBe(true);

    // Later runs keep working offline: the unsynced catalog source contributes no
    // profiles until `outfitter sync` succeeds, and the starter default still resolves.
    const secondResult = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeLine: () => undefined,
        writeError: () => undefined,
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
    expect(secondResult.profileId).toBe('starter');
    expect(secondResult.agentId).toBe('claude');
  });

  it('rejects a picker selection that is not one of the offered profiles', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, agentId: 'claude' },
        {
          interactive: true,
          writeLine: () => undefined,
          writeError: () => undefined,
          synchronizer: createCatalogSynchronizer(),
          selectDefaultProfile: () => Promise.resolve('not-offered'),
          launcher: {
            launch() {
              throw new Error('must not launch after an invalid picker selection');
            },
          },
        },
      ),
    ).rejects.toThrow("Selected default profile 'not-offered' was not one of the available setup profiles.");

    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  it('does not show the picker or mutate settings for non-interactive claude first runs', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, agentId: 'claude' },
        {
          interactive: false,
          writeLine: () => undefined,
          synchronizer: {
            sync() {
              throw new Error('non-interactive first runs must not sync onboarding sources');
            },
          },
          launcher: {
            launch() {
              throw new Error('non-interactive first runs must not launch without settings');
            },
          },
        },
      ),
    ).rejects.toThrow('Cannot run without a selected profile or default_profile');

    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  it('skips onboarding for print-mode claude launches and explicit profile selections', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const failingDependencies = {
      interactive: true,
      writeLine: () => undefined,
      selectDefaultProfile: () => Promise.reject(new Error('the picker must not open')),
      synchronizer: {
        sync: () => {
          throw new Error('onboarding sources must not sync');
        },
      },
    } as const;

    for (const printFlag of ['--print', '-p']) {
      await expect(
        executeRunCommand(
          { homeDirectory, projectDirectory, agentId: 'claude', passThroughArgs: [printFlag] },
          failingDependencies,
        ),
      ).rejects.toThrow('Cannot run without a selected profile or default_profile');
    }

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, agentId: 'claude', profileId: 'engineer' },
        failingDependencies,
      ),
    ).rejects.toThrow("Cannot resolve profile 'engineer'");

    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });
});

describe('claude login hint', () => {
  const runWithExistingSettings = async (
    homeDirectory: string,
    projectDirectory: string,
    overrides: Partial<Parameters<typeof executeRunCommand>[0]> = {},
  ): Promise<string[]> => {
    const messages: string[] = [];

    await executeRunCommand(
      { homeDirectory, projectDirectory, ...overrides },
      {
        interactive: true,
        writeLine: (message) => messages.push(message),
        writeError: () => undefined,
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    return messages;
  };

  it('hints at /login when no claude login state is detectable and stays quiet once it is', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeExistingClaudeSettings(homeDirectory);

    expect(await runWithExistingSettings(homeDirectory, projectDirectory)).toContain(claudeLoginHint);

    // A malformed ~/.claude.json is not evidence of a configured login.
    writeFileSync(join(homeDirectory, '.claude.json'), 'not json\n');
    expect(await runWithExistingSettings(homeDirectory, projectDirectory)).toContain(claudeLoginHint);

    writeFileSync(join(homeDirectory, '.claude.json'), '[]\n');
    expect(await runWithExistingSettings(homeDirectory, projectDirectory)).toContain(claudeLoginHint);

    writeFileSync(join(homeDirectory, '.claude.json'), '{"oauthAccount":{"emailAddress":"user@example.com"}}\n');
    expect(await runWithExistingSettings(homeDirectory, projectDirectory)).not.toContain(claudeLoginHint);

    rmSync(join(homeDirectory, '.claude.json'));
    mkdirSync(join(homeDirectory, '.claude'), { recursive: true });
    writeFileSync(join(homeDirectory, '.claude', '.credentials.json'), '{}\n');
    expect(await runWithExistingSettings(homeDirectory, projectDirectory)).not.toContain(claudeLoginHint);
  });

  it('does not hint for print-mode claude launches or non-claude agents', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeExistingClaudeSettings(homeDirectory);

    expect(
      await runWithExistingSettings(homeDirectory, projectDirectory, { passThroughArgs: ['--print', 'prompt'] }),
    ).not.toContain(claudeLoginHint);
    expect(await runWithExistingSettings(homeDirectory, projectDirectory, { agentId: 'pi' })).not.toContain(
      claudeLoginHint,
    );
  });

  it('translates a missing claude binary into actionable npm and brew install guidance', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeExistingClaudeSettings(homeDirectory);

    const thrownError = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeLine: () => undefined,
        launcher: {
          launch: () => Promise.reject(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })),
        },
      },
    ).catch((error: unknown) => error);

    expect(thrownError).toBeInstanceOf(Error);
    const message = (thrownError as Error).message;
    expect(message).toContain("Could not launch the 'claude' agent CLI");
    expect(message).toContain('npm install -g @anthropic-ai/claude-code');
    expect(message).toContain('brew install --cask claude-code');
  });
});
