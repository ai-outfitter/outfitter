// Covers invocation-only `.agents` layers across resolver precedence and harness projection.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createRunAgentCommand, executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { findResource } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';

const roots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-runtime-layer-'));
  roots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agent = (name: string, extra = ''): string => `---\nname: ${name}\n${extra}---\n\n# ${name}\n`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runtime layer resolution', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('orders invocation-only runtime layers above workspace in command-line order', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const first = join(root, 'first');
    const second = join(root, 'second');
    write(join(first, 'agents', 'shared', 'agent.md'), agent('shared', 'model: first\n'));
    write(join(second, 'agents', 'shared', 'agent.md'), agent('shared', 'model: second\n'));
    write(join(project, '.agents', 'agents', 'shared', 'agent.md'), agent('shared', 'model: workspace\n'));

    const discovered = discoverLayers({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      runtimeLayers: [first, second],
      settings: {},
    });
    const resolved = findResource(resolveResources(discovered.layers), 'agent', 'shared')!;

    expect(discovered.layers.map((layer) => layer.origin)).toEqual(['runtime', 'runtime', 'workspace']);
    expect(resolved.winner.layer.root).toBe(first);
    expect(resolved.shadowed.map((definition) => definition.layer.root)).toEqual([second, join(project, '.agents')]);
  });

  it('resolves relative roots from the project and rejects missing or non-directory roots', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    write(join(project, 'generated', 'agents', 'x', 'agent.md'), agent('x'));
    write(join(project, 'not-a-layer'), 'file');
    const input = { homeDirectory: join(root, 'home'), projectDirectory: project, settings: {} };

    expect(discoverLayers({ ...input, runtimeLayers: ['generated'] }).layers[0].root).toBe(join(project, 'generated'));
    expect(() => discoverLayers({ ...input, runtimeLayers: ['missing'] })).toThrow(/does not exist/);
    expect(() => discoverLayers({ ...input, runtimeLayers: ['not-a-layer'] })).toThrow(/not a directory/);
  });

  it('validates runtime-layer resources through the shared schema boundary', () => {
    const root = temporaryRoot();
    const runtime = join(root, 'runtime');
    write(join(runtime, 'agents', 'invalid', 'agent.md'), '---\ndescription: missing name\n---\n\nBody.\n');

    const result = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      runtimeLayers: [runtime],
    });

    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.resource.includes('invalid'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8, OFTR-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects the winning runtime resource through both harness adapters without persisting it', async () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const first = join(root, 'first');
    const second = join(root, 'second');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer', 'skills: [wiki]\n'));
    write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWorkspace.\n');
    write(join(first, 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nFirst runtime.\n');
    write(join(second, 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nSecond runtime.\n');

    for (const harness of ['pi', 'claude'] as const) {
      const launches: AgentLaunchPlan[] = [];
      const result = await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        runtimeLayers: [first, second],
        agent: 'engineer',
        harness,
        passThroughArgs: ['--runtime-argument'],
        launcher: (plan) => {
          launches.push(plan);
          const runtime = plan.env.PI_CODING_AGENT_DIR ?? plan.env.CLAUDE_CONFIG_DIR ?? '';
          expect(readFileSync(join(runtime, 'skills', 'wiki', 'SKILL.md'), 'utf8')).toContain('First runtime');
          return Promise.resolve(0);
        },
      });

      expect(result.exitCode).toBe(0);
      expect(launches[0].args).toContain('--runtime-argument');
    }

    expect(existsSync(join(project, '.agents', 'settings.yml'))).toBe(false);
    expect(readFileSync(join(first, 'skills', 'wiki', 'SKILL.md'), 'utf8')).toContain('First runtime');
  });

  it('accepts a runtime layer through the run command parser', async () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const runtime = join(root, 'runtime');
    write(join(runtime, 'agents', 'engineer', 'agent.md'), agent('engineer'));
    const program = new Command();
    let launched = false;
    createRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      launcher: () => {
        launched = true;
        return Promise.resolve(0);
      },
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'run', 'engineer', '--runtime-layer', runtime]);
    expect(launched).toBe(true);
  });
});
