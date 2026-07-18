// Tests the .agents resolver: layer ordering, merge-by-ID shadowing, agent/skill parsing, validation.
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { encodeRemoteSource } from '../../src/sources/SourceCache.js';
import {
  isAgentDefinitionIssue,
  parseAgentDefinition,
  readAgentDefinition,
} from '../../src/resolver/AgentDefinition.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { compareSlugs, findResource, listResources } from '../../src/resolver/Resource.js';
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

const setFor = (home: string, project: string, sources: { path: string }[] = []) =>
  resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: { sources } }));

const expectIssueContaining = (result: ReturnType<typeof parseAgentDefinition>, substring: string): void => {
  expect(isAgentDefinitionIssue(result)).toBe(true);
  if (isAgentDefinitionIssue(result)) {
    expect(result.message).toContain(substring);
  }
};

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
        'skills: [wiki, research]\nsubagents: [code-reviewer]\nmodel: gpt-5.2\ntools:\n  allow: [read]\n',
      ),
      [],
      '/nowhere/agent.md',
    );

    expect(isAgentDefinitionIssue(parsed)).toBe(false);
    if (isAgentDefinitionIssue(parsed)) return;
    expect(parsed.name).toBe('engineer');
    expect(parsed.loadout.skills).toEqual(['wiki', 'research']);
    expect(parsed.loadout.tools).toEqual({ allow: ['read'], deny: [] });
    expect(parsed.body).toContain('# engineer');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges config.json loadout over frontmatter by key, restricted to loadout fields', () => {
    const root = createTemporaryRoot();
    const agentDir = join(root, 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer', 'skills: [wiki]\nmodel: gpt-5.2\n'));
    // config.json attempts to also override identity `name`, which must be ignored.
    write(join(agentDir, 'config.json'), JSON.stringify({ model: 'gpt-5.3-mini', name: 'evil' }));

    const parsed = readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]);

    expect(isAgentDefinitionIssue(parsed)).toBe(false);
    if (isAgentDefinitionIssue(parsed)) return;
    expect(parsed.name).toBe('engineer'); // identity stays from frontmatter
    expect(parsed.loadout.skills).toEqual(['wiki']);
    expect(parsed.loadout.model).toBe('gpt-5.3-mini');
  });

  it('validates frontmatter independently so config cannot supply required identity', () => {
    const root = createTemporaryRoot();
    const agentDir = join(root, 'agents', 'x');
    write(join(agentDir, 'agent.md'), '---\ndescription: no name\n---\n\nBody.\n');
    write(join(agentDir, 'config.json'), JSON.stringify({ skills: ['wiki'] }));
    expectIssueContaining(readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]), 'invalid');
  });

  it('reports malformed and non-object config.json as issues', () => {
    const root = createTemporaryRoot();
    const agentDir = join(root, 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    write(join(agentDir, 'bad.json'), '{ not json');
    write(join(agentDir, 'array.json'), '[1,2]');
    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'bad.json')]),
      'not readable JSON',
    );
    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'array.json')]),
      'must be a JSON object',
    );
  });

  it('reports missing frontmatter, unclosed frontmatter, invalid YAML, non-mapping, and read errors', () => {
    expectIssueContaining(parseAgentDefinition('no frontmatter', [], '/x/agent.md'), 'frontmatter block');
    expectIssueContaining(parseAgentDefinition('---\nname: x\n', [], '/x/agent.md'), 'frontmatter block'); // no closing ---
    expectIssueContaining(parseAgentDefinition('---\n: bad: yaml:\n---\n', [], '/x/agent.md'), 'not valid YAML');
    expectIssueContaining(parseAgentDefinition('---\n- 1\n---\n', [], '/x/agent.md'), 'YAML mapping');
    expectIssueContaining(readAgentDefinition('/missing/agent.md'), 'Could not read');
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

  it('caches remote sources under cache_directory (default ~/.agents/cache)', () => {
    const root = createTemporaryRoot();
    const cache = join(root, 'cache');
    // Materialize a fake synced remote payload under the configured cache dir, using the real encoder.
    const encoded = encodeRemoteSource({ github: 'example/.agent', ref: 'main' });
    write(join(cache, 'repos', encoded, 'agents', 'remote-agent', 'agent.md'), agentMd('remote-agent'));

    const layers = discoverLayers({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      settings: { cacheDirectory: cache, sources: [{ github: 'example/.agent', ref: 'main' }] },
    });

    expect(layers.some((layer) => layer.origin === 'source')).toBe(true);
    const set = resolveResources(layers);
    expect(findResource(set, 'agent', 'remote-agent')).toBeDefined();
  });
});

