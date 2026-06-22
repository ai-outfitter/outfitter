// Tests welcome command onboarding behavior.
import { PassThrough } from 'node:stream';

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { createWelcomeCommand, executeWelcomeCommand } from '../../src/cli/commands/WelcomeCommand.js';

const defaultLoadoutSources = [
  'git:github.com/ai-outfitter/ulta-tasklist',
  'git:github.com/ai-outfitter/deepwork',
  'npm:pi-subagents',
  'npm:pi-mcp-adapter',
];

describe('welcome command', () => {
  it('returns skipped onboarding without prompting when the selector opts out', async () => {
    const result = await executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/tmp/project' },
      {
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
      },
    );

    expect(result).toEqual({
      answered: false,
      warnings: [],
      messages: ['Skipped Outfitter welcome questions. Run `outfitter welcome` any time to revisit them.'],
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns selected default-profile role and recommended loadout data', async () => {
    const result = await executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme/api' },
      {
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: true, selectedRoleId: 'data_analyst' });
        },
      },
    );

    expect(result.answered).toBe(true);
    expect(result.selectedRole).toEqual({ id: 'data_analyst', label: 'Data Analyst' });
    expect(result.selectedLoadout?.id).toBe('recommended-pi');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
    expect(result.warnings).toEqual([]);
    expect(result.messages).toEqual([
      'Selected Outfitter role: data_analyst (Data Analyst).',
      `Selected Recommended Pi productivity loadout: ${defaultLoadoutSources.join(', ')}.`,
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back for unknown roles and skips unknown loadout items', async () => {
    const result = await executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme/api' },
      {
        selectWelcomePlan() {
          return Promise.resolve({
            answerQuestions: true,
            selectedRoleId: 'reviewer',
            loadoutItemIds: ['deepwork', 'deepwork', 'missing-package'],
          });
        },
      },
    );

    expect(result.selectedRole).toEqual({ id: 'engineer', label: 'Engineer' });
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual([
      'git:github.com/ai-outfitter/deepwork',
    ]);
    expect(result.warnings).toEqual([
      "Welcome role 'reviewer' is not available; using fallback role 'engineer'.",
      "Loadout item 'missing-package' is not available for recommended-pi; skipping it.",
    ]);
    expect(result.messages).toContain(
      "Warning: Welcome role 'reviewer' is not available; using fallback role 'engineer'.",
    );
  });

  it('runs through the registered welcome command action', async () => {
    const program = new Command();
    const messages: string[] = [];
    createWelcomeCommand({
      homeDirectory: '/tmp/home',
      projectDirectory: '/tmp/project',
      input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
      output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
      writeLine: (message) => messages.push(message),
      selectWelcomePlan() {
        return Promise.resolve({ answerQuestions: true });
      },
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'welcome']);

    expect(messages).toEqual([
      'Selected Outfitter role: engineer (Engineer).',
      `Selected Recommended Pi productivity loadout: ${defaultLoadoutSources.join(', ')}.`,
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1, OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('supports readline answers for role and selected loadout items while showing welcome text', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    let outputText = '';
    output.on('data', (chunk: Buffer | string) => {
      outputText += chunk.toString();
    });
    const answers = ['y', '2', 'c', '2,4'];
    const writeNextAnswer = (): void => {
      const answer = answers.shift();

      if (answer === undefined) {
        input.end();
        return;
      }

      input.write(`${answer}\n`);
      setImmediate(writeNextAnswer);
    };
    const resultPromise = executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme/default' },
      { interactive: true, input, output },
    );
    setImmediate(writeNextAnswer);
    const result = await resultPromise;

    expect(outputText).toContain('____        _    __ _ _   _');
    expect(outputText).not.toContain('____  _');
    expect(outputText).toContain('Pi is a heavily customizable coding harness.');
    expect(outputText).toContain('engineer - Engineer');
    expect(outputText).toContain('data_analyst - Data Analyst');
    expect(outputText).toContain('npm:pi-mcp-adapter');
    expect(result.answered).toBe(true);
    expect(result.selectedRole?.id).toBe('data_analyst');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual([
      'git:github.com/ai-outfitter/deepwork',
      'npm:pi-mcp-adapter',
    ]);
  });

  it('supports readline role fallback and accepting the full loadout', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const answers = ['y', '9', ''];
    const writeNextAnswer = (): void => {
      const answer = answers.shift();

      if (answer === undefined) {
        input.end();
        return;
      }

      input.write(`${answer}\n`);
      setImmediate(writeNextAnswer);
    };
    const resultPromise = executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme' },
      { interactive: true, input, output },
    );
    setImmediate(writeNextAnswer);
    const result = await resultPromise;

    expect(result.selectedRole?.id).toBe('engineer');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
  });

  it('supports readline custom loadout defaults', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const answers = ['y', '', 'c', ''];
    const writeNextAnswer = (): void => {
      const answer = answers.shift();

      if (answer === undefined) {
        input.end();
        return;
      }

      input.write(`${answer}\n`);
      setImmediate(writeNextAnswer);
    };
    const resultPromise = executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme' },
      { interactive: true, input, output },
    );
    setImmediate(writeNextAnswer);
    const result = await resultPromise;

    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
  });

  it('supports readline defaults and skipping loadout installation', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const answers = ['', '', 'n'];
    const writeNextAnswer = (): void => {
      const answer = answers.shift();

      if (answer === undefined) {
        input.end();
        return;
      }

      input.write(`${answer}\n`);
      setImmediate(writeNextAnswer);
    };
    const resultPromise = executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme' },
      { interactive: true, input, output },
    );
    setImmediate(writeNextAnswer);
    const result = await resultPromise;

    expect(result.answered).toBe(true);
    expect(result.selectedRole?.id).toBe('engineer');
    expect(result.selectedLoadout?.selectedItems).toEqual([]);
    expect(result.messages).toEqual([
      'Selected Outfitter role: engineer (Engineer).',
      'Skipped Recommended Pi productivity loadout.',
    ]);
  });

  it('supports readline opt-out answers', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const resultPromise = executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme' },
      { interactive: true, input, output },
    );
    setImmediate(() => input.end('n\n'));
    const result = await resultPromise;

    expect(result.answered).toBe(false);
  });

  it('requires TTY streams for interactive welcome prompts', async () => {
    await expect(
      executeWelcomeCommand(
        { homeDirectory: '/tmp/home', projectDirectory: '/tmp/project' },
        {
          interactive: true,
          input: { isTTY: false } as NodeJS.ReadableStream & { isTTY: false },
          output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        },
      ),
    ).rejects.toThrow('requires an interactive TTY');
    await expect(
      executeWelcomeCommand(
        { homeDirectory: '/tmp/home', projectDirectory: '/tmp/project' },
        {
          interactive: true,
          input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
          output: { isTTY: false } as NodeJS.WritableStream & { isTTY: false },
        },
      ),
    ).rejects.toThrow('requires an interactive TTY');
  });
});
