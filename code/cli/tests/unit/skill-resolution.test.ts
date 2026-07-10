// Tests catalog skill discovery, reference materialization, and profile skill resolution.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';
import { discoverSkillCatalog } from '../../src/skills/SkillCatalog.js';
import { isValidSkillId, parseSkillDocument, readSkillDocument } from '../../src/skills/SkillDocument.js';
import { resolveSkillEntries } from '../../src/skills/SkillResolution.js';
import { resolveProfileSkillControls } from '../../src/skills/ProfileSkillResolution.js';

const temporaryRoots: string[] = [];

const createRoot = (prefix = 'outfitter-skills-'): string => {
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

describe('skill IDs and SKILL.md documents', () => {
  it('accepts lowercase hyphenated ids up to 64 characters and rejects other names', () => {
    expect(isValidSkillId('outfitter-actions')).toBe(true);
    expect(isValidSkillId('a')).toBe(true);
    expect(isValidSkillId('a'.repeat(64))).toBe(true);
    expect(isValidSkillId('a'.repeat(65))).toBe(false);
    expect(isValidSkillId('-leading')).toBe(false);
    expect(isValidSkillId('trailing-')).toBe(false);
    expect(isValidSkillId('double--hyphen')).toBe(false);
    expect(isValidSkillId('Upper')).toBe(false);
    expect(isValidSkillId('dots.name')).toBe(false);
  });

  it('parses frontmatter name, description, and references', () => {
    const document = parseSkillDocument(
      '---\nname: deploy-review\ndescription: Review deployments.\nreferences:\n  - file: docs/design.md\n  - repo_file: docs/runbook.md\n---\n# Deploy\n',
      'SKILL.md',
    );

    expect(document).toEqual({
      name: 'deploy-review',
      description: 'Review deployments.',
      references: [{ file: 'docs/design.md' }, { repo_file: 'docs/runbook.md' }],
      scripts: [],
      assets: [],
    });
  });

  it('parses scripts and assets sections with the same reference union', () => {
    const document = parseSkillDocument(
      '---\nname: deploy-review\nscripts:\n  - file: tools/process.sh\nassets:\n  - repo_file: templates/report.json\n---\n',
      'SKILL.md',
    );

    expect(document).toEqual({
      name: 'deploy-review',
      description: undefined,
      references: [],
      scripts: [{ file: 'tools/process.sh' }],
      assets: [{ repo_file: 'templates/report.json' }],
    });
    expect(parseSkillDocument('---\nname: ok\nscripts:\n  - tools/process.sh\n---\n', 'SKILL.md')).toHaveProperty(
      'message',
    );
  });

  it('rejects missing frontmatter, invalid names, and malformed reference entries', () => {
    expect(parseSkillDocument('# No frontmatter\n', 'SKILL.md')).toHaveProperty('message');
    expect(parseSkillDocument('---\nname: Bad Name\n---\n', 'SKILL.md')).toHaveProperty('message');
    expect(
      parseSkillDocument('---\nname: ok\nreferences:\n  - file: a.md\n    repo_file: b.md\n---\n', 'SKILL.md'),
    ).toHaveProperty('message');
    expect(parseSkillDocument('---\nname: ok\nreferences:\n  - name: a.md\n---\n', 'SKILL.md')).toHaveProperty(
      'message',
    );
  });
});

describe('skill catalog discovery', () => {
  it('prefers project skills over configured sources and reports shadowing', () => {
    const project = createRoot();
    const catalog = createRoot();
    writeSkill(join(project, '.outfitter', 'skills'), 'deploy-review', 'name: deploy-review');
    writeSkill(join(catalog, 'skills'), 'deploy-review', 'name: deploy-review');
    mkdirSync(join(catalog, 'profiles'), { recursive: true });

    const discovered = discoverSkillCatalog({
      projectDirectory: project,
      sourcePaths: [join(catalog, 'profiles')],
    });

    expect(discovered.entries.get('deploy-review')?.directory).toBe(
      join(project, '.outfitter', 'skills', 'deploy-review'),
    );
    expect(discovered.shadowed).toHaveLength(1);
    expect(discovered.shadowed[0].shadowedDirectory).toBe(join(catalog, 'skills', 'deploy-review'));
  });

  it('resolves the catalog root from a source path pointing directly at the profiles directory', () => {
    const catalog = createRoot();
    mkdirSync(join(catalog, 'profiles'), { recursive: true });
    writeSkill(join(catalog, 'skills'), 'kpi-reporting', 'name: kpi-reporting');

    const discovered = discoverSkillCatalog({ sourcePaths: [join(catalog, 'profiles')] });

    expect(discovered.entries.has('kpi-reporting')).toBe(true);
  });

  it('exposes bundled directory-profile skills and ignores invalid directory names', () => {
    const project = createRoot();
    const profileRoot = join(project, '.outfitter', 'profiles', 'platform');
    writeSkill(join(profileRoot, 'skills'), 'issue-planning', 'name: issue-planning');
    writeSkill(join(project, '.outfitter', 'skills'), 'Invalid.Name', 'name: whatever');

    const discovered = discoverSkillCatalog({
      projectDirectory: project,
      profileLayers: [{ sourceRootPath: join(project, '.outfitter', 'profiles'), resourceRootPath: profileRoot }],
    });

    expect(discovered.entries.has('issue-planning')).toBe(true);
    expect(discovered.entries.has('Invalid.Name')).toBe(false);
  });
});

describe('skill resolution and reference materialization', () => {
  it('materializes catalog file and project repo_file references beneath references/', () => {
    const project = createRoot();
    const output = createRoot();
    const skillsDirectory = join(project, '.outfitter', 'skills');
    writeSkill(
      skillsDirectory,
      'deploy-review',
      'name: deploy-review\nreferences:\n  - file: docs/design.md\n  - repo_file: docs/runbooks/deploy.md',
    );
    mkdirSync(join(project, 'docs', 'runbooks'), { recursive: true });
    writeFileSync(join(project, 'docs', 'design.md'), 'design\n');
    writeFileSync(join(project, 'docs', 'runbooks', 'deploy.md'), 'runbook\n');

    const catalog = discoverSkillCatalog({ projectDirectory: project });
    const resolution = resolveSkillEntries({
      entries: [{ entry: 'deploy-review' }],
      catalog,
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(resolution.diagnostics).toEqual([]);
    expect(resolution.sources).toEqual([join(output, 'deploy-review')]);
    expect(readFileSync(join(output, 'deploy-review', 'references', 'design.md'), 'utf8')).toBe('design\n');
    expect(readFileSync(join(output, 'deploy-review', 'references', 'deploy.md'), 'utf8')).toBe('runbook\n');
    expect(existsSync(join(output, 'deploy-review', 'SKILL.md'))).toBe(true);
  });

  it('materializes scripts and assets beneath their own generated directories', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'deploy-review',
      'name: deploy-review\nscripts:\n  - file: tools/process.sh\nassets:\n  - repo_file: templates/report.json',
    );
    mkdirSync(join(project, 'tools'), { recursive: true });
    mkdirSync(join(project, 'templates'), { recursive: true });
    writeFileSync(join(project, 'tools', 'process.sh'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(project, 'templates', 'report.json'), '{}\n');

    const catalog = discoverSkillCatalog({ projectDirectory: project });
    const resolution = resolveSkillEntries({
      entries: [{ entry: 'deploy-review' }],
      catalog,
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(resolution.diagnostics).toEqual([]);
    expect(readFileSync(join(output, 'deploy-review', 'scripts', 'process.sh'), 'utf8')).toBe('#!/bin/sh\n');
    expect(statSync(join(output, 'deploy-review', 'scripts', 'process.sh')).mode & 0o100).toBe(0o100);
    expect(readFileSync(join(output, 'deploy-review', 'assets', 'report.json'), 'utf8')).toBe('{}\n');
  });

  it('omits a missing repo_file reference and fails a missing file reference', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'optional-ref',
      'name: optional-ref\nreferences:\n  - repo_file: docs/absent.md',
    );
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'broken-ref',
      'name: broken-ref\nreferences:\n  - file: docs/absent.md',
    );
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const optional = resolveSkillEntries({
      entries: [{ entry: 'optional-ref' }],
      catalog,
      projectDirectory: project,
      outputDirectory: output,
    });
    const broken = resolveSkillEntries({
      entries: [{ entry: 'broken-ref' }],
      catalog,
      projectDirectory: project,
    });

    expect(optional.diagnostics).toEqual([]);
    expect(existsSync(join(output, 'optional-ref', 'references'))).toBe(false);
    expect(broken.diagnostics[0]?.severity).toBe('error');
    expect(broken.diagnostics[0]?.message).toContain("Reference file 'docs/absent.md' was not found");
  });

  it('fails duplicate reference destinations, directory targets, and root-escaping symlinks', () => {
    const project = createRoot();
    const outside = createRoot();
    writeFileSync(join(outside, 'secret.md'), 'secret\n');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs', 'design.md'), 'design\n');
    symlinkSync(join(outside, 'secret.md'), join(project, 'docs', 'escape.md'));
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'colliding',
      'name: colliding\nreferences:\n  - file: docs/design.md\n  - repo_file: docs/design.md',
    );
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'directory-ref',
      'name: directory-ref\nreferences:\n  - file: docs',
    );
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'escaping',
      'name: escaping\nreferences:\n  - file: docs/escape.md',
    );
    const catalog = discoverSkillCatalog({ projectDirectory: project });
    const resolve = (id: string) =>
      resolveSkillEntries({ entries: [{ entry: id }], catalog, projectDirectory: project }).diagnostics;

    expect(resolve('colliding')[0]?.message).toContain('declared more than once');
    expect(resolve('directory-ref')[0]?.message).toContain('must be a regular file');
    expect(resolve('escaping')[0]?.message).toContain('resolves outside');
  });

  it('fails when the SKILL.md name does not match the directory name', () => {
    const project = createRoot();
    writeSkill(join(project, '.outfitter', 'skills'), 'misnamed', 'name: other-name');
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const resolution = resolveSkillEntries({ entries: [{ entry: 'misnamed' }], catalog, projectDirectory: project });

    expect(resolution.diagnostics[0]?.message).toContain('must match its directory name');
  });

  it('errors on unresolved object selections and passes through unresolved path-like strings', () => {
    const project = createRoot();
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const resolution = resolveSkillEntries({
      entries: [{ entry: { id: 'missing-skill' } }, { entry: './skills/review' }, { entry: 'bare-name' }],
      catalog,
      projectDirectory: project,
    });

    expect(resolution.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['error', 'warning']);
    expect(resolution.sources).toEqual(['./skills/review', 'bare-name']);
  });
});

