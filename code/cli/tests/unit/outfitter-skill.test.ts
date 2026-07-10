// Tests the bundled Outfitter self-documentation skill materialized into composite profiles.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createOutfitterPluginCompositeFiles,
  outfitterPluginCompositeRelativePath,
  outfitterPluginSkillCompositeRelativePath,
  resolveOutfitterSkillSource,
} from '../../src/agents/OutfitterSkill.js';
import { createClaudeAdapter } from '../../src/agents/claude/ClaudeAdapter.js';
import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';

const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const createSkillFixture = (skillMarkdown: string, referenceFiles: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-skill-test-'));
  temporaryRoots.push(root);
  const skillDirectory = join(root, '.outfitter', 'skills', 'outfitter');
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(join(skillDirectory, 'SKILL.md'), skillMarkdown);

  for (const [relativePath, content] of Object.entries(referenceFiles)) {
    mkdirSync(join(root, relativePath, '..'), { recursive: true });
    writeFileSync(join(root, relativePath), content);
  }

  return { skillDirectory, referenceRootDirectory: root };
};

describe('outfitter skill', () => {
  it('resolves the repository skill authored at .outfitter/skills/outfitter', () => {
    const source = resolveOutfitterSkillSource();

    expect(source?.skillDirectory).toBe(join(repositoryRoot, '.outfitter', 'skills', 'outfitter'));
    expect(source?.referenceRootDirectory).toBe(join(repositoryRoot, '.'));
  });

  it('materializes the bundled skill with every declared documentation reference', () => {
    const files = createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite');
    const relativePaths = files.map((file) => file.relativePath);

    expect(relativePaths).toContain(`${outfitterPluginCompositeRelativePath}/.claude-plugin/plugin.json`);
    expect(relativePaths).toContain(`${outfitterPluginSkillCompositeRelativePath}/SKILL.md`);
    expect(relativePaths).toContain(`${outfitterPluginSkillCompositeRelativePath}/references/README.md`);
    expect(relativePaths).toContain(`${outfitterPluginSkillCompositeRelativePath}/references/profiles.md`);
    expect(relativePaths).toContain(`${outfitterPluginSkillCompositeRelativePath}/references/skills.md`);

    const skillFile = files.find(
      (file) => file.relativePath === `${outfitterPluginSkillCompositeRelativePath}/SKILL.md`,
    );
    expect(skillFile?.content).toContain('name: outfitter');

    const referenceFile = files.find(
      (file) => file.relativePath === `${outfitterPluginSkillCompositeRelativePath}/references/profiles.md`,
    );
    expect(referenceFile?.content).toContain('# Profiles');
    expect(referenceFile?.sourceInputs).toEqual([join(repositoryRoot, 'docs', 'documentation', 'profiles.md')]);
  });

  it('materializes file references relative to the repository containing the skill', () => {
    const source = createSkillFixture(
      '---\nname: outfitter\ndescription: Test skill.\nreferences:\n  - file: docs/guide.md\n---\n# Outfitter\n',
      { 'docs/guide.md': '# Guide\n' },
    );

    const files = createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite', source);

    expect(files.map((file) => file.relativePath)).toEqual([
      `${outfitterPluginCompositeRelativePath}/.claude-plugin/plugin.json`,
      `${outfitterPluginSkillCompositeRelativePath}/SKILL.md`,
      `${outfitterPluginSkillCompositeRelativePath}/references/guide.md`,
    ]);
    expect(files[2]?.content).toBe('# Guide\n');
  });

  it('accepts a skill without declared references', () => {
    const source = createSkillFixture('---\nname: outfitter\ndescription: Test skill.\n---\n# Outfitter\n');

    const files = createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite', source);

    expect(files.map((file) => file.relativePath)).toEqual([
      `${outfitterPluginCompositeRelativePath}/.claude-plugin/plugin.json`,
      `${outfitterPluginSkillCompositeRelativePath}/SKILL.md`,
    ]);
  });

  it('accepts a skill without frontmatter', () => {
    const source = createSkillFixture('# Outfitter\n');

    const files = createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite', source);

    expect(files.map((file) => file.relativePath)).toEqual([
      `${outfitterPluginCompositeRelativePath}/.claude-plugin/plugin.json`,
      `${outfitterPluginSkillCompositeRelativePath}/SKILL.md`,
    ]);
  });

  it('rejects frontmatter references that are not a list', () => {
    const source = createSkillFixture(
      '---\nname: outfitter\ndescription: Test skill.\nreferences: docs/guide.md\n---\n# Outfitter\n',
    );

    expect(() => createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite', source)).toThrow(
      /'references' must be a list/,
    );
  });

  it('rejects reference entries that are not objects', () => {
    const source = createSkillFixture(
      '---\nname: outfitter\ndescription: Test skill.\nreferences:\n  - docs/guide.md\n---\n# Outfitter\n',
    );

    expect(() => createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite', source)).toThrow(
      /must be \{ file: <path> \} entries/,
    );
  });

  it('rejects a missing file reference target', () => {
    const source = createSkillFixture(
      '---\nname: outfitter\ndescription: Test skill.\nreferences:\n  - file: docs/missing.md\n---\n# Outfitter\n',
    );

    expect(() => createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite', source)).toThrow(
      /reference 'docs\/missing\.md' is missing/,
    );
  });

  it('rejects references that collide on their destination basename', () => {
    const source = createSkillFixture(
      '---\nname: outfitter\ndescription: Test skill.\nreferences:\n  - file: docs/guide.md\n  - file: other/guide.md\n---\n# Outfitter\n',
      { 'docs/guide.md': '# Guide\n', 'other/guide.md': '# Other\n' },
    );

    expect(() => createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite', source)).toThrow(
      /collide on basename 'guide\.md'/,
    );
  });

  it('rejects reference entries that are not file sources', () => {
    const source = createSkillFixture(
      '---\nname: outfitter\ndescription: Test skill.\nreferences:\n  - repo_file: docs/guide.md\n---\n# Outfitter\n',
    );

    expect(() => createOutfitterPluginCompositeFiles('/tmp/outfitter-skill-composite', source)).toThrow(
      /must be \{ file: <path> \} entries/,
    );
  });

  it('publishes the bundled skill in pi composite profiles and launch plans', () => {
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      { rootDirectory: '/tmp/outfitter-engineering-pi-skill', profilePaths: [] },
    );

    expect(compositeProfilePlan.compositeProfile.files.map((file) => file.relativePath)).toContain(
      `${outfitterPluginSkillCompositeRelativePath}/SKILL.md`,
    );

    const launchPlan = adapter.createLaunchPlan(compositeProfilePlan.compositeProfile);

    expect(launchPlan.args).toContain('--skill');
    expect(launchPlan.args).toContain(
      join('/tmp/outfitter-engineering-pi-skill', outfitterPluginSkillCompositeRelativePath),
    );
    expect(launchPlan.args.join(' ')).not.toContain('--append-system-prompt');
  });

  it('publishes the bundled skill to Claude launches as a plugin directory', () => {
    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      { rootDirectory: '/tmp/outfitter-engineering-claude-skill', profilePaths: [] },
    );
    const relativePaths = compositeProfilePlan.compositeProfile.files.map((file) => file.relativePath);

    expect(relativePaths).toContain(`${outfitterPluginCompositeRelativePath}/.claude-plugin/plugin.json`);
    expect(relativePaths).toContain(`${outfitterPluginSkillCompositeRelativePath}/SKILL.md`);

    const launchPlan = adapter.createLaunchPlan(compositeProfilePlan.compositeProfile);

    expect(launchPlan.args).toEqual([
      '--plugin-dir',
      join('/tmp/outfitter-engineering-claude-skill', outfitterPluginCompositeRelativePath),
    ]);
  });
});
