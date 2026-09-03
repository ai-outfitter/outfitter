import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'outfitter-harness-defaults-'));
  roots.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const plan: CompositionPlan = {
  agent: 'agent',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
  },
  warnings: [],
};

describe('native harness defaults projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.11.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('applies Pi harness defaults beneath a native profile settings overlay', () => {
    const directory = root();
    const overlay = root();
    writeFileSync(join(overlay, 'settings.json'), '{"httpIdleTimeoutMs":120000,"theme":"light"}');

    projectComposition(plan, {
      harness: 'pi',
      rootDirectory: directory,
      homeDirectory: directory,
      harnessDefaults: { httpIdleTimeoutMs: 3600000, retry: { provider: { maxRetries: 2 } } },
      configurationOverlayDirectories: [overlay],
    });

    expect(JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8'))).toEqual({
      httpIdleTimeoutMs: 120000,
      retry: { provider: { maxRetries: 2 } },
      theme: 'light',
      quietStartup: true,
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.11.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns when Pi harness defaults cannot merge into malformed native settings', () => {
    const directory = root();
    const overlay = root();
    writeFileSync(join(overlay, 'settings.json'), 'not json');

    const projection = projectComposition(plan, {
      harness: 'pi',
      rootDirectory: directory,
      homeDirectory: directory,
      harnessDefaults: { httpIdleTimeoutMs: 3600000 },
      configurationOverlayDirectories: [overlay],
    });

    expect(readFileSync(join(directory, 'settings.json'), 'utf8')).toBe('not json');
    expect(projection.warnings).toContain(
      'pi harness defaults could not be merged because settings.json is not a JSON object.',
    );
  });
});
