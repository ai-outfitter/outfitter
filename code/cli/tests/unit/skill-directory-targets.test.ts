// Tests directory targets in skill reference, script, and asset materialization.
import {
  existsSync,
  lstatSync,
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

import { discoverSkillCatalog } from '../../src/skills/SkillCatalog.js';
import { resolveSkillEntries } from '../../src/skills/SkillResolution.js';

const temporaryRoots: string[] = [];

const createRoot = (prefix = 'outfitter-skill-dirs-'): string => {
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

describe('directory targets in reference materialization', () => {
  it('materializes a directory target recursively with dereferenced symlinks and preserved modes', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'template-shipper',
      'name: template-shipper\nassets:\n  - file: code/project-repo-template',
    );
    const template = join(project, 'code', 'project-repo-template');
    mkdirSync(join(template, 'scripts'), { recursive: true });
    writeFileSync(join(template, 'README.md'), 'template readme\n');
    writeFileSync(join(template, 'scripts', 'setup.sh'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(project, 'code', 'shared.md'), 'shared\n');
    // In-root symlinks are dereferenced so the generated skill is self-contained;
    // the duplicate directory link also exercises the scan's shared-subtree memo.
    symlinkSync(join(project, 'code', 'shared.md'), join(template, 'shared-link.md'));
    symlinkSync(join(template, 'scripts'), join(template, 'scripts-link'));

    const catalog = discoverSkillCatalog({ projectDirectory: project });
    const resolution = resolveSkillEntries({
      entries: [{ entry: 'template-shipper' }],
      catalog,
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(resolution.diagnostics).toEqual([]);
    const materialized = join(output, 'template-shipper', 'assets', 'project-repo-template');
    expect(readFileSync(join(materialized, 'README.md'), 'utf8')).toBe('template readme\n');
    expect(readFileSync(join(materialized, 'scripts', 'setup.sh'), 'utf8')).toBe('#!/bin/sh\n');
    expect(statSync(join(materialized, 'scripts', 'setup.sh')).mode & 0o100).toBe(0o100);
    expect(readFileSync(join(materialized, 'shared-link.md'), 'utf8')).toBe('shared\n');
    expect(lstatSync(join(materialized, 'shared-link.md')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(materialized, 'scripts-link', 'setup.sh'), 'utf8')).toBe('#!/bin/sh\n');
  });

  it('omits a missing directory repo_file target and materializes a present one', () => {
    const catalogRepo = createRoot();
    mkdirSync(join(catalogRepo, 'profiles'), { recursive: true });
    writeSkill(
      join(catalogRepo, 'skills'),
      'template-shipper',
      'name: template-shipper\nassets:\n  - repo_file: code/project-repo-template',
    );
    const bareProject = createRoot();
    const templateProject = createRoot();
    mkdirSync(join(templateProject, 'code', 'project-repo-template'), { recursive: true });
    writeFileSync(join(templateProject, 'code', 'project-repo-template', 'config.yml'), 'kind: template\n');
    const resolve = (projectDirectory: string, outputDirectory: string) =>
      resolveSkillEntries({
        entries: [{ entry: 'template-shipper' }],
        catalog: discoverSkillCatalog({ projectDirectory, sourcePaths: [join(catalogRepo, 'profiles')] }),
        projectDirectory,
        outputDirectory,
      });

    const bareOutput = createRoot();
    const templateOutput = createRoot();
    const omitted = resolve(bareProject, bareOutput);
    const present = resolve(templateProject, templateOutput);

    expect(omitted.diagnostics).toEqual([]);
    expect(existsSync(join(bareOutput, 'template-shipper', 'assets'))).toBe(false);
    expect(present.diagnostics).toEqual([]);
    expect(
      readFileSync(join(templateOutput, 'template-shipper', 'assets', 'project-repo-template', 'config.yml'), 'utf8'),
    ).toBe('kind: template\n');
  });

  it('fails a basename collision between a directory target and a file target', () => {
    const project = createRoot();
    mkdirSync(join(project, 'docs'), { recursive: true });
    mkdirSync(join(project, 'other'), { recursive: true });
    writeFileSync(join(project, 'docs', 'design.md'), 'design\n');
    writeFileSync(join(project, 'other', 'docs'), 'a file named docs\n');
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'colliding-kinds',
      'name: colliding-kinds\nreferences:\n  - file: docs\n  - repo_file: other/docs',
    );
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const resolution = resolveSkillEntries({
      entries: [{ entry: 'colliding-kinds' }],
      catalog,
      projectDirectory: project,
    });

    expect(resolution.diagnostics[0]?.message).toContain("Destination 'references/docs' is declared more than once");
  });

  it('fails a directory target containing a symlink that escapes the reference root', () => {
    const project = createRoot();
    const outside = createRoot();
    writeFileSync(join(outside, 'secret.md'), 'secret\n');
    mkdirSync(join(project, 'docs', 'nested'), { recursive: true });
    writeFileSync(join(project, 'docs', 'design.md'), 'design\n');
    symlinkSync(join(outside, 'secret.md'), join(project, 'docs', 'nested', 'escape.md'));
    mkdirSync(join(project, 'shared'), { recursive: true });
    symlinkSync(join(outside, 'secret.md'), join(project, 'shared', 'escape.md'));
    mkdirSync(join(project, 'linking'), { recursive: true });
    // The in-root directory link is followed, so its escaping content still fails.
    symlinkSync(join(project, 'shared'), join(project, 'linking', 'shared-link'));
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'escaping-dir',
      'name: escaping-dir\nreferences:\n  - file: docs',
    );
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'escaping-linked-dir',
      'name: escaping-linked-dir\nreferences:\n  - file: linking',
    );
    const catalog = discoverSkillCatalog({ projectDirectory: project });
    const resolve = (id: string) =>
      resolveSkillEntries({ entries: [{ entry: id }], catalog, projectDirectory: project }).diagnostics;

    expect(resolve('escaping-dir')[0]?.message).toContain(
      `contains '${join('nested', 'escape.md')}', which resolves outside`,
    );
    expect(resolve('escaping-linked-dir')[0]?.message).toContain(
      `contains '${join('shared-link', 'escape.md')}', which resolves outside`,
    );
  });

  it('fails a directory target containing a symlink cycle', () => {
    const project = createRoot();
    mkdirSync(join(project, 'looping'), { recursive: true });
    symlinkSync(join(project, 'looping'), join(project, 'looping', 'loop'));
    writeSkill(join(project, '.outfitter', 'skills'), 'cyclic-dir', 'name: cyclic-dir\nassets:\n  - file: looping');
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const resolution = resolveSkillEntries({
      entries: [{ entry: 'cyclic-dir' }],
      catalog,
      projectDirectory: project,
    });

    expect(resolution.diagnostics[0]?.message).toContain("contains 'loop', which creates a symlink cycle");
  });
});
