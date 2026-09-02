import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { listResources } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';
import { isWorkflowDefinitionIssue, readWorkflowDefinition } from '../../src/resolver/WorkflowDefinition.js';

const roots: string[] = [];
const temporary = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-workflow-test-'));
  roots.push(root);
  return root;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixture = () => {
  const root = temporary();
  const home = join(root, 'home');
  const project = join(root, 'project');
  const catalog = join(project, '.agents');
  write(join(catalog, 'skills', 'review', 'SKILL.md'), '---\nname: review\n---\n');
  write(join(catalog, 'prompts', 'review.md'), 'Review carefully.\n');
  write(
    join(catalog, 'agents', 'reviewer', 'agent.md'),
    '---\nname: reviewer\nskills: [review]\nmcp: [github]\nappend_system_prompt:\n  - file: prompts/review.md\n---\n\n# Reviewer\n',
  );
  write(
    join(catalog, 'agents', 'reviewer', 'mcp.json'),
    JSON.stringify({ mcpServers: { github: { command: 'github-mcp-server' } } }),
  );
  write(
    join(catalog, 'agents', 'reviewer-two', 'agent.md'),
    '---\nname: reviewer-two\nskills: [review]\nmcp: [github]\n---\n\n# Second reviewer\n',
  );
  write(
    join(catalog, 'agents', 'reviewer-two', 'mcp.json'),
    JSON.stringify({ mcpServers: { github: { command: 'github-mcp-server' } } }),
  );
  write(
    join(catalog, 'workflows', 'review', 'workflow.yaml'),
    `version: 1
id: review
title: Review
description: Review a change.
actors:
  reviewer: {kind: agent, profile: reviewer}
  second: {kind: agent, profile: reviewer-two}
  owner: {kind: human}
environments: {workstation: local}
integrations:
  github: {kind: mcp, server: github}
  source: {kind: artifact, repository: ai-outfitter/outfitter, ref: "1111111111111111111111111111111111111111", path: README.md, sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}
feedback:
  - {from: inspect, to: confirm}
nodes:
  - id: inspect
    action: inspect
    description: Inspect the change.
    actor: reviewer
    environment: workstation
    skill: review
    prompt_fragment: prompts/review.md
    uses: [github]
  - id: confirm
    action: confirm
    description: Confirm the result.
    actor: second
    environment: workstation
    needs: [inspect]
`,
  );
  write(
    join(catalog, 'workflows', 'delivery', 'workflow.yaml'),
    `version: 1
id: delivery
title: Delivery
description: Deliver with review.
actors: {}
nodes:
  - id: review
    workflow: review
    description: Run review.
`,
  );
  write(join(catalog, 'settings.yml'), 'workflows:\n  - delivery\n');
  return { root, home, project, catalog };
};

