// Tests dump closure tolerance for byte-identical duplicate definitions of one slug.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-dupdump-'));
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

interface DuplicateSkillOptions {
  readonly leadBody: string;
  readonly reviewerBody: string;
  readonly leadReference?: string;
  readonly reviewerReference?: string;
}

const writeLeadReviewerDuplicateSkill = (project: string, options: DuplicateSkillOptions): void => {
  write(join(project, '.agents', 'system-prompt.md'), 'BASE');
  write(
    join(project, '.agents', 'agents', 'lead', 'agent.md'),
    '---\nname: lead\nskills: [dup]\nsubagents: [reviewer]\n---\n',
  );
  write(join(project, '.agents', 'agents', 'lead', 'skills', 'dup', 'SKILL.md'), options.leadBody);
  if (options.leadReference !== undefined) {
    write(join(project, '.agents', 'agents', 'lead', 'skills', 'dup', 'references', 'note.md'), options.leadReference);
  }
  write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\nskills: [dup]\n---\n');
  write(join(project, '.agents', 'agents', 'reviewer', 'skills', 'dup', 'SKILL.md'), options.reviewerBody);
  if (options.reviewerReference !== undefined) {
    write(
      join(project, '.agents', 'agents', 'reviewer', 'skills', 'dup', 'references', 'note.md'),
      options.reviewerReference,
    );
  }
};

const SKILL_BODY = '---\nname: dup\n---\n\nSelf-contained instructions.\n';

const dumpLead = (root: string, project: string): ReturnType<typeof executeDumpCommand> =>
  executeDumpCommand({
    homeDirectory: join(root, 'home'),
    projectDirectory: project,
    agent: 'lead',
    out: join(root, 'dump'),
  });

describe('dump duplicate definitions', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3.4, OFTR-005.3.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('flattens byte-identical agent-local duplicate skill definitions to one copy', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    writeLeadReviewerDuplicateSkill(project, { leadBody: SKILL_BODY, reviewerBody: SKILL_BODY });
    const out = join(root, 'dump');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'lead',
      out,
    });

    expect(result.ok).toBe(true);
    expect(relativeTree(join(out, '.agents'))).toEqual([
      '.outfitter/composition.json',
      'agents/lead/agent.md',
      'agents/reviewer/agent.md',
      'skills/dup/SKILL.md',
      'system-prompt.md',
    ]);
    expect(readFileSync(join(out, '.agents', 'skills', 'dup', 'SKILL.md'), 'utf8')).toBe(SKILL_BODY);
    // Severity agreement with the composer: the collision stays a non-fatal warning, not a failure.
    expect(result.messages.join(' ')).toContain("delegate skill 'dup' resolves to conflicting definitions");
  });

  it('keeps the divergent duplicate skill definitions fatal and names the slug', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    writeLeadReviewerDuplicateSkill(project, {
      leadBody: '---\nname: dup\n---\n\nlead\n',
      reviewerBody: '---\nname: dup\n---\n\nreviewer\n',
    });

    const result = dumpLead(root, project);

    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain(
      "dump closure resolves conflicting definitions for skill 'dup' and cannot flatten both.",
    );
  });

  it('stays fatal when SKILL.md is identical but packaged reference content differs', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    writeLeadReviewerDuplicateSkill(project, {
      leadBody: SKILL_BODY,
      reviewerBody: SKILL_BODY,
      leadReference: '# One\n',
      reviewerReference: '# Two\n',
    });

    const result = dumpLead(root, project);

    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain(
      "dump closure resolves conflicting definitions for skill 'dup' and cannot flatten both.",
    );
  });

  it('stays fatal when a packaged reference file is present in one definition only', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    writeLeadReviewerDuplicateSkill(project, {
      leadBody: SKILL_BODY,
      reviewerBody: SKILL_BODY,
      leadReference: '# One\n',
    });

    const result = dumpLead(root, project);

    expect(result.ok).toBe(false);
    expect(result.messages.join(' ')).toContain(
      "dump closure resolves conflicting definitions for skill 'dup' and cannot flatten both.",
    );
  });

  it('flattens byte-identical duplicate command documents and stays fatal on divergent ones', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const out = join(root, 'dump');
    write(join(project, '.agents', 'agents', 'lead', 'commands', 'shared.md'), 'shared steps');
    write(
      join(project, '.agents', 'agents', 'lead', 'agent.md'),
      '---\nname: lead\ncommands: [shared]\nsubagents: [reviewer]\n---\n',
    );
    write(join(project, '.agents', 'agents', 'reviewer', 'commands', 'shared.md'), 'shared steps');
    write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\ncommands: [shared]\n---\n');

    const identical = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'lead',
      out,
    });

    expect(identical.ok).toBe(true);
    expect(readFileSync(join(out, '.agents', 'commands', 'shared.md'), 'utf8')).toBe('shared steps');

    write(join(project, '.agents', 'agents', 'reviewer', 'commands', 'shared.md'), 'diverged steps');

    const divergent = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'lead',
      out,
    });

    expect(divergent.ok).toBe(false);
    expect(divergent.messages.join(' ')).toContain(
      "dump closure resolves conflicting definitions for command 'shared.md' and cannot flatten both.",
    );
  });

  it('dumps compositions without duplicate slugs byte-identically to the no-duplicate baseline', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'system-prompt.md'), 'BASE');
    write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n');
    write(join(project, '.agents', 'skills', 'notes', 'SKILL.md'), '---\nname: notes\n---\n');
    write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\n---\n\nReview.\n');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nskills: [notes, wiki]\nsubagents: [reviewer]\n---\n\n# Engineer\n',
    );
    const outA = join(root, 'a');
    const outB = join(root, 'b');

    executeDumpCommand({ homeDirectory: join(root, 'home'), projectDirectory: project, agent: 'engineer', out: outA });
    executeDumpCommand({ homeDirectory: join(root, 'home'), projectDirectory: project, agent: 'engineer', out: outB });

    const treeA = relativeTree(join(outA, '.agents'));
    expect(treeA).toEqual(relativeTree(join(outB, '.agents')));
    expect(treeA).toEqual(expect.arrayContaining(['skills/notes/SKILL.md', 'skills/wiki/SKILL.md']));
    for (const file of treeA) {
      expect(readFileSync(join(outA, '.agents', file), 'utf8')).toBe(readFileSync(join(outB, '.agents', file), 'utf8'));
    }
  });

  it('compares nested packaged directories and skips symlinks when flattening duplicates', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    writeLeadReviewerDuplicateSkill(project, { leadBody: SKILL_BODY, reviewerBody: SKILL_BODY });
    for (const agentDir of ['lead', 'reviewer']) {
      const skillDir = join(project, '.agents', 'agents', agentDir, 'skills', 'dup');
      write(join(skillDir, 'references', 'guide', 'deep.md'), '# Deep\n');
      write(join(skillDir, 'references', 'note.md'), '# Note\n');
      symlinkSync(join(skillDir, 'references', 'note.md'), join(skillDir, 'references', 'link.md'));
    }
    const out = join(root, 'dump');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'lead',
      out,
    });

    expect(result.ok).toBe(true);
    const dumped = relativeTree(join(out, '.agents'));
    expect(dumped).toContain('skills/dup/references/guide/deep.md');
    expect(dumped).toContain('skills/dup/references/note.md');
    expect(dumped).not.toContain('skills/dup/references/link.md');
  });
});
