// Tests pi/claude extension projection: --extension args and extension unsupported-set handling.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-project-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const planWith = (extensions: readonly string[]): CompositionPlan => ({
  agent: 'agent',
  identity: { agentBody: 'Body.' },
  loadout: { skills: [], subagents: [], mcp: [], extensions: [...extensions], plugins: [] },
  warnings: [],
});

describe('projectComposition extensions', () => {
  it('loads pi extension dirs with --extension and drops extensions from unsupported', () => {
    const dir = root();
    const projection = projectComposition(planWith(['git:github.com/o/r']), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: ['/cache/git/github.com/o/r'],
    });
    const args = projection.launch.args;
    expect(args[args.indexOf('/cache/git/github.com/o/r') - 1]).toBe('--extension');
    expect(projection.unsupported).not.toContain('extensions');
  });

  it('reports extensions unsupported for pi when no load dirs are provided (adds no --extension)', () => {
    const dir = root();
    const projection = projectComposition(planWith(['git:github.com/o/r']), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
    });
    expect(projection.launch.args).not.toContain('--extension');
    expect(projection.unsupported).toContain('extensions');
  });

  it('never adds --extension for claude and keeps extensions unsupported', () => {
    const dir = root();
    const projection = projectComposition(planWith(['git:github.com/o/r']), {
      harness: 'claude',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: ['/cache/git/github.com/o/r'],
    });
    expect(projection.launch.args).not.toContain('--extension');
    expect(projection.unsupported).toContain('extensions');
  });
});
