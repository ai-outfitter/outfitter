// Behavioral tests for the Outfitter Pi extension against the typed pi API surface.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activateExtension,
  cleanupTemporaryRoots,
  createMockContext,
  createTemporaryRoot,
  keySequences,
  startMockSession,
  type MockContext,
  type MockPi,
} from './harness.js';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTemporaryRoots();
});

describe('startup header', () => {
  it('renders the ASCII art, brand line, and self-help hint on regular startups', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root });

    await startMockSession(pi, mock);

    const header = mock.headerRenders[0] ?? [];
    expect(header.slice(0, 3)).toEqual([' ___', '(o o)', ' ___']);
    expect(header.join('\n')).toContain('Outfitter + pi');
    expect(header.join('\n')).toContain('/ commands · ! bash · shift+tab mode · ctrl+shift+t thinking · ctrl+o more');
    expect(header.join('\n')).toContain(
      'Outfitter + Pi can explain its own features and look up its docs. Ask it how to use or extend Pi or outfitter profiles.',
    );
    expect(mock.statusUpdates[0]).toEqual({ key: 'outfitter-mode', text: 'mode: build' });
  });

  it('renders first-run explanatory text without ASCII art when disabled', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({
      homeDirectory: root,
      projectDirectory: root,
      autoOpenOutfitter: true,
      startupAsciiArt: false,
    });

    await startMockSession(pi, mock);

    const header = mock.headerRenders[0]?.join('\n') ?? '';
    expect(header).toContain('Outfitter turns Pi into a configured working environment:');
    expect(header).toContain('profiles define model, tools, prompts, skills, and extensions');
    expect(header).not.toContain('(o o)');
  });

  it('extends the gradient with the accent color for extra ASCII art lines', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({
      homeDirectory: root,
      projectDirectory: root,
      asciiArt: 'one\ntwo\nthree\nfour\nfive\nsix',
    });

    await startMockSession(pi, mock);

    expect(mock.headerRenders[0]?.slice(0, 6)).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
  });

  it('skips header branding outside the TUI', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root }, { mode: 'print' });

    await startMockSession(pi, mock);

    expect(mock.headerRenders).toHaveLength(0);
  });
});

