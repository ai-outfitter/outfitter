// Tests skill control entry merging, pi argv filtering, and bundled Outfitter skill files.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  mergeLaunchResourceSources,
  mergeSkillControlSources,
  skillControlEntryIdentity,
} from '../../src/agents/LaunchResources.js';
import { repeatFlagValue } from '../../src/agents/AdapterProfileControls.js';
import { createPiArgs } from '../../src/agents/pi/PiArgs.js';
import { createOutfitterPluginCompositeFiles } from '../../src/agents/OutfitterSkill.js';
import { discoverSkillCatalog } from '../../src/skills/SkillCatalog.js';
import { resolveSkillEntries } from '../../src/skills/SkillResolution.js';

const temporaryRoots: string[] = [];

const createRoot = (prefix = 'outfitter-skill-controls-'): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const writeSkill = (skillsDirectory: string, id: string, frontmatter: string, body = '# Skill\n'): string => {
  const directory = join(skillsDirectory, id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}`);
  return directory;
};

describe('skill control entry merging', () => {
  it('dedupes bare IDs against { id } selections and keeps path identities separate', () => {
    expect(skillControlEntryIdentity('deploy-review')).toBe(skillControlEntryIdentity({ id: 'deploy-review' }));
    expect(skillControlEntryIdentity('./skills/review')).not.toBe(skillControlEntryIdentity('deploy-review'));

    const merged = mergeSkillControlSources(
      ['deploy-review', './skills/review'],
      [{ id: 'deploy-review', references: [{ repo_file: 'docs/a.md' }] }],
    );

    expect(merged).toEqual([{ id: 'deploy-review', references: [{ repo_file: 'docs/a.md' }] }, './skills/review']);
    expect(mergeSkillControlSources(undefined, undefined)).toBeUndefined();
    expect(mergeSkillControlSources(['deploy-review'], undefined)).toEqual(['deploy-review']);
  });

  it('filters non-string entries from pi --skill args', () => {
    expect(createPiArgs({ skills: ['./skills/review', { id: 'deploy-review' }] })).toEqual([
      '--skill',
      './skills/review',
    ]);
    expect(createPiArgs({})).toEqual([]);
    expect(typeof skillControlEntryIdentity(42)).toBe('string');
    expect(mergeLaunchResourceSources('skill', ['./skills/review'], ['./skills/review'])).toEqual(['./skills/review']);
    expect(repeatFlagValue('--append-system-prompt', { file: 'prompts/team.md' })).toEqual([]);
  });

  it('reports a repo_file reference without a project root as an error', () => {
    const project = createRoot();
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'rootless',
      'name: rootless\nreferences:\n  - repo_file: docs/runbook.md',
    );
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const resolution = resolveSkillEntries({ entries: [{ entry: 'rootless' }], catalog });

    expect(resolution.diagnostics[0]?.message).toContain('has no project root');
  });
});

describe('bundled Outfitter skill materialization', () => {
  it('materializes the skill without references and rejects malformed reference entries', () => {
    const root = createRoot();
    const plainSkill = join(root, 'plain');
    mkdirSync(plainSkill, { recursive: true });
    writeFileSync(join(plainSkill, 'SKILL.md'), '---\nname: outfitter\n---\n# Outfitter\n');
    const badSkill = join(root, 'bad');
    mkdirSync(badSkill, { recursive: true });
    writeFileSync(join(badSkill, 'SKILL.md'), '---\nname: outfitter\nreferences:\n  - docs/plain-string.md\n---\n');
    const listlessSkill = join(root, 'listless');
    mkdirSync(listlessSkill, { recursive: true });
    writeFileSync(join(listlessSkill, 'SKILL.md'), '---\nname: outfitter\nreferences: not-a-list\n---\n');

    const files = createOutfitterPluginCompositeFiles(root, {
      skillDirectory: plainSkill,
      referenceRootDirectory: root,
    });

    expect(files.map((file) => file.relativePath)).toEqual([
      'outfitter/plugin/.claude-plugin/plugin.json',
      'outfitter/plugin/skills/outfitter/SKILL.md',
    ]);
    expect(() =>
      createOutfitterPluginCompositeFiles(root, {
        skillDirectory: badSkill,
        referenceRootDirectory: root,
      }),
    ).toThrow(/must be \{ file: <path> \} entries/u);
    expect(() =>
      createOutfitterPluginCompositeFiles(root, {
        skillDirectory: listlessSkill,
        referenceRootDirectory: root,
      }),
    ).toThrow(/must be a list/u);
  });
});
