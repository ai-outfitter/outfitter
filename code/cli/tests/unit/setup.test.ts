// Tests interactive onboarding: writes a starter .agents config, sanitizes names, is idempotent.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createSetupCommand, runSetup } from '../../src/cli/commands/SetupCommand.js';
import type { SetupPrompter } from '../../src/setup/Setup.js';
import { executeSetup, sanitizeAgentSlug } from '../../src/setup/Setup.js';

const temporaryRoots: string[] = [];

const createTemporaryHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'outfitter-setup-'));
  temporaryRoots.push(home);
  return home;
};

const scriptedPrompter = (answers: { harness?: string; name?: string }, interactive = true): SetupPrompter => ({
  interactive,
  select: (_question, _options, defaultValue) => Promise.resolve(answers.harness ?? defaultValue),
  input: (_question, defaultValue) => Promise.resolve(answers.name ?? defaultValue),
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('outfitter setup', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes settings and a starter agent from the prompted answers', async () => {
    const home = createTemporaryHome();
    const result = await executeSetup({
      homeDirectory: home,
      prompter: scriptedPrompter({ harness: 'claude', name: 'Engineer Bot' }),
    });

    expect(result.alreadyConfigured).toBe(false);
    expect(result.defaultAgent).toBe('engineer-bot'); // sanitized from "Engineer Bot"
    expect(result.defaultHarness).toBe('claude');

    const settings = readFileSync(join(home, '.agents', 'settings.yml'), 'utf8');
    expect(settings).toContain('default_agent: "engineer-bot"'); // quoted so numeric/bool-like slugs stay strings
    expect(settings).toContain('default_harness: claude');

    const agent = readFileSync(join(home, '.agents', 'agents', 'engineer-bot', 'agent.md'), 'utf8');
    expect(agent).toContain('name: "engineer-bot"'); // name matches directory so it composes
    expect(result.created).toEqual([
      join(home, '.agents', 'settings.yml'),
      join(home, '.agents', 'agents', 'engineer-bot', 'agent.md'),
    ]);
  });

  it('uses defaults when the prompter declines every question', async () => {
    const home = createTemporaryHome();
    const result = await executeSetup({ homeDirectory: home, prompter: scriptedPrompter({}) });

    expect(result.defaultAgent).toBe('assistant');
    expect(result.defaultHarness).toBe('pi');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('coerces an unusable name to the default slug', async () => {
    const home = createTemporaryHome();
    const result = await executeSetup({ homeDirectory: home, prompter: scriptedPrompter({ name: '!!!' }) });
    expect(result.defaultAgent).toBe('assistant');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('produces schema-valid slugs: collapses hyphen runs and truncates to 64 chars', () => {
    expect(sanitizeAgentSlug('foo--bar__baz')).toBe('foo-bar-baz'); // no consecutive hyphens
    const long = sanitizeAgentSlug('a'.repeat(80));
    expect(long.length).toBe(64);
    expect(sanitizeAgentSlug(`${'a'.repeat(63)}-b`)).toBe('a'.repeat(63)); // truncation leaves no trailing hyphen
    const schemaPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    expect(schemaPattern.test('foo-bar-baz')).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.3.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('is idempotent: leaves an existing settings.yml untouched', async () => {
    const home = createTemporaryHome();
    mkdirSync(join(home, '.agents'), { recursive: true });
    writeFileSync(join(home, '.agents', 'settings.yml'), 'default_agent: kept\n');

    const result = await executeSetup({ homeDirectory: home, prompter: scriptedPrompter({ name: 'other' }) });

    expect(result.alreadyConfigured).toBe(true);
    expect(result.created).toEqual([]);
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toBe('default_agent: kept\n');
    expect(existsSync(join(home, '.agents', 'agents', 'other'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.3.2, OFTR-010.3.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('never overwrites an existing agent, and rolls back settings on that conflict', async () => {
    const home = createTemporaryHome();
    const agentPath = join(home, '.agents', 'agents', 'taken', 'agent.md');
    mkdirSync(dirname(agentPath), { recursive: true });
    writeFileSync(agentPath, 'PRE-EXISTING');

    const result = await executeSetup({ homeDirectory: home, prompter: scriptedPrompter({ name: 'taken' }) });

    expect(result.created).toEqual([]);
    expect(result.defaultAgent).toBeUndefined();
    expect(readFileSync(agentPath, 'utf8')).toBe('PRE-EXISTING'); // untouched
    expect(existsSync(join(home, '.agents', 'settings.yml'))).toBe(false); // rolled back
  });

  it('sanitizeAgentSlug normalizes casing, spaces, and edges', () => {
    expect(sanitizeAgentSlug('  My Agent  ')).toBe('my-agent');
    expect(sanitizeAgentSlug('data_analyst')).toBe('data-analyst');
    expect(sanitizeAgentSlug('---')).toBe('assistant');
    expect(sanitizeAgentSlug('ok')).toBe('ok');
  });

  it('runSetup drives the setup command object with an injected prompter and writer', async () => {
    const home = createTemporaryHome();
    const lines: string[] = [];
    const program = new Command();
    createSetupCommand({
      homeDirectory: home,
      prompter: scriptedPrompter({ harness: 'pi', name: 'starter' }),
      writeLine: (message) => lines.push(message),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'setup']);

    expect(existsSync(join(home, '.agents', 'agents', 'starter', 'agent.md'))).toBe(true);
    expect(lines.join('\n')).toContain("Default agent 'starter'");
  });

  it('runSetup returns the setup result directly', async () => {
    const home = createTemporaryHome();
    const result = await runSetup({ homeDirectory: home, prompter: scriptedPrompter({ name: 'direct' }) });
    expect(result.defaultAgent).toBe('direct');
  });
});
