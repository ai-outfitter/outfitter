// Tests composition of a harness-neutral CompositionPlan from the effective resource set.
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compose } from '../../src/composer/Composer.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-composer-'));
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

const resolveSet = (home: string, project: string) =>
  resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers);

describe('composer', () => {
  const buildTree = (): { home: string; project: string } => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(home, '.agents', 'system-prompt.md'), 'BASE PROMPT');
    write(join(project, '.agents', 'agents.md'), 'SHARED CONTEXT');
    write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n');
    write(
      join(project, '.agents', 'mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'github-mcp-server' } } }),
    );
    write(
      join(project, '.agents', 'agents', 'code-reviewer', 'agent.md'),
      '---\nname: code-reviewer\nskills: [review-only]\n---\n\nReview.\n',
    );
    write(
      join(project, '.agents', 'agents', 'code-reviewer', 'skills', 'review-only', 'SKILL.md'),
      '---\nname: review-only\n---\n',
    );
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\ndescription: Ships changes.\nskills: [wiki]\nsubagents: [code-reviewer]\nmodel: gpt-5.2\nthinking: high\nmcp: [github]\n---\n\n# Engineer\n\nImplement.\n',
    );
    return { home, project };
  };

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.2, OFTR-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes identity and resolved loadout for a selected agent', () => {
    const { home, project } = buildTree();
    const result = compose(resolveSet(home, project), 'engineer');

    expect(result.errors).toEqual([]);
    const plan = result.plan!;
    expect(plan.identity.systemPrompt).toBe('BASE PROMPT');
    expect(plan.identity.sharedContext).toBe('SHARED CONTEXT');
    expect(plan.identity.agentBody).toContain('# Engineer');
    expect(plan.identity.description).toBe('Ships changes.');
    expect(plan.loadout.skills.map((s) => s.slug)).toEqual(['wiki']);
    expect(plan.loadout.delegateSkills.map((s) => s.slug)).toEqual(['review-only']);
    expect(plan.loadout.delegateSkills[0]?.winner.ownerAgent).toBe('code-reviewer');
    expect(plan.loadout.subagents.map((s) => s.slug)).toEqual(['code-reviewer']);
    expect(plan.loadout.mcp).toEqual(['github']);
    expect(plan.loadout.mcpServers).toEqual({ github: { command: 'github-mcp-server' } });
    expect(plan.loadout.model).toBe('gpt-5.2');
    expect(plan.loadout.thinking).toBe('high');
    expect(plan.warnings).toEqual([]);
  });

  it('composes the selected profile display label', () => {
    const { home, project } = buildTree();
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nlabel: Engineering Lead\n---\n\n# Engineer\n',
    );

    expect(compose(resolveSet(home, project), 'engineer').plan?.identity.label).toBe('Engineering Lead');
  });

  it('merges layered and agent-local MCP servers by id, then keeps only selected servers', () => {
    const { home, project } = buildTree();
    write(
      join(home, '.agents', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: { command: 'home-github' },
          unused: { command: 'home-unused' },
        },
      }),
    );
    write(
      join(project, '.agents', 'mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'project-github' } } }),
    );
    write(
      join(project, '.agents', 'agents', 'engineer', 'mcp.json'),
      JSON.stringify({ mcpServers: { github: { command: 'agent-github' } } }),
    );

    const result = compose(resolveSet(home, project), 'engineer');

    expect(result.plan?.loadout.mcpServers).toEqual({ github: { command: 'agent-github' } });
    expect(result.plan?.warnings).toEqual([]);
  });

  it('warns when selected MCP configuration is invalid or does not contain the selected server', () => {
    const { home, project } = buildTree();
    write(join(home, '.agents', 'mcp.json'), 'not json');
    write(join(project, '.agents', 'mcp.json'), JSON.stringify({ mcpServers: [] }));
    write(join(project, '.agents', 'agents', 'engineer', 'mcp.json'), JSON.stringify([]));

    const result = compose(resolveSet(home, project), 'engineer');

    expect(result.plan?.loadout.mcpServers).toEqual({});
    expect(result.plan?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('not readable JSON'),
        expect.stringContaining("object-valued 'mcpServers'"),
        expect.stringContaining("unknown server 'github'"),
      ]),
    );
  });

  it('does not read selected MCP configuration through a symlink that escapes its layer', () => {
    const { home, project } = buildTree();
    const external = join(createTemporaryRoot(), 'outside-mcp.json');
    write(external, JSON.stringify({ mcpServers: { github: { command: 'outside' } } }));
    rmSync(join(project, '.agents', 'mcp.json'));
    symlinkSync(external, join(project, '.agents', 'mcp.json'));

    const result = compose(resolveSet(home, project), 'engineer');

    expect(result.plan?.loadout.mcpServers).toEqual({});
    expect(result.plan?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('resolves outside the resource layers'),
        expect.stringContaining("unknown server 'github'"),
      ]),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes an agent-local skill before a catalog-wide skill of the same slug', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'debug', 'SKILL.md'), '---\nname: debug\n---\n\nglobal\n');
    write(
      join(project, '.agents', 'agents', 'actions', 'agent.md'),
      '---\nname: actions\nskills: [debug]\n---\n\nActions.\n',
    );
    write(
      join(project, '.agents', 'agents', 'actions', 'skills', 'debug', 'SKILL.md'),
      '---\nname: debug\n---\n\nlocal\n',
    );

    const result = compose(resolveSet(join(root, 'home'), project), 'actions');

    expect(result.plan?.loadout.skills[0]?.winner.ownerAgent).toBe('actions');
    expect(result.plan?.warnings).toEqual([]);
  });

  it('is deterministic — identical inputs compose to an identical plan', () => {
    const { home, project } = buildTree();
    expect(compose(resolveSet(home, project), 'engineer').plan).toEqual(
      compose(resolveSet(home, project), 'engineer').plan,
    );
  });

  it('errors for an unknown agent slug', () => {
    const { home, project } = buildTree();
    const result = compose(resolveSet(home, project), 'missing');
    expect(result.plan).toBeUndefined();
    expect(result.errors[0]).toContain("Unknown agent 'missing'");
  });

  it('errors when the selected agent definition is invalid', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'broken', 'agent.md'), 'no frontmatter here');
    const result = compose(resolveSet(join(root, 'home'), project), 'broken');
    expect(result.errors[0]).toContain('is invalid');
  });

  it('errors when the selected agent name does not match its directory', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'mislabeled', 'agent.md'), '---\nname: other\n---\n\nBody.\n');
    const result = compose(resolveSet(join(root, 'home'), project), 'mislabeled');
    expect(result.plan).toBeUndefined();
    expect(result.errors[0]).toContain('must match its directory');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns but does not fail when a loadout slug does not resolve', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nskills: [ghost]\n---\n\nBody.\n',
    );
    const result = compose(resolveSet(join(root, 'home'), project), 'engineer');
    expect(result.errors).toEqual([]);
    expect(result.plan!.warnings).toContain("loadout skills references unknown skill 'ghost'.");
  });

  it('warns when a delegate-only skill does not resolve', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nsubagents: [reviewer]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'reviewer', 'agent.md'),
      '---\nname: reviewer\nskills: [ghost]\n---\n\nReview.\n',
    );

    const result = compose(resolveSet(join(root, 'home'), project), 'engineer');

    expect(result.plan?.loadout.delegateSkills).toEqual([]);
    expect(result.plan?.warnings).toContain("subagent 'reviewer' loadout skills references unknown skill 'ghost'.");
  });

  it('keeps the first materializable definition when delegate skill slugs conflict', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nsubagents: [alpha, beta]\n---\n\nBody.\n',
    );

    for (const delegate of ['alpha', 'beta']) {
      write(
        join(project, '.agents', 'agents', delegate, 'agent.md'),
        `---\nname: ${delegate}\nskills: [review]\n---\n\nReview.\n`,
      );
      write(
        join(project, '.agents', 'agents', delegate, 'skills', 'review', 'SKILL.md'),
        `---\nname: review\n---\n\n${delegate}\n`,
      );
    }

    const result = compose(resolveSet(join(root, 'home'), project), 'engineer');

    expect(result.plan?.loadout.delegateSkills).toHaveLength(1);
    expect(result.plan?.loadout.delegateSkills[0]?.winner.ownerAgent).toBe('alpha');
    expect(result.plan?.warnings).toEqual([expect.stringContaining("delegate skill 'review' resolves")]);
  });

  it('does not resolve skills from invalid or mislabeled delegates', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nsubagents: [broken, mislabeled]\n---\n\nBody.\n',
    );
    write(join(project, '.agents', 'agents', 'broken', 'agent.md'), 'missing frontmatter');
    write(
      join(project, '.agents', 'agents', 'mislabeled', 'agent.md'),
      '---\nname: other\nskills: [ghost]\n---\n\nReview.\n',
    );

    const result = compose(resolveSet(join(root, 'home'), project), 'engineer');

    expect(result.errors).toEqual([]);
    expect(result.plan?.loadout.delegateSkills).toEqual([]);
    expect(result.plan?.warnings).toEqual([]);
  });

  it('does not read delegate definitions through an escaping symlink', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const external = join(createTemporaryRoot(), 'outside-agent.md');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nsubagents: [reviewer]\n---\n\nBody.\n',
    );
    write(external, '---\nname: reviewer\nskills: [ghost]\n---\n\nOutside.\n');
    mkdirSync(join(project, '.agents', 'agents', 'reviewer'), { recursive: true });
    symlinkSync(external, join(project, '.agents', 'agents', 'reviewer', 'agent.md'));

    const result = compose(resolveSet(join(root, 'home'), project), 'engineer');

    expect(result.errors).toEqual([]);
    expect(result.plan?.loadout.delegateSkills).toEqual([]);
    expect(result.plan?.warnings).toEqual([]);
  });
});