describe('workflow resources', () => {
  it('discovers and strictly validates typed composed dependencies', () => {
    const { home, project } = fixture();
    const set = resolveResources(
      discoverLayers({ homeDirectory: home, projectDirectory: project, settings: { sources: [] } }).layers,
    );
    expect(listResources(set, 'workflow').map((workflow) => workflow.slug)).toEqual(['delivery', 'review']);
    expect(validateEffectiveSet(set, project)).toEqual([]);
  });

  it('rejects skills, prompts, and MCP servers outside the selected agent closure', () => {
    const { home, project, catalog } = fixture();
    const path = join(catalog, 'workflows', 'review', 'workflow.yaml');
    write(
      path,
      readFileSync(path, 'utf8')
        .replace('skill: review', 'skill: missing')
        .replace('server: github', 'server: missing')
        .replace('prompts/review.md', 'prompts/missing.md'),
    );
    const set = resolveResources(
      discoverLayers({ homeDirectory: home, projectDirectory: project, settings: { sources: [] } }).layers,
    );
    const messages = validateEffectiveSet(set, project).map((finding) => finding.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("skill 'missing' outside"),
        expect.stringContaining("prompt fragment 'prompts/missing.md' outside"),
        expect.stringContaining("MCP server 'missing' outside"),
      ]),
    );
  });

  it('reports malformed definitions and every typed workflow reference boundary', () => {
    const { home, project, catalog } = fixture();
    write(join(catalog, 'workflows', 'bad-yaml', 'workflow.yaml'), 'version: [\n');
    write(
      join(catalog, 'workflows', 'wrong-id', 'workflow.yaml'),
      `version: 1
id: different
title: Wrong id
description: Exercise directory identity validation.
actors: {}
nodes:
  - {id: noop, action: inspect, description: Keep the definition schema-valid.}
`,
    );
    write(
      join(catalog, 'workflows', 'invalid', 'workflow.yaml'),
      `version: 1
id: invalid
title: Invalid references
description: Exercise every workflow reference boundary.
actors:
  missing: {kind: agent, profile: absent}
  human: {kind: human}
environments: {known: local}
integrations:
  missing-fields: {kind: artifact, ref: short, sha256: short}
  omitted-fields: {kind: artifact}
  github: {kind: mcp, server: github}
feedback:
  - {from: absent-source, to: absent-target}
nodes:
  - id: duplicate
    action: inspect
    description: First duplicate.
    actor: missing
    environment: absent
    needs: [absent-node]
    uses: [absent-integration]
  - id: duplicate
    action: inspect
    description: Second duplicate.
    actor: human
    environment: absent
    skill: missing
  - id: nested
    workflow: absent-workflow
    description: Unknown nested workflow.
`,
    );
    write(
      join(catalog, 'workflows', 'cycle', 'workflow.yaml'),
      `version: 1
id: cycle
title: Cycle
description: Exercise nested cycle validation.
actors: {}
nodes:
  - {id: again, workflow: cycle, description: Recurse.}
`,
    );

    const set = resolveResources(
      discoverLayers({ homeDirectory: home, projectDirectory: project, settings: { sources: [] } }).layers,
    );
    const messages = validateEffectiveSet(set, project).map((finding) => finding.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('not valid YAML'),
        expect.stringContaining("workflow id 'different'"),
        expect.stringContaining("actor 'missing' references unknown agent 'absent'"),
        expect.stringContaining("duplicate node id 'duplicate'"),
        expect.stringContaining("references unknown environment 'absent'"),
        expect.stringContaining("needs unknown node 'absent-node'"),
        expect.stringContaining("references unknown integration 'absent-integration'"),
        expect.stringContaining("references unknown workflow 'absent-workflow'"),
        expect.stringContaining("feedback references unknown source node 'absent-source'"),
        expect.stringContaining("feedback references unknown target node 'absent-target'"),
        expect.stringContaining("artifact integration 'missing-fields' must pin"),
        expect.stringContaining("artifact integration 'missing-fields' must declare a SHA-256"),
        expect.stringContaining("artifact integration 'missing-fields' must declare repository and path"),
        expect.stringContaining('nested workflow cycle'),
        expect.stringContaining("node 'duplicate' has agent-closure assertions but no agent actor"),
      ]),
    );
  });

  it('reports unknown and invalid workflows without creating an export', () => {
    const { home, project, catalog, root } = fixture();
    write(join(catalog, 'settings.yml'), 'workflows:\n  - absent\n');
    const unknown = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'absent',
      out: join(root, 'unknown'),
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.messages.join('\n')).toContain("references unknown workflow 'absent'");

    write(join(catalog, 'settings.yml'), 'workflows:\n  - broken\n');
    write(join(catalog, 'workflows', 'broken', 'workflow.yaml'), 'version: [\n');
    const broken = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'broken',
      out: join(root, 'broken'),
    });
    expect(broken.ok).toBe(false);
    expect(broken.messages.join('\n')).toContain("workflow 'broken': workflow.yaml is not valid YAML");

    write(join(catalog, 'settings.yml'), 'workflows:\n  - wrong-id\n');
    write(
      join(catalog, 'workflows', 'wrong-id', 'workflow.yaml'),
      `version: 1
id: different
title: Wrong id
description: Exercise directory identity validation during export.
actors: {}
nodes:
  - {id: noop, action: inspect, description: Keep the definition schema-valid.}
`,
    );
    const wrongId = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'wrong-id',
      out: join(root, 'wrong-id'),
    });
    expect(wrongId.ok).toBe(false);
    expect(wrongId.messages.join('\n')).toContain("workflow id 'different' must match its directory 'wrong-id'");
    const unreadable = readWorkflowDefinition(join(root, 'missing.yaml'));
    expect(isWorkflowDefinitionIssue(unreadable)).toBe(true);
    if (isWorkflowDefinitionIssue(unreadable)) expect(unreadable.message).toContain('not readable');

    expect(() =>
      executeDumpCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'reviewer',
        workflow: 'review',
        out: join(root, 'ambiguous'),
      }),
    ).toThrow('Choose either --agent or --workflow');

    write(join(catalog, 'settings.yml'), 'workflows:\n  - loop\n');
    write(
      join(catalog, 'workflows', 'loop', 'workflow.yaml'),
      `version: 1
id: loop
title: Loop
description: Exercise closure de-duplication.
actors: {}
nodes:
  - {id: again, workflow: loop, description: Recurse once.}
`,
    );
    const loop = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'loop',
      out: join(root, 'loop'),
    });
    expect(loop.ok).toBe(true);

    write(join(catalog, 'settings.yml'), 'workflows:\n  - missing-agent\n');
    write(
      join(catalog, 'workflows', 'missing-agent', 'workflow.yaml'),
      `version: 1
id: missing-agent
title: Missing agent
description: Exercise an agent dump failure.
actors:
  absent: {kind: agent, profile: absent}
nodes:
  - {id: run, action: inspect, actor: absent, description: Try the missing agent.}
`,
    );
    const missingAgent = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'missing-agent',
      out: join(root, 'missing-agent'),
    });
    expect(missingAgent.ok).toBe(false);
    expect(missingAgent.messages.join('\n')).toContain("Unknown agent 'absent'");
    expect(existsSync(join(root, 'missing-agent', '.agents'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects a resolvable disabled root while allowing its enabled parent to include it', () => {
    const { home, project, catalog, root } = fixture();
    write(
      join(home, '.agents', 'workflows', 'review', 'workflow.yaml'),
      readFileSync(join(catalog, 'workflows', 'review', 'workflow.yaml'), 'utf8'),
    );
    const nested = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'review',
      out: join(root, 'nested'),
      strict: true,
    });
    expect(nested.ok).toBe(false);
    expect(nested.messages.join('\n')).toContain("Workflow 'review' is not enabled");

    const parent = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'delivery',
      out: join(root, 'parent'),
    });
    expect(parent.ok).toBe(true);
    expect(readFileSync(join(root, 'parent', '.agents', 'workflows', 'review', 'workflow.yaml'), 'utf8')).toContain(
      'id: review',
    );
  });

  it('rejects schema-valid-looking null integrations and escaping workflow symlinks', () => {
    const { home, project, catalog, root } = fixture();
    write(
      join(catalog, 'workflows', 'null-integration', 'workflow.yaml'),
      `version: 1
id: null-integration
title: Null integration
description: Reject null integration values.
actors: {}
integrations: {cache: null}
nodes:
  - {id: inspect, action: inspect, description: Inspect.}
`,
    );
    const set = resolveResources(
      discoverLayers({ homeDirectory: home, projectDirectory: project, settings: { sources: [] } }).layers,
    );
    expect(validateEffectiveSet(set, project).map((finding) => finding.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('/integrations/cache')]),
    );

    const external = join(root, 'external-workflow');
    write(
      join(external, 'workflow.yaml'),
      `version: 1
id: escape
title: Escape
description: External workflow.
actors: {}
nodes:
  - {id: inspect, action: inspect, description: Inspect.}
`,
    );
    symlinkSync(external, join(catalog, 'workflows', 'escape'));
    write(join(catalog, 'settings.yml'), 'workflows:\n  - escape\n');
    const escaped = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'escape',
      out: join(root, 'escaped'),
    });
    expect(escaped.ok).toBe(false);
    expect(escaped.messages.join('\n')).toContain('resolves outside the tree');
    expect(existsSync(join(root, 'escaped', '.agents'))).toBe(false);
  });

  it('exports root and nested workflow YAML with the complete agent closure and manifest', () => {
    const { home, project, root } = fixture();
    const out = join(root, 'out');
    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, workflow: 'delivery', out });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(out, '.agents', 'workflows', 'delivery', 'workflow.yaml'), 'utf8')).toContain(
      'id: delivery',
    );
    expect(readFileSync(join(out, '.agents', 'workflows', 'review', 'workflow.yaml'), 'utf8')).toContain('id: review');
    expect(readFileSync(join(out, '.agents', 'agents', 'reviewer', 'agent.md'), 'utf8')).toContain('name: reviewer');
    expect(readFileSync(join(out, '.agents', 'skills', 'review', 'SKILL.md'), 'utf8')).toContain('name: review');
    const manifest = JSON.parse(
      readFileSync(join(out, '.agents', '.outfitter', 'workflow-composition.json'), 'utf8'),
    ) as { root: string; workflows: { id: string; source: { layer: string; path: string } }[] };
    expect(manifest.root).toBe('delivery');
    expect(manifest.workflows.map((workflow) => ({ id: workflow.id, layer: workflow.source.layer }))).toEqual([
      { id: 'delivery', layer: 'workspace' },
      { id: 'review', layer: 'workspace' },
    ]);
    expect(manifest.workflows.every((workflow) => workflow.source.path.endsWith('workflow.yaml'))).toBe(true);
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
