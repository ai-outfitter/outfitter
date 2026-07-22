// Tests the Claude first-run/login handoff that remains after universal setup moved into Pi.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import {
  claudeLoginHintMessage,
  hasConfiguredClaudeLoginState,
  resolveClaudeLoginHint,
} from '../../src/cli/commands/run/RunClaudeOnboarding.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-claude-onboarding-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('claude login handoff', () => {
  it('detects native Claude login markers without treating malformed config as login state', () => {
    const home = createTemporaryRoot();
    expect(hasConfiguredClaudeLoginState(home)).toBe(false);
    write(join(home, '.claude.json'), 'not json');
    expect(hasConfiguredClaudeLoginState(home)).toBe(false);
    write(join(home, '.claude.json'), '[]');
    expect(hasConfiguredClaudeLoginState(home)).toBe(false);
    write(join(home, '.claude.json'), '{"oauthAccount":{"emailAddress":"user@example.com"}}');
    expect(hasConfiguredClaudeLoginState(home)).toBe(true);
    write(join(home, '.claude.json'), '{}');
    write(join(home, '.claude', '.credentials.json'), '{}');
    expect(hasConfiguredClaudeLoginState(home)).toBe(true);
  });

  it('only returns the handoff for interactive, non-print Claude launches without login state', () => {
    const homeDirectory = createTemporaryRoot();
    const hint = (overrides: Partial<Parameters<typeof resolveClaudeLoginHint>[0]> = {}) =>
      resolveClaudeLoginHint({
        harness: 'claude',
        homeDirectory,
        passThroughArgs: [],
        interactive: true,
        ...overrides,
      });

    expect(hint()).toBe(claudeLoginHintMessage);
    expect(hint({ harness: 'pi' })).toBeUndefined();
    expect(hint({ interactive: false })).toBeUndefined();
    expect(hint({ passThroughArgs: ['--print', 'hello'] })).toBeUndefined();
    expect(hint({ passThroughArgs: ['-p', 'hello'] })).toBeUndefined();
    write(join(homeDirectory, '.claude.json'), '{"primaryApiKey":"configured"}');
    expect(hint()).toBeUndefined();
  });

  it('emits the native /login handoff before launching Claude', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    write(join(projectDirectory, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n');
    const events: string[] = [];

    const result = await executeRunAgentCommand({
      homeDirectory,
      projectDirectory,
      agent: 'engineer',
      harness: 'claude',
      interactive: true,
      writeLine: (message) => events.push(message),
      launcher: () => {
        events.push('launch');
        return Promise.resolve(0);
      },
    });

    expect(result.messages).toContain(claudeLoginHintMessage);
    expect(events.indexOf(claudeLoginHintMessage)).toBeLessThan(events.indexOf('launch'));
  });
});
