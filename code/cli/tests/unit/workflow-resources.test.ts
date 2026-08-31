import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { listResources } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';

const roots: string[] = [];
const temporary = (): string => { const root = mkdtempSync(join(tmpdir(), 'outfitter-workflow-test-')); roots.push(root); return root; };
const write = (path: string, content: string): void => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const fixture = () => {
  const root = temporary();
  const home = join(root, 'home');
  const project = join(root, 'project');
  const catalog = join(project, '.agents');
  write(join(catalog, 'skills', 'review', 'SKILL.md'), '---\nname: review\n---\n');
  write(join(catalog, 'prompts', 'review.md'), 'Review carefully.\n');
  write(join(catalog, 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\nskills: [review]\nmcp: [github]\nappend_system_prompt:\n  - file: prompts/review.md\n---\n\n# Reviewer\n');
  write(join(catalog, 'agents', 'reviewer', 'mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'github-mcp-server' } } }));
  write(join(catalog, 'workflows', 'review', 'workflow.yaml'), `version: 1
id: review
title: Review
description: Review a change.
actors:
  reviewer: {kind: agent, profile: reviewer}
environments: {workstation: local}
integrations:
  github: {kind: mcp, server: github}
nodes:
  - id: inspect
    action: inspect
    description: Inspect the change.
    actor: reviewer
    environment: workstation
    skill: review
    prompt_fragment: prompts/review.md
    uses: [github]
`);
  write(join(catalog, 'workflows', 'delivery', 'workflow.yaml'), `version: 1
id: delivery
title: Delivery
description: Deliver with review.
actors: {}
nodes:
  - id: review
    workflow: review
    description: Run review.
`);
  return { root, home, project, catalog };
};

describe('workflow resources', () => {
  it('discovers and strictly validates typed composed dependencies', () => {
    const { home, project } = fixture();
    const set = resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: { sources: [] } }).layers);
    expect(listResources(set, 'workflow').map((workflow) => workflow.slug)).toEqual(['delivery', 'review']);
    expect(validateEffectiveSet(set, project)).toEqual([]);
  });

  it('rejects skills, prompts, and MCP servers outside the selected agent closure', () => {
    const { home, project, catalog } = fixture();
    const path = join(catalog, 'workflows', 'review', 'workflow.yaml');
    write(path, readFileSync(path, 'utf8').replace('skill: review', 'skill: missing').replace('server: github', 'server: missing').replace('prompts/review.md', 'prompts/missing.md'));
    const set = resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: { sources: [] } }).layers);
    const messages = validateEffectiveSet(set, project).map((finding) => finding.message);
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining("skill 'missing' outside"),
      expect.stringContaining("prompt fragment 'prompts/missing.md' outside"),
      expect.stringContaining("MCP server 'missing' outside"),
    ]));
  });

  it('exports root and nested workflow YAML with the complete agent closure and manifest', () => {
    const { home, project, root } = fixture();
    const out = join(root, 'out');
    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, workflow: 'delivery', out });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(out, '.agents', 'workflows', 'delivery', 'workflow.yaml'), 'utf8')).toContain('id: delivery');
    expect(readFileSync(join(out, '.agents', 'workflows', 'review', 'workflow.yaml'), 'utf8')).toContain('id: review');
    expect(readFileSync(join(out, '.agents', 'agents', 'reviewer', 'agent.md'), 'utf8')).toContain('name: reviewer');
    expect(readFileSync(join(out, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8')).toContain('name: review');
    const manifest = JSON.parse(readFileSync(join(out, '.agents', '.outfitter', 'workflow-composition.json'), 'utf8')) as { root: string; workflows: string[] };
    expect(manifest).toMatchObject({ root: 'delivery', workflows: ['delivery', 'review'] });
  });

  it('refuses an existing destination instead of replacing it', () => {
    const { home, project, root } = fixture();
    const out = join(root, 'out');
    write(join(out, '.agents', 'user-owned.md'), 'keep\n');
    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, workflow: 'delivery', out });
    expect(result.ok).toBe(false);
    expect(result.messages.join('\n')).toContain('refuses existing destination');
    expect(readFileSync(join(out, '.agents', 'user-owned.md'), 'utf8')).toBe('keep\n');
  });
});
