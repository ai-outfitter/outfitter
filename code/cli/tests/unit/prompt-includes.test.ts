// Tests typed append-system-prompt file include resolution.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inferProfileIncludeSourceRoot, resolveAppendSystemPromptControl } from '../../src/profiles/PromptIncludes.js';
import { loadLocalProfileSource, parseProfileYaml } from '../../src/profiles/ProfileLoader.js';

const temporaryRoots: string[] = [];

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-prompt-includes-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('prompt includes', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.1, OFTR-003.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('parses literal and file append_system_prompt entries while rejecting unsupported typed entries', () => {
    const profile = parseProfileYaml(
      'id: engineer\ncontrols:\n  append_system_prompt:\n    - literal prompt\n    - file: prompts/team.md\n    - repo_file: docs/mission.md\n',
      'engineer',
    );
    const unsupported = parseProfileYaml(
      'id: engineer\ncontrols:\n  append_system_prompt:\n    - text: unsupported\n',
      'engineer',
    );

    expect('message' in profile).toBe(false);
    expect('message' in unsupported ? unsupported.message : '').toContain('must be string');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.6, OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves file includes from each declaring outfitter source root in precedence order', () => {
    const projectRoot = createRoot();
    const outfitterRoot = join(projectRoot, '.outfitter');
    const profilesRoot = join(outfitterRoot, 'profiles');
    mkdirSync(join(profilesRoot, 'base'), { recursive: true });
    mkdirSync(join(profilesRoot, 'engineer'), { recursive: true });
    mkdirSync(join(outfitterRoot, 'prompts'), { recursive: true });
    writeFileSync(join(outfitterRoot, 'prompts', 'base.md'), 'base include');
    writeFileSync(join(outfitterRoot, 'prompts', 'engineer.md'), 'engineer include');
    writeFileSync(
      join(profilesRoot, 'base', 'profile.yml'),
      'id: base\ncontrols:\n  append_system_prompt:\n    - file: .outfitter/prompts/base.md\n',
    );
    writeFileSync(
      join(profilesRoot, 'engineer', 'profile.yml'),
      'id: engineer\ninherits:\n  - base\ncontrols:\n  append_system_prompt:\n    - file: .outfitter/prompts/engineer.md\n',
    );
    const loaded = loadLocalProfileSource({ path: profilesRoot });

    const result = resolveAppendSystemPromptControl({
      fallback: undefined,
      profileLayers: loaded.profiles.map((layer) => ({
        profile: layer.profile,
        profilePath: layer.profilePath,
        sourceRootPath: layer.sourceRootPath,
        resourceRootPath: layer.resourceRootPath,
        layout: layer.layout,
      })),
      agentKey: 'pi',
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.prompts).toEqual(['engineer include', 'base include']);
  });

  it('infers include roots for home, project, catalog, and explicit profile sources', () => {
    const root = createRoot();

    expect(
      inferProfileIncludeSourceRoot({
        profilePath: join(homedir(), '.outfitter', 'profiles', 'engineer.yml'),
        sourceRootPath: join(homedir(), '.outfitter', 'profiles'),
      }),
    ).toBe(join(homedir(), '.outfitter'));
    expect(
      inferProfileIncludeSourceRoot({
        profilePath: join(root, '.outfitter', 'profiles', 'engineer.yml'),
        sourceRootPath: join(root, '.outfitter', 'profiles'),
      }),
    ).toBe(root);
    expect(
      inferProfileIncludeSourceRoot({
        profilePath: join(root, 'outfitter', 'profiles', 'engineer.yml'),
        sourceRootPath: join(root, 'outfitter', 'profiles'),
      }),
    ).toBe(root);
    expect(
      inferProfileIncludeSourceRoot({
        profilePath: join(root, 'profiles', 'engineer.yml'),
        sourceRootPath: join(root, 'profiles'),
      }),
    ).toBe(join(root, 'profiles'));
  });

  it('resolves repo_file entries from the active project directory', () => {
    const root = createRoot();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'mission.md'), 'project mission');

    const result = resolveAppendSystemPromptControl({
      fallback: [{ repo_file: 'docs/mission.md' }],
      projectDirectory: root,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.prompts).toEqual(['project mission']);
  });

  it('resolves absolute file and repo_file entries', () => {
    const root = createRoot();
    const catalogFile = join(root, 'catalog.md');
    const repoFile = join(root, 'repo.md');
    writeFileSync(catalogFile, 'catalog absolute');
    writeFileSync(repoFile, 'repo absolute');

    const result = resolveAppendSystemPromptControl({
      fallback: [{ file: catalogFile }, { repo_file: repoFile }],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.prompts).toEqual(['catalog absolute', 'repo absolute']);
  });

  it('warns for missing typed files and raw path-looking strings without warning for multiline prose', () => {
    const root = createRoot();
    const result = resolveAppendSystemPromptControl({
      fallback: [
        { file: 'prompts/missing.md' },
        { repo_file: 'docs/missing.md' },
        './prompts/raw.md',
        'Line one\nLine two',
      ],
      projectDirectory: root,
      profileLayers: [
        {
          profile: { id: 'engineer', inherits: [], controls: {} },
          profilePath: join(root, '.outfitter', 'profiles', 'engineer', 'profile.yml'),
          sourceRootPath: join(root, '.outfitter', 'profiles'),
        },
      ],
    });

    expect(result.prompts).toEqual(['./prompts/raw.md', 'Line one\nLine two']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Prompt file include 'prompts/missing.md' was not found.",
      "Prompt repo_file include 'docs/missing.md' was not found.",
      "Raw append_system_prompt entry looks like a file path; use { file: './prompts/raw.md' }.",
    ]);
  });

  it('warns when repo_file cannot resolve without a project directory', () => {
    const result = resolveAppendSystemPromptControl({
      fallback: [{ repo_file: 'docs/mission.md' }],
    });

    expect(result.prompts).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Prompt repo_file include 'docs/mission.md' was not found.",
    ]);
  });
});
