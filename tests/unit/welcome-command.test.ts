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

const sharedProfileChoices = [
  {
    id: 'engineer',
    label: 'Engineer',
    description: 'Engineering setup from the shared default profiles repository.',
  },
  {
    id: 'researcher',
    label: 'Researcher',
    description: 'Research setup with source checking and concise synthesis.',
  },
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
        'Skipped shared profile setup. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
      ],
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns selected shared default-profile data and recommended loadout data', async () => {
    const result = await executeWelcomeCommand(
      {
        homeDirectory: '/tmp/home',
        projectDirectory: '/work/acme/api',
        profileChoices: sharedProfileChoices,
        currentDefaultProfileId: 'engineer',
      },
      {
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: true, selectedProfileId: 'researcher' });
        },
      },
    );

    expect(result.answered).toBe(true);
    expect(result.selectedProfile).toEqual({
      id: 'researcher',
      label: 'Researcher',
      description: 'Research setup with source checking and concise synthesis.',
    });
    expect(result.selectedLoadout?.id).toBe('recommended-pi');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
    expect(result.warnings).toEqual([]);
    expect(result.messages).toEqual([
      "Selected default profile 'researcher' from shared profiles. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back for unavailable shared profiles and skips unknown loadout items', async () => {
    const result = await executeWelcomeCommand(
      {
        homeDirectory: '/tmp/home',
        projectDirectory: '/work/acme/api',
        profileChoices: sharedProfileChoices,
        currentDefaultProfileId: 'engineer',
      },
      {
        selectWelcomePlan() {
          return Promise.resolve({
            answerQuestions: true,
            selectedProfileId: 'reviewer',
            loadoutItemIds: ['deepwork', 'deepwork', 'missing-package'],
          });
        },
      },
    );

    expect(result.selectedProfile).toEqual({
      id: 'engineer',
      label: 'Engineer',
      description: 'Engineering setup from the shared default profiles repository.',
    });
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual([
      'git:github.com/ai-outfitter/deepwork',
    ]);
    expect(result.warnings).toEqual([
      "Welcome profile 'reviewer' is not available; using fallback profile 'engineer'.",
      "Loadout item 'missing-package' is not available for recommended-pi; skipping it.",
    ]);
    expect(result.messages).toContain(
      "Warning: Welcome profile 'reviewer' is not available; using fallback profile 'engineer'.",
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
        return Promise.resolve({ answerQuestions: true, selectedProfileId: 'engineer' });
      },
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'welcome']);

    expect(messages).toEqual([
      "Selected default profile 'engineer' from shared profiles. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1, OFTR-010.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses the first question to choose among remote profile labels and descriptions', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    let outputText = '';
    output.on('data', (chunk: Buffer | string) => {
      outputText += chunk.toString();
    });
    const resultPromise = executeWelcomeCommand(
      {
        homeDirectory: '/tmp/home',
        projectDirectory: '/work/acme/default',
        profileChoices: sharedProfileChoices,
        currentDefaultProfileId: 'engineer',
      },
      { interactive: true, input, output },
    );
    setImmediate(() => input.end('2\n'));
    const result = await resultPromise;

    expect(outputText).toContain('____        _    __ _ _   _');
    expect(outputText).not.toContain('____  _');
    expect(outputText).toContain('Pi is a fully extensible agentic coding harness.');
    expect(outputText).toContain('https://github.com/ai-outfitter/default-profiles');
    expect(outputText).toContain('remote_settings:');
    expect(outputText).toContain('github: ai-outfitter/default-profiles');
    expect(outputText).toContain('ref: main');
    expect(outputText).toContain('path: settings.yml');
    expect(outputText).not.toContain('Use shared profiles from');
    expect(outputText).toContain('1. engineer - Engineer');
    expect(outputText).toContain('Engineering setup from the shared default profiles repository.');
    expect(outputText).toContain('2. researcher - Researcher');
    expect(outputText).toContain('Research setup with source checking and concise synthesis.');
    expect(result.answered).toBe(true);
    expect(result.selectedProfile?.id).toBe('researcher');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
  });

  it('accepts with Enter (default) and selects the current shared default profile', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const resultPromise = executeWelcomeCommand(
      {
        homeDirectory: '/tmp/home',
        projectDirectory: '/work/acme',
        profileChoices: sharedProfileChoices,
        currentDefaultProfileId: 'engineer',
      },
      { interactive: true, input, output },
    );
    setImmediate(() => input.end('\n'));
    const result = await resultPromise;

    expect(result.answered).toBe(true);
    expect(result.selectedProfile?.id).toBe('engineer');
    expect(result.selectedLoadout?.selectedItems.map((item) => item.source)).toEqual(defaultLoadoutSources);
  });

  it('returns unanswered when no shared default profiles are available', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    let outputText = '';
    output.on('data', (chunk: Buffer | string) => {
      outputText += chunk.toString();
    });
    const result = await executeWelcomeCommand(
      { homeDirectory: '/tmp/home', projectDirectory: '/work/acme', profileChoices: [] },
      { interactive: true, input, output },
    );

    expect(result.answered).toBe(false);
    expect(outputText).toContain(
      'No shared default profiles were found. Outfitter will open /outfitter inside Pi instead.',
    );
    expect(result.messages).toEqual([
      'Skipped shared profile setup. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
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