describe('plan/build mode', () => {
  const enterPlanMode = async (pi: MockPi, mock: MockContext): Promise<void> => {
    await startMockSession(pi, mock);
    expect(mock.terminalInputHandler?.(keySequences.shiftTab)).toEqual({ consume: true });
  };

  it('toggles plan/build mode with Shift+Tab and blocks plan-mode Bash commands', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root });

    await enterPlanMode(pi, mock);

    expect(pi.activeTools).toEqual(['read', 'grep', 'find', 'ls']);
    expect(mock.statusUpdates.at(-1)).toEqual({ key: 'outfitter-mode', text: 'mode: plan' });
    await expect(
      pi.handlers.tool_call?.[0]?.({ toolName: 'bash', input: { command: 'rm file.txt' } }, mock.context),
    ).resolves.toMatchObject({ block: true, reason: expect.stringContaining('rm file.txt') as string });
    await expect(
      pi.handlers.context?.[0]?.(
        { messages: [{ customType: 'outfitter-mode-context' }, { role: 'user' }] },
        mock.context,
      ),
    ).resolves.toEqual({
      messages: [
        { role: 'user' },
        expect.objectContaining({ customType: 'outfitter-mode-context', display: false, role: 'custom' }),
      ],
    });

    expect(mock.terminalInputHandler?.(keySequences.shiftTab)).toEqual({ consume: true });
    expect(pi.activeTools).toEqual(['read', 'bash', 'edit', 'write']);
    await expect(
      pi.handlers.tool_call?.[0]?.({ toolName: 'bash', input: { command: 'ls' } }, mock.context),
    ).resolves.toBeUndefined();
    await expect(
      pi.handlers.context?.[0]?.(
        { messages: [{ customType: 'outfitter-mode-context' }, { role: 'user' }] },
        mock.context,
      ),
    ).resolves.toEqual({ messages: [{ role: 'user' }] });
  });

  it('blocks plan-mode Bash commands without command input and ignores other tools', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root });

    await enterPlanMode(pi, mock);

    await expect(pi.handlers.tool_call?.[0]?.({ toolName: 'bash' }, mock.context)).resolves.toMatchObject({
      block: true,
    });
    await expect(pi.handlers.tool_call?.[0]?.({ toolName: 'read', input: {} }, mock.context)).resolves.toBeUndefined();
  });

  it('falls back to the canonical plan tool list when pi exposes none of them', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root });
    (pi.api as { getAllTools: () => { name: string }[] }).getAllTools = () => [];

    await enterPlanMode(pi, mock);

    expect(pi.activeTools).toEqual(['read', 'grep', 'find', 'ls']);
  });

  it('ignores non-Shift+Tab terminal input and keeps saved build tools across toggles', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root });

    await startMockSession(pi, mock);
    pi.api.setActiveTools(['read', 'edit']);

    expect(mock.terminalInputHandler?.('x')).toBeUndefined();
    expect(mock.terminalInputHandler?.(keySequences.shiftTab)).toEqual({ consume: true });
    expect(mock.terminalInputHandler?.(keySequences.shiftTab)).toEqual({ consume: true });
    expect(pi.activeTools).toEqual(['read', 'edit']);
  });

  it('toggles the mode from the /mode command inside the TUI only', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root });
    await startMockSession(pi, mock);

    await pi.commands.mode?.handler('', mock.context);
    expect(pi.activeTools).toEqual(['read', 'grep', 'find', 'ls']);
    await pi.commands.mode?.handler('', mock.context);
    expect(pi.activeTools).toEqual(['read', 'bash', 'edit', 'write']);

    const nonTui = createMockContext({ mode: 'print' });
    await pi.commands.mode?.handler('', nonTui.context);
    expect(pi.activeTools).toEqual(['read', 'bash', 'edit', 'write']);
  });
});

describe('project trust', () => {
  it('auto-trusts only the exact project folder during first-run onboarding', async () => {
    const root = createTemporaryRoot();
    const projectDirectory = join(root, 'project');
    const { pi, mock } = activateExtension({
      homeDirectory: root,
      projectDirectory: resolve(projectDirectory),
      autoOpenOutfitter: true,
    });

    await expect(pi.handlers.project_trust?.[0]?.({ cwd: resolve(projectDirectory) }, mock.context)).resolves.toEqual({
      trusted: 'yes',
      remember: true,
    });
    await expect(pi.handlers.project_trust?.[0]?.({ cwd: dirname(projectDirectory) }, mock.context)).resolves.toEqual({
      trusted: 'undecided',
    });
  });

  it('stays undecided when runtime onboarding is not active', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root });

    await expect(pi.handlers.project_trust?.[0]?.({ cwd: root }, mock.context)).resolves.toEqual({
      trusted: 'undecided',
    });
  });
});

describe('system prompt export', () => {
  it('exports the runtime system prompt when the export path is set', async () => {
    const root = createTemporaryRoot();
    const outputPath = join(root, 'nested', 'system-prompt.md');
    vi.stubEnv('OUTFITTER_SYSTEM_PROMPT_EXPORT_PATH', outputPath);
    const { pi, mock } = activateExtension(
      { homeDirectory: root, projectDirectory: root },
      { systemPrompt: 'runtime prompt body' },
    );

    await startMockSession(pi, mock);

    expect(readFileSync(outputPath, 'utf8')).toContain('# Generated Pi runtime system prompt');
    expect(readFileSync(outputPath, 'utf8')).toContain('runtime prompt body');
  });

  it('skips the export for non-string prompts and unset export paths', async () => {
    const root = createTemporaryRoot();
    const outputPath = join(root, 'system-prompt.md');
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root }, { systemPrompt: 'unused' });
    await startMockSession(pi, mock);
    expect(existsSync(outputPath)).toBe(false);

    vi.stubEnv('OUTFITTER_SYSTEM_PROMPT_EXPORT_PATH', outputPath);
    const nonString = activateExtension({ homeDirectory: root, projectDirectory: root }, { systemPrompt: 42 });
    await startMockSession(nonString.pi, nonString.mock);
    expect(existsSync(outputPath)).toBe(false);
  });
});

