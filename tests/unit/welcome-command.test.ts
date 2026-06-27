// Tests welcome command onboarding behavior.
import { PassThrough } from 'node:stream';

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { createWelcomeCommand, executeWelcomeCommand } from '../../src/cli/commands/WelcomeCommand.js';

const defaultLoadoutSources = [
  'git:github.com/ai-outfitter/deepwork',
  'npm:@juicesharp/rpiv-ask-user-question',
  'git:github.com/applepi-ai/ulta-tasklist',
  'npm:pi-nolo',
  'npm:pi-browser-harness',
  'npm:@mjakl/pi-subagent',
  'npm:@narumitw/pi-btw',
  'npm:pi-must-have-extension',
  'npm:pi-interactive-shell',
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
      messages: [
        'Skipped default profile setup. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
      ],
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
    expect(result.selectedRole).toEqual({
      id: 'data_analyst',
      label: 'Data Analyst',
      description: 'Data analysis setup for careful inspection, reproducible methods, assumptions, and summaries.',
    });
    expect(result.selectedLoadout?.id).toBe('recommended-pi');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
    expect(result.warnings).toEqual([]);
    expect(result.messages).toEqual([
      'Installed the founder profile. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
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

    expect(result.selectedRole).toEqual({
      id: 'founder',
      label: 'Founder',
      description:
        'Founder-operator setup for building, product thinking, research checks, dense prose, and careful delivery.',
    });
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual([
      'git:github.com/ai-outfitter/deepwork',
    ]);
    expect(result.warnings).toEqual([
      "Welcome role 'reviewer' is not available; using fallback role 'founder'.",
      "Loadout item 'missing-package' is not available for recommended-pi; skipping it.",
    ]);
    expect(result.messages).toContain(
      "Warning: Welcome role 'reviewer' is not available; using fallback role 'founder'.",
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
      'Installed the founder profile. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts with a single Y and installs the full founder loadout while showing welcome text', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    let outputText = '';
    output.on('data', (chunk: Buffer | string) => {
      outputText += chunk.toString();
    });
    const resultPromise = executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme/default' },
      { interactive: true, input, output },
    );
    setImmediate(() => input.end('y\n'));
    const result = await resultPromise;

    expect(outputText).toContain('____        _    __ _ _   _');
    expect(outputText).not.toContain('____  _');
    expect(outputText).toContain('Pi is a fully extensible agentic coding harness.');
    expect(outputText).toContain('Press Y to install it now.');
    expect(result.answered).toBe(true);
    expect(result.selectedRole?.id).toBe('founder');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
  });

  it('accepts with Enter (default) and installs the full founder loadout', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const resultPromise = executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme' },
      { interactive: true, input, output },
    );
    setImmediate(() => input.end('\n'));
    const result = await resultPromise;

    expect(result.answered).toBe(true);
    expect(result.selectedRole?.id).toBe('founder');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
  });

  it('declines with N and returns unanswered', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const resultPromise = executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme' },
      { interactive: true, input, output },
    );
    setImmediate(() => input.end('n\n'));
    const result = await resultPromise;

    expect(result.answered).toBe(false);
    expect(result.messages).toEqual([
      'Skipped default profile setup. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
    ]);
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
