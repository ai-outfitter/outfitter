// Tests glob targets in skill reference, script, and asset materialization.
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

import { discoverSkillCatalog } from '../../src/skills/SkillCatalog.js';
import { resolveSkillEntries } from '../../src/skills/SkillResolution.js';

const temporaryRoots: string[] = [];

const createRoot = (prefix = 'outfitter-skill-globs-'): string => {
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

describe('glob targets in reference materialization', () => {
  it('expands file and repo_file globs so each match materializes by basename', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'globbed',
      'name: globbed\nreferences:\n  - file: docs/*.md\nassets:\n  - repo_file: templates/*.json',
    );
    mkdirSync(join(project, 'docs'), { recursive: true });
    mkdirSync(join(project, 'templates'), { recursive: true });
    writeFileSync(join(project, 'docs', 'alpha.md'), 'alpha\n');
    writeFileSync(join(project, 'docs', 'beta.md'), 'beta\n');
    writeFileSync(join(project, 'docs', 'notes.txt'), 'not matched\n');
    writeFileSync(join(project, 'templates', 'report.json'), '{}\n');
    // A matched broken symlink resolves to a missing repo_file target and is omitted.
    symlinkSync(join(project, 'templates', 'nonexistent.json'), join(project, 'templates', 'broken.json'));

    const catalog = discoverSkillCatalog({ projectDirectory: project });
    const resolution = resolveSkillEntries({
      entries: [{ entry: 'globbed' }],
      catalog,
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(resolution.diagnostics).toEqual([]);
    expect(readFileSync(join(output, 'globbed', 'references', 'alpha.md'), 'utf8')).toBe('alpha\n');
    expect(readFileSync(join(output, 'globbed', 'references', 'beta.md'), 'utf8')).toBe('beta\n');
    expect(existsSync(join(output, 'globbed', 'references', 'notes.txt'))).toBe(false);
    expect(readFileSync(join(output, 'globbed', 'assets', 'report.json'), 'utf8')).toBe('{}\n');
    expect(existsSync(join(output, 'globbed', 'assets', 'broken.json'))).toBe(false);
  });

  it('recurses ** globs and materializes matched directories recursively', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'deep-glob',
      'name: deep-glob\nreferences:\n  - file: docs/**/*.md\nassets:\n  - file: code/*',
    );
    mkdirSync(join(project, 'docs', 'guides'), { recursive: true });
    writeFileSync(join(project, 'docs', 'top.md'), 'top\n');
    writeFileSync(join(project, 'docs', 'guides', 'deep.md'), 'deep\n');
    const template = join(project, 'code', 'project-repo-template');
    mkdirSync(join(template, 'scripts'), { recursive: true });
    writeFileSync(join(template, 'scripts', 'setup.sh'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(project, 'code', 'notes.md'), 'notes\n');

    const catalog = discoverSkillCatalog({ projectDirectory: project });
    const resolution = resolveSkillEntries({
      entries: [{ entry: 'deep-glob' }],
      catalog,
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(resolution.diagnostics).toEqual([]);
    expect(readFileSync(join(output, 'deep-glob', 'references', 'top.md'), 'utf8')).toBe('top\n');
    expect(readFileSync(join(output, 'deep-glob', 'references', 'deep.md'), 'utf8')).toBe('deep\n');
    const materializedTemplate = join(output, 'deep-glob', 'assets', 'project-repo-template');
    expect(readFileSync(join(materializedTemplate, 'scripts', 'setup.sh'), 'utf8')).toBe('#!/bin/sh\n');
    expect(statSync(join(materializedTemplate, 'scripts', 'setup.sh')).mode & 0o100).toBe(0o100);
    expect(readFileSync(join(output, 'deep-glob', 'assets', 'notes.md'), 'utf8')).toBe('notes\n');
  });

  it('fails a zero-match file glob and omits a zero-match repo_file glob', () => {
    const project = createRoot();
    const output = createRoot();
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'empty-file-glob',
      'name: empty-file-glob\nreferences:\n  - file: docs/*.md',
    );
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'empty-repo-glob',
      'name: empty-repo-glob\nreferences:\n  - repo_file: docs/*.md',
    );
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const failing = resolveSkillEntries({
      entries: [{ entry: 'empty-file-glob' }],
      catalog,
      projectDirectory: project,
    });
    const omitted = resolveSkillEntries({
      entries: [{ entry: 'empty-repo-glob' }],
      catalog,
      projectDirectory: project,
      outputDirectory: output,
    });

    expect(failing.diagnostics[0]?.message).toContain("Reference file glob 'docs/*.md' matched no files under");
    expect(omitted.diagnostics).toEqual([]);
    expect(omitted.sources).toEqual([join(output, 'empty-repo-glob')]);
    expect(existsSync(join(output, 'empty-repo-glob', 'references'))).toBe(false);
  });

  it('fails glob-induced basename collisions naming both sources', () => {
    const project = createRoot();
    mkdirSync(join(project, 'docs', 'alpha'), { recursive: true });
    mkdirSync(join(project, 'docs', 'beta'), { recursive: true });
    writeFileSync(join(project, 'docs', 'alpha', 'readme.md'), 'alpha\n');
    writeFileSync(join(project, 'docs', 'beta', 'readme.md'), 'beta\n');
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'colliding-glob',
      'name: colliding-glob\nreferences:\n  - file: docs/**/readme.md',
    );
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const resolution = resolveSkillEntries({
      entries: [{ entry: 'colliding-glob' }],
      catalog,
      projectDirectory: project,
    });

    const message = resolution.diagnostics[0]?.message;
    expect(message).toContain("Destination 'references/readme.md' is declared more than once");
    expect(message).toContain(join(project, 'docs', 'alpha', 'readme.md'));
    expect(message).toContain(join(project, 'docs', 'beta', 'readme.md'));
  });

  it('fails a glob match that escapes the reference root through a symlink', () => {
    const project = createRoot();
    const outside = createRoot();
    writeFileSync(join(outside, 'secret.md'), 'secret\n');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(join(project, 'docs', 'design.md'), 'design\n');
    symlinkSync(join(outside, 'secret.md'), join(project, 'docs', 'escape.md'));
    writeSkill(
      join(project, '.outfitter', 'skills'),
      'escaping-glob',
      'name: escaping-glob\nreferences:\n  - file: docs/*.md',
    );
    const catalog = discoverSkillCatalog({ projectDirectory: project });

    const resolution = resolveSkillEntries({
      entries: [{ entry: 'escaping-glob' }],
      catalog,
      projectDirectory: project,
    });

    expect(resolution.diagnostics[0]?.message).toContain(
      "Reference file 'docs/escape.md' resolves outside its catalog root",
    );
    expect(resolution.sources).toEqual([]);
  });
});
