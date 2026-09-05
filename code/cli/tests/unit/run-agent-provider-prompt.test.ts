// Tests the provider-prompt handoff from first-run setup into the relaunched pi session (#372).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import type { SetupResult } from '../../src/setup/Setup.js';

const temporaryRoots: string[] = [];
const captured: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-provider-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

// Captures the stamped runtime extension so the provider prompt mode can be asserted.
const launcher = (plan: AgentLaunchPlan): Promise<number> => {
  const path = plan.args.find(
    (arg, index) => plan.args[index - 1] === '--extension' && arg.endsWith('outfitter-runtime-extension.js'),
  );
  captured.push(path !== undefined && existsSync(path) ? readFileSync(path, 'utf8') : '');
  return Promise.resolve(0);
};

beforeEach(() => {
  captured.length = 0;
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('run agent provider prompt', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.7.3).
  it('relaunches in hint mode after the user skipped the provider step in setup', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    const setup = (input: { homeDirectory: string }, extra: Partial<SetupResult>): Promise<SetupResult> => {
      write(
        join(input.homeDirectory, '.agents', 'agents', 'assistant', 'agent.md'),
        '---\nname: assistant\n---\n\nHi.\n',
      );
      write(join(input.homeDirectory, '.agents', 'settings.yml'), 'default_agent: assistant\ndefault_harness: pi\n');
      return Promise.resolve({
        created: [],
        updated: [],
        settingsPath: join(input.homeDirectory, '.agents', 'settings.yml'),
        defaultAgent: 'assistant',
        defaultHarness: 'pi' as const,
        messages: [],
        ...extra,
      });
    };

    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher,
      setup: (input) => setup(input, { providerPromptSkipped: true }),
    });
    expect(captured[0]).toContain('const OUTFITTER_PROVIDER_PROMPT_MODE = "hint";');

    // Without setup (or after a connected/available provider) the runtime dialog stays in place.
    await executeRunAgentCommand({ homeDirectory: home, projectDirectory: project, launcher });
    expect(captured[1]).toContain('const OUTFITTER_PROVIDER_PROMPT_MODE = "dialog";');
  });

  it('prints the /login hint with the sync next step when a skipped-provider setup cannot launch', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher,
      setup: () =>
        Promise.resolve({
          created: [],
          updated: [],
          settingsPath: join(home, '.agents', 'settings.yml'),
          defaultHarness: 'pi' as const,
          messages: [],
          providerPromptSkipped: true,
        }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.messages).toEqual([
      expect.stringContaining("Run 'outfitter sync'"),
      "No model provider connected yet. Run '/login' inside Outfitter to connect one.",
    ]);
  });
});
