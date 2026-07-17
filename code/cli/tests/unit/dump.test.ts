// Tests `outfitter dump`: deterministic, self-contained, closure-scoped .agents output.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';

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
});