describe('profile skill resolution', () => {
  it('parses bare IDs and { id, references } selections from profile YAML', () => {
    const profile = parseProfileYaml(
      [
        'id: platform',
        'controls:',
        '  skills:',
        '    - outfitter-actions',
        '    - id: deploy-review',
        '      references:',
        '        - repo_file: docs/runbooks/deploy.md',
      ].join('\n'),
      'platform',
    );

    expect('message' in profile).toBe(false);
    expect('controls' in profile ? profile.controls.skills : undefined).toEqual([
      'outfitter-actions',
      { id: 'deploy-review', references: [{ repo_file: 'docs/runbooks/deploy.md' }] },
    ]);
  });

  it('materializes profile-added references beside skill-declared references without forking the skill', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'deploy-review',
      'name: deploy-review\nreferences:\n  - file: docs/design.md',
    );
    mkdirSync(join(project, 'docs', 'runbooks'), { recursive: true });
    writeFileSync(join(project, 'docs', 'design.md'), 'design\n');
    writeFileSync(join(project, 'docs', 'runbooks', 'deploy.md'), 'runbook\n');
    const profilePath = join(project, '.outfitter', 'profiles', 'platform', 'profile.yml');
    mkdirSync(join(project, '.outfitter', 'profiles', 'platform'), { recursive: true });
    writeFileSync(profilePath, 'id: platform\n');
    const profile = parseProfileYaml(
      [
        'id: platform',
        'controls:',
        '  skills:',
        '    - id: deploy-review',
        '      references:',
        '        - repo_file: docs/runbooks/deploy.md',
      ].join('\n'),
      'platform',
    );

    expect('message' in profile).toBe(false);
    if ('message' in profile) {
      return;
    }

    const resolution = resolveProfileSkillControls({
      profile,
      profileLayers: [
        {
          source: { path: join(project, '.outfitter', 'profiles') },
          folderPath: join(project, '.outfitter', 'profiles', 'platform'),
          profilePath,
          profile,
          sourceRootPath: join(project, '.outfitter', 'profiles'),
          resourceRootPath: join(project, '.outfitter', 'profiles', 'platform'),
          layout: 'directory',
        },
      ],
      sourcePaths: [],
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(resolution.diagnostics).toEqual([]);
    const generated = join(output, 'outfitter', 'skills', 'deploy-review');
    expect(resolution.profile.controls.skills).toEqual([generated]);
    expect(readFileSync(join(generated, 'references', 'design.md'), 'utf8')).toBe('design\n');
    expect(readFileSync(join(generated, 'references', 'deploy.md'), 'utf8')).toBe('runbook\n');
  });

  it('warns when a selected skill ID shadows the same ID from a lower-precedence source', () => {
    const project = createRoot();
    const catalogRepo = createRoot();
    writeSkill(join(project, '.outfitter', 'skills'), 'deploy-review', 'name: deploy-review');
    writeSkill(join(catalogRepo, 'skills'), 'deploy-review', 'name: deploy-review');
    mkdirSync(join(catalogRepo, 'profiles'), { recursive: true });
    const profile = parseProfileYaml('id: platform\ncontrols:\n  skills:\n    - deploy-review\n', 'platform');

    expect('message' in profile).toBe(false);
    if ('message' in profile) {
      return;
    }

    const resolution = resolveProfileSkillControls({
      profile,
      profileLayers: [],
      sourcePaths: [catalogRepo],
      projectDirectory: project,
    });

    expect(resolution.diagnostics.some((diagnostic) => diagnostic.message.includes('shadows'))).toBe(true);
  });
});

