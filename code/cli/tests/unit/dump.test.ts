// Tests `outfitter dump`: deterministic, self-contained, closure-scoped .agents output.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { encodeRemoteSource } from '../../src/sources/SourceCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-dump-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const relativeTree = (root: string): string[] => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(relative(root, full).split(/[/\\]/).join('/'));
    }
  };
  walk(root);
  return files.sort();
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const buildTree = (): { home: string; project: string } => {
  const root = createTemporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(join(project, '.agents', 'system-prompt.md'), 'BASE');
  write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n');
  write(join(project, '.agents', 'skills', 'unused', 'SKILL.md'), '---\nname: unused\n---\n');
  write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\n---\n\nReview.\n');
  write(
    join(project, '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nskills: [wiki]\nsubagents: [reviewer]\n---\n\n# Engineer\n',
  );
  return { home, project };
};

describe('dump command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes the transitive closure of an agent as a self-contained .agents tree', () => {
    const { home, project } = buildTree();
    const out = join(createTemporaryRoot(), 'review');

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'engineer', out });

    expect(result.ok).toBe(true);
    expect(relativeTree(join(out, '.agents'))).toEqual([
      'agents/engineer/agent.md',
      'agents/reviewer/agent.md',
      'skills/wiki/SKILL.md',
      'system-prompt.md',
    ]);
    // 'unused' skill is not in engineer's closure.
    expect(relativeTree(join(out, '.agents'))).not.toContain('skills/unused/SKILL.md');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.2, OFTR-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('flattens a cached source agent-local skill into the dump with all packaged files', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const source = { github: 'example/actions', ref: 'main' };
    const cached = join(home, '.agents', 'cache', 'repos', encodeRemoteSource(source));
    write(
      join(cached, 'agents', 'actions', 'agent.md'),
      '---\nname: actions\nskills: [actions-automation]\n---\n\nActions.\n',
    );
    const localSkill = join(cached, 'agents', 'actions', 'skills', 'actions-automation');
    write(join(localSkill, 'SKILL.md'), '---\nname: actions-automation\n---\n');
    write(join(localSkill, 'references', 'on-job-failure.md'), '# On failure\n');
    write(join(localSkill, 'scripts', 'collect.sh'), 'echo collect\n');
    write(join(project, '.agents', 'settings.yml'), 'sources:\n  - github: example/actions\n    ref: main\n');
    const out = join(root, 'dump');

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'actions', out });

    expect(result.ok).toBe(true);
    const dumped = relativeTree(join(out, '.agents'));
    expect(dumped).toContain('skills/actions-automation/SKILL.md');
    expect(dumped).toContain('skills/actions-automation/references/on-job-failure.md');
    expect(dumped).toContain('skills/actions-automation/scripts/collect.sh');
    expect(dumped).not.toContain('agents/actions/skills/actions-automation/SKILL.md');
  });

  it('keeps same-slug local skills isolated when dumping their owning agents separately', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    for (const agent of ['alpha', 'beta']) {
      write(join(project, '.agents', 'agents', agent, 'agent.md'), `---\nname: ${agent}\nskills: [private]\n---\n`);
      write(
        join(project, '.agents', 'agents', agent, 'skills', 'private', 'SKILL.md'),
        `---\nname: private\n---\n\n${agent}\n`,
      );
    }
    const alphaOut = join(root, 'alpha');
    const betaOut = join(root, 'beta');

    executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'alpha',
      out: alphaOut,
    });
    executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'beta',
      out: betaOut,
    });

    expect(readFileSync(join(alphaOut, '.agents', 'skills', 'private', 'SKILL.md'), 'utf8')).toContain('alpha');
    expect(readFileSync(join(betaOut, '.agents', 'skills', 'private', 'SKILL.md'), 'utf8')).toContain('beta');
  });

  it('rejects conflicting same-slug local skills in one transitive dump closure', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'lead', 'agent.md'),
      '---\nname: lead\nskills: [private]\nsubagents: [reviewer]\n---\n',
    );
    write(
      join(project, '.agents', 'agents', 'lead', 'skills', 'private', 'SKILL.md'),
      '---\nname: private\n---\n\nlead\n',
    );
    write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\nskills: [private]\n---\n');
    write(
      join(project, '.agents', 'agents', 'reviewer', 'skills', 'private', 'SKILL.md'),
      '---\nname: private\n---\n\nreviewer\n',
    );

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'lead',
      out: join(root, 'dump'),
    });

    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain("conflicting definitions for skill 'private'");
  });

  it('is deterministic — two dumps produce identical trees and contents', () => {
    const { home, project } = buildTree();
    const outA = join(createTemporaryRoot(), 'a');
    const outB = join(createTemporaryRoot(), 'b');

    executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'engineer', out: outA });
    executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'engineer', out: outB });

    const treeA = relativeTree(join(outA, '.agents'));
    expect(treeA).toEqual(relativeTree(join(outB, '.agents')));
    for (const file of treeA) {
      expect(readFileSync(join(outA, '.agents', file), 'utf8')).toBe(readFileSync(join(outB, '.agents', file), 'utf8'));
    }
  });

  it('never copies symlinks into the dump', () => {
    const { home, project } = buildTree();
    symlinkSync('/etc/passwd', join(project, '.agents', 'agents', 'engineer', 'secret-link'));
    const out = join(createTemporaryRoot(), 'safe');

    executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'engineer', out });

    expect(relativeTree(join(out, '.agents'))).not.toContain('agents/engineer/secret-link');
  });

  it('uses default_agent when --agent is omitted and errors when neither is available', () => {
    const { home, project } = buildTree();
    write(join(project, '.agents', 'settings.yml'), 'default_agent: engineer\n');
    const out = join(createTemporaryRoot(), 'def');
    expect(executeDumpCommand({ homeDirectory: home, projectDirectory: project, out }).ok).toBe(true);

    const bare = createTemporaryRoot();
    expect(() =>
      executeDumpCommand({ homeDirectory: join(bare, 'home'), projectDirectory: join(bare, 'project'), out }),
    ).toThrow(/No agent selected/);
  });

  it('reports an error for an unknown agent', () => {
    const { home, project } = buildTree();
    const out = join(createTemporaryRoot(), 'x');
    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'ghost', out });
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain("Unknown agent 'ghost'");
  });

  it('materializes the merged effective config.json across layers', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(
      join(home, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nmodel: gpt-5.2\n---\n\nBody.\n',
    );
    write(join(project, '.agents', 'agents', 'engineer', 'config.json'), JSON.stringify({ model: 'gpt-5.3' }));
    const out = join(createTemporaryRoot(), 'merged');

    executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'engineer', out });

    const config = JSON.parse(
      readFileSync(join(out, '.agents', 'agents', 'engineer', 'config.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(config).toEqual({ model: 'gpt-5.3' });
  });

  it('rejects a dump whose resource directory is a symlink', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const external = join(root, 'external-skill');
    write(join(external, 'SKILL.md'), '---\nname: wiki\n---\n');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nskills: [wiki]\n---\n\nBody.\n',
    );
    mkdirSync(join(project, '.agents', 'skills'), { recursive: true });
    symlinkSync(external, join(project, '.agents', 'skills', 'wiki'));
    const out = join(createTemporaryRoot(), 'unsafe');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      out,
    });
    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain('cannot be safely dumped');
  });

  it('rejects a resource reached through a symlinked ancestor directory', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const externalAgents = join(root, 'external-agents');
    write(join(externalAgents, 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    mkdirSync(join(project, '.agents'), { recursive: true });
    symlinkSync(externalAgents, join(project, '.agents', 'agents')); // whole agents/ dir is an escaping link
    const out = join(createTemporaryRoot(), 'ancestor');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      out,
    });
    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain('cannot be safely dumped');
  });

  it('rejects an --out that overlaps a source layer', () => {
    const { home, project } = buildTree();
    const result = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      out: project,
    });
    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain('overlaps source layer');
    // the source .agents tree must still be intact
    expect(relativeTree(join(project, '.agents'))).toContain('agents/engineer/agent.md');
  });

  it('materializes tree-root mcp.json and models.json so selections are self-contained', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'mcp.json'), '{"github":{}}');
    write(join(project, '.agents', 'models.json'), '{"gpt-5.2":{}}');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nmcp: [github]\n---\n\nBody.\n',
    );
    const out = join(createTemporaryRoot(), 'roots');

    executeDumpCommand({ homeDirectory: join(root, 'home'), projectDirectory: project, agent: 'engineer', out });
    const tree = relativeTree(join(out, '.agents'));
    expect(tree).toContain('mcp.json');
    expect(tree).toContain('models.json');
  });

  it('errors when a tree-root file resolves outside the tree', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(root, 'outside', 'system-prompt.md'), 'EXTERNAL');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    symlinkSync(join(root, 'outside', 'system-prompt.md'), join(project, '.agents', 'system-prompt.md'));
    const out = join(createTemporaryRoot(), 'escape');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      out,
    });
    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain('resolves outside the tree');
  });

  it('cleans the destination so a smaller closure leaves no stale files', () => {
    const { home, project } = buildTree();
    const out = join(createTemporaryRoot(), 'reuse');
    // First dump: engineer pulls in reviewer + wiki.
    executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'engineer', out });
    // Second dump into the same dir: reviewer has no skills/subagents.
    executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'reviewer', out });

    const tree = relativeTree(join(out, '.agents'));
    expect(tree).toContain('agents/reviewer/agent.md');
    expect(tree).not.toContain('agents/engineer/agent.md');
    expect(tree).not.toContain('skills/wiki/SKILL.md');
  });

  it('fails the whole dump when a transitive subagent is invalid', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'lead', 'agent.md'),
      '---\nname: lead\nskills: [ghost]\nsubagents: [broken]\n---\n\nBody.\n',
    );
    write(join(project, '.agents', 'agents', 'broken', 'agent.md'), '---\nname: mismatch\n---\n\nBody.\n');
    const out = join(createTemporaryRoot(), 'closure');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'lead',
      out,
    });
    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain('must match its directory');
    // warnings from closure members are surfaced even on a fatal failure
    expect(result.messages.join(' ')).toContain("unknown skill 'ghost'");
  });

  it('propagates non-fatal loadout warnings from closure members', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nskills: [ghost]\n---\n\nBody.\n',
    );
    const out = join(createTemporaryRoot(), 'warn');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      out,
    });
    expect(result.ok).toBe(true);
    expect(result.messages.join(' ')).toContain("unknown skill 'ghost'");
  });
});
