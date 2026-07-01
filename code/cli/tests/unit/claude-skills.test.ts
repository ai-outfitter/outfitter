// Tests Claude Code skill materialization into the composite profile skills directory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createClaudeAdapter } from '../../src/agents/claude/ClaudeAdapter.js';
import type { CompositeProfileStatePath } from '../../src/compositeProfile/StatePersistence.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-claude-skills-'));
  temporaryRoots.push(root);
  return root;
};

const writeSkill = (skillsFolder: string, name: string, content = `# ${name}\n`): string => {
  const skillDirectory = join(skillsFolder, name);
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(join(skillDirectory, 'SKILL.md'), content);
  return skillDirectory;
};

const findStatePath = (
  statePaths: readonly CompositeProfileStatePath[],
  relativePath: string,
): CompositeProfileStatePath | undefined => statePaths.find((statePath) => statePath.relativePath === relativePath);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Claude Code adapter skills materialization', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('materializes profile skills as per-skill symlinks deduplicated by identity and name', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const baseFolder = join(root, 'profiles', 'base');
    const selectedFolder = join(root, 'profiles', 'selected');
    const baseShadowed = writeSkill(join(baseFolder, 'skills'), 'shadowed');
    const baseOnly = writeSkill(join(baseFolder, 'skills'), 'base-only');
    const selectedShadowing = writeSkill(join(selectedFolder, 'skills'), 'shadowed');
    const projectSkill = writeSkill(join(projectDirectory, 'tools', 'skills'), 'project-skill');
    const personalSkill = writeSkill(join(homeDirectory, '.claude', 'skills'), 'personal-skill');
    writeFileSync(join(homeDirectory, '.claude', 'skills', 'notes.md'), 'personal flat note\n');
    writeSkill(join(homeDirectory, '.claude', 'skills'), 'shadowed', '# personal shadowed skill\n');

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      {
        id: 'skillful',
        inherits: [],
        controls: {
          skills: ['./tools/skills/project-skill', join(projectDirectory, 'tools', 'skills', 'project-skill')],
        },
      },
      {
        rootDirectory: join(root, 'composite'),
        profilePaths: [],
        profileFolders: [baseFolder, selectedFolder],
        homeDirectory,
        projectDirectory,
      },
    );
    const statePaths = compositeProfilePlan.compositeProfile.statePaths;

    expect(adapter.supportedControls).toContain('skills');
    expect(adapter.getUnsupportedControls({ id: 'skillful', inherits: [], controls: { skills: ['x'] } })).toEqual([]);
    expect(compositeProfilePlan.warnings).toEqual([]);
    expect(findStatePath(statePaths, 'skills/')).toEqual({
      relativePath: 'skills/',
      strategy: 'warn',
      directory: true,
    });
    expect(findStatePath(statePaths, 'skills/project-skill/')).toMatchObject({
      strategy: 'symlink',
      sourcePath: projectSkill,
      directory: true,
    });
    expect(findStatePath(statePaths, 'skills/shadowed/')).toMatchObject({ sourcePath: selectedShadowing });
    expect(findStatePath(statePaths, 'skills/base-only/')).toMatchObject({ sourcePath: baseOnly });
    expect(findStatePath(statePaths, 'skills/personal-skill/')).toMatchObject({ sourcePath: personalSkill });
    expect(findStatePath(statePaths, 'skills/notes.md')).toMatchObject({
      strategy: 'symlink',
      sourcePath: join(homeDirectory, '.claude', 'skills', 'notes.md'),
      directory: false,
    });
    expect(statePaths.filter((statePath) => statePath.sourcePath === baseShadowed)).toEqual([]);
    expect(
      statePaths.filter(
        (statePath) => statePath.relativePath.startsWith('skills/') && statePath.relativePath !== 'skills/',
      ).length,
    ).toBe(5);
  });

  it('resolves bare skill names from profile skills folders and warns for unresolved skills', () => {
    const root = createTemporaryRoot();
    const profileFolder = join(root, 'profiles', 'named');
    const namedSkill = writeSkill(join(profileFolder, 'cli_specific', 'claude', 'skills'), 'named-skill');

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      {
        id: 'named',
        inherits: [],
        controls: { claude: { skills: ['named-skill', 'missing-skill', String.raw`windows\style`] } },
      },
      {
        rootDirectory: join(root, 'composite'),
        profilePaths: [],
        profileFolders: [profileFolder],
        homeDirectory: join(root, 'home'),
        projectDirectory: join(root, 'project'),
      },
    );

    expect(compositeProfilePlan.warnings).toEqual([
      "claude adapter could not find skill 'missing-skill' for profile 'named'.",
      `claude adapter could not find skill '${String.raw`windows\style`}' for profile 'named'.`,
    ]);
    expect(findStatePath(compositeProfilePlan.compositeProfile.statePaths, 'skills/named-skill/')).toMatchObject({
      strategy: 'symlink',
      sourcePath: namedSkill,
    });
  });

  it('keeps the whole-directory skills symlink when no profile skills resolve', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    writeSkill(join(homeDirectory, '.claude', 'skills'), 'personal-only');

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'plain', inherits: [], controls: { skills: ['missing-skill'] } },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [], homeDirectory },
    );
    const statePaths = compositeProfilePlan.compositeProfile.statePaths;

    expect(compositeProfilePlan.warnings).toEqual([
      "claude adapter could not find skill 'missing-skill' for profile 'plain'.",
    ]);
    expect(findStatePath(statePaths, 'skills/')).toMatchObject({
      strategy: 'symlink',
      sourcePath: join(homeDirectory, '.claude', 'skills'),
    });
    expect(statePaths.filter((statePath) => statePath.relativePath.startsWith('skills/')).length).toBe(1);
  });

  it('respects a non-symlink skills state persistence override while materializing profile skills', () => {
    const root = createTemporaryRoot();
    const profileFolder = join(root, 'profiles', 'sandboxed');
    const sandboxSkill = writeSkill(join(profileFolder, 'skills'), 'sandbox-skill');

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'sandboxed', inherits: [], controls: {}, statePersistence: { 'skills/': 'discard' } },
      {
        rootDirectory: join(root, 'composite'),
        profilePaths: [],
        profileFolders: [profileFolder],
        homeDirectory: join(root, 'home'),
      },
    );
    const statePaths = compositeProfilePlan.compositeProfile.statePaths;

    expect(findStatePath(statePaths, 'skills/')).toMatchObject({ strategy: 'discard', sourcePath: undefined });
    expect(findStatePath(statePaths, 'skills/sandbox-skill/')).toMatchObject({
      strategy: 'symlink',
      sourcePath: sandboxSkill,
    });
  });

  it('reports unreadable profile skills folders', () => {
    const root = createTemporaryRoot();
    const profileFolder = join(root, 'profiles', 'broken');
    mkdirSync(profileFolder, { recursive: true });
    writeFileSync(join(profileFolder, 'skills'), 'not a directory');

    expect(() =>
      createClaudeAdapter().createCompositeProfile(
        { id: 'broken', inherits: [], controls: {} },
        { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder] },
      ),
    ).toThrow(`Could not read Claude skills folder '${join(profileFolder, 'skills')}'`);
  });
});