describe('login kickoff', () => {
  it('opens Pi /login when no models are available after startup', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root }, { availableModels: [] });

    await startMockSession(pi, mock);

    expect(mock.editorText).toBe('/login');
    expect(mock.submittedInputs).toEqual(['\r']);
    expect(mock.customRenders[0]?.join('\n')).toContain('Pi does not have a model provider connected yet.');
    expect(mock.customRenders[0]?.join('\n')).toContain('Connect one now so Outfitter can use Pi.');
    expect(mock.customRenders[0]?.join('\n')).toContain('Credentials stay inside Pi.');
    expect(mock.customRenders[0]?.join('\n')).toContain('→ Connect a model provider');
  });

  it('does not resubmit /login once it has been submitted', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension(
      { homeDirectory: root, projectDirectory: root },
      { availableModels: [], selectedOptions: ['Connect a model provider', 'Connect a model provider'] },
    );

    await startMockSession(pi, mock);
    await startMockSession(pi, mock, 'reload');

    expect(mock.submittedInputs).toEqual(['\r']);
  });

  it('keeps pi untouched when models are available or the confirmation is cancelled', async () => {
    const root = createTemporaryRoot();
    const available = activateExtension({ homeDirectory: root, projectDirectory: root });
    await startMockSession(available.pi, available.mock);
    expect(available.mock.editorText).toBe('');

    const cancelled = activateExtension(
      { homeDirectory: root, projectDirectory: root },
      { availableModels: [], selectedOptions: [undefined] },
    );
    await startMockSession(cancelled.pi, cancelled.mock);
    expect(cancelled.mock.editorText).toBe('');
    expect(cancelled.mock.submittedInputs).toEqual([]);
  });

  it('falls back to the current model when the registry is unavailable or failing', async () => {
    const root = createTemporaryRoot();

    const noRegistry = activateExtension(
      { homeDirectory: root, projectDirectory: root },
      { hasModelRegistry: false, model: { id: 'model' } },
    );
    await startMockSession(noRegistry.pi, noRegistry.mock);
    expect(noRegistry.mock.editorText).toBe('');

    const noRegistryNoModel = activateExtension(
      { homeDirectory: root, projectDirectory: root },
      { hasModelRegistry: false, selectedOptions: ['Connect a model provider'] },
    );
    await startMockSession(noRegistryNoModel.pi, noRegistryNoModel.mock);
    expect(noRegistryNoModel.mock.editorText).toBe('/login');

    const throwing = activateExtension(
      { homeDirectory: root, projectDirectory: root },
      {
        getAvailable: () => Promise.reject(new Error('registry offline')),
        model: { id: 'model' },
      },
    );
    await startMockSession(throwing.pi, throwing.mock);
    expect(throwing.mock.editorText).toBe('');

    const throwingNoModel = activateExtension(
      { homeDirectory: root, projectDirectory: root },
      {
        getAvailable: () => Promise.reject(new Error('registry offline')),
        selectedOptions: ['Connect a model provider'],
      },
    );
    await startMockSession(throwingNoModel.pi, throwingNoModel.mock);
    expect(throwingNoModel.mock.editorText).toBe('/login');

    const nonArray = activateExtension(
      { homeDirectory: root, projectDirectory: root },
      { getAvailable: () => Promise.resolve('not-a-list'), selectedOptions: ['Connect a model provider'] },
    );
    await startMockSession(nonArray.pi, nonArray.mock);
    expect(nonArray.mock.editorText).toBe('/login');
  });
});