describe('skill document and catalog edge cases', () => {
  it('reports unreadable, unterminated, and non-mapping SKILL.md frontmatter', () => {
    const project = createRoot();
    expect(parseSkillDocument('---\nname: [unclosed\n---\n', 'SKILL.md')).toHaveProperty('message');
    expect(parseSkillDocument('---\nname: never-closed\n', 'SKILL.md')).toHaveProperty('message');
    expect(parseSkillDocument('---\n- a\n- b\n---\n', 'SKILL.md')).toHaveProperty('message');
    expect(readSkillDocument(join(project, 'missing', 'SKILL.md'))).toHaveProperty('message');
  });

  it('discovers symlinked skill directories and ignores plain files and broken symlinks', () => {
    const project = createRoot();
    const shared = createRoot();
    const skillsDirectory = join(project, '.outfitter', 'skills');
    const sharedSkill = writeSkill(shared, 'linked-skill', 'name: linked-skill');
    mkdirSync(skillsDirectory, { recursive: true });
    symlinkSync(sharedSkill, join(skillsDirectory, 'linked-skill'));
    symlinkSync(join(shared, 'absent'), join(skillsDirectory, 'broken-link'));
    writeFileSync(join(skillsDirectory, 'stray-file'), 'not a skill\n');

    const discovered = discoverSkillCatalog({ projectDirectory: project });

    expect(discovered.entries.has('linked-skill')).toBe(true);
    expect(discovered.entries.has('broken-link')).toBe(false);
    expect(discovered.entries.has('stray-file')).toBe(false);
  });

  it('throws when a skills directory cannot be read', () => {
    const project = createRoot();
    mkdirSync(join(project, '.outfitter'), { recursive: true });
    writeFileSync(join(project, '.outfitter', 'skills'), 'a file where a directory belongs\n');

    expect(() => discoverSkillCatalog({ projectDirectory: project })).toThrow(/Could not read skills directory/u);
  });

  it('surfaces invalid frontmatter and shipped-file collisions through resolution', () => {
    const project = createRoot();
    const output = createRoot();
    const skillsDirectory = join(project, '.outfitter', 'skills');
    writeSkill(skillsDirectory, 'invalid-frontmatter', 'name: [unclosed');
    const shippedSkill = writeSkill(
      skillsDirectory,
      'shipped-collision',
      'name: shipped-collision\nreferences:\n  - repo_file: docs/design.md',
    );
    mkdirSync(join(shippedSkill, 'references'), { recursive: true });
    writeFileSync(join(shippedSkill, 'references', 'design.md'), 'shipped\n');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs', 'design.md'), 'external\n');
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const invalid = resolveSkillEntries({
      entries: [{ entry: 'invalid-frontmatter' }],
      catalog,
      projectDirectory: project,
    });
    const collision = resolveSkillEntries({
      entries: [{ entry: 'shipped-collision' }],
      catalog,
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(invalid.diagnostics[0]?.message).toContain('frontmatter');
    expect(collision.diagnostics[0]?.message).toContain('collides with a file already shipped');
    expect(collision.sources).toEqual([]);
  });

  it('resolves adapter-scoped skill IDs and falls back to the project root for unmatched selections', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(join(project, '.outfitter', 'skills'), 'pi-only', 'name: pi-only');
    writeSkill(join(project, '.outfitter', 'skills'), 'claude-only', 'name: claude-only');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs', 'extra.md'), 'extra\n');
    const profile = parseProfileYaml(
      [
        'id: platform',
        'controls:',
        '  pi:',
        '    skills:',
        '      - id: pi-only',
        '        references:',
        '          - file: docs/extra.md',
        '  claude:',
        '    skills:',
        '      - claude-only',
      ].join('\n'),
      'platform',
    );

    expect('message' in profile).toBe(false);
    if ('message' in profile) {
      return;
    }

    const resolution = resolveProfileSkillControls({
      profile,
      profileLayers: [],
      sourcePaths: [],
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(resolution.diagnostics).toEqual([]);
    expect(resolution.profile.controls.pi?.skills).toEqual([join(output, 'outfitter', 'skills', 'pi-only')]);
    expect(resolution.profile.controls.claude?.skills).toEqual([join(output, 'outfitter', 'skills', 'claude-only')]);
    expect(readFileSync(join(output, 'outfitter', 'skills', 'pi-only', 'references', 'extra.md'), 'utf8')).toBe(
      'extra\n',
    );
  });
});
