// Guards OFTR-004.6.10's coherence at the run boundary: first-run onboarding fetches the declared
// closure best-effort, and a dependency it could not fetch must surface as an actionable
// `outfitter sync` warning. That warning is only computable after onboarding, so RunAgentCommand
// must emit it from the post-onboarding re-resolve. Reverting that emit makes this test fail.
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
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('surfaces a newly-actionable resolution warning produced after onboarding', async () => {
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

    // Surfaced to the terminal (writeLine)...
    expect(lines.some((line) => line.includes("Run 'outfitter sync'"))).toBe(true);
    expect(lines.some((line) => line.includes('github:acme/unsynced#v1.0.0'))).toBe(true);
    // ...and returned to programmatic callers, after the setup notices.
    expect(result.messages.some((message) => message.includes("Run 'outfitter sync'"))).toBe(true);
  });
});
