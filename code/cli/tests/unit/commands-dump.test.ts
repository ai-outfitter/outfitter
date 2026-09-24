// Tests that `outfitter dump` carries the composed closure's commands into the dumped tree.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { dumpAgent } from '../../src/dump/Dump.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-cmddump-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const agent = (name: string, loadout: string): string => `---\nname: ${name}\n${loadout}\n---\n\nBody.\n`;

const resolveSet = (home: string, project: string) =>
  resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers);

describe('dump commands closure', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.36).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes selected commands into the dumped tree so it validates on its own', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const out = join(root, 'out');
    write(join(project, '.agents', 'commands', 'review-pr.md'), 'review steps');
    write(join(project, '.agents', 'commands', 'deploy', 'staging.md'), 'staging steps');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      agent('engineer', 'commands: [review-pr, deploy/staging.md]'),
    );

    const set = resolveSet(home, project);
    const result = dumpAgent(set, 'engineer', out);

    expect(result.errors).toEqual([]);
    expect(readFileSync(join(out, '.agents', 'commands', 'review-pr.md'), 'utf8')).toBe('review steps');
    expect(readFileSync(join(out, '.agents', 'commands', 'deploy', 'staging.md'), 'utf8')).toBe('staging steps');
    expect(validateEffectiveSet(resolveSet(home, out)).some((f) => f.severity === 'error')).toBe(false);
  });

  it('carries delegate-declared commands through the closure', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const out = join(root, 'out');
    write(join(project, '.agents', 'commands', 'shared.md'), 'shared');
    write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), agent('reviewer', 'commands: [shared]'));
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer', 'subagents: [reviewer]'));

    const result = dumpAgent(resolveSet(home, project), 'engineer', out);

    expect(result.errors).toEqual([]);
    expect(existsSync(join(out, '.agents', 'commands', 'shared.md'))).toBe(true);
  });

  it('fails the dump when the closure resolves conflicting definitions for one command slug', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const out = join(root, 'out');
    write(join(project, '.agents', 'commands', 'shared.md'), 'catalog');
    write(join(project, '.agents', 'agents', 'reviewer', 'commands', 'shared.md'), 'local');
    write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), agent('reviewer', 'commands: [shared]'));
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      agent('engineer', 'commands: [shared]\nsubagents: [reviewer]'),
    );

    const result = dumpAgent(resolveSet(home, project), 'engineer', out);

    expect(result.writtenPaths).toEqual([]);
    expect(result.errors).toEqual([
      "dump closure resolves conflicting definitions for command 'shared.md' and cannot flatten both.",
    ]);
  });
});
