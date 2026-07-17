// Tests the .agents resolver: layer ordering, merge-by-ID shadowing, agent parsing, and validation.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseAgentDefinition,
  readAgentDefinition,
  isAgentDefinitionIssue,
} from '../../src/resolver/AgentDefinition.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { findResource, listResources } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';
import { executeListCommand } from '../../src/cli/commands/ListCommand.js';
import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-resolver-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agentMd = (name: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: The ${name} agent.\n${extra}---\n\n# ${name}\n\nBody for ${name}.\n`;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('agent definition parsing', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.1, OFTR-003.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses frontmatter loadout and markdown body', () => {
    const parsed = parseAgentDefinition(
      agentMd(
        'engineer',
        'skills: [wiki, research]\nsubagents: [code-reviewer]\nmodel: gpt-5.2\nthinking: high\ntools:\n  allow: [read, edit]\n',
      ),
      '/nowhere',
      '/nowhere/agent.md',
    );

    expect(isAgentDefinitionIssue(parsed)).toBe(false);
    if (isAgentDefinitionIssue(parsed)) return;
    expect(parsed.name).toBe('engineer');
    expect(parsed.loadout.skills).toEqual(['wiki', 'research']);
    expect(parsed.loadout.subagents).toEqual(['code-reviewer']);
    expect(parsed.loadout.model).toBe('gpt-5.2');
    expect(parsed.loadout.tools).toEqual({ allow: ['read', 'edit'], deny: [] });
    expect(parsed.body).toContain('# engineer');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges config.json loadout over frontmatter by key', () => {
    const root = createTemporaryRoot();
    const agentDir = join(root, 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer', 'skills: [wiki]\nmodel: gpt-5.2\n'));
    write(join(agentDir, 'config.json'), JSON.stringify({ model: 'gpt-5.3-mini' }));

    const parsed = readAgentDefinition(agentDir, join(agentDir, 'agent.md'));

    expect(isAgentDefinitionIssue(parsed)).toBe(false);
    if (isAgentDefinitionIssue(parsed)) return;
    expect(parsed.loadout.skills).toEqual(['wiki']);
    expect(parsed.loadout.model).toBe('gpt-5.3-mini');
  });

  it('reports missing frontmatter, invalid YAML, non-mapping, schema, and read errors', () => {
    expect(parseAgentDefinition('no frontmatter', '/x', '/x/agent.md')).toMatchObject({
      message: expect.stringContaining('frontmatter block'),
    });
    expect(parseAgentDefinition('---\n: bad: yaml:\n---\n', '/x', '/x/agent.md')).toMatchObject({
      message: expect.stringContaining('not valid YAML'),
    });
    expect(parseAgentDefinition('---\n- 1\n- 2\n---\n', '/x', '/x/agent.md')).toMatchObject({
      message: expect.stringContaining('YAML mapping'),
    });
    expect(parseAgentDefinition('---\ndescription: no name\n---\n', '/x', '/x/agent.md')).toMatchObject({
      message: expect.stringContaining('invalid'),
    });
    expect(readAgentDefinition('/missing', '/missing/agent.md')).toMatchObject({
      message: expect.stringContaining('Could not read'),
    });
  });
});

describe('layer discovery', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('orders workspace over global over sources and drops missing roots', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const shared = join(root, 'shared');
    write(join(home, '.agents', 'agents', 'a', 'agent.md'), agentMd('a'));
    write(join(project, '.agents', 'agents', 'b', 'agent.md'), agentMd('b'));
    write(join(shared, 'agents', 'c', 'agent.md'), agentMd('c'));

    const layers = discoverLayers({
      homeDirectory: home,
      projectDirectory: project,
      settings: { sources: [{ path: shared }, { path: join(root, 'absent') }] },
    });

    expect(layers.map((layer) => layer.origin)).toEqual(['workspace', 'global', 'source']);
  });
});

describe('resource resolution', () => {
  const buildTree = (): { home: string; project: string } => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    // global defines engineer + a skill; workspace shadows engineer and adds knowledge/commands.
    write(join(home, '.agents', 'agents', 'engineer', 'agent.md'), agentMd('engineer', 'skills: [wiki]\n'));
    write(join(home, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agentMd('engineer', 'skills: [wiki]\n'));
    write(join(project, '.agents', 'knowledge', 'arch', 'overview.md'), '# overview\n');
    write(join(project, '.agents', 'commands', 'ship.md'), '# ship\n');
    return { home, project };
  };

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.4, OFTR-003.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('builds the effective set with merge-by-ID shadowing', () => {
    const { home, project } = buildTree();
    const layers = discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} });
    const set = resolveResources(layers);

    const engineer = findResource(set, 'agent', 'engineer');
    expect(engineer?.winner.layer.origin).toBe('workspace');
    expect(engineer?.shadowed).toHaveLength(1);
    expect(engineer?.shadowed[0]?.layer.origin).toBe('global');
    expect(listResources(set, 'skill').map((r) => r.slug)).toEqual(['wiki']);
    expect(listResources(set, 'knowledge').map((r) => r.slug)).toEqual(['arch/overview.md']);
    expect(listResources(set, 'command').map((r) => r.slug)).toEqual(['ship.md']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.7, OFTR-003.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('lists resources by kind and reports shadow warnings during validation', () => {
    const { home, project } = buildTree();
    const listed = executeListCommand({ homeDirectory: home, projectDirectory: project, kind: 'agents' });
    expect(listed.messages.join('\n')).toContain('engineer  [workspace]');

    const validation = executeValidateCommand({ homeDirectory: home, projectDirectory: project });
    expect(validation.ok).toBe(true);
    expect(validation.findings.some((f) => f.severity === 'warning' && f.resource === 'agent:engineer')).toBe(true);

    const strict = executeValidateCommand({ homeDirectory: home, projectDirectory: project, strict: true });
    expect(strict.ok).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.2, OFTR-003.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('flags unknown loadout slugs and name mismatches as errors', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agentMd('engineer', 'skills: [missing]\n'));
    write(join(project, '.agents', 'agents', 'mislabeled', 'agent.md'), agentMd('other'));

    const set = resolveResources(
      discoverLayers({ homeDirectory: join(root, 'home'), projectDirectory: project, settings: {} }),
    );
    const findings = validateEffectiveSet(set);

    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        resource: 'agent:engineer',
        message: expect.stringContaining("unknown skill 'missing'"),
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        resource: 'agent:mislabeled',
        message: expect.stringContaining('must match its directory'),
      }),
    );
  });

  it('rejects an unknown list kind and lists all kinds by default', () => {
    const { home, project } = buildTree();
    expect(() => executeListCommand({ homeDirectory: home, projectDirectory: project, kind: 'widgets' })).toThrow(
      /Unknown resource kind/,
    );
    const all = executeListCommand({ homeDirectory: home, projectDirectory: project });
    expect(all.messages).toContain('agents:');
    expect(all.messages).toContain('skills:');
    expect(all.messages).toContain('knowledge:');
    expect(all.messages).toContain('commands:');
  });
});