describe('resource resolution', () => {
  const buildTree = (): { home: string; project: string } => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
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
    const set = setFor(home, project);
    const engineer = findResource(set, 'agent', 'engineer');
    expect(engineer?.winner.layer.origin).toBe('workspace');
    expect(engineer?.shadowed[0]?.layer.origin).toBe('global');
    expect(listResources(set, 'skill').map((r) => r.slug)).toEqual(['wiki']);
    expect(listResources(set, 'knowledge').map((r) => r.slug)).toEqual(['arch/overview.md']);
    expect(listResources(set, 'command').map((r) => r.slug)).toEqual(['ship.md']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges a workspace config.json over a globally defined agent by ID', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(home, '.agents', 'agents', 'engineer', 'agent.md'), agentMd('engineer', 'model: gpt-5.2\n'));
    // Workspace supplies only a config.json override — no agent.md.
    write(join(project, '.agents', 'agents', 'engineer', 'config.json'), JSON.stringify({ model: 'gpt-5.3' }));

    const set = setFor(home, project);
    const engineer = findResource(set, 'agent', 'engineer')!;
    expect(engineer.winner.layer.origin).toBe('global');
    const definition = readAgentDefinition(engineer.winner.path, engineer.configPaths);
    expect(isAgentDefinitionIssue(definition)).toBe(false);
    if (isAgentDefinitionIssue(definition)) return;
    expect(definition.loadout.model).toBe('gpt-5.3');
  });

  it('discovers agents behind directory symlinks and skips broken links', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const realAgent = join(root, 'real', 'linked');
    write(join(realAgent, 'agent.md'), agentMd('linked'));
    mkdirSync(join(project, '.agents', 'agents'), { recursive: true });
    symlinkSync(realAgent, join(project, '.agents', 'agents', 'linked'));
    // Broken links (dangling dir + dangling file) must be skipped, not crash discovery.
    symlinkSync(join(root, 'nonexistent-dir'), join(project, '.agents', 'agents', 'dangling'));
    mkdirSync(join(project, '.agents', 'commands'), { recursive: true });
    symlinkSync(join(root, 'nonexistent-file'), join(project, '.agents', 'commands', 'dangling.md'));

    const set = setFor(join(root, 'home'), project);
    expect(findResource(set, 'agent', 'linked')).toBeDefined();
    expect(findResource(set, 'agent', 'dangling')).toBeUndefined();
    expect(listResources(set, 'command').map((r) => r.slug)).toEqual([]);
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
    expect(executeValidateCommand({ homeDirectory: home, projectDirectory: project, strict: true }).ok).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.2, OFTR-003.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('flags unknown loadout slugs, agent and skill name mismatches as errors', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agentMd('engineer', 'skills: [missing]\n'));
    write(join(project, '.agents', 'agents', 'mislabeled', 'agent.md'), agentMd('other'));
    write(join(project, '.agents', 'skills', 'wrong', 'SKILL.md'), '---\nname: notwrong\n---\n');

    const findings = validateEffectiveSet(setFor(join(root, 'home'), project));
    const hasFinding = (resource: string, substring: string): boolean =>
      findings.some((finding) => finding.resource === resource && finding.message.includes(substring));

    expect(hasFinding('agent:engineer', "unknown skill 'missing'")).toBe(true);
    expect(hasFinding('agent:mislabeled', 'must match its directory')).toBe(true);
    expect(hasFinding('skill:wrong', 'must match its directory')).toBe(true);
  });

  it('reports a malformed SKILL.md or agent.md as a validation error', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'broken', 'SKILL.md'), 'no frontmatter at all');
    write(join(project, '.agents', 'agents', 'broken', 'agent.md'), 'no frontmatter at all');

    const findings = validateEffectiveSet(setFor(join(root, 'home'), project));
    expect(findings.some((f) => f.resource === 'skill:broken' && f.severity === 'error')).toBe(true);
    expect(findings.some((f) => f.resource === 'agent:broken' && f.severity === 'error')).toBe(true);
  });

  it('rejects an unknown list kind and lists all kinds by default', () => {
    const { home, project } = buildTree();
    expect(() => executeListCommand({ homeDirectory: home, projectDirectory: project, kind: 'widgets' })).toThrow(
      /Unknown resource kind/,
    );
    const all = executeListCommand({ homeDirectory: home, projectDirectory: project });
    expect(all.messages).toEqual(expect.arrayContaining(['agents:', 'skills:', 'knowledge:', 'commands:']));
  });

  it('compares slugs deterministically by code unit', () => {
    expect(compareSlugs('a', 'b')).toBe(-1);
    expect(compareSlugs('b', 'a')).toBe(1);
    expect(compareSlugs('a', 'a')).toBe(0);
  });
});
