// Guards quiet first-run startup when an unrelated catalog dependency remains unsynchronized.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { SetupResult } from '../../src/setup/Setup.js';

const temporaryRoots: string[] = [];

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('run agent onboarding warnings', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.10, OFTR-010.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('suppresses an unrelated resolution warning produced after onboarding', async () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-onboarding-'));
    temporaryRoots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });

    // Onboarding configures a default agent and a remote source whose closure was not fetched (as a
    // best-effort bootstrap dependency failure would leave it).
    const setup = (input: { homeDirectory: string }): Promise<SetupResult> => {
      write(
        join(input.homeDirectory, '.agents', 'agents', 'assistant', 'agent.md'),
        '---\nname: assistant\n---\n\nHi.\n',
      );
      write(
        join(input.homeDirectory, '.agents', 'settings.yml'),
        'default_agent: assistant\ndefault_harness: pi\nsources:\n  - github: acme/unsynced\n    ref: v1.0.0\n',
      );
      return Promise.resolve({
        created: [],
        updated: [],
        settingsPath: join(input.homeDirectory, '.agents', 'settings.yml'),
        defaultAgent: 'assistant',
        defaultHarness: 'pi' as const,
        messages: [],
      });
    };

    const lines: string[] = [];
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher: () => Promise.resolve(0),
      setup,
      writeLine: (message) => lines.push(message),
    });

    expect(lines).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it('gives one concise sync action when the selected agent is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-onboarding-'));
    temporaryRoots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(
      join(home, '.agents', 'settings.yml'),
      'default_agent: founder\nsources:\n  - github: acme/unsynced\n    ref: v1.0.0\n',
    );

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher: () => Promise.resolve(0),
    });

    expect(result.exitCode).toBe(1);
    expect(result.messages).toEqual(["Agent 'founder' is not ready. Run 'outfitter sync', then try again."]);
  });
});
