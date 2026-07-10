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
import { resolveProfileSkillControls } from '../../src/skills/ProfileSkillResolution.js';
import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';

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

describe('skill precedence and cross-scope selection', () => {
  it('lets later configured sources and higher profile layers win, matching profile precedence', () => {
    const earlySource = createRoot();
    const lateSource = createRoot();
    const project = createRoot();
    for (const catalog of [earlySource, lateSource]) {
      mkdirSync(join(catalog, 'profiles'), { recursive: true });
      writeSkill(join(catalog, 'skills'), 'deploy-review', 'name: deploy-review');
    }
    const baseProfile = join(project, '.outfitter', 'profiles', 'base');
    const selectedProfile = join(project, '.outfitter', 'profiles', 'selected');
    writeSkill(join(baseProfile, 'skills'), 'issue-planning', 'name: issue-planning');
    writeSkill(join(selectedProfile, 'skills'), 'issue-planning', 'name: issue-planning');

    const sourceCatalog = discoverSkillCatalog({ sourcePaths: [earlySource, lateSource] });
    const layerCatalog = discoverSkillCatalog({
      profileLayers: [
        { sourceRootPath: join(project, '.outfitter', 'profiles'), resourceRootPath: baseProfile },
        { sourceRootPath: join(project, '.outfitter', 'profiles'), resourceRootPath: selectedProfile },
      ],
    });

    expect(sourceCatalog.entries.get('deploy-review')?.directory).toBe(join(lateSource, 'skills', 'deploy-review'));
    expect(layerCatalog.entries.get('issue-planning')?.directory).toBe(
      join(selectedProfile, 'skills', 'issue-planning'),
    );
  });

  it('materializes an ID selected by several control scopes once and rejects conflicting references', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(join(project, '.outfitter', 'skills'), 'deploy-review', 'name: deploy-review');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs', 'runbook.md'), 'runbook\n');
    const sharedProfile = parseProfileYaml(
      'id: platform\ncontrols:\n  skills:\n    - deploy-review\n  pi:\n    skills:\n      - deploy-review\n',
      'platform',
    );
    const conflictingProfile = parseProfileYaml(
      [
        'id: platform',
        'controls:',
        '  skills:',
        '    - deploy-review',
        '  pi:',
        '    skills:',
        '      - id: deploy-review',
        '        references:',
        '          - repo_file: docs/runbook.md',
      ].join('\n'),
      'platform',
    );

    if ('message' in sharedProfile || 'message' in conflictingProfile) {
      throw new Error('fixture profiles must parse');
    }

    const shared = resolveProfileSkillControls({
      profile: sharedProfile,
      profileLayers: [],
      sourcePaths: [],
      projectDirectory: project,
      outputDirectory: output,
    });
    const conflicting = resolveProfileSkillControls({
      profile: conflictingProfile,
      profileLayers: [],
      sourcePaths: [],
      projectDirectory: project,
    });

    const generated = join(output, 'outfitter', 'skills', 'deploy-review');
    expect(shared.diagnostics).toEqual([]);
    expect(shared.profile.controls.skills).toEqual([generated]);
    expect(shared.profile.controls.pi?.skills).toEqual([generated]);
    expect(
      conflicting.diagnostics.some((diagnostic) => diagnostic.message.includes('conflicting reference sets')),
    ).toBe(true);
  });

  it('reports shipped-file collisions without materializing and allows dot-prefixed sibling names', () => {
    const project = createRoot();
    const shippedSkill = writeSkill(
      join(project, '.outfitter', 'skills'),
      'shipped',
      'name: shipped\nscripts:\n  - repo_file: tools/collect.sh',
    );
    mkdirSync(join(shippedSkill, 'scripts'), { recursive: true });
    writeFileSync(join(shippedSkill, 'scripts', 'collect.sh'), 'shipped\n');
    mkdirSync(join(project, 'tools'), { recursive: true });
    writeFileSync(join(project, 'tools', 'collect.sh'), 'external\n');
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'dotted',
      'name: dotted\nreferences:\n  - repo_file: ..config/guide.md',
    );
    mkdirSync(join(project, '..config'), { recursive: true });
    writeFileSync(join(project, '..config', 'guide.md'), 'guide\n');
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const shipped = resolveSkillEntries({ entries: [{ entry: 'shipped' }], catalog, projectDirectory: project });
    const dotted = resolveSkillEntries({ entries: [{ entry: 'dotted' }], catalog, projectDirectory: project });

    expect(shipped.diagnostics[0]?.message).toContain('collides with a file already shipped');
    expect(dotted.diagnostics).toEqual([]);
  });
});
